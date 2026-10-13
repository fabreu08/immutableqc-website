// Immutable QC app: the engine (docs/product-v1.md, section 5). Everything the page does that is not drawing:
//   - reading a folder: a dropped one (DataTransferItem.webkitGetAsEntry, every entry, readEntries in batches) or one
//     chosen with <input webkitdirectory>, into a listing {root, items: [{raw, file}]} (raw: the path relative to the
//     folder, "/" between segments, not yet encoded);
//   - finding its ledger (locate): ImmutableQC/ledger.jsonl at the top, or one level down when the folder holds exactly
//     one data folder with a ledger;
//   - the Web Worker pool (Pool, hash-worker.mjs): the SHA-256 of every file (crypto.subtle.digest up to 256 MiB,
//     core's incremental Sha256 over 8 MiB slices above) and the ledger's signatures (verifyLedger's verifyBatch);
//   - the audit (runAudit) and the seal (runSeal), both with core's own functions and nothing else deciding a result;
//   - the browser's key (IndexedDB, not extractable; held in this tab only when storage fails);
//   - the demo's sample folder (ui/sample-data.mjs), sealed and audited by the same code as a real folder.
// Errors meant for a person are AppError(title, message, {action}); a canceled run throws Canceled. Nothing here makes a
// network request: the page's CSP has connect-src 'none'.
import * as IQC from '../core/immutableqc.mjs'
import { FOLDER as DEMO_FOLDER, STATION as DEMO_STATION, EDIT as DEMO_EDIT, sampleFiles } from '../ui/sample-data.mjs'

export const TOOL = `immutableqc-app/${IQC.VERSION}`
export const WHOLE_LIMIT = 256 * 1024 * 1024 // read at once up to this size
export const SLICE = 8 * 1024 * 1024 // then in slices of this size
export const MAX_FILES = 1000000 // more than a tab can list and keep reliably
export const MAX_LEDGER = 512 * 1024 * 1024 // a ledger this large is for the agent (about a million records)
const BUDGET = 512 * 1024 * 1024 // whole-file bytes in flight across the pool
const BATCH_FILES = 64, BATCH_BYTES = 4 * 1024 * 1024 // small files travel to a worker together

export class AppError extends Error {
  constructor(title, message, extra = {}) {
    super(message)
    this.name = 'AppError'
    this.title = title
    Object.assign(this, extra)
  }
}
export class Canceled extends Error {
  constructor() { super('Canceled.'); this.name = 'Canceled' }
}
const AGENT_HINT = 'The agent reads folders of any size on the command line: node iqc.mjs audit "<folder>".'

// --------------------------------------------------------------------------------------------- reading a folder
// The entries of a drop must be taken while the drop event runs (the browser empties the list afterwards).
export function entriesOfDrop(dataTransfer) {
  const entries = [], loose = []
  const items = dataTransfer && dataTransfer.items ? [...dataTransfer.items] : []
  for (const it of items) {
    if (it.kind !== 'file') continue
    const e = typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null
    if (e) entries.push(e)
    else { const f = it.getAsFile(); if (f) loose.push(f) }
  }
  if (!items.length && dataTransfer && dataTransfer.files) loose.push(...dataTransfer.files)
  return { entries, loose }
}

const readBatch = (reader) => new Promise((resolve, reject) => reader.readEntries(resolve, reject))
const fileOf = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject))
const errText = (e) => (e && (e.message || e.name)) || String(e)

// Every file under the dropped entries. One folder dropped: paths are relative to it and it is the root. Several items
// dropped (a folder's contents, say): paths start at the items, and there is no root name.
export async function listEntries({ entries, loose = [] }, { onProgress, signal, max = MAX_FILES } = {}) {
  const single = entries.length === 1 && entries[0].isDirectory && !loose.length
  const root = single ? entries[0].name : null
  const items = [], errors = [], dirs = [], files = []
  if (single) dirs.push({ entry: entries[0], raw: '' })
  else for (const e of entries) (e.isDirectory ? dirs : files).push({ entry: e, raw: e.name })
  for (const f of loose) items.push({ raw: f.name, file: f })
  let tick = 0
  const progress = () => { if (onProgress && Date.now() - tick > 100) { tick = Date.now(); onProgress({ listed: items.length + files.length }) } }
  const check = () => {
    if (signal && signal.aborted) throw new Canceled()
    if (items.length + files.length > max) throw new AppError('This folder is too large for a browser tab', `It holds more than ${IQC.formatCount(max)} files. ${AGENT_HINT}`, { code: 'too-many' })
  }
  // folders, breadth first; each folder's entries in batches until an empty one (the browser returns about 100 at a time)
  while (dirs.length) {
    const { entry, raw } = dirs.shift()
    const reader = entry.createReader()
    try {
      for (;;) {
        const batch = await readBatch(reader)
        if (!batch.length) break
        for (const e of batch) {
          const p = raw ? `${raw}/${e.name}` : e.name
          if (e.isDirectory) dirs.push({ entry: e, raw: p })
          else if (e.isFile) files.push({ entry: e, raw: p })
        }
        check()
        progress()
      }
    } catch (e) {
      if (e instanceof AppError || e instanceof Canceled) throw e
      errors.push({ raw: raw || root || '.', error: errText(e) })
    }
  }
  // then the File of each file entry, a few dozen at a time
  let next = 0
  const worker = async () => {
    while (next < files.length) {
      const it = files[next++]
      // a file that cannot be opened is still there: the audit lists it as not checked, never as missing
      try { items.push({ raw: it.raw, file: await fileOf(it.entry) }) } catch (e) { items.push({ raw: it.raw, file: null, error: errText(e) }) }
      if (signal && signal.aborted) throw new Canceled()
      progress()
    }
  }
  await Promise.all(Array.from({ length: Math.min(32, files.length) }, worker))
  if (signal && signal.aborted) throw new Canceled()
  items.sort((a, b) => (a.raw < b.raw ? -1 : a.raw > b.raw ? 1 : 0))
  return { root, items, errors, source: 'drop' }
}

// <input type="file" webkitdirectory>: each File carries webkitRelativePath, "<chosen folder>/<path>".
export function listInput(fileList, { max = MAX_FILES } = {}) {
  const files = [...(fileList || [])]
  if (files.length > max) throw new AppError('This folder is too large for a browser tab', `It holds more than ${IQC.formatCount(max)} files. ${AGENT_HINT}`, { code: 'too-many' })
  const rel = files.map((f) => f.webkitRelativePath || f.name)
  const tops = new Set(rel.map((r) => r.split('/')[0]))
  const nested = rel.length > 0 && rel.every((r) => r.includes('/')) && tops.size === 1
  const root = nested ? [...tops][0] : null
  const items = files.map((file, i) => ({ raw: nested ? rel[i].slice(root.length + 1) : rel[i], file }))
  // (sizes are read later, a slice at a time: see measure)
  items.sort((a, b) => (a.raw < b.raw ? -1 : a.raw > b.raw ? 1 : 0))
  return { root, items, errors: [], source: 'input' }
}

// Lets the page draw and take input between slices of long work. A message on a channel comes back at once (a timer is
// clamped to 4 ms or more, which adds up over thousands of slices).
const _now = () => (globalThis.performance ? performance.now() : Date.now())
let _chan = null
const _waiting = []
export function yieldNow() {
  if (typeof MessageChannel !== 'function') return new Promise((r) => setTimeout(r, 0))
  if (!_chan) { _chan = new MessageChannel(); _chan.port1.onmessage = () => { const r = _waiting.shift(); if (r) r() } }
  return new Promise((r) => { _waiting.push(r); _chan.port2.postMessage(0) })
}
const SLICE_MS = 40

// The size (and, for a seal, the modification time) of every file, a slice of the list at a time. A browser fetches a
// chosen file's size from the disk the first time it is asked, synchronously on the page's own thread (and again before
// it can send the file to a worker), so for a hundred thousand files this takes seconds; between slices the page draws
// its progress and stays responsive.
export async function measure(listing, { onProgress, signal, modified = false } = {}) {
  const items = listing.items
  let t = _now()
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.file && it.size === undefined) {
      try { it.size = it.file.size; if (modified) it.modified = it.file.lastModified } catch (e) { it.error = errText(e); it.file = null }
    }
    if (_now() - t > SLICE_MS) {
      if (onProgress) onProgress({ measured: i + 1, total: items.length })
      await yieldNow()
      if (signal && signal.aborted) throw new Canceled()
      t = _now()
    }
  }
  return listing
}

// ------------------------------------------------------------------------------------------- finding the ledger
// -> {kind: 'folder', root, ledger: {raw, file}, files: [{raw, file}], parent?}
//  | {kind: 'ledger-only', root, ledger, why: 'file' | 'ledger-folder'}   a ledger alone: the audit covers the ledger only
//  | {kind: 'no-ledger', root, files}                                     ask for the ledger file
export function locate(listing) {
  const items = listing.items
  if (!items.length) {
    throw new AppError(listing.errors && listing.errors.length ? 'The folder could not be read' : 'The folder is empty',
      listing.errors && listing.errors.length ? `The browser could not read ${listing.errors[0].raw} (${listing.errors[0].error}).` : 'There is no file in it to check.', { code: 'empty' })
  }
  const at = items.find((x) => x.raw === IQC.LEDGER_PATH)
  if (at) return { kind: 'folder', root: listing.root, ledger: at, files: items.filter((x) => x !== at) }
  // a ledger dropped on its own, or the ImmutableQC folder itself
  if (items.length === 1 && !items[0].raw.includes('/') && /\.jsonl$/i.test(items[0].raw)) return { kind: 'ledger-only', root: listing.root, ledger: items[0], why: 'file' }
  if (listing.root === IQC.LEDGER_DIR) {
    const l = items.find((x) => x.raw === IQC.LEDGER_FILE)
    if (l) return { kind: 'ledger-only', root: listing.root, ledger: l, why: 'ledger-folder' }
  }
  // one level down: the folder dropped holds exactly one data folder with a ledger
  const down = items.filter((x) => { const s = x.raw.split('/'); return s.length === 3 && s[1] === IQC.LEDGER_DIR && s[2] === IQC.LEDGER_FILE })
  if (down.length === 1) {
    const top = down[0].raw.split('/')[0], pre = top + '/'
    const files = items.filter((x) => x !== down[0] && x.raw.startsWith(pre)).map((x) => ({ raw: x.raw.slice(pre.length), file: x.file }))
    return { kind: 'folder', root: top, parent: listing.root, ledger: { raw: IQC.LEDGER_PATH, file: down[0].file }, files }
  }
  if (down.length > 1) {
    const names = down.map((x) => x.raw.split('/')[0])
    throw new AppError('This folder holds several data folders', `${IQC.formatCount(names.length)} folders in it have their own ledger (${names.slice(0, 4).join(', ')}${names.length > 4 ? ', …' : ''}). Drop one data folder at a time: each one is audited against its own ledger.`, { code: 'several' })
  }
  return { kind: 'no-ledger', root: listing.root, files: items }
}

// The first line of a file someone chose as the ledger must be a ledger header; else it is the wrong file.
export function ledgerHeaderProblem(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (!b.length) return 'the file is empty'
  let end = b.indexOf(0x0a)
  if (end < 0) end = Math.min(b.length, 65536)
  let first
  try { first = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, end)).replace(/^﻿/, '').replace(/\r$/, '') } catch { return 'its first line is not text' }
  let o
  try { o = JSON.parse(first) } catch { return 'its first line is not a JSON object' }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return 'its first line is not a JSON object'
  if (o.format !== IQC.FORMAT) return `its first line is not an Immutable QC ledger header (no "format": "${IQC.FORMAT}")`
  return null
}

// The files to read: encoded paths, without the ledger's own folder and the default ignores (unless the ledger seals a
// path that matches one), each path once.
export function prepareFiles(files, sealed = null) {
  const ig = IQC.ignoreMatcher([])
  const list = [], skipped = []
  const seen = new Set()
  for (const it of files) {
    let path
    try { path = IQC.encodePath(it.raw) } catch { skipped.push({ raw: it.raw, why: 'its name cannot be written in a ledger' }); continue }
    if (IQC.isLedgerFolderPath(path)) continue
    if (ig(path) && !(sealed && sealed.has(path))) continue
    if (seen.has(path)) { skipped.push({ raw: it.raw, why: 'another file has the same name once written in Unicode NFC' }); continue }
    seen.add(path)
    if (!it.file) list.push({ path, raw: it.raw, file: null, size: 0, error: it.error || 'the browser could not open it' })
    else list.push({ path, raw: it.raw, file: it.file, size: it.size !== undefined ? it.size : it.file.size, modified: it.modified })
  }
  return { list, skipped }
}
// the same, a slice at a time, for long lists
async function prepareFilesSliced(files, sealed, signal) {
  const CHUNK = 4000
  if (files.length <= CHUNK) return prepareFiles(files, sealed)
  const list = [], skipped = [], seen = new Set()
  for (let a = 0; a < files.length; a += CHUNK) {
    const part = prepareFiles(files.slice(a, a + CHUNK), sealed)
    for (const x of part.list) { if (seen.has(x.path)) skipped.push({ raw: x.raw, why: 'another file has the same name once written in Unicode NFC' }); else { seen.add(x.path); list.push(x) } }
    skipped.push(...part.skipped)
    await yieldNow()
    if (signal && signal.aborted) throw new Canceled()
  }
  return { list, skipped }
}

// ----------------------------------------------------------------------------------------------- the worker pool
export const defaultPoolSize = () => Math.max(2, Math.min(4, ((globalThis.navigator && navigator.hardwareConcurrency) || 4) - 1))

export class Pool {
  constructor({ size = defaultPoolSize(), url = new URL('./hash-worker.mjs', import.meta.url) } = {}) {
    this.size = size
    this.jobs = new Map()
    this.next = 1
    this.failure = null
    this.lastActivity = Date.now()
    this.slots = []
    for (let i = 0; i < size; i++) this.slots.push(this._spawn(url, i))
  }

  _spawn(url, i) {
    const slot = { i, busy: 0, w: null }
    const w = new Worker(url, { type: 'module', name: `immutableqc-${i + 1}` })
    slot.w = w
    w.onmessage = (e) => this._message(e.data)
    w.onerror = (e) => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault()
      const why = e && e.message ? e.message : 'it could not start or it ran out of memory'
      this.fail(new AppError('A background worker stopped', `The worker that reads files stopped (${why}). Nothing was changed. Reload the page and try again; for a very large folder, use the agent: node iqc.mjs audit "<folder>".`, { code: 'worker' }))
    }
    w.onmessageerror = () => this.fail(new AppError('A background worker stopped', 'A message from the worker that reads files could not be read. Reload the page and try again.', { code: 'worker' }))
    return slot
  }

  _message(m) {
    this.lastActivity = Date.now()
    const job = m && this.jobs.get(m.id)
    if (!job) return
    if (m.type === 'tick') { if (job.onTick) job.onTick(m); return }
    this.jobs.delete(m.id)
    job.slot.busy--
    if (m.type === 'done') job.resolve(m.res)
    else job.reject(new AppError('A file could not be checked', `The background worker reported: ${m.error}.`, { code: 'worker' }))
  }

  _post(msg, { onTick, slot } = {}) {
    if (this.failure) return Promise.reject(this.failure)
    const s = slot || this.slots.reduce((a, b) => (b.busy < a.busy ? b : a))
    const id = this.next++
    s.busy++
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject, onTick, slot: s })
      try { s.w.postMessage({ ...msg, id }) } catch (e) { this.jobs.delete(id); s.busy--; reject(new AppError('A file could not be sent to the background worker', errText(e), { code: 'worker' })) }
    })
  }

  free() { return this.slots.find((s) => s.busy === 0) || null }

  // verifyLedger's verifyBatch
  verify(pub, items) { return this._post({ op: 'verify', pub, items }) }

  // The SHA-256 of each entry of list ([{file, size}]): resolves to [{sha256, at} | {error}] in the same order.
  // onTick({files, bytes, cur: {index, done, size, k, n}}) reports the whole run's progress.
  hash(list, { onTick, whole = WHOLE_LIMIT, slice = SLICE } = {}) {
    const results = new Array(list.length)
    if (!list.length) return Promise.resolve(results)
    // batches: a file read at once that is large, or any file read in slices, travels alone; small ones together
    const batches = []
    let cur = null
    for (let i = 0; i < list.length; i++) {
      const size = list[i].size
      const alone = size > whole || size > BATCH_BYTES
      if (alone) { batches.push({ idx: [i], bytes: size, held: size <= whole ? size : slice }); continue }
      if (!cur || cur.idx.length >= BATCH_FILES || cur.bytes + size > BATCH_BYTES) { cur = { idx: [], bytes: 0, held: 0 }; batches.push(cur) }
      cur.idx.push(i)
      cur.bytes += size
      cur.held += size
    }
    let nb = 0, held = 0, doneFiles = 0, doneBytes = 0, settled = false
    const live = new Map()
    const report = (curInfo) => {
      if (!onTick) return
      let f = doneFiles, b = doneBytes
      for (const t of live.values()) { f += t.files; b += t.bytes }
      onTick({ files: f, bytes: b, cur: curInfo || null })
    }
    return new Promise((resolve, reject) => {
      const fail = (e) => { if (!settled) { settled = true; reject(e) } }
      const pump = () => {
        if (settled) return
        if (this.failure) return fail(this.failure)
        while (nb < batches.length) {
          const slot = this.free()
          if (!slot) break
          const b = batches[nb]
          if (held > 0 && held + b.held > BUDGET) break
          nb++
          held += b.held
          const key = nb
          const onT = (m) => {
            live.set(key, { files: m.files, bytes: m.bytes })
            report(m.cur ? { index: m.cur.i, done: m.cur.done, size: m.cur.size, k: m.cur.k, n: m.cur.n } : null)
          }
          this._post({ op: 'hash', files: b.idx.map((i) => ({ i, file: list[i].file })), whole, slice }, { onTick: onT, slot }).then((res) => {
            live.delete(key)
            held -= b.held
            for (const r of res) results[r.i] = r.error ? { error: r.error } : { sha256: r.sha256, at: r.at }
            doneFiles += b.idx.length
            doneBytes += b.bytes
            report(null)
            if (doneFiles === list.length) { settled = true; resolve(results) } else pump()
          }, fail)
        }
      }
      this._failHook = fail
      pump()
    })
  }

  fail(err) {
    if (this.failure) return
    this.failure = err
    for (const s of this.slots) { try { s.w.terminate() } catch { /* gone */ } }
    for (const job of this.jobs.values()) job.reject(err)
    this.jobs.clear()
    if (this._failHook) this._failHook(err)
  }

  terminate() { this.fail(new Canceled()) }
}

// ------------------------------------------------------------------------------------------------ hashing a list
// Hash `list` (from prepareFiles) in the pool; progress through onProgress({stage: 'hash', …}). Returns the files map
// for core (path -> {sha256, bytes, observedAt, modifiedAt} or null when a file could not be read) and the unreadable.
async function hashList(pool, all, { onProgress, signal, whole, slice, progress }) {
  const list = all.filter((x) => x.file)
  const total = list.reduce((a, x) => a + x.size, 0)
  progress.filesTotal = list.length
  progress.bytesTotal = total
  progress.files = 0
  progress.bytes = 0
  progress.hashStarted = Date.now()
  progress.stage = 'hash'
  if (onProgress) onProgress(progress)
  const res = await pool.hash(list, {
    whole, slice,
    onTick: (t) => {
      progress.files = t.files
      progress.bytes = t.bytes
      if (t.cur) progress.cur = { path: list[t.cur.index].path, size: t.cur.size, done: t.cur.done, k: t.cur.k, n: t.cur.n, whole: t.cur.n === 1 }
      if (onProgress) onProgress(progress)
    },
  })
  if (signal && signal.aborted) throw new Canceled()
  const files = new Map(), unreadable = []
  for (const x of all) if (!x.file) { files.set(x.path, null); unreadable.push({ path: x.path, error: x.error }) }
  list.forEach((x, i) => {
    const r = res[i]
    if (!r || r.error) { files.set(x.path, null); unreadable.push({ path: x.path, error: r ? r.error : 'no answer' }); return }
    const v = { sha256: r.sha256, bytes: x.size, observedAt: new Date(r.at).toISOString() }
    if (Number.isFinite(x.modified) && x.modified > 0) v.modifiedAt = new Date(x.modified).toISOString()
    files.set(x.path, v)
  })
  progress.files = list.length
  progress.bytes = total
  progress.cur = null
  progress.hashMs = Date.now() - progress.hashStarted
  return { files, unreadable, bytes: total }
}

async function readLedger(item) {
  const f = item.file
  if (!f) throw new AppError('The ledger could not be read', `The browser could not open ${item.raw} (${item.error || 'no access'}). If it is open in another program or on a disconnected drive, close it or reconnect, then try again.`, { code: 'ledger-unreadable' })
  if (f.size > MAX_LEDGER) throw new AppError('This ledger is too large for a browser tab', `It is ${IQC.formatBytes(f.size)}. ${AGENT_HINT}`, { code: 'ledger-too-large' })
  try { return new Uint8Array(await f.arrayBuffer()) } catch (e) {
    throw new AppError('The ledger could not be read', `The browser could not read ${item.raw} (${errText(e)}). If it is open in another program or on a disconnected drive, close it or reconnect, then try again.`, { code: 'ledger-unreadable' })
  }
}

async function verify(pool, bytes, { onProgress, signal, progress }) {
  progress.stage = 'ledger'
  progress.ledgerDone = 0
  progress.ledgerTotal = 0
  if (onProgress) onProgress(progress)
  const verified = await IQC.verifyLedger(bytes, {
    verifyBatch: (pub, items) => pool.verify(pub, items),
    batchSize: 512,
    concurrency: pool.size * 2,
    onProgress: (done, total) => { progress.ledgerDone = done; progress.ledgerTotal = total; if (onProgress) onProgress(progress) },
  })
  if (signal && signal.aborted) throw new Canceled()
  if (pool.failure) throw pool.failure
  progress.ledgerDone = progress.ledgerTotal = verified.recordCount
  progress.records = verified.recordCount
  progress.ledgerProblems = verified.problems.length
  return verified
}

// ------------------------------------------------------------------------------------------------------ the audit
// located: from locate() (kind 'folder' or 'ledger-only'), or {kind: 'folder', root, ledger, files} with a ledger the
// person chose. Returns {report, verified, located, unreadable, skipped, bytes, ms}.
export async function runAudit(located, { expectHead, expectKeyId, onProgress, signal, pool, whole, slice, chosen = false } = {}) {
  const t0 = Date.now()
  const progress = { stage: 'ledger', started: t0, root: located.root }
  const bytes = await readLedger(located.ledger)
  if (chosen) {
    const why = ledgerHeaderProblem(bytes)
    if (why) throw new AppError('This file is not a ledger', `${located.ledger.raw}: ${why}. Choose the file the agent writes, ImmutableQC/ledger.jsonl.`, { code: 'not-ledger' })
  }
  const verified = await verify(pool, bytes, { onProgress, signal, progress })
  let files = null, unreadable = [], skipped = [], read = 0
  if (located.kind === 'folder') {
    const prep = await prepareFilesSliced(located.files, verified.files, signal)
    skipped = prep.skipped
    const h = await hashList(pool, prep.list, { onProgress, signal, whole, slice, progress })
    files = h.files
    unreadable = h.unreadable
    read = h.bytes
  }
  progress.stage = 'audit'
  if (onProgress) onProgress(progress)
  await yieldNow()
  const report = IQC.audit(verified, files, {
    expectHead: expectHead || undefined,
    expectKeyId: expectKeyId || undefined,
    where: 'browser',
    tool: TOOL,
    folder: located.root || undefined,
  })
  return { report, verified, located, unreadable, skipped, bytes: read, ms: Date.now() - t0 }
}

// ------------------------------------------------------------------------------------------------------- the seal
// A new ledger (no ledger in the folder) with the browser's key, or more records on a ledger whose key this browser
// holds. Never extends a ledger that does not verify. Returns {text, header, records, appended, mode, report (a
// check of the result, audited at once), verified, key, unreadable, skipped, counts}.
export async function runSeal(located, { station = 'Browser', onProgress, signal, pool, keys, whole, slice, agent = TOOL } = {}) {
  const t0 = Date.now()
  const progress = { stage: 'ledger', started: t0, root: located.root }
  if (located.kind === 'ledger-only') throw new AppError('Drop the data folder, not its ledger', 'Sealing reads every file of the data folder. Drop the folder that holds ImmutableQC/ledger.jsonl.', { code: 'seal-ledger-only' })
  if (!IQC.isSealedText(station) || !station || [...station].length > 64) throw new AppError('The station name cannot be used', 'A station name is 1 to 64 characters, with no "|" and no control character.', { code: 'station' })
  let verified, header, prefix, key, appended = false
  if (located.kind === 'folder') {
    const bytes = await readLedger(located.ledger)
    verified = await verify(pool, bytes, { onProgress, signal, progress })
    if (!verified.ok) {
      throw new AppError('The ledger in this folder does not verify', `Nothing was added to it: a ledger with a problem is never extended. ${verified.problems[0] ? verified.problems[0].message : ''} Audit the folder to see every problem.`, { code: 'seal-broken', action: 'audit' })
    }
    key = await keys.find(verified.keyId, verified.header.publicKey)
    if (!key) {
      throw new AppError('This browser does not hold the ledger’s key', `The ledger in this folder was signed with key id ${verified.keyId}, which this browser does not hold, so nothing can be added to it here. Audit the folder instead, or seal it with the agent on the computer that holds the key.`, { code: 'seal-foreign', action: 'audit' })
    }
    header = verified.header
    prefix = new TextDecoder().decode(bytes)
    appended = true
  } else {
    key = await keys.current()
    if (signal && signal.aborted) throw new Canceled()
    header = await IQC.createHeader({ station, privateKey: key.privateKey, publicKeyHex: key.publicKeyHex, agent })
    prefix = IQC.serializeLine(header)
    verified = await IQC.verifyLedger(prefix)
  }
  const prep = await prepareFilesSliced(located.files, verified.files, signal)
  const h = await hashList(pool, prep.list, { onProgress, signal, whole, slice, progress })
  progress.stage = 'sign'
  if (onProgress) onProgress(progress)
  const mode = IQC.isFirstScan(verified) ? 'first' : 'unwatched'
  const now = new Date().toISOString()
  const plan = IQC.planSeal(verified, h.files, { mode, station, observedAt: now })
  const items = [{ kind: 'session', f: { station, event: 'scan', at: now, agent } }, ...plan]
  const records = await IQC.createRecords({ head: verified.head, items, privateKey: key.privateKey })
  if (signal && signal.aborted) throw new Canceled()
  const text = prefix + records.map((r) => IQC.serializeLine(r)).join('')
  // check what was made, as an audit would: the ledger verifies and every file read matches
  progress.stage = 'audit'
  if (onProgress) onProgress(progress)
  const v2 = await IQC.verifyLedger(text, { verifyBatch: (pub, it) => pool.verify(pub, it), batchSize: 512, concurrency: pool.size * 2 })
  const report = IQC.audit(v2, h.files, { where: 'browser', tool: agent, folder: located.root || undefined })
  const counts = { new: 0, changed: 0, removed: 0 }
  for (const it of plan) {
    if (it.kind === 'file-removed') counts.removed++
    else if (/^(existing|added)/.test(it.f.event)) counts.new++
    else counts.changed++
  }
  return { text, header, records, appended, mode, plan, counts, report, verified: v2, key, unreadable: h.unreadable, skipped: prep.skipped, bytes: h.bytes, ms: Date.now() - t0 }
}

// -------------------------------------------------------------------------------------------- the browser's key
// IndexedDB database "immutableqc-app", store "keys" (keyPath keyId): {keyId, publicKeyHex, privateKey (a CryptoKey that
// cannot be exported), createdAt}. One key per browser profile, as the agent keeps one per computer. When storage is
// off or fails, a key is made for this tab only (and the page says so).
const DB_NAME = 'immutableqc-app', STORE = 'keys'

function idb(op) {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('this browser has no IndexedDB'))
    let req
    try { req = indexedDB.open(DB_NAME, 1) } catch (e) { return reject(e) }
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'keyId' }) }
    req.onblocked = () => reject(new Error('the key store is open in another tab with an older version'))
    req.onerror = () => reject(req.error || new Error('the key store could not be opened'))
    req.onsuccess = () => {
      const db = req.result
      let tx
      try { tx = db.transaction(STORE, op.write ? 'readwrite' : 'readonly') } catch (e) { db.close(); return reject(e) }
      const store = tx.objectStore(STORE)
      let out
      const r = op.write ? store.put(op.write) : op.get ? store.get(op.get) : store.getAll()
      r.onsuccess = () => { out = r.result }
      tx.oncomplete = () => { db.close(); resolve(out) }
      tx.onerror = () => { db.close(); reject(tx.error || r.error || new Error('the key store failed')) }
      tx.onabort = () => { db.close(); reject(tx.error || new Error('the key store was aborted (storage may be full)')) }
    }
  })
}

export class KeyStore {
  constructor() { this.memory = new Map(); this.lastNote = null }

  // the key to seal a new ledger with: the newest one this browser keeps, or a new one
  async current() {
    let stored = [], why = null
    try { stored = (await idb({})) || [] } catch (e) { why = errText(e) }
    const usable = []
    for (const k of [...stored].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))) if (k && k.privateKey && k.publicKeyHex) usable.push(k)
    for (const k of usable) {
      if (await IQC.keyMatches(k.privateKey, k.publicKeyHex)) return { ...k, stored: true, created: false }
    }
    if (this.memory.size) { const k = [...this.memory.values()].pop(); return { ...k, stored: false, created: false, why: k.why } }
    const kp = await IQC.generateKeyPair({ extractable: false })
    const publicKeyHex = await IQC.publicKeyHex(kp.publicKey)
    const rec = { keyId: IQC.keyIdOf(publicKeyHex), publicKeyHex, privateKey: kp.privateKey, createdAt: new Date().toISOString() }
    if (!why) {
      try { await idb({ write: rec }); return { ...rec, stored: true, created: true } } catch (e) { why = errText(e) }
    }
    rec.why = why
    this.memory.set(rec.keyId, rec)
    return { ...rec, stored: false, created: true, why }
  }

  // the key with this id, if this browser holds it (and it really belongs to that public key)
  async find(keyId, publicKeyHex) {
    let k = this.memory.get(keyId) || null
    if (!k) { try { k = (await idb({ get: keyId })) || null } catch { k = null } }
    if (!k || !k.privateKey) return null
    if (publicKeyHex && k.publicKeyHex !== publicKeyHex) return null
    if (!(await IQC.keyMatches(k.privateKey, k.publicKeyHex))) return null
    return { ...k, stored: !this.memory.has(keyId) }
  }
}

// ---------------------------------------------------------------------------------------------------- the demo
export const DEMO = { folder: DEMO_FOLDER, station: DEMO_STATION, edit: DEMO_EDIT }
const DEMO_TIME = Date.parse('2026-09-14T08:19:47.000Z')

// The sample folder as Files in memory; edited: plate-07.csv as the shared copy has it (EDIT applied to the bytes).
export function demoListing({ edited = false, ledgerText = null } = {}) {
  const items = sampleFiles().map((f) => {
    let bytes = f.bytes
    if (edited && f.path === DEMO_EDIT.path) {
      bytes = bytes.slice()
      bytes.set(new TextEncoder().encode(DEMO_EDIT.after), DEMO_EDIT.offset)
    }
    return { raw: f.path, file: new File([bytes], f.name, { type: f.type, lastModified: DEMO_TIME }) }
  })
  if (ledgerText !== null) items.push({ raw: IQC.LEDGER_PATH, file: new File([ledgerText], IQC.LEDGER_FILE, { type: 'application/x-ndjson' }) })
  items.sort((a, b) => (a.raw < b.raw ? -1 : a.raw > b.raw ? 1 : 0))
  return { root: DEMO_FOLDER, items, errors: [], source: 'demo' }
}

// A key made for the demo alone, in memory, never stored.
export class DemoKeys {
  async current() {
    if (!this.k) {
      const kp = await IQC.generateKeyPair({ extractable: false })
      const publicKeyHex = await IQC.publicKeyHex(kp.publicKey)
      this.k = { keyId: IQC.keyIdOf(publicKeyHex), publicKeyHex, privateKey: kp.privateKey, createdAt: new Date().toISOString(), stored: false, created: true, demo: true }
    }
    return this.k
  }
  async find(keyId) { return this.k && this.k.keyId === keyId ? this.k : null }
}
