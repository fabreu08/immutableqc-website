// Regression tests for the adversarial review's core findings (docs/build-notes/reports/adversarial-review.md), one per
// finding id, under the lead's rulings R1 to R7 and R9 (core's re-run command).
import test from 'node:test'
import assert from 'node:assert/strict'
import * as IQC from '../immutableqc.mjs'
import { build, T, sha } from './_helpers.mjs'

const AG = 'immutableqc-cli/0.1.0'
const B = (s) => Buffer.byteLength(s)
const F = (s) => ({ sha256: sha(s), bytes: B(s) })
const ref = (path, c) => ({ path, sha256: sha(c), bytes: B(c) })
const keys = new Map()
const keyOf = (name) => { if (!keys.has(name)) keys.set(name, IQC.generateKeyPair()); return keys.get(name) }
const idOf = (name) => sha(`ledger ${name}`).slice(0, 32)
async function ledger(name, items, { station = name, key = name, id = name } = {}) {
  const L = await build(items, { key: await keyOf(key), station, ledgerId: idOf(id), createdAt: T(0) })
  const v = await IQC.verifyLedger(L.text)
  assert.deepEqual(v.problems, [], `${name} verifies`)
  return { ...L, v, id: idOf(id), name, keyId: v.keyId }
}
const cut = (L, k) => IQC.verifyLedger(L.lines.slice(0, -k).map((l) => l + '\n').join(''))
const files = (o) => (o === null ? null : new Map(Object.entries(o).map(([p, c]) => [p, c === null ? null : F(c)])))
const E = (L, f, extra = {}) => ({ verified: L.v, root: L.name, files: files(f), label: L.name, ...extra })
const inst = (station, list, t0 = 0) => [
  { kind: 'session', f: { station, event: 'watch-started', at: T(t0), agent: AG } },
  ...list.map(([path, c], i) => ({ kind: 'file', f: { station, path, sha256: sha(c), bytes: String(B(c)), observedAt: T(t0 + 1 + i), event: 'added' } })),
  { kind: 'session', f: { station, event: 'watch-stopped', at: T(t0 + 500), agent: AG } },
]
const step = (action, inputs, outputs, at) => IQC.planStep({ station: 'analysis-server', actor: 'analysis-agent', tool: '-', action, inputs: inputs.map(([p, c]) => ref(p, c)), outputs: outputs.map(([p, c]) => ref(p, c)), at: T(at) })
const review = (reviewer, subjects, decision, at) => IQC.planReview({ station: 'Browser', reviewer, subjects, decision, at: T(at) })
const subj = (L, k = 0) => { const r = L.records.filter((x) => x.kind === 'step')[k]; return { ledgerId: L.id, n: r.n, h: r.h } }
const codes = (l) => l.map((g) => g.code)
const pin = (L, head = L.v.head) => IQC.formatPinLine(L.id, head, T(600))

const P = 'well,signal\nA1,0.9\n', N = 'well,norm\nA1,1.0\n', X = 'made up\n'
const bio = await ledger('bio', inst('bio-line-2', [['plate.csv', P]]))
const agent = await ledger('agent', [step('Normalize the plate', [['in/plate.csv', P]], [['out/norm.csv', N]], 1000)], { station: 'analysis-server' })
const agentFiles = { 'in/plate.csv': P, 'out/norm.csv': N }
const lab = () => [E(bio, { 'plate.csv': P }), E(agent, agentFiles)]

// R1 ----------------------------------------------------------------------------------------------------------------
test('INT-1: a ledger of file records audited with no folder is a review item, never a pass', () => {
  let r = IQC.auditMany([E(bio, null, { root: null })])
  assert.equal(r.verdict, 'review')
  assert.deepEqual(codes(r.forReview), ['files-not-checked'])
  assert.deepEqual(r.forReview[0].items, ['bio seals 1 file, but no folder was checked against it'])
  r = IQC.auditMany([...lab(), E(bio, null, { root: null, label: 'old.ledger.jsonl' })])
  assert.ok(codes(r.forReview).includes('files-not-checked'))
  assert.equal(IQC.audit(bio.v, null).verdict, 'review')
})

test('INT-2: a sealed file present but unreadable (or an NFC/NFD twin, null in the map) is a review item', () => {
  const a = IQC.audit(bio.v, files({ 'plate.csv': null }), { expectHead: IQC.formatHead(bio.v.head) })
  assert.equal(a.verdict, 'review')
  assert.deepEqual(codes(a.forReview), ['not-checked'])
  assert.equal(a.summary, 'Review: 1 sealed file could not be checked. Each is recorded below.')
  const r = IQC.auditMany([E(bio, { 'plate.csv': null }), E(agent, agentFiles)])
  assert.equal(r.verdict, 'review')
  assert.ok(codes(r.forReview).includes('not-checked'))
  assert.equal(IQC.audit(bio.v, files({ 'plate.csv': null }), { strict: true }).verdict, 'fail')
})

test('CLI-2: the pass sentence claims only what was checked', async () => {
  // a sealed file left out of the audit: "1 of 2 sealed files", never "all 2 files match"
  const L = await ledger('cli2', inst('bio-line-2', [['plate.csv', P], ['old.ledger.jsonl', 'x']]))
  let a = IQC.audit(L.v, files({ 'plate.csv': P, 'old.ledger.jsonl': 'changed' }), { expectHead: IQC.formatHead(L.v.head) })
  assert.equal(a.verdict, 'pass')
  assert.equal(a.summary, 'Pass: 1 of 2 sealed files matches its seal (1 left out), and the ledger is intact (1 note).')
  const only = await ledger('cli2b', inst('bio-line-2', [['sub/ImmutableQC/ledger.jsonl', 'x']]))
  a = IQC.audit(only.v, files({}))
  assert.match(a.summary, /^Pass: the sealed file was not checked \(1 left out\), and the ledger is intact/)
  assert.doesNotMatch(a.summary, /recorded as removed/)
  // an unreadable file never yields a pass sentence
  assert.match(IQC.auditMany([E(bio, { 'plate.csv': null })]).summary, /^Review: /)
})

// R2 ----------------------------------------------------------------------------------------------------------------
test('INT-8: seal and audit share one never-data rule; a path sealed before it is a note, not missing', async () => {
  for (const p of ['ImmutableQC/ledger.jsonl', 'sub/ImmutableQC/README.txt', 'sub/immutableqc/agent.lock', 'j-rivera.ledger.jsonl', 'r/X.LEDGER.JSONL']) assert.equal(IQC.isNeverDataPath(p), true, p)
  for (const p of ['a.csv', 'ImmutableQCx/a.csv', 'ledger.jsonl', 'notes.jsonl']) assert.equal(IQC.isNeverDataPath(p), false, p)
  const present = files({ 'a.csv': 'a', 'sub/ImmutableQC/ledger.jsonl': 'l', 'sub/immutableqc/agent.lock': 'k', 'j-rivera.ledger.jsonl': 'j' })
  const fresh = await IQC.verifyLedger((await build([])).text)
  const plan = IQC.planSeal(fresh, present, { mode: 'first', station: 'S', observedAt: T(1) })
  assert.deepEqual(plan.map((x) => x.f.path), ['a.csv'])
  // a ledger that sealed them before the rule: not missing, not "removed" by the next seal; a note
  const old = await ledger('int8', inst('S', [['a.csv', 'a'], ['j-rivera.ledger.jsonl', 'j'], ['sub/ImmutableQC/ledger.jsonl', 'l'], ['analysis/ic50.csv', 'i']]))
  assert.deepEqual(IQC.planSeal(old.v, files({ 'a.csv': 'a', 'analysis/ic50.csv': 'i' }), { mode: 'unwatched', station: 'S', observedAt: T(9) }), [])
  const r = IQC.auditMany([E(old, { 'a.csv': 'a' }, { nested: ['analysis'] }), E(agent, agentFiles, { root: 'analysis' })])
  assert.notEqual(r.verdict, 'fail')
  assert.deepEqual(r.files.filter((f) => f.ledger === 0).map((f) => [f.path, f.state]), [['a.csv', 'match'], ['analysis/ic50.csv', 'excluded'], ['j-rivera.ledger.jsonl', 'excluded'], ['sub/ImmutableQC/ledger.jsonl', 'excluded']])
  assert.ok(codes(r.notes).includes('excluded-after-seal'))
  // a later --ignore of a sealed path: a note too, not missing
  const a = IQC.audit(old.v, files({ 'analysis/ic50.csv': 'i' }), { ignore: ['a.csv'] })
  assert.equal(a.files.find((f) => f.path === 'a.csv').state, 'excluded')
  assert.equal(a.counts.missing, 0)
})

// R3 ----------------------------------------------------------------------------------------------------------------
test('CLI-3: a pin file fails a ledger that was started over (a new ledger id)', async () => {
  const restarted = await ledger('bio-restart', inst('bio-line-2', [['plate.csv', 'edited']]), { key: 'bio-restart' })
  const r = IQC.auditMany([E(restarted, { 'plate.csv': 'edited' })], { pinLines: pin(bio) })
  assert.equal(r.verdict, 'fail')
  assert.deepEqual(codes(r.problems), ['pin-ledger-missing'])
})

test('MCP-1: an agent ledger deleted and restarted fails against the pin file', async () => {
  const again = await ledger('agent-again', [], { station: 'analysis-server', key: 'agent' })
  const r = IQC.auditMany([E(bio, { 'plate.csv': P }), E(again, agentFiles)], { pinLines: [pin(bio), pin(agent)].join('\n') })
  assert.equal(r.verdict, 'fail')
  assert.deepEqual(codes(r.problems), ['pin-ledger-missing'])
  assert.equal(r.problems[0].ledgerId, agent.id)
})

test('HON-1: a ledger rewritten under a new ledger id with the same key fails the pin file', async () => {
  const rewritten = await ledger('bio-rewritten', inst('bio-line-2', [['plate.csv', 'edited']]), { key: 'bio' })
  const r = IQC.auditMany([E(rewritten, { 'plate.csv': 'edited' })], { pinLines: pin(bio) })
  assert.equal(r.verdict, 'fail')
  assert.equal(r.counts.pinsMissing, 1)
})

test('INT-5: a deleted ledger named by the pin file fails, and the message says how to include one kept elsewhere', () => {
  const r = IQC.auditMany([E(bio, { 'plate.csv': P })], { pinLines: [pin(bio), pin(agent)].join('\n') })
  assert.equal(r.verdict, 'fail')
  assert.match(r.problems[0].message, /no audited ledger has that id: the ledger was deleted, started over, or is kept outside this folder\. Include a ledger kept elsewhere with --ledger <file>/)
  assert.equal(r.expectations.pins.find((x) => x.ledgerId === agent.id).ok, false)
})

test('MISSED-3: one restarted folder with a pin file: fail, not a pass with a note', async () => {
  const restarted = await ledger('m3', inst('bio-line-2', [['plate.csv', 'edited']]))
  const r = IQC.auditMany([E(restarted, { 'plate.csv': 'edited' }, { folderOwn: true })], { pinLines: pin(bio) })
  assert.equal(r.summary, 'Fail: 1 pinned ledger is missing.')
  assert.ok(!codes(r.notes).includes('pin-other-ledger'))
})

test('MISSED-1: an expected head with no ledger id is never satisfied by any ledger', async () => {
  const fresh = await ledger('m1-new', inst('bio-line-2', [['plate.csv', 'edited']]))
  const backup = { ...E(bio, { 'plate.csv': P }), root: 'backup', label: 'backup' }
  let r = IQC.auditMany([E(fresh, { 'plate.csv': 'edited' }), backup], { expectHeads: [IQC.formatHead(bio.v.head)] })
  assert.equal(r.verdict, 'fail')
  assert.match(r.problems[0].message, /names no ledger id.*name the ledger id/)
  r = IQC.auditMany([E(fresh, { 'plate.csv': 'edited' }), backup], { expectHeads: [`${bio.id}:${IQC.formatHead(bio.v.head)}`] })
  assert.equal(r.expectations.heads[0].ok, true, 'a 32-hex ledger id prefix binds it')
  // an expected key with several ledgers: each ledger signed by another key fails
  r = IQC.auditMany([E(fresh, { 'plate.csv': 'edited' }), backup], { expectKeyIds: [bio.keyId] })
  assert.equal(r.verdict, 'fail')
  assert.deepEqual(codes(r.problems), ['unexpected-key'])
})

test('MISSED-15: with the original kept in a subfolder, a restarted folder fails the head and key that iqc head printed', async () => {
  const fresh = await ledger('m15-new', inst('bio-line-2', [['plate.csv', 'edited']]))
  const entries = [E(fresh, { 'plate.csv': 'edited' }, { folderOwn: true }), { ...E(bio, { 'plate.csv': P }), root: 'backup', label: 'backup' }]
  const r = IQC.auditMany(entries, { pinLines: pin(bio), expectHeads: [IQC.formatHead(bio.v.head)], expectKeyIds: [bio.keyId] })
  assert.equal(r.verdict, 'fail')
  assert.deepEqual(codes(r.problems), ['expect-head', 'unexpected-key'])
  assert.match(r.problems[0].message, /^m15-new: /)
})

test('HON-1 (re-test): a restarted folder with a planted copy of the pinned ledger fails the pin file alone', async () => {
  const fresh = await ledger('hon1-new', inst('bio-line-2', [['plate.csv', 'edited']]), { key: 'hon1-new' })
  const entries = [E(fresh, { 'plate.csv': 'edited' }, { folderOwn: true }), { ...E(bio, { 'plate.csv': P }), root: 'backup', label: 'backup' }]
  const r = IQC.auditMany(entries, { pinLines: pin(bio) })
  assert.equal(r.verdict, 'fail')
  assert.deepEqual(codes(r.problems), ['ledger-not-pinned'])
  assert.equal(r.problems[0].ledgerId, fresh.id)
  assert.match(r.problems[0].message, /^hon1-new is this folder's own ledger .*no pin line or pinned head names it, while they name backup: .*started over/)
  assert.equal(r.summary, "Fail: the folder's own ledger is not pinned.")
  // honest: the folder's own ledger is the pinned one, with another ledger beside it
  assert.equal(IQC.auditMany([{ ...entries[1], folderOwn: true, root: '' }, E(agent, agentFiles)], { pinLines: pin(bio) }).verdict, 'pass')
})

test('MISSED-3 (re-test): an expected head bound to a planted copy alone does not pass the restarted folder', async () => {
  const fresh = await ledger('m3-new', inst('bio-line-2', [['plate.csv', 'edited']]), { key: 'm3-new' })
  const entries = [E(fresh, { 'plate.csv': 'edited' }, { folderOwn: true }), { ...E(bio, { 'plate.csv': P }), root: 'backup', label: 'backup' }]
  const r = IQC.auditMany(entries, { expectHeads: [`${bio.id}:${IQC.formatHead(bio.v.head)}`] })
  assert.equal(r.expectations.heads[0].ok, true)
  assert.equal(r.verdict, 'fail')
  assert.deepEqual(codes(r.problems), ['ledger-not-pinned'])
})

test('MISSED-2: a planted uncut copy does not hide a cut: every copy of a ledger id is checked against the pin', async () => {
  const L = await ledger('m2', inst('bio-line-2', [['plate.csv', P], ['b.csv', 'out of spec']]))
  const shortV = await cut(L, 2)
  const r = IQC.auditMany([{ verified: shortV, root: 'station', files: files({ 'plate.csv': P }), label: 'station' }, { verified: L.v, root: null, files: null, label: 'station/ImmutableQC/0.ledger.jsonl' }], { pinLines: pin(L) })
  assert.equal(r.verdict, 'fail')
  assert.match(r.problems.find((p) => p.code === 'pin').message, /^station: pin line 1 .*this copy of the ledger has only 2 records: it was cut, or it is an older copy\.$/)
  assert.ok(codes(r.forReview).includes('duplicate-ledger'))
  // duplicates alone: a review item, not a failure with tampering wording (INT-9)
  const d = IQC.auditMany([E(bio, { 'plate.csv': P }), { ...E(bio, { 'plate.csv': P }), root: 'copy', label: 'copy' }])
  assert.equal(d.verdict, 'review')
  assert.deepEqual(codes(d.forReview), ['duplicate-ledger'])
})

// R4 ----------------------------------------------------------------------------------------------------------------
const forged = await ledger('forged', inst('bio-line-2', [['x.csv', X]]))
const agentX = await ledger('agentx', [step('Use x', [['in/x.csv', X]], [['out/y.csv', 'y']], 1000)], { station: 'analysis-server' })
const xLab = () => [E(bio, { 'plate.csv': P }), E(forged, { 'x.csv': X }), E(agentX, { 'in/x.csv': X, 'out/y.csv': 'y' })]

test('HON-2: a ledger an agent made itself measures nothing once station keys are listed; without them a note says so', () => {
  let r = IQC.auditMany(xLab())
  assert.equal(r.steps[0].inputs[0].state, 'measured')
  const g = r.notes.find((n) => n.code === 'station-keys-not-listed')
  assert.ok(g.message.includes(`${forged.keyId} (forged)`) && /List station keys with --station-key/.test(g.message), g.message)
  r = IQC.auditMany(xLab(), { stationKeys: [bio.keyId] })
  assert.equal(r.verdict, 'review')
  assert.equal(r.steps[0].inputs[0].state, 'untraced')
  assert.equal(r.steps[0].inputs[0].why, `sealed by key ${forged.keyId}, not a listed station key`)
  assert.ok(!codes(r.notes).includes('station-keys-not-listed'))
})

test("INT-4: an agent's own ledger never measures its own inputs", async () => {
  const self = await ledger('self', [...inst('analysis-server', [['in/x.csv', X]]), step('Use x', [['in/x.csv', X]], [['out/y.csv', 'y']], 1000)], { station: 'analysis-server' })
  const r = IQC.auditMany([E(self, { 'in/x.csv': X, 'out/y.csv': 'y' })])
  assert.equal(r.steps[0].inputs[0].state, 'untraced')
  assert.equal(r.verdict, 'review')
})

test('KEY-2: with station keys, only ledgers signed by a listed key measure; a listed key that signs nothing fails', () => {
  let r = IQC.auditMany(xLab(), { stationKeys: [bio.keyId.toUpperCase()] })
  assert.deepEqual(codes(r.forReview), ['untraced-input'])
  r = IQC.auditMany(xLab(), { stationKeys: [bio.keyId, '0123456789abcdef'] })
  assert.equal(r.verdict, 'fail')
  assert.deepEqual(codes(r.problems), ['station-key-not-found'])
  assert.throws(() => IQC.auditMany(xLab(), { stationKeys: ['nope'] }), /16 hex characters/)
  assert.ok(r.rerun[1].includes(`--station-key ${bio.keyId} --station-key 0123456789abcdef`))
})

test('CLI-6: an added station ledger with an unexpected key fails a lab audit with --expect-key; keys are listed', () => {
  const r = IQC.auditMany(xLab(), { expectKeyIds: [bio.keyId, agentX.keyId] })
  assert.equal(r.verdict, 'fail')
  assert.deepEqual(codes(r.problems), ['unexpected-key'])
  assert.match(r.problems[0].message, new RegExp(`^forged is signed with key ${forged.keyId}, which is not among the expected keys\\. The keys found: `))
  assert.equal(IQC.auditMany(xLab(), { expectKeyIds: [bio.keyId, agentX.keyId, forged.keyId], stationKeys: [bio.keyId] }).verdict, 'review')
})

test('CLI-5 (R4): bytes an agent wrote and a station also sealed are traced as derived, so the lineage is kept', async () => {
  const sealedOut = await ledger('sealed-out', inst('bio-line-2', [['norm.csv', N]], 2000))
  const two = await ledger('two', [step('Normalize', [['in/plate.csv', P]], [['out/norm.csv', N]], 1000), step('Fit', [['out/norm.csv', N]], [['out/fit.csv', 'f']], 1001)], { station: 'analysis-server' })
  const r = IQC.auditMany([E(bio, { 'plate.csv': P }), E(sealedOut, { 'norm.csv': N }), E(two, { 'in/plate.csv': P, 'out/norm.csv': N, 'out/fit.csv': 'f' })])
  const inp = r.steps[1].inputs[0]
  assert.deepEqual([inp.state, inp.step.n, inp.measured[0].ledgerId], ['derived', 1, sealedOut.id])
})

// R5 ----------------------------------------------------------------------------------------------------------------
const noIn = await ledger('noin', [step('Write the standard curve', [], [['standard.csv', 'S']], 1000), step('Fit against it', [['in/plate.csv', P], ['standard.csv', 'S']], [['result.csv', 'R']], 1001)], { station: 'analysis-server' })
const noInFiles = { 'standard.csv': 'S', 'in/plate.csv': P, 'result.csv': 'R' }

test('INT-7: a step that names no inputs is a review item; a reviewer approval clears it; no "every input traced"', async () => {
  let r = IQC.auditMany([E(bio, { 'plate.csv': P }), E(noIn, noInFiles)])
  assert.equal(r.verdict, 'review')
  assert.deepEqual(codes(r.forReview), ['no-inputs'])
  assert.deepEqual(r.forReview[0].items, ['noin: Step 1 ("Write the standard curve") names no inputs: its outputs trace to nothing measured'])
  const rv = await ledger('rv-noin', [review('J. Rivera', [subj(noIn, 0)], 'approved', 2000)], { station: 'Browser' })
  r = IQC.auditMany([E(bio, { 'plate.csv': P }), E(noIn, noInFiles), E(rv, null, { root: null })])
  assert.equal(r.verdict, 'pass')
  assert.doesNotMatch(r.summary, /every input traced/)
  assert.match(r.summary, /2 agent steps are recorded \(2 that do not trace to measurements are approved by a reviewer\)/)
})

test('MISSED-10: an output of a step with no inputs does not launder an invented file', () => {
  const r = IQC.auditMany([E(bio, { 'plate.csv': P }), E(noIn, noInFiles)])
  assert.equal(r.steps[1].inputs[1].state, 'derived')
  const lo = r.lineage.outputs.find((o) => o.path === 'result.csv')
  assert.deepEqual([lo.tracesToMeasured, lo.empty], [false, true])
  assert.equal(r.verdict, 'review')
})

// R6 ----------------------------------------------------------------------------------------------------------------
test('INT-3: a forged approval under the same reviewer name and another key does not override a rejection', async () => {
  const real = await ledger('rv-real', [review('J. Rivera', [subj(agent)], 'rejected', 2000)], { station: 'Browser' })
  const fake = await ledger('rv-fake', [review('J. Rivera', [subj(agent)], 'approved', 3000)], { station: 'Browser' })
  const r = IQC.auditMany([...lab(), E(real, null, { root: null }), E(fake, null, { root: null })])
  assert.equal(r.steps[0].review.state, 'rejected')
  assert.equal(r.verdict, 'review')
  assert.deepEqual(r.steps[0].review.decisions.map((d) => [d.keyId, d.latest]), [[real.keyId, true], [fake.keyId, true]])
})

test('KEY-1: within a key the highest record number wins, not the self-written time', async () => {
  const one = await ledger('rv-one', [review('J. Rivera', [subj(agent)], 'approved', 3000), review('J. Rivera', [subj(agent)], 'question', 2000)], { station: 'Browser' })
  assert.equal(IQC.auditMany([...lab(), E(one, null, { root: null })]).steps[0].review.state, 'question')
  // two ledgers of one key: by their own time
  const a = await ledger('rv-k1', [review('J. Rivera', [subj(agent)], 'rejected', 2000)], { station: 'Browser', key: 'rv-same' })
  const b = await ledger('rv-k2', [review('J. Rivera', [subj(agent)], 'approved', 3000)], { station: 'Browser', key: 'rv-same' })
  assert.equal(IQC.auditMany([...lab(), E(a, null, { root: null }), E(b, null, { root: null })]).steps[0].review.state, 'approved')
})

test('MISSED-6: with reviewer keys, approvals count only from listed keys; without them a note names the keys', async () => {
  const real = await ledger('rv-real6', [review('J. Rivera', [subj(agent)], 'approved', 2000)], { station: 'Browser' })
  const fake = await ledger('rv-fake6', [review('J. Rivera', [subj(agent)], 'approved', 3000)], { station: 'Browser' })
  let r = IQC.auditMany([...lab(), E(fake, null, { root: null })], { reviewerKeys: [real.keyId] })
  assert.equal(r.steps[0].review.state, 'awaiting review')
  assert.ok(codes(r.notes).includes('review-unlisted-key'))
  r = IQC.auditMany([...lab(), E(real, null, { root: null })], { reviewerKeys: [real.keyId] })
  assert.equal(r.steps[0].review.state, 'approved')
  r = IQC.auditMany([...lab(), E(fake, null, { root: null })])
  assert.ok(r.notes.find((n) => n.code === 'reviewer-keys-not-listed').message.includes(`${fake.keyId} (J. Rivera)`))
  // a rejection from any key still counts
  const rej = await ledger('rv-rej6', [review('K. Osei', [subj(agent)], 'rejected', 2500)], { station: 'Browser' })
  assert.equal(IQC.auditMany([...lab(), E(real, null, { root: null }), E(rej, null, { root: null })], { reviewerKeys: [real.keyId] }).steps[0].review.state, 'rejected')
})

// R7 ----------------------------------------------------------------------------------------------------------------
test('INT-6: an audit with no pinned head says a cut from the end cannot show; with one, the cut fails', async () => {
  const shortV = await cut(bio, 2)
  let a = IQC.audit(shortV, files({ 'plate.csv': P }))
  assert.ok(codes(a.notes).includes('no-pinned-head'))
  assert.equal(a.notes.find((n) => n.code === 'no-pinned-head').message, 'Records removed from the end of a ledger show only against a pinned head (--pin-file or --expect-head).')
  a = IQC.audit(shortV, files({ 'plate.csv': P }), { expectHead: IQC.formatHead(bio.v.head) })
  assert.equal(a.verdict, 'fail')
  assert.ok(!codes(a.notes).includes('no-pinned-head'))
})

test('MISSED-4: every ledger no pin covers gets the note; a pinned cut fails in a lab audit', async () => {
  let r = IQC.auditMany(lab(), { pinLines: pin(bio) })
  assert.deepEqual(r.notes.find((n) => n.code === 'no-pinned-head').items, [`agent: the head now is ${IQC.formatHead(agent.v.head)}`])
  r = IQC.auditMany([{ ...E(bio, { 'plate.csv': P }), verified: await cut(bio, 1) }, E(agent, agentFiles)], { pinLines: pin(bio) })
  assert.equal(r.verdict, 'fail')
  assert.match(r.problems[0].message, /records were removed from its end/)
})

// R9 (core) ---------------------------------------------------------------------------------------------------------
test('WS-1/MISSED-5: the re-run command never carries a name that could run as code in any shell', () => {
  const evil = "plate'$(New-Item -ItemType File PWNED)'x"
  for (const r of [IQC.audit(bio.v, files({ 'plate.csv': P }), { folder: evil }), IQC.auditMany(lab(), { folder: evil })]) {
    const line = r.rerun[1]
    assert.ok(line.startsWith("On the command line (replace <folder> with the folder's path): node iqc.mjs audit <folder>"), line)
    const cmd = line.slice(line.indexOf('node iqc.mjs'))
    assert.ok(!cmd.includes('$(') && !cmd.includes("'"), line)
  }
  assert.ok(IQC.audit(bio.v, files({}), { folder: 'data/run-0914' }).rerun[1].startsWith('On the command line: node iqc.mjs audit data/run-0914 '))
  const line = IQC.audit(bio.v, files({}), { folder: 'd', allowChanges: ['*.log', "a'b"] }).rerun[1]
  assert.ok(line.endsWith(' --allow-changes "*.log" --allow-changes <pattern>') && line.includes('(replace <pattern> with the pattern)'), line)
})
