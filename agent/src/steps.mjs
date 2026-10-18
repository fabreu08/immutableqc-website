// iqc record, iqc trace and iqc review: an agent step recorded in the agent's own ledger (what it read and wrote, by
// SHA-256), the trace of a file's bytes back to measurements, and a reviewer's sign-off in the reviewer's own ledger.
// The records are core's (planStep, planReview); the trace is core's auditMany (lab.mjs). The MCP server (mcp.mjs) uses
// the same functions.
import { lstatSync, writeFileSync } from 'node:fs'
import { resolve, join, relative, isAbsolute, sep, basename } from 'node:path'
import { planStep, planReview, parseRef, encodePath, formatBytes, DECISIONS } from '../../core/immutableqc.mjs'
import { UserError, EXIT_OK, EXIT_USAGE, EXIT_REVIEW, plural } from './util.mjs'
import { dataFolder, locate, confinedFile, displayPath, relPathOrNull } from './paths.mjs'
import { acquireLock } from './lock.mjs'
import { ensureDir, ensureReadme } from './ledger.mjs'
import { openForWriting, pinFileFor } from './session.mjs'
import { hashFile } from './scan.mjs'
import { labLedgers, traceRefs, stateData, treeLines, treeLeaves, LedgerCache } from './lab.mjs'

export const AGENT_README_TEXT = `Immutable QC: the record of what an agent did in this folder
=============================================================

This folder (ImmutableQC) is kept by the Immutable QC agent (iqc record, or the
iqc mcp server an AI agent calls). Each step record names the files the step
read and wrote, by SHA-256 fingerprint and size, and what the step did; each
record is signed and linked to the one before it.

  ledger.jsonl  One record per line.
  README.txt    This note.
  agent.lock    Present only while iqc is writing to the ledger.

Do not edit, rename, move or delete this folder or anything in it. Any edit to
the ledger shows in an audit. Keep it with the folder around it, and audit the
whole lab folder together (the instrument folders, this one and the reviewers'
*.ledger.jsonl files): the audit traces each step's inputs back to the files
the instruments sealed.

  In a browser: open https://immutableqc.com/app/ and drop the lab folder.
  On the command line, with Node.js 22 or later and iqc.mjs:

      node iqc.mjs audit "<the lab folder>"
`

const inside = (dir, abs) => { const r = relative(dir, abs); return !!r && r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r) }

// A file's reference for a step: {path (stored form), sha256, bytes, abs}
export async function refOf(file) {
  let r
  try {
    r = await hashFile(file.abs)
  } catch (e) {
    throw new UserError(`Cannot read ${file.abs} (${e.code || e.message}).`, EXIT_USAGE)
  }
  return { path: file.path, sha256: r.sha256, bytes: r.bytes, abs: file.abs }
}

// --in-ref <sha256>:<bytes>:<label>: an input that is not on disk (core's reference form)
export function inRef(text) {
  try {
    const r = parseRef(String(text))
    return { path: r.path, sha256: r.sha256, bytes: Number(r.bytes) }
  } catch (e) {
    throw new UserError(`--in-ref ${JSON.stringify(text)} is not a file reference: ${e.message} A reference is written <sha256, 64 hex>:<bytes>:<label>.`, EXIT_USAGE)
  }
}

// For a file inside the folder of a ledger that seals files: whether its bytes are those of its latest seal there.
// -> null (in no such folder) | {ledger, path, state: 'matches its seal' | 'changed since it was sealed' | 'recorded removed'
//    | 'not sealed', record?}
export function sealedHere(ledgers, abs, sha256) {
  let best = null
  for (const L of ledgers) {
    if (!L.rootAbs || !L.verified || !L.verified.kinds || !L.verified.kinds.file) continue
    if (!inside(L.rootAbs, abs)) continue
    if (!best || inside(best.rootAbs, L.rootAbs)) best = L
  }
  if (!best) return null
  const p = relPathOrNull(best.rootAbs, abs)
  const e = p ? best.verified.files.get(p) : null
  if (!e) return { ledger: best.label, path: p, state: 'not sealed' }
  const l = e.latest
  if (l.kind === 'file-removed') return { ledger: best.label, path: p, state: 'recorded removed', record: l.n }
  return { ledger: best.label, path: p, state: l.sha256 === sha256 ? 'matches its seal' : 'changed since it was sealed', record: l.n }
}

// Each file's trace state, for check_inputs and iqc record: [{path, sha256, bytes, state, …, sealedHere?}]
export async function traceFiles(ledgers, refs) {
  if (!refs.length) return { files: [], report: null }
  const t = await traceRefs(ledgers, refs.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })))
  const files = refs.map((r, k) => {
    const d = stateData(t.report, t.inputs[k])
    const o = { path: displayPath(r.path), sha256: r.sha256, bytes: r.bytes, ...d }
    if (r.abs) {
      const h = sealedHere(ledgers, r.abs, r.sha256)
      if (h) {
        o.sealedHere = h
        if (h.state === 'changed since it was sealed') o.text += `; ${h.ledger} sealed ${displayPath(h.path)} with other bytes (record ${h.record}): it changed since it was sealed`
      }
    }
    return o
  })
  return { files, report: t.report }
}

// Appends one step record and traces its inputs. w: {root, loc, appender, key, station, cache, searchDirs, out}
export async function recordStep(w, { actor, tool, action, inputs, outputs }) {
  const item = planStep({ station: w.station, actor, tool, action, inputs: inputs.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })), outputs: outputs.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })) })
  // the inputs are traced before the step is appended, so an input is never traced to this step's own output
  await w.appender.sync()
  const own = { abs: w.loc.ledgerPath, rootAbs: w.root, rel: w.loc.shown, root: '' }
  const ledgers = await labLedgers(w.searchDirs, { extra: [own], cache: w.cache })
  const { files } = await traceFiles(ledgers, inputs)
  const [rec] = await w.appender.append([item], w.key.privateKey)
  const v = w.appender.v
  const untraced = files.filter((f) => f.state === 'untraced').length
  return {
    ledger: { path: w.loc.ledgerPath, ledgerId: v.header.ledgerId, station: v.header.station, keyId: v.keyId },
    record: rec.n, link: rec.h, reference: `${v.header.ledgerId}:${rec.n}:${rec.h}`,
    actor: item.f.actor, tool: item.f.tool, action: item.f.action, at: item.f.at,
    inputs: files, outputs: outputs.map((o) => ({ path: displayPath(o.path), sha256: o.sha256, bytes: o.bytes })),
    untracedInputs: untraced,
    ...(untraced ? { warning: `${plural(untraced, 'input matches', 'inputs match')} no sealed measurement and no recorded step output: an audit lists this step for review.` } : {}),
  }
}

// the field rules (core's), before anything is read or written: a plain sentence on a usage error
function checkStepFields({ actor, tool, action, station = 'station' }) {
  try {
    planStep({ station, actor, tool, action, inputs: [], outputs: [{ path: 'x', sha256: '0'.repeat(64), bytes: 0 }] })
  } catch (e) {
    throw new UserError(e.message.replace(/^Not a valid step record: /, 'The step cannot be recorded: '), EXIT_USAGE)
  }
}

function writeJson(opts, data, stdout) {
  if (!opts.json) return
  const text = JSON.stringify(data, null, 2) + '\n'
  if (opts.json === '-') { stdout.write(text); return }
  try { writeFileSync(resolve(opts.json), text) } catch (e) { throw new UserError(`Cannot write the JSON to ${resolve(opts.json)} (${e.code || e.message}).`, EXIT_USAGE) }
}

export function searchDirsOf(opts, def) {
  const list = (opts.search && opts.search.length ? opts.search : [def]).map((d) => resolve(d))
  for (const d of list) {
    let st
    try { st = lstatSync(d) } catch { throw new UserError(`--search ${d}: no folder there.`, EXIT_USAGE) }
    if (!st.isDirectory()) throw new UserError(`--search ${d} is not a folder.`, EXIT_USAGE)
  }
  return list
}

// ------------------------------------------------------------------------------------------------------ iqc record
export async function runRecord({ opts, out, stdout }) {
  const root = dataFolder(opts.root == null ? '.' : opts.root)
  const loc = locate(root, opts.ledger)
  checkStepFields({ actor: opts.actor, tool: opts.tool, action: opts.action, station: opts.station })
  const pin = pinFileFor(opts, out, loc)
  const searchDirs = searchDirsOf(opts, root)
  const cwd = process.cwd()
  const inputs = []
  for (const p of opts.in || []) inputs.push(await refOf(confinedFile(root, p, { base: cwd, what: 'input', own: loc.own })))
  for (const t of opts['in-ref'] || []) inputs.push(inRef(t))
  const outputs = []
  for (const p of opts.out) outputs.push(await refOf(confinedFile(root, p, { base: cwd, what: 'output', own: loc.own })))
  ensureDir(loc.dir)
  const lock = acquireLock(loc.lockPath, { command: 'record', out })
  let r, open
  try {
    open = await openForWriting(loc, opts, out, { pin })
    if (loc.isDefault) ensureReadme(loc.readmePath, AGENT_README_TEXT)
    r = await recordStep({ root, loc, ...open, cache: new LedgerCache(), searchDirs, out }, { actor: opts.actor, tool: opts.tool, action: opts.action, inputs, outputs })
  } finally {
    lock.release()
  }
  if (open.created) {
    out.print(`New ledger ${loc.shown} (ledger id ${r.ledger.ledgerId}, station ${r.ledger.station}).`)
    if (open.key.created) out.print(`New signing key ${open.key.keyId}, saved to ${open.key.file}\n  Keep a backup of that file: it is needed to add records to this ledger (never to audit it).`)
  }
  out.print(`Recorded step ${r.record} in ${loc.shown}: ${r.actor}${r.tool !== '-' ? ` (${r.tool})` : ''}: ${r.action}`)
  out.print(`  reference ${r.reference}`)
  for (const f of r.inputs) out.event(f.state === 'untraced' ? 'untraced' : f.state, f.state === 'untraced' ? 'yellow' : f.state === 'measured' ? 'green' : 'cyan', `${f.path}  ${formatBytes(f.bytes)}  ${f.sha256.slice(0, 8)}…  ${f.text.replace(/^(?:measured|derived|untraced): /, '')}`)
  for (const f of r.outputs) out.event('wrote', 'blue', `${f.path}  ${formatBytes(f.bytes)}  ${f.sha256.slice(0, 8)}…`)
  if (r.warning) out.warn(r.warning)
  writeJson(opts, r, stdout)
  return EXIT_OK
}

// ------------------------------------------------------------------------------------------------------- iqc trace
export async function traceOne(ledgers, file) {
  const ref = await refOf(file)
  const t = await traceRefs(ledgers, [{ path: ref.path, sha256: ref.sha256, bytes: ref.bytes }])
  const x = t.inputs[0]
  const leaves = x && x.tree ? treeLeaves(x.tree) : { measured: 0, untraced: 1, cut: false }
  const cycle = !!(x && x.tree && JSON.stringify(x.tree).includes('"stop":"cycle"'))
  const traces = !!x && !leaves.untraced && !cycle && leaves.measured > 0
  const d = stateData(t.report, x)
  const here = sealedHere(ledgers, ref.abs, ref.sha256)
  const sentence = !x || x.state === 'untraced' ? 'Untraced: these bytes match no sealed measurement and no recorded agent step output.'
    : x.state === 'measured' ? `Measured: ${d.text.replace(/^measured: /, '')}.`
    : traces ? `Derived: it traces to ${plural(leaves.measured, 'measured file', 'measured files')}${leaves.cut ? ' (the tree is cut short; the audit has the whole count)' : ''}.`
    : `Derived, but not every input on the way traces to a measurement: ${plural(leaves.untraced, 'input', 'inputs')} nothing measured${cycle ? ', and a cycle of steps' : ''}.`
  return {
    path: displayPath(ref.path), sha256: ref.sha256, bytes: ref.bytes, ...d, tracesToMeasured: traces, measuredFiles: leaves.measured, untracedInputs: leaves.untraced,
    ...(here ? { sealedHere: here } : {}), sentence, tree: x ? x.tree : null, lines: x && x.tree ? treeLines(t.report, x.tree) : [],
  }
}

export async function runTrace({ file, opts, out, stdout }) {
  const cwd = process.cwd()
  const abs = resolve(cwd, file)
  let st
  try { st = lstatSync(abs) } catch (e) { throw new UserError(e.code === 'ENOENT' ? `No file at ${abs}.` : `Cannot look at ${abs} (${e.code || e.message}).`, EXIT_USAGE) }
  if (st.isSymbolicLink()) throw new UserError(`${abs} is a symbolic link: links are never followed. Trace the file itself.`, EXIT_USAGE)
  if (!st.isFile()) throw new UserError(`${abs} is not a file.`, EXIT_USAGE)
  const rel = relative(cwd, abs)
  const raw = rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : basename(abs)
  let path
  try { path = encodePath(raw) } catch { path = 'file' }
  const searchDirs = searchDirsOf(opts, cwd)
  const ledgers = await labLedgers(searchDirs)
  const r = await traceOne(ledgers, { abs, path })
  out.result(`${r.path}  ${formatBytes(r.bytes)}  ${r.sha256}`)
  out.print(r.sentence)
  if (r.sealedHere) out.print(`In ${r.sealedHere.ledger}: ${r.sealedHere.state}${r.sealedHere.record ? ` (record ${r.sealedHere.record})` : ''}.`)
  if (r.state === 'derived') for (const l of r.lines.slice(1)) out.print(l)
  out.print(`Searched ${plural(ledgers.length, 'ledger', 'ledgers')} under ${searchDirs.join(', ')}.`)
  const { lines, ...data } = r
  writeJson(opts, data, stdout)
  return r.state === 'measured' || r.tracesToMeasured ? EXIT_OK : EXIT_REVIEW
}

// ------------------------------------------------------------------------------------------------------ iqc review
const SUBJECT = /^([0-9a-fA-F]{32}):(0|[1-9][0-9]*)(?::([0-9a-fA-F]{64}))?$/

// a reviewer's name as a file name: "J. Rivera" -> j-rivera
export function reviewerSlug(name) {
  const s = String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
  return s || 'reviewer'
}

export async function runReview({ subjects, opts, out, stdout }) {
  if (!DECISIONS.includes(opts.decision)) throw new UserError(`--decision ${JSON.stringify(opts.decision)}: the decision is one of ${DECISIONS.join(', ')}.`, EXIT_USAGE)
  try {
    planReview({ station: opts.station || 'station', reviewer: opts.reviewer, subjects: [{ ledgerId: '0'.repeat(32), n: 1, h: '0'.repeat(64) }], decision: opts.decision, note: opts.note })
  } catch (e) {
    throw new UserError(e.message.replace(/^Not a valid review record: /, 'The review cannot be recorded: '), EXIT_USAGE)
  }
  const wanted = subjects.map((t) => {
    const m = SUBJECT.exec(String(t).trim())
    if (!m) throw new UserError(`${JSON.stringify(t)} is not a record reference. Write <ledger id, 32 hex>:<record number>, or <ledger id>:<record number>:<link, 64 hex> (iqc record prints it).`, EXIT_USAGE)
    return { ledgerId: m[1].toLowerCase(), n: Number(m[2]), h: m[3] ? m[3].toLowerCase() : null, text: t }
  })
  const cwd = process.cwd()
  const searchDirs = searchDirsOf(opts, cwd)
  const ledgerFile = opts.ledger ? resolve(opts.ledger) : join(cwd, `${reviewerSlug(opts.reviewer)}.ledger.jsonl`)
  const loc = locate(cwd, ledgerFile)
  const pin = pinFileFor(opts, out, loc)
  const ledgers = await labLedgers(searchDirs)
  const byId = new Map()
  for (const L of ledgers) if (L.verified.header && !byId.has(L.verified.header.ledgerId)) byId.set(L.verified.header.ledgerId, L)
  const resolved = []
  for (const w of wanted) {
    if (w.n === 0) throw new UserError(`${w.text}: record 0 is the ledger's header; name a record (1 or more).`, EXIT_USAGE)
    const L = byId.get(w.ledgerId)
    if (!L) {
      if (!w.h) throw new UserError(`Ledger ${w.ledgerId} is not under ${searchDirs.join(', ')}, so record ${w.n}'s link cannot be read. Give --search <the folder that holds it>, or the full reference <ledger id>:<n>:<link>.`, EXIT_USAGE)
      out.warn(`Ledger ${w.ledgerId} is not under ${searchDirs.join(', ')}: record ${w.n} is signed off as given, with link ${w.h.slice(0, 12)}…, unchecked.`)
      resolved.push({ ledgerId: w.ledgerId, n: w.n, h: w.h, what: 'a record of a ledger not found' })
      continue
    }
    const v = L.verified
    if (w.n > v.goodCount) {
      throw new UserError(w.n > v.recordCount ? `${L.label} has no record ${w.n} (it has ${plural(v.recordCount, 'record', 'records')}). Nothing was written.` : `${L.label} does not verify up to record ${w.n}: a broken ledger's records are not signed off. Run iqc audit. Nothing was written.`)
    }
    const rec = v.records[w.n - 1]
    if (w.h && w.h !== rec.h) throw new UserError(`Record ${w.n} of ${L.label} has the link ${rec.h}, not ${w.h}: it is not the record that reference named (the ledger was rewritten, or the reference is wrong). Nothing was written.`)
    const what = rec.kind === 'step' ? `agent step: ${rec.f.actor}: ${rec.f.action}` : rec.kind === 'file' ? `file ${displayPath(rec.f.path)} as sealed on ${rec.f.station}` : rec.kind === 'file-removed' ? `removal of ${displayPath(rec.f.path)}` : `${rec.kind} record`
    if (rec.kind === 'session') out.warn(`Record ${w.n} of ${L.label} is a session record (${rec.f.event}), not an agent step or a file.`)
    resolved.push({ ledgerId: w.ledgerId, n: w.n, h: rec.h, what, ledger: L.label })
  }
  ensureDir(loc.dir)
  const lock = acquireLock(loc.lockPath, { command: 'review', out })
  let rec, open
  try {
    open = await openForWriting(loc, opts, out, { pin })
    const item = planReview({ station: open.station, reviewer: opts.reviewer, subjects: resolved.map(({ ledgerId, n, h }) => ({ ledgerId, n, h })), decision: opts.decision, note: opts.note })
    await open.appender.sync()
    ;[rec] = await open.appender.append([item], open.key.privateKey)
  } finally {
    lock.release()
  }
  const v = open.appender.v
  if (open.created) {
    out.print(`New reviewer ledger ${loc.shown} (ledger id ${v.header.ledgerId}, station ${v.header.station}).`)
    if (open.key.created) out.print(`New signing key ${open.key.keyId}, saved to ${open.key.file}\n  The key identifies whoever holds it on this computer, not a person.`)
  }
  out.print(`Recorded review ${rec.n} in ${loc.shown}: ${opts.decision} by ${rec.f.reviewer}, on ${plural(resolved.length, 'record', 'records')}${rec.f.note !== '-' ? ` ("${rec.f.note}")` : ''}`)
  for (const s of resolved) out.print(`  ${s.ledgerId}:${s.n}  ${s.what}`)
  out.print('Keep this ledger with the lab folder: an audit of the folder finds every *.ledger.jsonl file in it.')
  writeJson(opts, { ledger: { path: loc.ledgerPath, ledgerId: v.header.ledgerId, station: v.header.station, keyId: v.keyId }, record: rec.n, link: rec.h, reviewer: rec.f.reviewer, decision: rec.f.decision, note: rec.f.note === '-' ? '' : rec.f.note, at: rec.f.at, subjects: resolved }, stdout)
  return EXIT_OK
}

