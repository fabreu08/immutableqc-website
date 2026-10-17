import test from 'node:test'
import assert from 'node:assert/strict'
import * as IQC from '../immutableqc.mjs'
import { build, sessionItem, fileItem, removedItem, T, STATION, sha, joinLines } from './_helpers.mjs'

const F = (s, extra = {}) => ({ sha256: sha(s), bytes: Buffer.byteLength(s), ...extra })
const plan = (v, files, mode, extra = {}) => IQC.planSeal(v, files, { mode, station: STATION, observedAt: T(500), ...extra })
const brief = (items) => items.map((x) => [x.kind, x.f.path, x.f.event])

// append planned items to a built ledger and verify the result
async function extend(L, v, items) {
  const recs = await IQC.createRecords({ head: v.head, items, privateKey: L.key.privateKey })
  const text = L.text + joinLines(recs.map((r) => IQC.canonicalJSON(r)))
  return { text, v: await IQC.verifyLedger(text) }
}

test('planSeal, first scan: every file is existing, sorted by path; the ImmutableQC folder and default ignores are skipped', async () => {
  const L = await build([sessionItem('scan', 1)])
  const v = await IQC.verifyLedger(L.text)
  assert.ok(IQC.isFirstScan(v))
  const files = new Map([
    ['b/2.csv', F('2')], ['a.csv', F('a', { modifiedAt: '2026-09-30T10:00:00.000Z' })], ['b/1.bin', F('\u0000\u0001')],
    ['ImmutableQC/ledger.jsonl', F(L.text)], ['ImmutableQC/README.txt', F('readme')], ['b/.DS_Store', F('x')], ['~$report.docx', F('lock')], ['run.tmp', F('t')],
  ])
  const items = plan(v, files, 'first')
  assert.deepEqual(brief(items), [['file', 'a.csv', 'existing'], ['file', 'b/1.bin', 'existing'], ['file', 'b/2.csv', 'existing']])
  assert.deepEqual(items[0], { kind: 'file', f: { station: STATION, path: 'a.csv', sha256: sha('a'), bytes: '1', observedAt: T(500), event: 'existing' }, ctx: { modifiedAt: '2026-09-30T10:00:00.000Z' } })
  assert.equal(items[1].ctx, undefined)
  // the plan seals and verifies; a second plan finds nothing to do
  const E = await extend(L, v, items)
  assert.equal(E.v.ok, true)
  assert.deepEqual(plan(E.v, files, 'watch'), [])
  // the whole folder now audits as a pass
  const a = IQC.audit(E.v, files)
  assert.equal(a.verdict, 'pass')
  assert.equal(a.counts.match, 3)
  assert.equal(a.counts.notSealed, 0, 'the ImmutableQC folder and ignored files are not reported as not sealed')
})

test('planSeal, watch: added, changed, removed; unchanged and touched files are not sealed again; back after removal is added', async () => {
  const L = await build([
    sessionItem('watch-started', 1), fileItem('keep.csv', 'k', 'existing', 2), fileItem('edit.csv', 'e1', 'existing', 3),
    fileItem('gone.csv', 'g', 'existing', 4), fileItem('back.csv', 'b', 'existing', 5), removedItem('back.csv', 'removed', 6),
  ])
  const v = await IQC.verifyLedger(L.text)
  const files = { 'keep.csv': F('k', { modifiedAt: 'touched' }), 'edit.csv': F('e2'), 'new.csv': F('n'), 'back.csv': F('b') }
  const items = plan(v, files, 'watch')
  assert.deepEqual(brief(items), [['file', 'back.csv', 'added'], ['file', 'edit.csv', 'changed'], ['file', 'new.csv', 'added'], ['file-removed', 'gone.csv', 'removed']])
  assert.deepEqual(items[3].f, { station: STATION, path: 'gone.csv', observedAt: T(500), event: 'removed' })
  const E = await extend(L, v, items)
  assert.equal(E.v.ok, true)
  // the edit and the removals are recorded: review, unless those files are expected to change
  assert.equal(IQC.audit(E.v, files).verdict, 'review')
  assert.equal(IQC.audit(E.v, files, { allowChanges: ['edit.csv', 'gone.csv', 'back.csv'] }).verdict, 'pass')
})

test('planSeal, unwatched: the -unwatched events; mode first on a path with history; per-file observedAt; pending files', async () => {
  const L = await build([sessionItem('watch-started', 1), fileItem('edit.csv', 'e1', 'existing', 2), fileItem('gone.csv', 'g', 'existing', 3), sessionItem('watch-stopped', 4)])
  const v = await IQC.verifyLedger(L.text)
  const files = new Map([['edit.csv', F('e2', { observedAt: T(600) })], ['new.csv', F('n')], ['busy.csv', null]])
  assert.deepEqual(brief(plan(v, files, 'unwatched')), [['file', 'edit.csv', 'changed-unwatched'], ['file', 'new.csv', 'added-unwatched'], ['file-removed', 'gone.csv', 'removed-unwatched']])
  assert.equal(plan(v, files, 'unwatched')[0].f.observedAt, T(600))
  assert.deepEqual(brief(plan(v, files, 'first')), [['file', 'edit.csv', 'changed-unwatched'], ['file', 'new.csv', 'existing'], ['file-removed', 'gone.csv', 'removed-unwatched']])
  // a file present but not readable yet (null) is neither sealed nor removed
  const busy = new Map([['edit.csv', F('e1')], ['gone.csv', null]])
  assert.deepEqual(plan(v, busy, 'watch'), [])
  // a removed file that is still gone is not removed again
  const L2 = await build([fileItem('x.csv', 'x', 'existing', 1), removedItem('x.csv', 'removed', 2)])
  assert.deepEqual(plan(await IQC.verifyLedger(L2.text), new Map(), 'watch'), [])
})

test('planSeal: extra ignore globs, encoded paths, and input checks', async () => {
  const L = await build([sessionItem('scan', 1)])
  const v = await IQC.verifyLedger(L.text)
  const files = new Map([[IQC.encodePath('50% B.csv'), F('p')], [IQC.encodePath('a|b\nc.csv'), F('q')], ['scratch/x.bak', F('z')]])
  assert.deepEqual(brief(plan(v, files, 'first', { ignore: ['*.bak'] })), [['file', '50%25 B.csv', 'existing'], ['file', 'a%7Cb%0Ac.csv', 'existing']])
  assert.throws(() => plan(v, new Map([['../x', F('x')]]), 'first'), /invalid path/)
  assert.throws(() => plan(v, new Map([['a|b', F('x')]]), 'first'), /invalid path/)
  assert.throws(() => plan(v, new Map([['a', { sha256: 'xyz', bytes: 1 }]]), 'first'), /SHA-256/)
  assert.throws(() => plan(v, new Map([['a', { sha256: sha('a'), bytes: -1 }]]), 'first'), /size in bytes/)
  assert.throws(() => plan(v, files, 'later'), /mode/)
  assert.throws(() => IQC.planSeal(v, files, { mode: 'first', station: 'a|b', observedAt: T(1) }), /station/)
  assert.throws(() => IQC.planSeal(v, files, { mode: 'first', station: 'PC', observedAt: 'now' }), /observedAt/)
  // arrays of {path, …} and bigint sizes are accepted too
  assert.deepEqual(brief(plan(v, [{ path: 'arr.csv', sha256: sha('a'), bytes: 1n }], 'first')), [['file', 'arr.csv', 'existing']])
})

test('planSeal works on the verified state before the first problem only', async () => {
  const L = await build([fileItem('a.csv', 'a1', 'existing', 1), fileItem('a.csv', 'a2', 'changed', 2)])
  const lines = L.text.split('\n')
  const o = JSON.parse(lines[2]); o.f.bytes = '99'; lines[2] = IQC.canonicalJSON(o)
  const v = await IQC.verifyLedger(lines.join('\n'))
  assert.equal(v.ok, false)
  assert.equal(v.files.get('a.csv').latest.sha256, sha('a1'))
})
