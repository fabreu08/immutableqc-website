// The ledgers of a lab, as an agent step, a trace or a lab-wide audit needs them: found under folders by core's rule
// (discoverLedgers: every ImmutableQC/ledger.jsonl up to 6 folders deep, and every *.ledger.jsonl, never following a
// symbolic link), read and verified whole (kept in memory while a file's size and modification time stay the same),
// and traced with core's auditMany. Nothing here decides a rule of the format: core does.
import { readdir, realpath } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { join, dirname, basename, relative, isAbsolute, sep } from 'node:path'
import {
  discoverLedgers, auditMany, planStep, createHeader, createRecords, verifyLedger, serializeLine, generateKeyPair,
  publicKeyHex, sha256Hex, LEDGER_DIR, LEDGER_FILE,
} from '../../core/immutableqc.mjs'
import { UserError, EXIT_USAGE, whenUTC } from './util.mjs'
import { readLedgerSettled } from './ledger.mjs'
import { peekLock, lockState } from './lock.mjs'

const DEPTH = 6

// The relative paths (raw, "/" between segments) of the files under dir that could be ledgers: ledger.jsonl inside a
// folder named ImmutableQC, and *.ledger.jsonl, at most 6 folders deep (core's discoverLedgers picks them). Folders are
// listed by name only (no file is opened); symbolic links are skipped. A folder that cannot be listed is left out
// (the top one is an error).
export async function ledgerCandidates(dir) {
  const out = []
  const stack = [{ abs: dir, rel: '', depth: 0 }]
  while (stack.length) {
    const { abs, rel, depth } = stack.pop()
    let entries
    try {
      entries = await readdir(abs, { withFileTypes: true })
    } catch (e) {
      if (depth === 0) throw new UserError(`Cannot read the folder ${dir} (${e.code || e.message}).`, EXIT_USAGE)
      continue
    }
    for (const ent of entries) {
      const r = rel ? `${rel}/${ent.name}` : ent.name
      if (ent.isSymbolicLink()) continue
      if (ent.isDirectory()) {
        if (depth < DEPTH || (depth === DEPTH && ent.name === LEDGER_DIR)) stack.push({ abs: join(abs, ent.name), rel: r, depth: depth + 1 })
      } else if (ent.isFile() && ((ent.name === LEDGER_FILE && basename(abs) === LEDGER_DIR) || ent.name.endsWith('.ledger.jsonl'))) out.push(r)
    }
  }
  return out.sort()
}

// The ledgers under dir, by core's rule: [{abs, rootAbs | null, rel, root (raw, relative to dir) | null}].
export async function discoverUnder(dir) {
  return discoverLedgers(await ledgerCandidates(dir)).map((d) => ({
    abs: join(dir, ...d.ledgerPath.split('/')),
    rootAbs: d.root === null ? null : d.root === '' ? dir : join(dir, ...d.root.split('/')),
    rel: d.ledgerPath,
    root: d.root,
  }))
}

// A ledger given by path (--ledger): ImmutableQC/ledger.jsonl has the folder around ImmutableQC as its root; any other
// file has no file root (a reviewer's *.ledger.jsonl, a ledger kept elsewhere).
export function ledgerAt(abs) {
  const isFolderLedger = basename(abs) === LEDGER_FILE && basename(dirname(abs)) === LEDGER_DIR
  return { abs, rootAbs: isFolderLedger ? dirname(dirname(abs)) : null, rel: abs, root: null }
}

// Reads and verifies ledgers, keeping each verified ledger while its file's size and modification time stay the same
// (the MCP server asks again on every call).
export class LedgerCache {
  constructor() { this.map = new Map() }

  async read(abs) {
    const lockPath = basename(abs) === LEDGER_FILE ? join(dirname(abs), 'agent.lock') : abs + '.lock'
    const r = await readLedgerSettled(abs, { agentRunning: () => lockState(peekLock(lockPath)) === 'live' })
    return r
  }

  async get(abs) {
    const k = this.map.get(abs)
    let st = null
    try { st = statSync(abs) } catch { /* read() says why */ }
    if (k && st && k.stat.size === st.size && k.stat.mtimeMs === st.mtimeMs) return k.verified
    const r = await this.read(abs)
    this.map.set(abs, { verified: r.verified, stat: r.stat })
    return r.verified
  }
}

// The ledgers to trace against: those found under each search folder, then the extra ones (the step's own ledger),
// each once (by its real path). label: its root (or file) relative to the first search folder when inside it.
export async function labLedgers(searchDirs, { extra = [], cache = new LedgerCache() } = {}) {
  const seen = new Set(), list = []
  const base = searchDirs[0] || null
  const add = async (d) => {
    let real
    try { real = await realpath(d.abs) } catch (e) { throw new UserError(`Cannot read the ledger ${d.abs} (${e.code || e.message}).`, EXIT_USAGE) }
    if (seen.has(real)) return
    seen.add(real)
    const where = d.rootAbs || d.abs
    const rel = base ? relative(base, where) : ''
    const label = base && !rel.startsWith('..') && !isAbsolute(rel) ? (rel ? rel.split(sep).join('/') : basename(where)) : where
    const verified = await cache.get(d.abs)
    list.push({ ...d, label, verified })
  }
  for (const dir of searchDirs) for (const d of await discoverUnder(dir)) await add(d)
  for (const d of extra) await add(d)
  return list
}

// ------------------------------------------------------------------------------------------------- trace (probe)
// To trace files without writing anything, core's auditMany is given one more ledger, made in memory and never
// saved: a single step whose inputs are the files asked about, signed with a key made for it. Its inputs come back
// measured, derived or untraced, with the trees back to measurements, exactly as the audit would trace a recorded step.
let _probeKey = null
const PROBE_STATION = 'trace'

async function probeLedger(refs) {
  if (!_probeKey) _probeKey = generateKeyPair({ extractable: false })
  const key = await _probeKey
  const at = new Date().toISOString()
  const header = await createHeader({ station: PROBE_STATION, privateKey: key.privateKey, publicKeyHex: await publicKeyHex(key.publicKey), createdAt: at })
  const out = { path: 'trace', sha256: sha256Hex(`immutableqc trace ${at} ${Math.random()}`), bytes: 0 }
  const item = planStep({ station: PROBE_STATION, actor: 'trace', action: 'Trace the files asked about', inputs: refs, outputs: [out], at })
  const records = await createRecords({ head: { n: 0, h: header.g }, items: [item], privateKey: key.privateKey })
  return verifyLedger([header, ...records].map(serializeLine).join(''))
}

// refs: [{path, sha256, bytes}] (path in its stored form). Returns {inputs: [core's input objects, in order, each with
// tree: its node in the trace tree], report}. ledgers: from labLedgers.
export async function traceRefs(ledgers, refs, { maxDepth } = {}) {
  const entries = ledgers.map((L) => ({ verified: L.verified, root: L.root ?? null, files: null, label: L.label, ledgerPath: L.rel }))
  const probe = await probeLedger(refs)
  entries.push({ verified: probe, root: null, files: null, label: PROBE_STATION })
  const report = auditMany(entries, { maxDepth, where: 'command line' })
  const li = entries.length - 1
  const step = report.steps.find((s) => s.ledger === li)
  const lo = report.lineage.outputs.find((o) => o.ledger === li)
  const nodes = lo && lo.tree ? lo.tree.inputs : []
  // inputs are deduplicated by core (an exact duplicate is left out): match them back by reference
  const key = (r) => `${r.sha256}:${r.bytes}:${r.path}`
  const byKey = new Map(step.inputs.map((x, k) => [key(x), { ...x, tree: nodes[k] || null }]))
  return { inputs: refs.map((r) => byKey.get(key({ ...r, bytes: String(r.bytes) })) || null), report, probeLedger: li }
}

// ------------------------------------------------------------------------------------------------ plain words
const stepOf = (report, ref) => (ref ? report.steps.find((s) => s.ledger === ref.ledger && s.n === ref.n) : null)
const labelOf = (report, i) => (report.ledgers[i] ? report.ledgers[i].label : `ledger ${i + 1}`)

// One input's trace state as a short phrase: what a person (or an agent) reads.
export function stateText(report, x) {
  if (!x) return 'not traced'
  if (x.state === 'measured') {
    const m = x.measured[0]
    const again = x.changedAfter ? `; that file was sealed again later (record ${x.changedAfter.n} of ${labelOf(report, x.changedAfter.ledger)}, ${whenUTC(x.changedAfter.observedAt)}): it changed after this version` : ''
    return `measured: sealed by ${m.station || labelOf(report, m.ledger)} as ${m.path} (record ${m.n}, ${whenUTC(m.observedAt)})${again}`
  }
  if (x.state === 'derived') {
    const s = stepOf(report, x.step)
    return `derived: written by the agent step in record ${x.step.n} of ${labelOf(report, x.step.ledger)}${s ? ` (${s.actor}: ${s.action})` : ''}`
  }
  return 'untraced: it matches no sealed measurement and no recorded agent step output'
}

// The same, as plain data (for --json and the MCP tools).
export function stateData(report, x) {
  if (!x) return { state: 'untraced' }
  const o = { state: x.state }
  if (x.state === 'measured') {
    const m = x.measured[0]
    o.measured = { ledgerId: m.ledgerId, ledger: labelOf(report, m.ledger), station: m.station, path: m.path, record: m.n, sealedAt: m.observedAt, event: m.event }
    if (x.measured.length > 1 || x.measuredMore) o.measured.alsoSealed = x.measured.length - 1 + (x.measuredMore || 0)
    o.changedAfterSeal = !!x.changedAfter
    if (x.changedAfter) o.sealedAgain = { ledger: labelOf(report, x.changedAfter.ledger), record: x.changedAfter.n, at: x.changedAfter.observedAt }
  } else if (x.state === 'derived') {
    const s = stepOf(report, x.step)
    o.derived = { ledgerId: x.step.ledgerId, ledger: labelOf(report, x.step.ledger), record: x.step.n, ...(s ? { actor: s.actor, tool: s.tool, action: s.action, at: s.at } : {}) }
  }
  o.text = stateText(report, x)
  return o
}

// A trace tree as lines of text: each input, with what wrote or sealed it, its inputs indented below.
export function treeLines(report, node, { indent = '', max = 400 } = {}) {
  const lines = []
  const walk = (n, pad) => {
    if (lines.length >= max) return
    if (n.stop === 'size') { lines.push(`${pad}… and ${n.more} more`); return }
    let t
    if (n.state === 'measured') t = `measured on ${n.measured.station || labelOf(report, n.measured.ledger)} (record ${n.measured.n}, ${whenUTC(n.measured.observedAt)})`
    else if (n.state === 'derived') { const s = stepOf(report, n.step); t = `derived: record ${n.step.n} of ${labelOf(report, n.step.ledger)}${s ? ` (${s.actor}: ${s.action})` : ''}` }
    else t = 'untraced: nothing measured it'
    const stop = n.stop === 'cycle' ? ' [a cycle: stops here]' : n.stop === 'shown above' ? ' [shown above]' : n.stop === 'depth' ? ' [too deep: stops here]' : ''
    lines.push(`${pad}${n.path}  ${n.sha256.slice(0, 12)}…  ${t}${stop}`)
    for (const c of n.inputs || []) walk(c, pad + '  ')
  }
  walk(node, indent)
  if (lines.length >= max) lines.push(`${indent}…(the tree is cut at ${max} lines)`)
  return lines
}

// What a tree rests on: the measured files and the untraced inputs it reaches (counted by SHA-256).
export function treeLeaves(node) {
  const measured = new Set(), untraced = new Set()
  let cut = false
  const walk = (n) => {
    if (n.stop === 'size' || n.stop === 'depth') { cut = true; return }
    if (n.state === 'measured') measured.add(n.sha256)
    else if (n.state === 'untraced') untraced.add(n.sha256)
    for (const c of n.inputs || []) walk(c)
  }
  walk(node)
  return { measured: measured.size, untraced: untraced.size, cut }
}
