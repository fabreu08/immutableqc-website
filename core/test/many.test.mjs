// auditMany (spec addendum C): several ledgers audited together, the lineage of agent steps, reviews, pins, one
// three-level verdict; and renderReportHTML on its report.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as IQC from '../immutableqc.mjs'
import { build, T, sha } from './_helpers.mjs'

const AG = 'immutableqc-cli/0.1.0'
const B = (s) => Buffer.byteLength(s)
const F = (s) => ({ sha256: sha(s), bytes: B(s) })
const ref = (path, content) => ({ path, sha256: sha(content), bytes: B(content) })
const idOf = (name) => sha(`ledger ${name}`).slice(0, 32)
const keys = new Map()
const keyOf = (name) => { if (!keys.has(name)) keys.set(name, IQC.generateKeyPair()); return keys.get(name) }

// an instrument ledger: a watch around file records [path, content, event?] (or removals {removed: path})
function instItems(station, files, t0 = 0) {
  const it = [{ kind: 'session', f: { station, event: 'watch-started', at: T(t0), agent: AG } }]
  files.forEach((x, i) => {
    if (x.removed) it.push({ kind: 'file-removed', f: { station, path: x.removed, observedAt: T(t0 + 1 + i), event: 'removed' } })
    else it.push({ kind: 'file', f: { station, path: x[0], sha256: sha(x[1]), bytes: String(B(x[1])), observedAt: T(t0 + 1 + i), event: x[2] || 'added' } })
  })
  it.push({ kind: 'session', f: { station, event: 'watch-stopped', at: T(t0 + 500), agent: AG } })
  return it
}
const step = (action, inputs, outputs, at, extra = {}) => IQC.planStep({ station: 'analysis-server', actor: 'analysis-agent', tool: 'pipeline 1.0', action, inputs: inputs.map(([p, c]) => ref(p, c)), outputs: outputs.map(([p, c]) => ref(p, c)), at: T(at), ...extra })
async function ledger(name, items, station = name) {
  const L = await build(items, { key: await keyOf(name), station, ledgerId: idOf(name), createdAt: T(0) })
  const v = await IQC.verifyLedger(L.text)
  assert.deepEqual(v.problems, [], `${name} verifies`)
  return { ...L, v, id: idOf(name), name }
}
const entry = (L, files, root = L.name) => ({ verified: L.v, root, files: files === null ? null : new Map(Object.entries(files).filter(([, c]) => c !== undefined).map(([p, c]) => [p, c === null ? null : F(c)])), label: L.name })
const stepRec = (L, k) => L.records.filter((r) => r.kind === 'step')[k]
const subj = (L, rec) => ({ ledgerId: L.id, n: rec.n, h: rec.h })
const review = (reviewer, subjects, decision, at, note) => IQC.planReview({ station: 'Browser', reviewer, subjects, decision, note, at: T(at) })
const codes = (list) => list.map((g) => g.code)
const plain = (r) => assert.deepEqual(JSON.parse(JSON.stringify(r)), r, 'JSON-serializable')

// the lab: plate.csv measured on bio-line-2, ref-injection.csv on hplc-3; an agent normalizes, fits, reports
const P = 'well,signal\nA1,0.9\nA2,0.4\n', R = 'sample,area\nS-1,1523.4\n', N = 'well,norm\nA1,1.0\nA2,0.44\n', FIT = 'ic50,2.04\n', M = '# Report\nIC50 2.04\n'
const bio = await ledger('bio-line-2', instItems('bio-line-2', [['plate.csv', P]]))
const hplc = await ledger('hplc-3', instItems('hplc-3', [['run/ref-injection.csv', R]], 10))
const agentItems = [
  { kind: 'session', f: { station: 'analysis-server', event: 'mcp-started', at: T(1000), agent: AG } },
  step('Normalize the plate', [['in/plate.csv', P]], [['out/norm.csv', N]], 1001),
  step('Fit the curve', [['out/norm.csv', N], ['in/ref,injection.csv', R]], [['out/fit.csv', FIT]], 1002),
  step('Write the report', [['out/fit.csv', FIT]], [['report/summary.md', M]], 1003),
  { kind: 'session', f: { station: 'analysis-server', event: 'mcp-stopped', at: T(1004), agent: AG } },
]
const agent = await ledger('agent', agentItems, 'analysis-server')
const agentFiles = { 'in/plate.csv': P, 'in/ref,injection.csv': R, 'out/norm.csv': N, 'out/fit.csv': FIT, 'report/summary.md': M }
const labEntries = (over = {}) => [entry(bio, over.bio || { 'plate.csv': P }), entry(hplc, over.hplc || { 'run/ref-injection.csv': R }), entry(agent, over.agent || agentFiles)]

test('auditMany: measured and derived inputs, multi-hop lineage, outputs match: pass, with each step awaiting review', () => {
  const r = IQC.auditMany(labEntries(), { auditedAt: T(5000), tool: 'immutableqc-test/1' })
  plain(r)
  assert.equal(r.format, 'immutableqc-audit')
  assert.equal(r.version, 1)
  assert.equal(r.verdict, 'pass')
  assert.equal(r.summary, 'Pass: all 3 ledgers are intact, all 2 files match their seals and 3 agent steps are recorded with every input traced (1 note).')
  assert.deepEqual(codes(r.notes), ['awaiting-review'])
  assert.equal(r.notes[0].count, 3)
  assert.deepEqual(r.ledgers.map((L) => [L.label, L.role, L.verdict, L.records]), [['bio-line-2', 'measured', 'pass', 3], ['hplc-3', 'measured', 'pass', 3], ['agent', 'agent', 'pass', 5]])
  const [s1, s2, s3] = r.steps
  assert.deepEqual(s1.inputs.map((x) => [x.path, x.state]), [['in/plate.csv', 'measured']])
  assert.deepEqual(s1.inputs[0].measured[0], { ledgerId: bio.id, ledger: 0, station: 'bio-line-2', path: 'plate.csv', n: 2, observedAt: T(1), event: 'added' })
  assert.deepEqual(s2.inputs.map((x) => [x.path, x.state]), [['out/norm.csv', 'derived'], ['in/ref,injection.csv', 'measured']], 'a comma in a path survives')
  assert.deepEqual(s2.inputs[0].step, { ledgerId: agent.id, ledger: 2, n: 2 })
  assert.deepEqual(s3.inputs.map((x) => x.state), ['derived'])
  assert.deepEqual(r.steps.map((s) => s.outputs.map((o) => o.state)), [['match'], ['match'], ['match']])
  assert.deepEqual(r.steps.map((s) => [s.actor, s.tool, s.action, s.at, s.review.state]), [
    ['analysis-agent', 'pipeline 1.0', 'Normalize the plate', T(1001), 'awaiting review'],
    ['analysis-agent', 'pipeline 1.0', 'Fit the curve', T(1002), 'awaiting review'],
    ['analysis-agent', 'pipeline 1.0', 'Write the report', T(1003), 'awaiting review'],
  ])
  // lineage of report/summary.md: report <- fit <- (norm <- plate, ref-injection): 2 measured files, 3 steps deep
  const lo = r.lineage.outputs.find((o) => o.path === 'report/summary.md')
  assert.equal(lo.tracesToMeasured, true)
  assert.equal(lo.measured, 2)
  assert.equal(lo.sentence, 'traces to 2 measured files')
  const t = lo.tree
  assert.deepEqual([t.path, t.step.n, t.inputs.length], ['report/summary.md', 4, 1])
  const fit = t.inputs[0]
  assert.deepEqual([fit.path, fit.state, fit.step.n], ['out/fit.csv', 'derived', 3])
  assert.deepEqual(fit.inputs.map((x) => [x.path, x.state]), [['out/norm.csv', 'derived'], ['in/ref,injection.csv', 'measured']])
  assert.deepEqual(fit.inputs[0].inputs.map((x) => [x.path, x.state, x.measured.station]), [['in/plate.csv', 'measured', 'bio-line-2']])
  assert.equal(fit.inputs[1].measured.station, 'hplc-3')
  assert.deepEqual([r.counts.steps, r.counts.measuredInputs, r.counts.derivedInputs, r.counts.untracedInputs, r.counts.outputs], [3, 2, 2, 0, 3])
  // the agent workspace's files that the steps name are not "not sealed"
  assert.equal(r.ledgers[2].report.counts.notSealed, 0)
  // strict: the note fails
  const st = IQC.auditMany(labEntries(), { strict: true })
  assert.equal(st.verdict, 'fail')
  assert.equal(st.summary, 'Fail: 1 note counts as a failure in strict mode.')
})

test('auditMany: an untraced input, and an input whose file was sealed again after the step used it, put it in review', async () => {
  // without hplc-3, ref-injection.csv matches nothing
  let r = IQC.auditMany([entry(bio, { 'plate.csv': P }), entry(agent, agentFiles)])
  assert.equal(r.verdict, 'review')
  assert.deepEqual(codes(r.forReview), ['untraced-input'])
  assert.equal(r.summary, 'Review: 1 agent step used inputs nothing measured. Each is recorded below.')
  assert.match(r.forReview[0].items[0], /^agent: record 3 \(analysis-agent: "Fit the curve"\): in\/ref,injection\.csv \([0-9a-f]{12}…\) matches no sealed measurement and no recorded step output$/)
  assert.deepEqual(r.forReview[0].records, [{ ledgerId: agent.id, ledger: 1, n: 3 }])
  assert.equal(r.steps[1].inputs[1].state, 'untraced')
  const lo = r.lineage.outputs.find((o) => o.path === 'report/summary.md')
  assert.deepEqual([lo.tracesToMeasured, lo.measured, lo.untraced], [false, 1, 1])
  assert.equal(lo.sentence, 'traces to 1 measured file, and 1 input nothing measured')
  // plate.csv sealed again on bio-line-2 after the agent read it: the input is still measured, and flagged
  const bio2 = await ledger('bio-line-2b', instItems('bio-line-2', [['plate.csv', P], ['plate.csv', P + 'A3,0.1\n', 'changed']], 0).map((x) => (x.kind === 'file' && x.f.event === 'changed' ? { ...x, f: { ...x.f, observedAt: T(2000) } } : x)), 'bio-line-2')
  r = IQC.auditMany([entry(bio2, { 'plate.csv': P + 'A3,0.1\n' }), entry(hplc, { 'run/ref-injection.csv': R }), entry(agent, agentFiles)], { allowChanges: ['plate.csv'] })
  assert.equal(r.verdict, 'review', 'the change itself is expected (allowChanges), its use by a step is not')
  assert.deepEqual(codes(r.forReview), ['input-changed-after-use'])
  const ca = r.steps[0].inputs[0].changedAfter
  assert.deepEqual([ca.path, ca.usedN, ca.n, ca.afterUse], ['plate.csv', 2, 3, true])
  assert.match(r.forReview[0].items[0], /in\/plate\.csv: the file changed after this step used it \(plate\.csv sealed again in record 3 of bio-line-2b, 2026-10-01 08:33:20 UTC\)/)
  assert.equal(r.steps[0].inputs[0].measured[0].sealedAgainN, 3)
  assert.equal(r.summary, 'Review: 1 agent step used a file that was sealed again later. Each is recorded below.')
  // the same change, recorded before the step ran: the step used an earlier version
  const bio3 = await ledger('bio-line-2c', instItems('bio-line-2', [['plate.csv', P], ['plate.csv', 'newer', 'changed']]), 'bio-line-2')
  r = IQC.auditMany([entry(bio3, { 'plate.csv': 'newer' }), entry(hplc, null), entry(agent, agentFiles)])
  assert.deepEqual(codes(r.forReview), ['sealed-more-than-once', 'input-changed-after-use'])
  assert.equal(r.steps[0].inputs[0].changedAfter.afterUse, false)
  assert.match(r.forReview[1].items[0], /the step used an earlier version/)
  assert.equal(r.summary, 'Review: 1 file was changed after it was first sealed and 1 agent step used a file that was sealed again later. Each is recorded below.')
})

test('auditMany: an output changed or missing fails; an output written again by a later step is superseded', async () => {
  let r = IQC.auditMany(labEntries({ agent: { ...agentFiles, 'out/fit.csv': 'ic50,9.99\n', 'report/summary.md': undefined } }))
  assert.equal(r.verdict, 'fail')
  assert.deepEqual(r.steps.map((s) => s.outputs[0].state), ['match', 'changed', 'missing'])
  assert.deepEqual(r.problems.map((p) => [p.code, p.message]), [
    ['output-changed', 'agent: out/fit.csv changed since the agent step in record 3 wrote it.'],
    ['output-missing', 'agent: report/summary.md is missing: the agent step in record 4 wrote it, and no removal is recorded.'],
  ])
  assert.deepEqual(r.problems[0].records, [{ ledgerId: agent.id, ledger: 2, n: 3 }])
  assert.equal(r.summary, 'Fail: 1 agent output changed since its step wrote it and 1 agent output is missing.')
  // files not given: not checked (a note)
  r = IQC.auditMany([entry(bio, { 'plate.csv': P }), entry(hplc, { 'run/ref-injection.csv': R }), entry(agent, null)])
  assert.equal(r.verdict, 'pass')
  assert.deepEqual(r.steps.map((s) => s.outputs[0].state), ['not checked', 'not checked', 'not checked'])
  assert.deepEqual(codes(r.notes), ['awaiting-review', 'outputs-not-checked'])
  // a later step rewrites out/fit.csv: the first version is superseded, the second compared; a file equal to the
  // first version is "changed" and says which step wrote it
  const two = await ledger('agent2', [step('Fit', [['in/plate.csv', P]], [['out/fit.csv', 'v1']], 1), step('Refit', [['in/plate.csv', P]], [['out/fit.csv', 'v2']], 2)], 'analysis-server')
  r = IQC.auditMany([entry(bio, { 'plate.csv': P }), entry(two, { 'in/plate.csv': P, 'out/fit.csv': 'v2' })])
  assert.deepEqual(r.steps.map((s) => s.outputs[0].state), ['superseded', 'match'])
  assert.deepEqual(r.steps[0].outputs[0].supersededBy, { ledgerId: two.id, ledger: 1, n: 2 })
  assert.equal(r.verdict, 'pass')
  r = IQC.auditMany([entry(bio, { 'plate.csv': P }), entry(two, { 'in/plate.csv': P, 'out/fit.csv': 'v1' })])
  assert.equal(r.steps[1].outputs[0].state, 'changed')
  assert.deepEqual(r.steps[1].outputs[0].matchesStep, { ledgerId: two.id, ledger: 1, n: 1 })
  assert.match(r.problems[0].message, /it matches the version written in record 1\.$/)
})

test('auditMany: a cycle of steps goes to review and is cut in the tree; the tree is depth-bounded, the summary is not', async () => {
  const cyc = await ledger('cycle', [step('A from B', [['b.csv', 'B']], [['a.csv', 'A']], 1), step('B from A', [['a.csv', 'A']], [['b.csv', 'B']], 2)], 'analysis-server')
  let r = IQC.auditMany([entry(cyc, { 'a.csv': 'A', 'b.csv': 'B' })])
  assert.deepEqual(r.steps.map((s) => s.inputs[0].state), ['derived', 'derived'])
  assert.equal(r.verdict, 'review')
  assert.deepEqual(codes(r.forReview), ['step-cycle'])
  assert.equal(r.forReview[0].count, 2)
  assert.equal(r.summary, 'Review: 2 agent steps are part of a cycle of steps. Each is recorded below.')
  const lo = r.lineage.outputs[0]
  assert.deepEqual([lo.cycle, lo.tracesToMeasured, lo.sentence], [true, false, 'part of a cycle of steps: it does not trace back to measurements'])
  assert.deepEqual([lo.tree.inputs[0].path, lo.tree.inputs[0].inputs[0].path, lo.tree.inputs[0].inputs[0].stop], ['b.csv', 'a.csv', 'cycle'])
  // a chain of 40 steps from one measurement: maxDepth 5 cuts the tree; the summary still traces to it
  const items = []
  for (let i = 0; i < 40; i++) items.push(step(`step ${i}`, [[i ? `c${i - 1}.csv` : 'in/plate.csv', i ? `c${i - 1}` : P]], [[`c${i}.csv`, `c${i}`]], 10 + i))
  const chain = await ledger('chain', items, 'analysis-server')
  r = IQC.auditMany([entry(bio, { 'plate.csv': P }), entry(chain, null)], { maxDepth: 5 })
  assert.equal(r.lineage.maxDepth, 5)
  const last = r.lineage.outputs[r.lineage.outputs.length - 1]
  assert.deepEqual([last.path, last.tracesToMeasured, last.measured], ['c39.csv', true, 1])
  let node = last.tree, depth = 0
  while (node.inputs && node.inputs.length) { node = node.inputs[0]; depth++ }
  assert.equal(depth, 5)
  assert.equal(node.stop, 'depth')
  assert.equal(IQC.auditMany([entry(bio, { 'plate.csv': P }), entry(chain, null)]).lineage.maxDepth, 32, 'default depth')
})

test('auditMany: reviews approved, questioned, rejected; latest decision per reviewer; a changed subject fails; an unknown ledger is a note', async () => {
  const s = (k) => subj(agent, stepRec(agent, k))
  const rv = await ledger('reviewer', [
    review('J. Rivera', [s(0), s(1)], 'approved', 2000),
    review('J. Rivera', [s(1)], 'question', 2001, 'Why this reference?'),
    review('K. Osei', [s(2)], 'rejected', 2002, 'Wrong curve model.'),
    review('K. Osei', [s(0)], 'approved', 2003),
  ], 'Browser')
  let r = IQC.auditMany([...labEntries(), entry(rv, null)])
  plain(r)
  assert.equal(r.ledgers[3].role, 'reviewer')
  assert.deepEqual(r.steps.map((x) => x.review.state), ['approved', 'question', 'rejected'])
  assert.deepEqual(r.steps[1].review.decisions.map((d) => [d.reviewer, d.decision, d.latest]), [['J. Rivera', 'approved', false], ['J. Rivera', 'question', true]])
  assert.equal(r.verdict, 'review')
  assert.deepEqual(codes(r.forReview), ['review-rejected', 'review-question'])
  assert.match(r.forReview[0].items[0], /record 4 \(analysis-agent: "Write the report"\): rejected by K\. Osei, 2026-10-01 08:33:22 UTC \("Wrong curve model\."\)/)
  assert.deepEqual(r.forReview[1].records, [{ ledgerId: agent.id, ledger: 2, n: 3 }, { ledgerId: rv.id, ledger: 3, n: 2 }])
  assert.equal(r.summary, 'Review: 1 agent step was rejected by a reviewer and 1 agent step was questioned by a reviewer. Each is recorded below.')
  assert.deepEqual(r.reviews.map((x) => [x.reviewer, x.decision, x.subjects.map((y) => y.state + ':' + y.kind)]), [
    ['J. Rivera', 'approved', ['matches:step', 'matches:step']], ['J. Rivera', 'question', ['matches:step']], ['K. Osei', 'rejected', ['matches:step']], ['K. Osei', 'approved', ['matches:step']],
  ])
  assert.equal(r.counts.reviews, 4)
  // the subject's link does not match (the record was rewritten after the review): fail
  const bad = await ledger('reviewer-bad', [review('J. Rivera', [{ ...s(0), h: sha('rewritten') }], 'approved', 2000), review('J. Rivera', [{ ledgerId: idOf('elsewhere'), n: 1, h: sha('x') }], 'approved', 2001)], 'Browser')
  r = IQC.auditMany([...labEntries(), entry(bad, null)])
  assert.equal(r.verdict, 'fail')
  assert.deepEqual(r.problems.map((p) => p.code), ['review-subject-changed'])
  assert.match(r.problems[0].message, /^reviewer-bad: the review in record 1 \(approved by J\. Rivera\) names record 2 of agent, which no longer matches: its link is not the one reviewed, so the record changed after it was reviewed\.$/)
  assert.deepEqual(codes(r.notes), ['awaiting-review', 'review-unknown-ledger'])
  assert.equal(r.steps[0].review.state, 'awaiting review', 'a review that does not match counts for nothing')
  assert.equal(r.summary, 'Fail: 1 review names a record that changed after it was reviewed.')
  // a review of a file record
  const rf = await ledger('reviewer-file', [review('J. Rivera', [subj(bio, bio.records[1])], 'approved', 2000)], 'Browser')
  r = IQC.auditMany([...labEntries(), entry(rf, null)])
  assert.deepEqual(r.reviews[0].subjects[0], { ledgerId: bio.id, n: 2, h: bio.records[1].h, state: 'matches', ledger: 0, kind: 'file', path: 'plate.csv' })
  // a subject past the end of its ledger
  const past = await ledger('reviewer-past', [review('J. Rivera', [{ ledgerId: agent.id, n: 99, h: sha('x') }], 'approved', 2000)], 'Browser')
  r = IQC.auditMany([...labEntries(), entry(past, null)])
  assert.match(r.problems[0].message, /the ledger has no such record/)
})

test('auditMany: pins pass, fail, name another ledger, or do not read; expectHeads and expectKeyIds', () => {
  const pin = (L, n, h = L.records[n - 1].h) => IQC.formatPinLine(L.id, { n, h }, T(3000))
  let r = IQC.auditMany(labEntries(), { pinLines: [pin(bio, 1), pin(bio, 3), pin(agent, 5)].join('\n') })
  assert.equal(r.verdict, 'pass')
  assert.equal(r.counts.pinsChecked, 3)
  assert.ok(r.expectations.pins.every((p) => p.ok === true))
  r = IQC.auditMany(labEntries(), { pinLines: `${pin(bio, 2, sha('other'))}\n${pin({ id: idOf('gone'), records: [{ h: sha('g') }] }, 1)}\nnot a pin line\n` })
  assert.equal(r.verdict, 'fail')
  assert.deepEqual(r.problems.map((p) => p.code), ['pin', 'pin-unreadable'])
  assert.match(r.problems.find((p) => p.code === 'pin').message, /^bio-line-2: pin line 1 \(2026-10-01 08:50:00 UTC\): Record 2's link is [0-9a-f]{64}, not the pinned [0-9a-f]{64}: the ledger was rewritten/)
  assert.deepEqual(codes(r.notes), ['awaiting-review', 'pin-other-ledger'])
  assert.match(r.notes[1].message, /another ledger was pinned from this station/)
  assert.equal(r.summary, 'Fail: 2 pins do not match.')
  // a pin past the end: the ledger was cut
  r = IQC.auditMany(labEntries(), { pinLines: [IQC.formatPinLine(bio.id, { n: 9, h: sha('x') }, T(1))] })
  assert.match(r.problems[0].message, /only 3 records: records were removed from its end/)
  // expectHeads: with a ledger id, without one (any ledger), a map; expectKeyIds
  r = IQC.auditMany(labEntries(), { expectHeads: [`${agent.id} 5:${agent.records[4].h}`, `2:${hplc.records[1].h}`], expectKeyIds: [bio.v.keyId, hplc.v.keyId, agent.v.keyId.toUpperCase()] })
  assert.equal(r.verdict, 'pass')
  assert.deepEqual(r.expectations.heads.map((x) => x.ok), [true, true])
  assert.match(r.expectations.heads[1].message, /^hplc-3: Record 2's link matches the pinned head \(the ledger has grown since, to 3 records\)\.$/)
  r = IQC.auditMany(labEntries(), { expectHeads: { [bio.id]: `1:${sha('nope')}` }, expectKeyIds: '0123456789abcdef' })
  assert.equal(r.verdict, 'fail')
  assert.deepEqual(r.problems.map((p) => p.code), ['expect-head', 'expect-key'])
  assert.deepEqual(codes(r.notes), ['awaiting-review', 'unexpected-key'])
  assert.equal(r.summary, 'Fail: the pinned head does not match and an expected key id is not found.')
  r = IQC.auditMany(labEntries(), { expectHeads: `${idOf('nobody')}:1:${sha('x')}` })
  assert.match(r.problems[0].message, /names ledger [0-9a-f]{32}, which was not audited/)
  r = IQC.auditMany(labEntries(), { expectHeads: `3:${sha('x')}` })
  assert.match(r.problems[0].message, /^No audited ledger has record 3 with the link/)
  r = IQC.auditMany(labEntries(), { expectHeads: 'nonsense' })
  assert.match(r.problems[0].message, /could not be read/)
})

test('auditMany: file changes across ledgers (review, allowChanges, unrecorded change fails); a broken ledger fails; roles; duplicates', async () => {
  const inst = await ledger('inst', instItems('inst', [['log.txt', 'a'], ['log.txt', 'ab', 'changed'], ['data.csv', 'd'], { removed: 'data.csv' }]))
  let r = IQC.auditMany([entry(inst, { 'log.txt': 'ab' }), entry(bio, { 'plate.csv': P })])
  assert.equal(r.verdict, 'review')
  assert.deepEqual(codes(r.forReview), ['sealed-more-than-once', 'removed'])
  assert.deepEqual(r.forReview[0].items, ['inst: log.txt: 2 versions (records 2, 3); changed in record 3, 2026-10-01 08:00:02 UTC'])
  assert.deepEqual(r.forReview[0].records, [{ ledgerId: inst.id, n: 3, ledger: 0 }])
  r = IQC.auditMany([entry(inst, { 'log.txt': 'ab' }), entry(bio, { 'plate.csv': P })], { allowChanges: ['*.txt', 'data.csv'] })
  assert.equal(r.verdict, 'pass')
  assert.equal(r.allowChanges.matched.length, 2)
  r = IQC.auditMany([entry(inst, { 'log.txt': 'abc' }), entry(bio, { 'plate.csv': P })], { allowChanges: ['*'] })
  assert.equal(r.verdict, 'fail', 'an unrecorded change fails, expected to change or not')
  assert.deepEqual(r.problems.map((p) => [p.code, p.message]), [['changed', 'inst: log.txt changed since it was sealed in record 3.']])
  assert.deepEqual(r.problems[0].records, [{ ledgerId: inst.id, ledger: 0, n: 3 }])
  // a broken ledger
  const lines = agent.lines.slice(); const o = JSON.parse(lines[2]); o.f.action = 'Something else'; lines[2] = IQC.canonicalJSON(o)
  const broken = await IQC.verifyLedger(lines.map((l) => l + '\n').join(''))
  r = IQC.auditMany([...labEntries().slice(0, 2), { verified: broken, root: 'agent', files: new Map(Object.entries(agentFiles).map(([p, c]) => [p, F(c)])), label: 'agent' }])
  assert.equal(r.verdict, 'fail')
  assert.match(r.problems[0].message, /^agent: Line 3 \(record 2\): the step fingerprint does not match its sealed fields\.$/)
  assert.equal(r.steps.length, 0, 'steps come from the records before the first problem')
  assert.match(r.summary, /^Fail: 1 ledger has problems\.$/)
  // roles, and the same ledger given twice
  const mixed = await ledger('mixed', [...instItems('mixed', [['x.csv', 'x']]), step('Copy x', [['x.csv', 'x']], [['y.csv', 'y']], 9)])
  const empty = await ledger('empty', [])
  r = IQC.auditMany([entry(mixed, { 'x.csv': 'x', 'y.csv': 'y' }), entry(empty, null), entry(agent, null, 'agent-copy'), entry(agent, null)])
  assert.deepEqual(r.ledgers.map((L) => L.role), ['mixed', 'empty', 'agent', 'agent'])
  assert.ok(codes(r.notes).includes('duplicate-ledger'))
  assert.equal(r.steps[0].inputs[0].state, 'measured', 'a mixed ledger measures its own files')
  assert.throws(() => IQC.auditMany([]), /at least one ledger/)
  assert.throws(() => IQC.auditMany([{ verified: {} }]), /needs \{verified\}/)
  assert.throws(() => IQC.auditMany(labEntries(), { allowChanges: [''] }), /files expected to change must be a non-empty string/)
})

test('auditMany: two instrument ledgers, an agent ledger and a reviewer ledger end to end, and the report HTML', async () => {
  const s = (k) => subj(agent, stepRec(agent, k))
  const rv = await ledger('reviewer', [review('J. Rivera', [s(0), s(1), s(2)], 'approved', 2000, 'Checked.')], 'Browser')
  const pins = [IQC.formatPinLine(bio.id, bio.v.head, T(600)), IQC.formatPinLine(hplc.id, hplc.v.head, T(600))].join('\n')
  const r = IQC.auditMany([...labEntries(), entry(rv, null)], { pinLines: pins, expectKeyIds: [bio.v.keyId, hplc.v.keyId, agent.v.keyId, rv.v.keyId], auditedAt: T(9000), where: 'browser', tool: 'immutableqc-app/0.1.0' })
  assert.equal(r.verdict, 'pass')
  assert.deepEqual(r.notes, [])
  assert.equal(r.summary, 'Pass: all 4 ledgers are intact, all 2 files match their seals and 3 agent steps are recorded with every input traced.')
  assert.deepEqual(r.steps.map((x) => x.review.state), ['approved', 'approved', 'approved'])
  assert.equal(r.counts.stepsApproved, 3)
  assert.equal(r.method.where, 'in a browser')
  assert.ok(r.rerun.some((x) => x.includes(`immutableqc-head ${bio.id} 3:`)))
  const html = IQC.renderReportHTML(r)
  for (const h of ['<h2>Counts</h2>', '<h2>Problems</h2>', '<h2>For review</h2>', '<h2>Notes</h2>', '<h2>Ledgers audited</h2>', '<h2>Agent steps</h2>', '<h2>Trace to measurements</h2>', '<h2>Reviews</h2>', '<h2>Expectations and pins</h2>', '<h2>Files</h2>', '<h2>Method</h2>']) assert.ok(html.includes(h), h)
  const at = ['class="verdict pass"', '<h2>Ledgers audited</h2>', '<h2>Agent steps</h2>', '<h2>Trace to measurements</h2>', '<h2>Reviews</h2>'].map((x) => html.indexOf(x))
  assert.deepEqual(at, at.slice().sort((a, b) => a - b))
  assert.ok(html.includes('<span class="word">Pass</span>'))
  assert.ok(html.includes('Normalize the plate') && html.includes('J. Rivera') && html.includes('reviewer') && html.includes(agent.v.keyId))
  assert.ok(html.includes('traces to 2 measured files'))
  assert.ok(!/<script/i.test(html))
  // review level: amber, the word Review
  const rr = IQC.auditMany([entry(bio, { 'plate.csv': P }), entry(agent, agentFiles)])
  const rh = IQC.renderReportHTML(rr)
  assert.ok(rh.includes('class="verdict review"') && rh.includes('<span class="word">Review</span><span class="sentence">1 agent step used inputs nothing measured. Each is recorded below.</span>'))
  assert.ok(rh.includes('.review{color:var(--rev)'))
  assert.ok(rh.includes('<title>Audit report: review, 2 ledgers</title>'))
})

test('report HTML (many): every string is escaped, no script, no external request', async () => {
  const X = '<img src=x onerror=alert(1)>'
  const evil = await ledger('evil', [IQC.planStep({ station: `PC ${X}`, actor: `<b>agent</b>`, tool: `<script>t</script>`, action: `Wrote ${X} & "q"`, inputs: [{ rawPath: `${X}.csv`, sha256: sha('i'), bytes: 1 }], outputs: [{ rawPath: `out/${X}|,.csv`, sha256: sha('o'), bytes: 1 }], at: T(1) })], `PC ${X}`)
  const rv = await ledger('evil-rev', [review(`<i>${X}</i>`, [subj(evil, evil.records[0])], 'question', 5, `Note ${X}`)], 'Browser')
  const r = IQC.auditMany([{ ...entry(evil, { [IQC.encodePath(`out/${X}|,.csv`)]: 'changed' }), label: `lab ${X}` }, { ...entry(rv, null), label: `rev ${X}` }])
  assert.equal(r.verdict, 'fail')
  const h = IQC.renderReportHTML(r)
  assert.ok(!/<script/i.test(h), 'no <script')
  assert.ok(!h.includes(X) && !h.includes('<b>agent</b>') && !h.includes('<i>'))
  assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;'))
  assert.ok(h.includes('&lt;script&gt;t&lt;/script&gt;'))
  assert.ok(!/<(?:link|img|iframe|object|embed|video|audio|source|form|base)\b/i.test(h))
  assert.ok(!/(?:src|href|action)\s*=\s*["']?\s*(?:https?:|\/\/)/i.test(h))
  assert.ok(h.includes(`content="default-src 'none'; style-src 'unsafe-inline'"`))
  const text = h.replace(/<style>[\s\S]*?<\/style>/, ' ').replace(/<[^>]+>/g, ' ').replace(/Immutable QC|immutableqc/gi, '')
  for (const re of [/\bimmutab(le|ility)\b/i, /guarantee/i, /\bproofs?\b/i, /crypto/i, /complian/i, /trustless/i, /\btokens?\b/i, /blockchain/i, /distributed ledger/i]) assert.ok(!re.test(text), String(re))
})

test('lineage over 100,000 records is not quadratic', async () => {
  // one measured file, then a chain of steps, each reading the previous output; plus a fan-in step every 1,000
  const key = await keyOf('perf')
  const L = await build([], { key: key, station: 'perf', ledgerId: idOf('perf') })
  const v = await IQC.verifyLedger(L.text)
  const SIG = '1'.repeat(128) // a low-S signature in form: extendVerified checks links, not signatures
  const COUNT = 100000
  const recs = []
  let prev = v.head.h
  const out = (i) => ({ path: `c/${i}.csv`, sha256: sha(`c${i}`), bytes: 10 })
  for (let i = 0; i < COUNT; i++) {
    const inputs = i === 0 ? [{ path: 'in/plate.csv', sha256: sha(P), bytes: B(P) }] : [out(i - 1)]
    if (i % 1000 === 999) for (let k = 1; k < 50; k++) inputs.push(out(i - 1 - k * 7))
    const f = { station: 'perf', actor: 'a', tool: '-', action: `step ${i}`, inputs: IQC.encodeRefList(inputs), outputs: IQC.encodeRefList([out(i)]), at: T(i) }
    const r = IQC.fingerprintOf('step', f), h = IQC.linkOf(prev, r, i + 1)
    recs.push({ n: i + 1, kind: 'step', f, r, prev, h, sig: SIG })
    prev = h
  }
  IQC.extendVerified(v, recs)
  const t0 = performance.now()
  const r = IQC.auditMany([entry(bio, { 'plate.csv': P }), { verified: v, root: null, files: null, label: 'perf' }])
  const ms = performance.now() - t0
  assert.equal(r.counts.steps, COUNT)
  assert.equal(r.verdict, 'pass')
  const last = r.lineage.outputs[COUNT - 1]
  assert.deepEqual([last.tracesToMeasured, last.measured], [true, 1])
  let nodes = 0
  for (const o of r.lineage.outputs) if (o.tree) nodes++
  assert.ok(nodes > 0 && r.lineage.outputs.some((o) => o.treeOmitted), 'trees stop at the overall budget')
  const t1 = performance.now()
  const html = IQC.renderReportHTML(r)
  const hms = performance.now() - t1
  assert.ok(html.length < 8e6, `report HTML stays bounded (${html.length} bytes)`)
  console.log(`# auditMany over ${COUNT.toLocaleString('en-US')} steps: ${(ms / 1000).toFixed(2)} s; report HTML ${(hms / 1000).toFixed(2)} s, ${(html.length / 1e6).toFixed(1)} MB`)
  assert.ok(ms < 30000, `auditMany took ${ms} ms`)
})
