// iqc audit: every ledger in the folder (core's discoverLedgers: the folder's own ImmutableQC/ledger.jsonl, every
// ImmutableQC/ledger.jsonl in the folders under it, up to 6 deep, and every *.ledger.jsonl reviewer ledger), plus any
// given with --ledger; each verified whole, every file under each ledger's folder read (streaming SHA-256), and one
// verdict from core: audit() for a folder that holds one ledger of sealed files and nothing else (the report the app
// reads today), auditMany() for a lab (several ledgers, agent steps, reviews, or a --pin-file to check).
// Exit 0 pass, 3 review, 1 fail, 2 usage or read error. --report writes core's HTML report, --json its JSON (- for
// standard output). Nothing is written to a ledger or a data folder, and no lock is taken.
import { writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, join, relative, isAbsolute, sep, basename, dirname } from 'node:path'
import { audit, auditMany, renderReportHTML, ignoreMatcher, formatBytes, formatCount, formatHead } from '../../core/immutableqc.mjs'
import { AGENT, UserError, EXIT_OK, EXIT_FAIL, EXIT_USAGE, EXIT_REVIEW, pool, plural } from './util.mjs'
import { dataFolder, locate, displayPath, relPathOrNull } from './paths.mjs'
import { readLedgerSettled } from './ledger.mjs'
import { peekLock, lockState, describeLock } from './lock.mjs'
import { walk, outOfSight, hashFile } from './scan.mjs'
import { discoverUnder, ledgerAt } from './lab.mjs'

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

const inside = (dir, abs) => { const r = relative(dir, abs); return !!r && r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r) }
const relLabel = (base, abs) => { const r = relative(base, abs); return r && !r.startsWith('..') && !isAbsolute(r) ? r.split(sep).join('/') : abs }

// The ledgers an audit of `root` covers: [{abs, rootAbs | null, label, ledgerPath, own, lockPath, isFolderOwn}].
// The folder's own ledger is <root>/ImmutableQC/ledger.jsonl, or, when there is none, the first --ledger that is not a
// reviewer's *.ledger.jsonl (a ledger kept elsewhere, as watch and seal write it with --ledger).
export async function ledgersOf(root, ledgerOpts = [], { pinFile = null } = {}) {
  const given = ledgerOpts.map((p) => { let a = resolve(p); try { if (statSync(a).isDirectory()) a = join(a, 'ledger.jsonl') } catch { /* checked below */ } return a })
  for (const a of given) if (!existsSync(a)) throw new UserError(`No ledger at ${a} (given with --ledger).`, EXIT_USAGE)
  let ownLoc = locate(root, null)
  if (!existsSync(ownLoc.ledgerPath) && given.length && !given[0].endsWith('.ledger.jsonl')) ownLoc = locate(root, given.shift())
  const list = []
  const seen = new Set()
  const add = (e) => { if (!seen.has(e.abs)) { seen.add(e.abs); list.push(e) } }
  if (existsSync(ownLoc.ledgerPath)) add({ abs: ownLoc.ledgerPath, rootAbs: root, own: new Set(ownLoc.own), lockPath: ownLoc.lockPath, isFolderOwn: true, ledgerPath: ownLoc.shown })
  for (const d of await discoverUnder(root)) {
    if (d.rootAbs === root) continue // the folder's own ledger, above
    const L = d.rootAbs ? locate(d.rootAbs, null) : null
    add({ abs: d.abs, rootAbs: d.rootAbs, own: L ? new Set(L.own) : null, lockPath: L ? L.lockPath : d.abs + '.lock', ledgerPath: d.rel })
  }
  for (const a of given) {
    const d = ledgerAt(a)
    const L = d.rootAbs ? locate(d.rootAbs, null) : null
    add({ abs: a, rootAbs: d.rootAbs, own: L ? new Set(L.own) : null, lockPath: L ? L.lockPath : basename(a) === 'ledger.jsonl' ? join(dirname(a), 'agent.lock') : a + '.lock', ledgerPath: relLabel(root, a) })
  }
  // each folder's files leave out the other ledgers' folders and files inside it, and the pin file
  for (const e of list) {
    if (!e.rootAbs) continue
    for (const o of list) {
      if (o === e) continue
      if (o.rootAbs && inside(e.rootAbs, o.rootAbs)) { const p = relPathOrNull(e.rootAbs, o.rootAbs); if (p) e.own.add(p) }
      if (!o.rootAbs && inside(e.rootAbs, o.abs)) { const p = relPathOrNull(e.rootAbs, o.abs); if (p) e.own.add(p) }
    }
    if (pinFile && inside(e.rootAbs, pinFile)) { const p = relPathOrNull(e.rootAbs, pinFile); if (p) e.own.add(p) }
  }
  for (const e of list) e.label = e.rootAbs ? (e.rootAbs === root ? basename(root) || root : relLabel(root, e.rootAbs)) : relLabel(root, e.abs)
  return list
}

// Reads, verifies and (for a ledger with a folder) reads the files of each ledger, then audits them together with
// core's auditMany. Used by iqc audit and the MCP server's audit_summary.
export async function auditLedgers(list, opts, { out, folder, pinLines } = {}) {
  const entries = []
  for (const e of list) {
    const lock = peekLock(e.lockPath)
    const live = lockState(lock) === 'live'
    const r = await readLedgerSettled(e.abs, { agentRunning: () => live, onProgress: out ? (d, t) => out.progress(`Checking ${e.label}: ${formatCount(d)} of ${formatCount(t)} records`) : undefined })
    if (out) out.clearProgress()
    if (live && out) out.note(`An agent is writing ${e.label} now (${describeLock(lock.info)}): a file written during the audit may show as changed or not sealed. Audit again to be sure.`)
    let files = null
    if (e.rootAbs) {
      const f = await readFolder(e.rootAbs, r.verified, { ignore: opts.ignore, own: e.own, out, label: `Reading ${e.label}:` })
      files = f.files
      if (out) {
        for (const p of f.walk.symlinks) out.note(`Skipped ${e.label}/${displayPath(p)}: a symbolic link (links are never followed or sealed).`)
        for (const [p] of f.walk.ambiguous) out.note(`Not checked: more than one file is named ${e.label}/${displayPath(p)}, in different Unicode forms (NFC and NFD).`)
      }
    }
    entries.push({ verified: r.verified, root: e.rootAbs ? e.label : null, files, label: e.label, ledgerPath: e.ledgerPath })
  }
  return auditMany(entries, {
    expectHeads: opts['expect-head'] ? [opts['expect-head']] : undefined, expectKeyIds: opts['expect-key'] ? [opts['expect-key']] : undefined,
    allowChanges: opts['allow-changes'] || [], pinLines, strict: !!opts.strict, where: 'command line', tool: AGENT, ignore: opts.ignore, folder,
  })
}

export function readPinFile(file) {
  if (!file) return undefined
  try {
    return readFileSync(resolve(file), 'utf8')
  } catch (e) {
    throw new UserError(`Cannot read the pin file ${resolve(file)} (${e.code || e.message}).`, EXIT_USAGE)
  }
}

export async function runAudit({ folder, opts, out, stdout = process.stdout }) {
  const root = dataFolder(folder)
  const pinText = readPinFile(opts['pin-file'])
  const list = await ledgersOf(root, opts.ledgers || [], { pinFile: opts['pin-file'] ? resolve(opts['pin-file']) : null })
  if (!list.length) {
    throw new UserError(`No ledger at ${join(root, 'ImmutableQC', 'ledger.jsonl')}, and none in the folders under it (up to 6 deep). Seal the folder first (iqc seal or iqc watch), give the folder that holds the ledgers, or give a ledger with --ledger <file>.`, EXIT_USAGE)
  }
  const shownFolder = folder == null ? '.' : folder
  let report, single = null
  if (list.length === 1 && list[0].isFolderOwn && pinText === undefined) {
    // one ledger of the folder's own: the single-ledger audit, unless it holds agent steps or reviews
    const e = list[0]
    const lock = peekLock(e.lockPath)
    const live = lockState(lock) === 'live'
    const r = await readLedgerSettled(e.abs, { agentRunning: () => live, onProgress: (d, t) => out.progress(`Checking the ledger: ${formatCount(d)} of ${formatCount(t)} records`) })
    out.clearProgress()
    const v = r.verified
    if (!(v.kinds && (v.kinds.step || v.kinds.review))) {
      if (live) out.note(`An agent is sealing this folder now (${describeLock(lock.info)}): a file written during the audit may show as changed or not sealed. Audit again to be sure.`)
      const { files, walk: w } = await readFolder(root, v, { ignore: opts.ignore, own: e.own, out, label: 'Reading' })
      for (const p of w.symlinks) out.note(`Skipped ${displayPath(p)}: a symbolic link (links are never followed or sealed).`)
      for (const [p] of w.ambiguous) out.note(`Not checked: more than one file is named ${displayPath(p)}, in different Unicode forms (NFC and NFD).`)
      report = audit(v, files, {
        expectHead: opts['expect-head'], expectKeyId: opts['expect-key'], allowChanges: opts['allow-changes'] || [], strict: !!opts.strict,
        where: 'command line', tool: AGENT, ignore: opts.ignore, folder: shownFolder,
      })
      single = e
    }
  }
  if (!report) report = await auditLedgers(list, opts, { out, folder: shownFolder, pinLines: pinText })
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
  if (single) printReport(report, { out, loc: { shown: single.ledgerPath }, written })
  else printMany(report, { out, written })
  return exitOf(report)
}

export const exitOf = (report) => (report.verdict === 'pass' ? EXIT_OK : report.verdict === 'review' ? EXIT_REVIEW : EXIT_FAIL)

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

// The verdict of a lab-wide audit (auditMany): the verdict and its sentence, problems, items for review and notes,
// then one line per ledger and the agent steps.
function printMany(report, { out, written }) {
  const pass = report.verdict === 'pass', review = report.verdict === 'review'
  const c = report.counts
  const sentence = report.summary.replace(/^(?:Pass|Review|Fail): /, '').replace(/^./, (ch) => ch.toUpperCase())
  const word = pass ? out.paint('green', out.paint('bold', 'PASS')) : review ? out.paint('yellow', out.paint('bold', 'REVIEW')) : out.paint('red', out.paint('bold', 'FAIL'))
  const say = pass ? (s) => out.print(s) : (s) => out.result(s)
  say(`${word}  ${sentence}`)
  if (report.problems.length) {
    say(out.paint('bold', 'Problems'))
    for (const p of report.problems.slice(0, MAX_PROBLEMS)) say(`  ${out.paint('red', '✗')} ${p.message}`)
    if (report.problems.length > MAX_PROBLEMS) say(`  …and ${formatCount(report.problems.length - MAX_PROBLEMS)} more (every one is in the report: --report or --json).`)
  }
  if (report.forReview.length) {
    say(out.paint('bold', report.strict ? 'For review (failures in strict mode)' : 'For review (recorded, not failures)'))
    for (const g of report.forReview) {
      say(`  ${out.paint('yellow', '!')} ${g.message}`)
      for (const x of g.items.slice(0, MAX_ITEMS)) say(`      ${x}`)
      if (g.items.length > MAX_ITEMS) say(`      …and ${formatCount(g.items.length - MAX_ITEMS)} more`)
    }
  }
  if (report.notes.length) {
    const sayN = report.strict ? say : (s) => out.print(s)
    sayN(out.paint('bold', report.strict ? 'Notes (failures in strict mode)' : 'Notes (not failures)'))
    for (const n of report.notes) {
      sayN(`  ${out.paint('yellow', '•')} ${n.message}`)
      for (const x of n.items.slice(0, MAX_ITEMS)) sayN(`      ${x}`)
      if (n.items.length > MAX_ITEMS) sayN(`      …and ${formatCount(n.items.length - MAX_ITEMS)} more`)
    }
  }
  for (const L of report.ledgers) {
    out.print(`${out.paint('dim', 'Ledger ')}  ${L.ledgerPath || L.label}: ${L.role}, ${plural(L.records, 'record', 'records')}${L.station ? `, station ${L.station}` : ''}${L.keyId ? `, key id ${L.keyId}` : ''}${L.head ? `, head ${formatHead(L.head)}` : ''} (${L.verdict})`)
  }
  const parts = [`${c.match} match`]
  if (c.changed) parts.push(`${c.changed} changed`)
  if (c.missing) parts.push(`${c.missing} missing`)
  if (c.removed) parts.push(`${c.removed} removed (recorded)`)
  if (c.notChecked) parts.push(`${c.notChecked} not checked`)
  out.print(`${out.paint('dim', 'Files  ')}  ${plural(c.sealed, 'file', 'files')} sealed: ${parts.join(', ')}${c.notSealed ? `; ${plural(c.notSealed, 'file', 'files')} not sealed` : ''}; read ${plural(c.filesRead, 'file', 'files')} (${formatBytes(c.bytesRead)})`)
  if (c.steps) {
    out.print(`${out.paint('dim', 'Steps  ')}  ${plural(c.steps, 'agent step', 'agent steps')}: inputs ${c.measuredInputs} measured, ${c.derivedInputs} derived, ${c.untracedInputs} untraced; ${c.stepsApproved} approved, ${c.stepsQuestion} questioned, ${c.stepsRejected} rejected, ${c.stepsAwaiting} awaiting review`)
  }
  if (c.pinsChecked) out.print(`${out.paint('dim', 'Pins   ')}  ${plural(c.pinsChecked, 'pin line', 'pin lines')} checked${c.pinFails ? `, ${c.pinFails} not matching` : ', all matching'}`)
  for (const [what, file] of written) out.print(`${out.paint('dim', what === 'report' ? 'Report ' : 'JSON   ')}  ${file}`)
}
