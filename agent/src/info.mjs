// iqc head and iqc status: read-only views of a ledger (no lock, nothing written).
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { formatHead, formatBytes, formatCount, ignoreMatcher } from '../../core/immutableqc.mjs'
import { EXIT_OK, EXIT_FAIL, pool, plural, whenUTC } from './util.mjs'
import { dataFolder, locate, displayPath } from './paths.mjs'
import { readLedgerSettled } from './ledger.mjs'
import { peekLock, lockState, describeLock } from './lock.mjs'
import { keyFileOf } from './keys.mjs'
import { walk, outOfSight, hashFile } from './scan.mjs'

const MAX_LIST = 20

function problemLines(v, out) {
  const p = v.problems
  out.error(`The ledger does not verify: ${p.length === 1 ? 'it has 1 problem' : `it has ${formatCount(p.length)} problems`}.`)
  for (const x of p.slice(0, 3)) out.error(`  ${x.message}`)
  if (p.length > 3) out.error(`  …and ${formatCount(p.length - 3)} more. Run iqc audit to see every problem.`)
  else out.error('Run iqc audit to see what each problem means.')
}

// iqc head: the head on standard output (n:h, nothing else), what it is on standard error.
export async function runHead({ folder, opts, out }) {
  const root = dataFolder(folder)
  const loc = locate(root, opts.ledger)
  const { verified: v } = await readLedgerSettled(loc.ledgerPath, { agentRunning: () => lockState(peekLock(loc.lockPath)) === 'live' })
  if (!v.ok) {
    problemLines(v, out)
    out.error('No head is printed: pin a head only from a ledger that verifies.')
    return EXIT_FAIL
  }
  const head = formatHead(v.head)
  out.result(head)
  out.note(`Record ${v.head.n} of ledger ${v.header.ledgerId} (station ${v.header.station}, key id ${v.keyId}).`)
  out.note('Pin it somewhere else (an email, an ELN entry, a printout). A later audit shows whether the ledger was rewritten or cut short since:')
  out.note(`  iqc audit ${folder == null ? '.' : /\s/.test(folder) ? `"${folder}"` : folder} --expect-head ${head} --expect-key ${v.keyId}`)
  return EXIT_OK
}

// iqc status: the ledger, the key, the agent, the last session, and what changed since the last seal.
export async function runStatus({ folder, opts, out }) {
  const root = dataFolder(folder)
  const loc = locate(root, opts.ledger)
  const label = (s) => out.paint('dim', s.padEnd(9))
  const lock = peekLock(loc.lockPath)
  const ls = lockState(lock)
  const r = await readLedgerSettled(loc.ledgerPath, { missingOk: true, agentRunning: () => ls === 'live' })
  out.print(`${label('Folder')}${root}`)
  if (!r) {
    out.print(`${label('Ledger')}none yet (it would be ${loc.ledgerPath})`)
    const ch = await changes(root, null, loc, opts)
    out.print(`${plural(ch.added.length, 'file', 'files')} (${formatBytes(ch.bytes)}) would be sealed by iqc seal or iqc watch.`)
    return EXIT_OK
  }
  const v = r.verified
  out.print(`${label('Ledger')}${loc.shown}: ${v.ok ? out.paint('green', 'intact') : out.paint('red', 'does not verify')}, ${plural(v.recordCount, 'record', 'records')}, ${formatBytes(r.bytes)}`)
  const H = v.header
  if (H && typeof H.station === 'string') out.print(`${label('Station')}${H.station}`)
  if (H && typeof H.keyId === 'string') {
    const kf = opts.key ? resolve(opts.key) : keyFileOf(H.keyId)
    out.print(`${label('Key')}${H.keyId}, ${existsSync(kf) ? `on this computer (${kf})` : `not on this computer (no ${kf}): needed to add records, not to audit`}`)
  }
  if (H && typeof H.createdAt === 'string') out.print(`${label('Created')}${whenUTC(H.createdAt)}`)
  if (v.head) out.print(`${label('Head')}${formatHead(v.head)}`)
  if (ls === 'live') out.print(`${label('Agent')}running (${describeLock(lock.info)})`)
  else if (ls === 'other-host') out.print(`${label('Agent')}a lock is held from another computer (${describeLock(lock.info)})`)
  else if (ls === 'stale' || ls === 'unreadable') out.print(`${label('Agent')}not running (a stale lock is left${lock.info ? ` from ${describeLock(lock.info)}` : ''}; the next agent takes it over)`)
  else out.print(`${label('Agent')}not running`)
  const s = v.sessions[v.sessions.length - 1]
  if (s) {
    let t
    if (s.type === 'scan') t = `seal at ${whenUTC(s.start)} (record ${s.startN}), ${plural(s.files, 'file record', 'file records')}`
    else if (s.stray) t = `a watch stop without a start (record ${s.stopN})`
    else {
      const end = s.open ? (ls === 'live' ? 'running now' : 'no stop record yet (it did not stop cleanly)') : s.clean ? `stopped ${whenUTC(s.stop)} (record ${s.stopN})` : `ended without a stop record (next start: record ${s.endedByN})`
      t = `watch started ${whenUTC(s.start)} (record ${s.startN}), ${end}, ${plural(s.files, 'file record', 'file records')}`
    }
    out.print(`${label('Last')}${t}`)
  }
  if (!v.ok) {
    problemLines(v, out)
    return EXIT_FAIL
  }
  const ch = await changes(root, v, loc, opts)
  const n = ch.added.length + ch.changed.length + ch.removed.length
  out.print(n ? `Since the last seal: ${ch.added.length} new, ${ch.changed.length} changed, ${ch.removed.length} removed; ${formatCount(ch.unchanged)} unchanged.`
    : `Nothing changed since the last seal (${plural(ch.unchanged, 'file', 'files')}).`)
  for (const [word, color, list] of [['new', 'green', ch.added], ['changed', 'yellow', ch.changed], ['removed', 'red', ch.removed]]) {
    for (const p of list.slice(0, MAX_LIST)) out.event(word, color, displayPath(p))
    if (list.length > MAX_LIST) out.print(`         …and ${formatCount(list.length - MAX_LIST)} more ${word}`)
  }
  if (ch.unread.length) out.print(`Could not read ${plural(ch.unread.length, 'file', 'files')} (open in another program, or no permission): ${ch.unread.slice(0, 5).map(displayPath).join(', ')}${ch.unread.length > 5 ? ', …' : ''}`)
  return EXIT_OK
}

// What a seal now would do, read-only: a file whose size and modification time match its last seal is unchanged;
// any other is read, and is changed only if its SHA-256 differs.
async function changes(root, v, loc, opts) {
  const ig = ignoreMatcher(opts.ignore)
  const w = await walk(root, { skip: (p) => loc.own.has(p) || ig(p) })
  const added = [], changed = [], removed = [], unread = []
  let unchanged = 0, bytes = 0
  const toRead = []
  for (const [p, e] of w.files) {
    const l = v && v.files.has(p) ? v.files.get(p).latest : null
    if (!l || l.kind !== 'file') { added.push(p); bytes += e.size; continue }
    if (String(e.size) === l.bytes && typeof l.modifiedAt === 'string' && Date.parse(l.modifiedAt) === Math.floor(e.mtimeMs)) { unchanged++; continue }
    toRead.push([p, e, l])
  }
  await pool(toRead, 4, async ([p, e, l]) => {
    try {
      const r = await hashFile(e.abs)
      if (r.sha256 === l.sha256) unchanged++
      else changed.push(p)
    } catch {
      unread.push(p)
    }
  })
  if (v) for (const e of v.files.values()) if (e.latest.kind === 'file' && !w.files.has(e.path) && !outOfSight(w, e.path) && !ig(e.path) && !loc.own.has(e.path)) removed.push(e.path)
  const sort = (a) => a.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))
  return { added: sort(added), changed: sort(changed), removed: sort(removed), unread: sort(unread), unchanged, bytes }
}

