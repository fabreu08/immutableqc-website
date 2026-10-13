// iqc watch and iqc seal: open (or start) the ledger, then seal what changed.
//
// A file is a candidate when its size or modification time differs from what was last sealed (the record's bytes and
// ctx.modifiedAt) or last seen by this agent. A candidate is read once its size and times have not changed for
// --settle seconds, and only if it can be opened (a busy or locked file is retried on the next poll; after a minute
// the agent warns once). If it changed while being read, it waits again. Its SHA-256 goes to core's planSeal with
// the rest of the folder, which decides what to seal and with which event (a touched file with the same bytes is
// not sealed again), so the agent and the app follow one rule.
//
// Events: the files found at the start of a session (a watch's first pass, or a seal) get the first-scan events
// (existing) on a ledger's first scan, else the -unwatched ones; files seen while a watch runs get added, changed and
// removed. A file missing at the start is recorded removed at once (its removal is a past fact); during a watch a
// file must stay missing for --settle seconds first (a program that saves by deleting and renaming does not make a
// removal). A seal handles the files present when it starts, then exits; it waits for files that are being written
// or are locked as long as other files make progress, and at most a minute without progress.
import { hostname } from 'node:os'
import { existsSync } from 'node:fs'
import { isFirstScan, planSeal, formatBytes, formatHead, formatDuration, formatCount } from '../../core/immutableqc.mjs'
import { AGENT, UserError, EXIT_OK, EXIT_FAIL, EXIT_USAGE, Wake, sleep, pool, isoOf, plural } from './util.mjs'
import { dataFolder, locate, displayPath } from './paths.mjs'
import { acquireLock } from './lock.mjs'
import { createKey, loadKey } from './keys.mjs'
import { readLedger, brokenMessage, createLedger, ensureDir, ensureReadme, Appender } from './ledger.mjs'
import { walk, outOfSight, skipper, hashFile, sameStat, BUSY, Stopped } from './scan.mjs'
import { stationProblem } from './args.mjs'

const MINUTE = 60000
const HASHERS = 4

// Opens the ledger for writing: verifies an existing one whole (and refuses a broken one), or starts a new one with
// a new key (or the --key file). Returns {appender, key, station, created}. A missing ledger whose folder was set up
// before (README.txt is written only once a ledger exists) is not replaced silently: it may have been moved or deleted.
export async function openForWriting(loc, opts, out) {
  const r = await readLedger(loc.ledgerPath, { missingOk: true })
  if (!r && loc.isDefault && existsSync(loc.readmePath)) {
    throw new UserError(`There is no ledger at ${loc.ledgerPath}, but its folder was set up before (its README.txt is there): the ledger may have been moved, renamed or deleted. Nothing was written. ` +
      `Put the ledger back; or, to start a new ledger for this folder, delete ${loc.readmePath} and run again.`)
  }
  if (r) {
    if (!r.verified.ok) throw new UserError(brokenMessage(r.verified, loc.ledgerPath))
    const key = await loadKey({ header: r.verified.header, keyOpt: opts.key, out })
    const station = opts.station || r.verified.header.station
    return { appender: new Appender(loc.ledgerPath, r.verified, r.stat, { out }), key, station, created: false }
  }
  let station = opts.station
  if (!station) {
    station = hostname()
    const why = stationProblem(station)
    if (why) throw new UserError(`This computer's name (${JSON.stringify(station)}) cannot be the station name: ${why}. Give one with --station <name>.`)
  }
  const key = opts.key ? await loadKey({ keyOpt: opts.key, out }) : await createKey()
  const made = await createLedger(loc.ledgerPath, { key, station })
  return { appender: new Appender(loc.ledgerPath, made.verified, made.stat, { out }), key, station, created: true }
}

export async function runSession(kind, { folder, opts, out, signals = process }) {
  const root = dataFolder(folder)
  const loc = locate(root, opts.ledger)
  ensureDir(loc.dir)
  const lock = acquireLock(loc.lockPath, { command: kind, out })
  try {
    const open = await openForWriting(loc, opts, out)
    if (loc.isDefault) ensureReadme(loc.readmePath)
    const s = new Session(kind, { root, loc, opts, out, ...open, signals })
    return await s.run()
  } finally {
    lock.release()
  }
}

class Session {
  constructor(kind, { root, loc, opts, out, appender, key, station, created, signals }) {
    Object.assign(this, { kind, root, loc, opts, out, appender, key, station, created, signals })
    this.settleMs = Math.round((opts.settle ?? 3) * 1000)
    this.intervalMs = Math.round((opts.interval ?? 2) * 1000)
    this.ignore = opts.ignore || []
    this.skip = skipper(this.ignore, loc.own)
    this.known = new Map() // path -> {size, mtimeMs, ctimeMs?, floor?}: what was last sealed or last read
    this.pending = new Map() // path -> candidate {abs, size, mtimeMs, ctimeMs, since, firstAt, startup, busySince, busyCode, warned}
    this.absent = new Map() // path -> since when a sealed file has been missing (watch)
    this.warnedOnce = new Set()
    this.stopping = false
    this.wake = new Wake()
    this.count = { sealed: 0, changed: 0, removed: 0, unchanged: 0 }
    this.buffers = Array.from({ length: HASHERS }, () => Buffer.allocUnsafe(1 << 20))
    this.rootDown = false
    this.walkState = {}
    // what the ledger says was last sealed: a file whose size and modification time still match is not read again
    for (const e of this.v.files.values()) {
      const l = e.latest
      if (l.kind === 'file' && typeof l.modifiedAt === 'string' && Number.isFinite(Date.parse(l.modifiedAt))) {
        this.known.set(e.path, { size: Number(l.bytes), floor: Date.parse(l.modifiedAt) })
      }
    }
  }

  get v() { return this.appender.v }

  async run() {
    const { out } = this
    const startedAt = Date.now()
    if (this.created) {
      const h = this.v.header
      out.print(`New ledger ${this.loc.shown} (ledger id ${h.ledgerId}, station ${h.station}).`)
      if (this.key.created) {
        out.print(`New signing key ${this.key.keyId}, saved to ${this.key.file}`)
        out.print('  Keep a backup of that file: it is needed to add records to this ledger (never to audit it).')
      }
    }
    const stopOn = ['SIGINT', 'SIGTERM', ...(process.platform === 'win32' ? ['SIGBREAK', 'SIGHUP'] : ['SIGHUP'])]
    let signalled = 0
    const onSignal = () => {
      signalled++
      if (signalled > 1) {
        out.error('Stopped at once (second signal). The ledger is complete up to its last record; the next start records the missing stop as a note.')
        process.exit(130)
      }
      this.stop()
    }
    for (const s of stopOn) this.signals.on(s, onSignal)
    try {
      if (this.kind === 'watch') return await this.watch(startedAt)
      return await this.sealOnce(startedAt)
    } finally {
      for (const s of stopOn) this.signals.removeListener(s, onSignal)
    }
  }

  stop() {
    this.stopping = true
    this.wake.fire()
  }

  async session(event) {
    await this.appender.sync()
    const at = new Date().toISOString()
    await this.appender.append([{ kind: 'session', f: { station: this.station, event, at, agent: AGENT } }], this.key.privateKey)
  }

  async watch(startedAt) {
    const { out } = this
    await this.session('watch-started')
    const startup = isFirstScan(this.v) ? 'first' : 'unwatched'
    out.print(`Watching ${this.root}`)
    out.print(`  ledger ${this.loc.shown}, ${plural(this.v.recordCount, 'record', 'records')}, station ${this.station}, key id ${this.key.keyId}`)
    out.print(`  every ${this.intervalMs / 1000} s; a file is sealed once it has not changed for ${this.settleMs / 1000} s. Press Ctrl+C to stop.`)
    this.warnUnclean()
    out.stamp = true
    let first = true, caughtUp = false
    while (!this.stopping) {
      // the start-of-session pass is the first poll that could read the folder
      if (await this.poll({ first, startup, allowNew: true })) first = false
      if (this.stopping) break
      if (!first && !caughtUp && ![...this.pending.values()].some((c) => c.startup)) {
        caughtUp = true
        let n = 0
        for (const e of this.v.files.values()) if (e.latest.kind === 'file') n++
        out.print(`Every file found at the start is sealed (${plural(n, 'file', 'files')} in the ledger). Watching for changes.`)
      }
      await sleep(this.nextWait(), this.wake)
    }
    await this.session('watch-stopped')
    out.stamp = false
    const c = this.count
    out.print(`Stopped after ${formatDuration(Date.now() - startedAt)}: ${c.sealed} sealed, ${c.changed} changed, ${c.removed} removed. Head ${formatHead(this.v.head)}`)
    return EXIT_OK
  }

  async sealOnce(startedAt) {
    const { out } = this
    await this.session('scan')
    this.warnUnclean()
    const startup = isFirstScan(this.v) ? 'first' : 'unwatched'
    await this.poll({ first: true, startup, allowNew: false })
    // wait as long as files keep being sealed; give up on the rest after a minute without progress (longer when the
    // settle time is long: a file needs at least two looks, --settle seconds apart)
    const patience = Math.max(MINUTE, 2 * this.settleMs + 2 * this.intervalMs)
    let lastProgress = Date.now(), done = this.done()
    while (this.pending.size && !this.stopping) {
      if (Date.now() - lastProgress >= patience) break
      await sleep(this.nextWait(), this.wake)
      if (this.stopping) break
      await this.poll({ first: false, startup, allowNew: false })
      if (this.done() !== done) { done = this.done(); lastProgress = Date.now() }
    }
    for (const [p, c] of this.pending) {
      out.warn(`Not sealed: ${displayPath(p)} ${c.busySince !== null ? `could not be read (${c.busyCode}: open in another program, or no permission)` : 'kept changing'}. The next seal or watch picks it up.`)
    }
    const c = this.count
    if (this.stopping) {
      out.error(`Stopped before the seal finished: ${c.sealed} sealed, ${c.changed} changed, ${c.removed} removed so far. The ledger is complete up to record ${this.v.head.n}.`)
      return EXIT_FAIL
    }
    const what = c.sealed + c.changed + c.removed
      ? `Sealed ${c.sealed} new, ${c.changed} changed, ${c.removed} removed; ${formatCount(c.unchanged)} unchanged`
      : `Nothing new to seal: ${plural(c.unchanged, 'file', 'files')} unchanged`
    out.print(`${what} (${formatDuration(Date.now() - startedAt)}). Head ${formatHead(this.v.head)}`)
    return EXIT_OK
  }

  // the session record just written ended a watch that never recorded its stop
  warnUnclean() {
    const s = this.v.sessions.find((x) => x.type === 'watch' && x.clean === false && x.endedByN === this.v.head.n)
    if (s) this.out.warn(`The watch before this one (started in record ${s.startN}) has no stop record: it did not stop cleanly (a crash, a forced quit or a power loss). An audit shows it as a note.`)
  }

  done() { return this.count.sealed + this.count.changed + this.count.removed + this.count.unchanged }

  // how long to sleep: the poll interval, or less when a candidate settles (or a removal is due) sooner
  nextWait() {
    const now = Date.now()
    let next = now + this.intervalMs
    for (const c of this.pending.values()) if (c.busySince === null && c.since + this.settleMs < next) next = c.since + this.settleMs
    for (const t of this.absent.values()) if (t + this.settleMs < next) next = t + this.settleMs
    return Math.max(20, next - now)
  }

  warnOnce(key, msg) {
    if (this.warnedOnce.has(key)) return
    this.warnedOnce.add(key)
    this.out.warn(msg)
  }

  async poll({ first, startup, allowNew }) {
    const { out } = this
    let w
    try {
      w = await walk(this.root, { skip: this.skip, state: this.walkState })
    } catch (e) {
      if (this.kind === 'seal') throw new UserError(`Cannot read the folder ${this.root} (${e.code || e.message}).`, EXIT_USAGE)
      if (!this.rootDown) out.warn(`Cannot read the folder ${this.root} (${e.code || e.message}). Nothing is recorded as removed while it is out of reach; retrying every ${this.intervalMs / 1000} s.`)
      this.rootDown = true
      return false
    }
    if (this.rootDown) { out.print(`The folder ${this.root} can be read again.`); this.rootDown = false }
    for (const d of w.unreadable) this.warnOnce(`dir:${d}`, `Cannot open the folder ${displayPath(d)}; what is inside it is left as it was sealed until it can be read.`)
    for (const [p, names] of w.ambiguous) this.warnOnce(`amb:${p}`, `Not sealed: ${names.length} files are named ${displayPath(p)}, written in different Unicode forms (NFC and NFD). Rename one of them.`)
    for (const p of w.symlinks) this.warnOnce(`link:${p}`, `Skipped ${displayPath(p)}: it is a symbolic link (links are never followed or sealed).`)
    for (const raw of w.badNames) this.warnOnce(`name:${raw}`, `Skipped a file whose name cannot be stored: ${JSON.stringify(raw)}.`)

    const now = Date.now()
    // 1. candidates
    for (const [p, e] of w.files) {
      const k = this.known.get(p)
      if (k && (k.floor !== undefined ? k.size === e.size && k.floor === Math.floor(e.mtimeMs) : sameStat(k, e))) {
        if (first) this.count.unchanged++
        this.pending.delete(p)
        continue
      }
      let c = this.pending.get(p)
      if (!c) {
        if (!first && !allowNew) continue
        c = { size: e.size, mtimeMs: e.mtimeMs, ctimeMs: e.ctimeMs, since: now, firstAt: now, startup: first, busySince: null, busyCode: null, warned: false }
        this.pending.set(p, c)
      } else if (!sameStat(c, e)) {
        Object.assign(c, { size: e.size, mtimeMs: e.mtimeMs, ctimeMs: e.ctimeMs, since: now })
      }
      c.abs = e.abs
      if (this.kind === 'watch' && !c.warned && c.busySince === null && now - c.firstAt >= 5 * MINUTE) {
        c.warned = true
        out.warn(`${displayPath(p)} has kept changing for ${formatDuration(now - c.firstAt)}; it is sealed once it stops changing for ${this.settleMs / 1000} s.`)
      }
    }
    for (const p of [...this.pending.keys()]) if (!w.files.has(p)) this.pending.delete(p)

    // 2. removals
    const removeNow = new Set()
    for (const e of this.v.files.values()) {
      if (e.latest.kind !== 'file') continue
      const p = e.path
      if (w.files.has(p) || outOfSight(w, p) || this.skip(p)) { this.absent.delete(p); continue }
      if (first) removeNow.add(p)
      else if (this.kind === 'watch') {
        const t = this.absent.get(p) ?? now
        this.absent.set(p, t)
        if (now - t >= this.settleMs) removeNow.add(p)
      }
    }

    // 3. read the candidates that have settled
    const due = [...this.pending].filter(([, c]) => now - c.since >= this.settleMs).map(([p]) => p)
    const read = new Map()
    const free = [...this.buffers]
    await pool(due, HASHERS, async (p) => {
      if (this.stopping) return
      const c = this.pending.get(p)
      const buf = free.pop()
      try {
        const r = await hashFile(c.abs, { stop: () => this.stopping, buf })
        if (r.bytes !== c.size || !sameStat(c, r.before) || !sameStat(c, r.after)) {
          // it changed while it was read: wait for it to settle again
          Object.assign(c, { size: r.after.size, mtimeMs: r.after.mtimeMs, ctimeMs: r.after.ctimeMs, since: Date.now(), busySince: null })
          return
        }
        this.pending.delete(p)
        this.known.set(p, { size: c.size, mtimeMs: c.mtimeMs, ctimeMs: c.ctimeMs })
        const v = { sha256: r.sha256, bytes: String(r.bytes), observedAt: r.observedAt, startup: c.startup }
        const m = isoOf(c.mtimeMs)
        if (m) v.modifiedAt = m
        read.set(p, v)
      } catch (e) {
        if (e instanceof Stopped) return
        if (e.code === 'ENOENT') { this.pending.delete(p); return }
        const t = Date.now()
        if (c.busySince === null) c.busySince = t
        c.busyCode = e.code || 'error'
        if (this.kind === 'watch' && !c.warned && t - c.busySince >= MINUTE) {
          c.warned = true
          out.warn(`Cannot read ${displayPath(p)} for ${formatDuration(t - c.busySince)} (${c.busyCode}${BUSY.has(e.code) ? ': open in another program, or no permission' : ''}). Still trying.`)
        }
      } finally {
        free.push(buf)
      }
    })
    if (this.stopping && !read.size && !removeNow.size) return true

    // 4. seal: the start-of-session files with the start events, the rest with the watch events. Each plan sees the
    //    whole folder; paths that belong to the other plan are passed as present-but-unread, so neither seals or
    //    removes them twice.
    const groups = [[startup, new Map([...read].filter(([, v]) => v.startup)), first ? removeNow : new Set()],
      ['watch', new Map([...read].filter(([, v]) => !v.startup)), first ? new Set() : removeNow]]
    for (const [mode, seal, remove] of groups) {
      if (!seal.size && !remove.size) continue
      if (await this.appender.sync()) { this.reload(); }
      const files = new Map()
      for (const e of this.v.files.values()) if (e.latest.kind === 'file' && !remove.has(e.path)) files.set(e.path, null)
      for (const [p, v] of seal) files.set(p, { sha256: v.sha256, bytes: v.bytes, observedAt: v.observedAt, ...(v.modifiedAt ? { modifiedAt: v.modifiedAt } : {}) })
      const items = planSeal(this.v, files, { mode, station: this.station, observedAt: new Date().toISOString(), ignore: this.ignore })
      const sealedPaths = new Set(items.map((x) => x.f.path))
      for (const p of seal.keys()) if (!sealedPaths.has(p)) this.count.unchanged++
      const recs = await this.appender.append(items, this.key.privateKey)
      for (const r of recs) {
        if (r.kind === 'file-removed') this.known.delete(r.f.path)
        this.show(r)
      }
      for (const p of remove) this.absent.delete(p)
    }
    return true
  }

  // after the ledger was read again from disk (grown by another program), what it says was last sealed
  reload() {
    for (const e of this.v.files.values()) {
      const l = e.latest
      if (l.kind === 'file' && !this.known.has(e.path) && typeof l.modifiedAt === 'string') this.known.set(e.path, { size: Number(l.bytes), floor: Date.parse(l.modifiedAt) })
    }
  }

  show(r) {
    const f = r.f, out = this.out
    const tag = f.event.endsWith('-unwatched') ? out.paint('dim', '  (while nothing was watching)') : ''
    if (r.kind === 'file') {
      const changed = f.event === 'changed' || f.event === 'changed-unwatched'
      if (changed) this.count.changed++
      else this.count.sealed++
      out.event(changed ? 'changed' : 'sealed', changed ? 'yellow' : 'green', `${displayPath(f.path)}  ${formatBytes(f.bytes)}  ${f.sha256.slice(0, 8)}…${tag}`)
    } else if (r.kind === 'file-removed') {
      this.count.removed++
      out.event('removed', 'red', `${displayPath(f.path)}${tag}`)
    }
  }
}

