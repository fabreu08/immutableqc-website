// iqc audit: verify the ledger whole, read every file in the folder (streaming SHA-256), and give core's verdict.
// Exit 0 pass, 3 review, 1 fail, 2 usage or read error. --report writes core's HTML report, --json its JSON (- for standard
// output). Nothing is written to the ledger or the data folder, and no lock is taken.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { audit, renderReportHTML, ignoreMatcher, formatBytes, formatCount } from '../../core/immutableqc.mjs'
import { AGENT, UserError, EXIT_OK, EXIT_FAIL, EXIT_USAGE, EXIT_REVIEW, pool, plural } from './util.mjs'
import { dataFolder, locate, displayPath } from './paths.mjs'
import { readLedgerSettled } from './ledger.mjs'
import { peekLock, lockState, describeLock } from './lock.mjs'
import { walk, outOfSight, hashFile } from './scan.mjs'

const MAX_PROBLEMS = 30, MAX_ITEMS = 10

// Reads the files present: path -> {sha256, bytes}, or null for a file that is there but could not be read (and for
// sealed paths out of sight). Files that are ignored and were never sealed are not read.
export async function readFolder(root, verified, { ignore = [], own = new Set(), out, label = 'Reading' } = {}) {
  let w
  try {
    w = await walk(root, { skip: (p) => own.has(p) })
  } catch (e) {
    throw new UserError(`Cannot read the folder ${root} (${e.code || e.message}).`, EXIT_USAGE)
  }
  const ig = ignoreMatcher(ignore)
  const sealed = verified ? verified.files : new Map()
  const files = new Map()
  const todo = []
  for (const [p, e] of w.files) if (!ig(p) || sealed.has(p)) todo.push([p, e])
  for (const p of w.unreadableFiles) if (!ig(p) || sealed.has(p)) files.set(p, null)
  for (const p of w.ambiguous.keys()) files.set(p, null)
  for (const e of sealed.values()) if (!w.files.has(e.path) && outOfSight(w, e.path)) files.set(e.path, null)
  const total = todo.reduce((a, [, e]) => a + e.size, 0)
  let doneFiles = 0, doneBytes = 0, unread = 0
  const bufs = Array.from({ length: 4 }, () => Buffer.allocUnsafe(1 << 20))
  await pool(todo, 4, async ([p, e]) => {
    const buf = bufs.pop()
    try {
      const r = await hashFile(e.abs, { buf })
      files.set(p, { sha256: r.sha256, bytes: String(r.bytes) })
    } catch {
      files.set(p, null)
      unread++
    } finally {
      bufs.push(buf)
    }
    doneFiles++
    doneBytes += e.size
    if (out) out.progress(`${label} ${formatCount(doneFiles)} of ${formatCount(todo.length)} files (${formatBytes(doneBytes)} of ${formatBytes(total)})`)
  })
  if (out) out.clearProgress()
  return { files, walk: w, unread, read: todo.length - unread }
}

export async function runAudit({ folder, opts, out, stdout = process.stdout }) {
  const root = dataFolder(folder)
  const loc = locate(root, opts.ledger)
  const lock = peekLock(loc.lockPath)
  const live = lockState(lock) === 'live'
  const r = await readLedgerSettled(loc.ledgerPath, { agentRunning: () => live, onProgress: (d, t) => out.progress(`Checking the ledger: ${formatCount(d)} of ${formatCount(t)} records`) })
  out.clearProgress()
  const v = r.verified
  if (live) out.note(`An agent is sealing this folder now (${describeLock(lock.info)}): a file written during the audit may show as changed or not sealed. Audit again to be sure.`)
  const { files, walk: w } = await readFolder(root, v, { ignore: opts.ignore, own: loc.own, out, label: 'Reading' })
  for (const p of w.symlinks) out.note(`Skipped ${displayPath(p)}: a symbolic link (links are never followed or sealed).`)
  for (const [p] of w.ambiguous) out.note(`Not checked: more than one file is named ${displayPath(p)}, in different Unicode forms (NFC and NFD).`)
  const report = audit(v, files, {
    expectHead: opts['expect-head'], expectKeyId: opts['expect-key'], strict: !!opts.strict,
    where: 'command line', tool: AGENT, ignore: opts.ignore, folder: folder == null ? '.' : folder,
  })
  const written = []
  const save = (file, text, what) => {
    try {
      writeFileSync(resolve(file), text)
      written.push([what, resolve(file)])
    } catch (e) {
      throw new UserError(`Cannot write the ${what} to ${resolve(file)} (${e.code || e.message}).`, EXIT_USAGE)
    }
  }
  if (opts.report) save(opts.report, renderReportHTML(report), 'report')
  if (opts.json === '-') stdout.write(JSON.stringify(report, null, 2) + '\n')
  else if (opts.json) save(opts.json, JSON.stringify(report, null, 2) + '\n', 'JSON report')
  printReport(report, { out, loc, written })
  return report.verdict === 'pass' ? EXIT_OK : report.verdict === 'review' ? EXIT_REVIEW : EXIT_FAIL
}

function printReport(report, { out, loc, written }) {
  const pass = report.verdict === 'pass', review = report.verdict === 'review'
  const c = report.counts
  const sentence = report.summary.replace(/^(?:Pass|Review|Fail): /, '').replace(/^./, (ch) => ch.toUpperCase())
  const word = pass ? out.paint('green', out.paint('bold', 'PASS')) : review ? out.paint('yellow', out.paint('bold', 'REVIEW')) : out.paint('red', out.paint('bold', 'FAIL'))
  const verdict = `${word}  ${sentence}`
  // with --quiet, a pass prints nothing (the exit code says it); a review or a fail prints its verdict and reasons
  const say = pass ? (s) => out.print(s) : (s) => out.result(s)
  say(verdict)
  if (report.problems.length) {
    say(out.paint('bold', 'Problems'))
    for (const p of report.problems.slice(0, MAX_PROBLEMS)) say(`  ${out.paint('red', '✗')} ${p.message}`)
    if (report.problems.length > MAX_PROBLEMS) say(`  …and ${formatCount(report.problems.length - MAX_PROBLEMS)} more (every one is in the report: --report or --json).`)
  }
  if (report.forReview && report.forReview.length) {
    say(out.paint('bold', report.strict ? 'For review (failures in strict mode)' : 'For review (recorded changes, not failures)'))
    for (const g of report.forReview) {
      say(`  ${out.paint('yellow', '!')} ${g.message}`)
      for (const x of g.items.slice(0, MAX_ITEMS)) say(`      ${x}`)
      if (g.items.length > MAX_ITEMS) say(`      …and ${formatCount(g.items.length - MAX_ITEMS)} more`)
    }
  }
  if (report.notes.length) {
    const strictFail = report.strict
    const sayN = strictFail ? say : (s) => out.print(s)
    sayN(out.paint('bold', strictFail ? 'Notes (failures in strict mode)' : 'Notes (not failures)'))
    for (const n of report.notes) {
      sayN(`  ${out.paint('yellow', '•')} ${n.message}`)
      for (const x of n.items.slice(0, MAX_ITEMS)) sayN(`      ${x}`)
      if (n.items.length > MAX_ITEMS) sayN(`      …and ${formatCount(n.items.length - MAX_ITEMS)} more`)
    }
  }
  const L = report.ledger
  out.print(`${out.paint('dim', 'Ledger ')}  ${loc.shown}: ${plural(L.records, 'record', 'records')}${L.station ? `, station ${L.station}` : ''}${L.keyId ? `, key id ${L.keyId}` : ''}`)
  if (L.head) out.print(`${out.paint('dim', 'Head   ')}  ${L.head.n}:${L.head.h}`)
  const parts = [`${c.match} match`]
  if (c.changed) parts.push(`${c.changed} changed`)
  if (c.missing) parts.push(`${c.missing} missing`)
  if (c.removed) parts.push(`${c.removed} removed (recorded)`)
  if (c.backAfterRemoval) parts.push(`${c.backAfterRemoval} back after removal`)
  if (c.notChecked) parts.push(`${c.notChecked} not checked`)
  out.print(`${out.paint('dim', 'Files  ')}  ${plural(c.sealed, 'file', 'files')} sealed: ${parts.join(', ')}${c.notSealed ? `; ${plural(c.notSealed, 'file', 'files')} not sealed` : ''}; read ${plural(c.filesRead, 'file', 'files')} (${formatBytes(c.bytesRead)})`)
  for (const [what, file] of written) out.print(`${out.paint('dim', what === 'report' ? 'Report ' : 'JSON   ')}  ${file}`)
}
