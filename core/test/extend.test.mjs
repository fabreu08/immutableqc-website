import test from 'node:test'
import assert from 'node:assert/strict'
import * as IQC from '../immutableqc.mjs'
import { build, sessionItem, fileItem, removedItem, readingItem, joinLines, fullItems } from './_helpers.mjs'

// what a full verification and an incremental one must agree on
const view = (v) => ({ ok: v.ok, head: v.head, recordCount: v.recordCount, goodCount: v.goodCount, records: v.records, files: [...v.files.entries()], sessions: v.sessions, gaps: v.gaps, kinds: v.kinds })

// Every step appends a few records and checks the in-memory state against a fresh verifyLedger of the whole text.
test('extendVerified: after every append, the state equals a full verification of the ledger (sessions open, stopped, unclean, stray, scans)', async () => {
  const L = await build([])
  let text = L.text
  const v = await IQC.verifyLedger(text)
  const steps = [
    [sessionItem('watch-started', 1), fileItem('a.csv', 'a', 'existing', 2)],
    [fileItem('b.csv', 'b', 'added', 3), fileItem('a.csv', 'a2', 'changed', 4)],
    [removedItem('b.csv', 'removed', 5)],
    [sessionItem('watch-stopped', 6)],
    [sessionItem('scan', 50), fileItem('c 50%25.csv', 'c', 'added-unwatched', 51)],
    [sessionItem('watch-started', 60)], // starts after a scan
    [fileItem('d.csv', 'd', 'added', 61)],
    [sessionItem('watch-started', 90)], // the watch before had no stop: unclean
    [sessionItem('watch-stopped', 91), sessionItem('watch-stopped', 92)], // the second stop is a stray
    [fileItem('e.csv', 'e', 'added-unwatched', 93), readingItem('1.5')], // counted in no session
    [],
  ]
  for (const items of steps) {
    const recs = await IQC.createRecords({ head: v.head, items, privateKey: L.key.privateKey })
    text += joinLines(recs.map((r) => IQC.canonicalJSON(r)))
    assert.equal(IQC.extendVerified(v, recs), v, 'returns the same object, updated in place')
    const full = await IQC.verifyLedger(text)
    assert.equal(full.ok, true)
    assert.deepEqual(view(v), view(full))
  }
  assert.equal(v.sessions.filter((s) => s.stray).length, 1)
  assert.equal(v.sessions.filter((s) => s.clean === false && !s.stray).length, 1)
})

test('extendVerified: the full fixture ledger built in two halves equals the whole', async () => {
  const items = fullItems()
  const L = await build(items.slice(0, 6))
  const v = await IQC.verifyLedger(L.text)
  const recs = await IQC.createRecords({ head: v.head, items: items.slice(6), privateKey: L.key.privateKey })
  IQC.extendVerified(v, recs)
  const whole = await IQC.verifyLedger(L.text + joinLines(recs.map((r) => IQC.canonicalJSON(r))))
  assert.deepEqual(view(v), view(whole))
})

test('extendVerified: refuses a broken ledger and records that do not continue the head, and changes nothing', async () => {
  const L = await build([sessionItem('scan', 1)])
  const v = await IQC.verifyLedger(L.text)
  const before = JSON.stringify(view(v))
  const [r2, r3] = await IQC.createRecords({ head: v.head, items: [fileItem('a.csv', 'a', 'existing', 2), fileItem('b.csv', 'b', 'existing', 3)], privateKey: L.key.privateKey })
  const bad = [
    [[r3], /does not continue the head: the next record is number 2/],
    [[{ ...r2, prev: '0'.repeat(64) }], /previous link/],
    [[{ ...r2, f: { ...r2.f, sha256: 'f'.repeat(64) } }], /fingerprint or link/],
    [[{ ...r2, h: '1'.repeat(64) }], /fingerprint or link/],
    [[{ ...r2, kind: 'note' }], /unknown kind/],
    [[{ ...r2, f: { ...r2.f, event: 'added-later' } }], /not valid/],
    [[{ ...r2, sig: 'x' }], /signature/],
    [[r2, { ...r3, n: 4 }], /the next record is number 3/],
  ]
  for (const [recs, re] of bad) {
    assert.throws(() => IQC.extendVerified(v, recs), re)
    assert.equal(JSON.stringify(view(v)), before, 'a refused list changes nothing')
  }
  const broken = await IQC.verifyLedger(L.text + '{"n":2}\n')
  assert.throws(() => IQC.extendVerified(broken, [r2]), /no problem/)
  IQC.extendVerified(v, [r2, r3])
  assert.equal(v.head.n, 3)
  assert.equal(v.files.get('b.csv').latest.line, 4)
})
