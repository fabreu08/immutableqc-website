// Immutable QC app: the demo's lab (docs/build-notes/spec-addendum-agents.md, section E "Demo"). No page code here, so
// Node runs it too (app/test/engine.test.mjs). Loaded by the page only when the demo runs.
//   - the instrument folder from ui/sample-data.mjs (bio-line-2), sealed with an instrument key (engine's runSeal);
//   - a small, real analysis agent, run in the page: deterministic code that reads plate-07.csv, writes
//     analysis/plate-07-normalized.csv and analysis/ic50.csv, and records each step (core's planStep) on its own ledger,
//     signed with a separate agent key;
//   - the three changes the demo offers, each audited again with core's auditMany over the whole lab folder: a step
//     that cites a file nothing measured (review), one value changed in a copy of the instrument folder (fail), and a
//     reviewer's sign-off on every step (a reviewer ledger, reviews/<name>.ledger.jsonl).
// Every key is made for the demo, in memory, and is gone when the tab closes. The sample folder (demoListing) is here, not
// in engine.mjs, so its bytes load only with the demo.
import * as IQC from '../core/immutableqc.mjs'
import { FOLDER, STATION, EDIT, sampleFiles } from '../ui/sample-data.mjs'
import { DemoKeys, runSeal, locate, TOOL } from './engine.mjs'
import { runAuditMany, signReview } from './many.mjs'

export const LAB = 'demo-lab'
export const AGENT_DIR = 'agent-workspace'
export const AGENT = { station: 'analysis-workstation', actor: 'analysis-agent' }
export const REVIEWER = 'Demo reviewer'
export const OUT = { normalized: 'analysis/plate-07-normalized.csv', ic50: 'analysis/ic50.csv', compare: 'analysis/plate-07-compare.csv' }
export const IN = { plate: 'inputs/plate-07.csv', copy: 'inputs/plate-07-shared-copy.csv' }
export const DEMO = { folder: FOLDER, station: STATION, edit: EDIT }
const DEMO_TIME = Date.parse('2026-09-14T08:19:47.000Z')

// The sample folder as Files in memory; edited: plate-07.csv as the shared copy has it (EDIT applied to the bytes).
export function demoListing({ edited = false, ledgerText = null } = {}) {
  const items = sampleFiles().map((f) => {
    let bytes = f.bytes
    if (edited && f.path === EDIT.path) {
      bytes = bytes.slice()
      bytes.set(new TextEncoder().encode(EDIT.after), EDIT.offset)
    }
    return { raw: f.path, file: new File([bytes], f.name, { type: f.type, lastModified: DEMO_TIME }) }
  })
  if (ledgerText !== null) items.push({ raw: IQC.LEDGER_PATH, file: new File([ledgerText], IQC.LEDGER_FILE, { type: 'application/x-ndjson' }) })
  items.sort((a, b) => (a.raw < b.raw ? -1 : a.raw > b.raw ? 1 : 0))
  return { root: FOLDER, items, errors: [], source: 'demo' }
}

const enc = (t) => new TextEncoder().encode(t)
const dec = (b) => new TextDecoder().decode(b)
const ref = (path, bytes) => ({ path, sha256: IQC.sha256Hex(bytes), bytes: bytes.length })

// ------------------------------------------------------------------------------------------------- the analysis
// plate CSV (well,abs_450) -> each well scaled to the plate's own range, 0 to 1, four decimals
export function normalize(csv) {
  const rows = String(csv).trim().split('\n').slice(1).map((l) => { const [well, v] = l.split(','); return { well, v: Number(v) } })
  const vs = rows.map((r) => r.v), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1
  return 'well,abs_450,normalized\n' + rows.map((r) => `${r.well},${r.v.toFixed(3)},${((r.v - lo) / span).toFixed(4)}\n`).join('')
}
// normalized CSV -> IC50 estimate: the twelve columns read as a two-fold series from 100 µM (column 1) down; the mean of
// each column; the dose where the means first cross 0.5, interpolated on a log scale. A demo calculation, not a method.
export function ic50(normCsv) {
  const rows = String(normCsv).trim().split('\n').slice(1).map((l) => l.split(','))
  const mean = Array.from({ length: 12 }, (_, c) => {
    const col = rows.filter((r) => Number(r[0].slice(1)) === c + 1).map((r) => Number(r[2]))
    return col.reduce((a, b) => a + b, 0) / col.length
  })
  const dose = (c) => 100 / 2 ** c
  let at = null
  for (let c = 0; c < 11 && at === null; c++) {
    const a = mean[c] - 0.5, b = mean[c + 1] - 0.5
    if (a === 0) at = dose(c)
    else if (a * b < 0) { const t = a / (a - b); at = 10 ** (Math.log10(dose(c)) + t * (Math.log10(dose(c + 1)) - Math.log10(dose(c)))) }
  }
  return 'plate,ic50_um,columns_mean\nplate-07,' + (at === null ? 'not reached' : at.toFixed(3)) + ',' + mean.map((m) => m.toFixed(4)).join(' ') + '\n'
}
// the step a careless agent adds: plate-07 compared with a copy from a shared drive, which nothing sealed
export function compare(a, b) {
  const A = String(a).trim().split('\n'), B = String(b).trim().split('\n')
  const diff = A.slice(1).map((l, i) => [l, B[i + 1]]).filter(([x, y]) => x !== y).map(([x, y]) => `${x.split(',')[0]},${x.split(',')[1]},${(y || '').split(',')[1] || ''}\n`)
  return 'well,plate_07,shared_copy\n' + diff.join('')
}

// ------------------------------------------------------------------------------------------------- the lab
// Builds the lab once: the instrument folder sealed, the agent run and its steps signed. -> state for audit()
export async function build({ pool, signal, at = () => new Date().toISOString() } = {}) {
  const instrumentKeys = new DemoKeys(), agentKeys = new DemoKeys()
  const sealed = await runSeal(locate(demoListing()), { station: STATION, pool, keys: instrumentKeys, signal })
  const plate = sampleFiles().find((f) => f.path === EDIT.path).bytes
  const edited = sampleFiles({ edited: true }).find((f) => f.path === EDIT.path).bytes
  const norm = enc(normalize(dec(plate)))
  const fit = enc(ic50(dec(norm)))
  const cmp = enc(compare(dec(plate), dec(edited)))
  const key = await agentKeys.current()
  const header = await IQC.createHeader({ station: AGENT.station, privateKey: key.privateKey, publicKeyHex: key.publicKeyHex, agent: TOOL })
  const v0 = await IQC.verifyLedger(IQC.serializeLine(header))
  const steps = [
    IQC.planStep({ station: AGENT.station, actor: AGENT.actor, tool: 'normalize, in-page demo', action: 'Scaled each well of plate-07 to the plate range', inputs: [ref(IN.plate, plate)], outputs: [ref(OUT.normalized, norm)], at: at() }),
    IQC.planStep({ station: AGENT.station, actor: AGENT.actor, tool: 'ic50, in-page demo', action: 'Estimated the IC50 from the scaled plate', inputs: [ref(OUT.normalized, norm)], outputs: [ref(OUT.ic50, fit)], at: at() }),
  ]
  const recs = await IQC.createRecords({ head: v0.head, items: steps, privateKey: key.privateKey })
  const agentText = IQC.serializeLine(header) + recs.map((r) => IQC.serializeLine(r)).join('')
  // the step that cites the unsealed copy, appended to the same ledger (so the first two steps keep their records)
  const v1 = await IQC.verifyLedger(agentText)
  const cite = IQC.planStep({ station: AGENT.station, actor: AGENT.actor, tool: 'compare, in-page demo', action: 'Compared plate-07 with a copy from a shared drive', inputs: [ref(IN.plate, plate), ref(IN.copy, edited)], outputs: [ref(OUT.compare, cmp)], at: at() })
  const citeRecs = await IQC.createRecords({ head: v1.head, items: [cite], privateKey: key.privateKey })
  return {
    sealed, instrumentText: sealed.text, agentText, citeText: agentText + citeRecs.map((r) => IQC.serializeLine(r)).join(''),
    bytes: { plate, edited, norm, fit, cmp }, keys: { instrument: sealed.key, agent: key }, review: null,
  }
}

// The lab folder as Files in memory, as a person would drop it.
export function listing(lab, { cite = false, edited = false } = {}) {
  const items = []
  const add = (raw, bytes, type = 'text/csv') => items.push({ raw, file: new File([bytes], raw.split('/').pop(), { type }) })
  for (const it of demoListing({ edited, ledgerText: lab.instrumentText }).items) items.push({ raw: `${FOLDER}/${it.raw}`, file: it.file })
  add(`${AGENT_DIR}/${IN.plate}`, lab.bytes.plate)
  add(`${AGENT_DIR}/${OUT.normalized}`, lab.bytes.norm)
  add(`${AGENT_DIR}/${OUT.ic50}`, lab.bytes.fit)
  if (cite) { add(`${AGENT_DIR}/${IN.copy}`, lab.bytes.edited); add(`${AGENT_DIR}/${OUT.compare}`, lab.bytes.cmp) }
  add(`${AGENT_DIR}/${IQC.LEDGER_PATH}`, enc(cite ? lab.citeText : lab.agentText), 'application/x-ndjson')
  if (lab.review) add(`reviews/${reviewFile(REVIEWER)}`, enc(lab.review.text), 'application/x-ndjson')
  items.sort((a, b) => (a.raw < b.raw ? -1 : a.raw > b.raw ? 1 : 0))
  return { root: LAB, items, errors: [], source: 'demo' }
}

// <name>.ledger.jsonl, from a reviewer's name
export const reviewFile = (name) => `${String(name || 'reviewer').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 48) || 'reviewer'}.ledger.jsonl`

// The whole lab audited with auditMany, as a dropped lab folder is.
export async function audit(lab, { pool, signal, cite = false, edited = false } = {}) {
  return runAuditMany(locate(listing(lab, { cite, edited })), { pool, signal })
}

// The demo reviewer approves every step the last audit shows, with a key of its own (in memory).
export async function signOff(lab, report, { note = 'Checked the scaled plate and the IC50 estimate.' } = {}) {
  if (!lab.reviewKey) lab.reviewKey = await new DemoKeys().current()
  const subjects = report.steps.filter((s) => s.review.state !== 'approved').map((s) => ({ ledgerId: s.ledgerId, n: s.n, h: s.h }))
  if (!subjects.length) return lab.review
  lab.review = await signReview({ key: lab.reviewKey, prior: lab.review, reviewer: REVIEWER, subjects, decision: 'approved', note })
  return lab.review
}
