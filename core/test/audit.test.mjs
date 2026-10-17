import test from 'node:test'
import assert from 'node:assert/strict'
import * as IQC from '../immutableqc.mjs'
import { build, fullItems, fullFiles, CONTENT, sessionItem, fileItem, removedItem, T, sha, joinLines, editLine } from './_helpers.mjs'

const L = await build(fullItems())
const V = await IQC.verifyLedger(L.text)
const states = (a) => Object.fromEntries(a.files.map((f) => [f.path, f.state]))
const F = (s) => ({ sha256: sha(s), bytes: Buffer.byteLength(s) })
const noteCodes = (a) => a.notes.map((n) => n.code)

test('audit: every file matches; recorded changes and removals put it in review; notes for unwatched changes and the gap', () => {
  const a = IQC.audit(V, fullFiles(), { auditedAt: T(1000), where: 'command line', tool: 'immutableqc-cli/0.1.0' })
  assert.equal(a.format, 'immutableqc-audit')
  assert.equal(a.version, 1)
  assert.equal(a.verdict, 'review')
  assert.equal(a.summary, 'Review: 2 files were changed after they were first sealed and 2 files were removed. Each change is recorded.')
  assert.deepEqual(states(a), {
    'notes 50%25 done.txt': 'match', 'run-0914/blank.csv': 'removed', 'run-0914/e.txt': 'removed',
    'run-0914/injection-01.csv': 'match', 'run-0914/raw/injection-01.bin': 'match',
  })
  assert.deepEqual(noteCodes(a), ['unwatched', 'gaps'])
  assert.deepEqual(a.forReview.map((g) => [g.code, g.count]), [['sealed-more-than-once', 2], ['removed', 2]])
  assert.deepEqual(a.forReview[0].items, [
    'run-0914/injection-01.csv: 2 versions (records 2, 6); changed in record 6, 2026-10-01 08:00:06 UTC',
    'run-0914/raw/injection-01.bin: 2 versions (records 3, 12); changed-unwatched in record 12, 2026-10-01 08:01:42 UTC',
  ])
  assert.deepEqual(a.forReview[1].items, ['run-0914/blank.csv: removed in record 7, 2026-10-01 08:00:07 UTC', 'run-0914/e.txt: removed-unwatched in record 13, 2026-10-01 08:01:43 UTC'])
  assert.deepEqual(a.forReview[0].records, [{ ledgerId: L.header.ledgerId, n: 6 }, { ledgerId: L.header.ledgerId, n: 12 }], 'each reason with the records it rests on')
  assert.deepEqual(a.forReview[1].records.map((x) => x.n), [7, 13])
  assert.equal(a.counts.review, 2)
  assert.equal(a.counts.reviewItems, 4)
  assert.equal(a.notes[0].count, 3)
  assert.equal(a.counts.sealed, 5)
  assert.equal(a.counts.problems, 0)
  assert.deepEqual(a.ledger.head, V.head)
  assert.equal(a.method.where, 'on the command line')
  assert.equal(a.method.tool, 'immutableqc-cli/0.1.0')
  assert.equal(a.method.auditedAt, T(1000))
  assert.ok(a.rerun.some((x) => x.includes(`--expect-head 13:${V.head.h}`) && x.includes(`--expect-key ${V.keyId}`)))
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a, 'plain JSON')
  // the ImmutableQC folder is never reported
  const withLedger = fullFiles(); withLedger.set('ImmutableQC/ledger.jsonl', F(L.text)); withLedger.set('ImmutableQC/agent.lock', F('1'))
  assert.equal(IQC.audit(V, withLedger).counts.notSealed, 0)
})

test('audit: changed, changed back to an earlier sealed version, missing', () => {
  const files = fullFiles()
  files.set('run-0914/injection-01.csv', F(CONTENT.a1)) // the version sealed in record 2
  files.set('run-0914/raw/injection-01.bin', F('something else'))
  files.delete('notes 50%25 done.txt')
  const a = IQC.audit(V, files)
  assert.equal(a.verdict, 'fail')
  assert.deepEqual(states(a), {
    'notes 50%25 done.txt': 'missing', 'run-0914/blank.csv': 'removed', 'run-0914/e.txt': 'removed',
    'run-0914/injection-01.csv': 'changed', 'run-0914/raw/injection-01.bin': 'changed',
  })
  const back = a.files.find((f) => f.path === 'run-0914/injection-01.csv')
  assert.equal(back.matchesN, 2)
  assert.deepEqual(a.problems.map((p) => p.message), [
    'notes 50%25 done.txt is missing: it was sealed in record 11, and no removal was recorded.',
    'run-0914/injection-01.csv changed since it was sealed in record 6; it matches the earlier version sealed in record 2.',
    'run-0914/raw/injection-01.bin changed since it was sealed in record 12.',
  ].sort())
  assert.equal(a.summary, 'Fail: 2 files changed since they were sealed and 1 file is missing.')
  assert.equal(a.counts.changed, 2)
  assert.equal(a.counts.missing, 1)
})

test('audit: back after removal, not sealed, not checked (no file map, or a file that cannot be read)', () => {
  const files = fullFiles()
  files.set('run-0914/blank.csv', F(CONTENT.c)) // back, with the bytes sealed in record 5
  files.set('run-0914/e.txt', F('different now'))
  files.set('run-0914/new.csv', F('never sealed'))
  files.set('run-0914/raw/injection-01.bin', null)
  let a = IQC.audit(V, files)
  assert.equal(a.verdict, 'review')
  assert.deepEqual(states(a), {
    'notes 50%25 done.txt': 'match', 'run-0914/blank.csv': 'back after removal', 'run-0914/e.txt': 'back after removal',
    'run-0914/injection-01.csv': 'match', 'run-0914/new.csv': 'not sealed', 'run-0914/raw/injection-01.bin': 'not checked',
  })
  assert.equal(a.files.find((f) => f.path === 'run-0914/blank.csv').matchesN, 5)
  assert.deepEqual(noteCodes(a), ['unwatched', 'not-sealed', 'back-after-removal', 'not-checked', 'gaps'])
  assert.deepEqual(a.notes.find((n) => n.code === 'not-sealed').items, ['run-0914/new.csv'])
  a = IQC.audit(V, null, { allowChanges: ['run-0914'] })
  assert.equal(a.verdict, 'pass')
  assert.equal(a.filesChecked, false)
  assert.ok(a.files.every((f) => f.state === 'not checked'))
  assert.equal(a.summary, 'Pass: the ledger is intact (13 records checked); the files were not checked (2 notes).')
  assert.match(a.method.recomputed.join(' '), /files were not checked/)
})

test('audit: a broken ledger fails, and its state comes from the records before the first problem', async () => {
  const v = await IQC.verifyLedger(joinLines(editLine(L.lines, 7, (o) => { o.f.sha256 = sha(CONTENT.a1) })))
  const a = IQC.audit(v, fullFiles())
  assert.equal(a.verdict, 'fail')
  assert.equal(a.counts.ledgerProblems, 1)
  assert.match(a.problems[0].message, /^Line 7 \(record 6\): the file fingerprint does not match its sealed fields\.$/)
  // judged against records 1 to 5 only: the versions sealed later (records 6 to 13) are not used
  assert.deepEqual(states(a), {
    'notes 50%25 done.txt': 'not sealed', 'run-0914/blank.csv': 'missing', 'run-0914/e.txt': 'missing',
    'run-0914/injection-01.csv': 'changed', 'run-0914/raw/injection-01.bin': 'changed',
  })
  assert.match(a.notes.find((n) => n.code === 'not-sealed').message, /before the first problem \(line 7\)/)
  assert.equal(a.summary, 'Fail: 2 files changed since they were sealed, 2 files are missing and the ledger has 1 problem.')
})

test('audit: expectHead passes on a grown ledger, fails on a wrong h, a cut ledger or a rewrite; expectKeyId', async () => {
  const pin = { n: 5, h: L.records[4].h }
  let a = IQC.audit(V, fullFiles(), { expectHead: IQC.formatHead(pin) })
  assert.equal(a.verdict, 'review', 'a matching head leaves the recorded changes in review')
  assert.equal(a.expectations.head.ok, true)
  assert.match(a.expectations.head.message, /grown since, to 13 records/)
  a = IQC.audit(V, fullFiles(), { expectHead: V.head })
  assert.equal(a.expectations.head.ok, true)
  a = IQC.audit(V, fullFiles(), { expectHead: `5:${'0'.repeat(64)}` })
  assert.equal(a.verdict, 'fail')
  assert.equal(a.expectations.head.ok, false)
  assert.match(a.problems[0].message, /^Record 5's link is [0-9a-f]{64}, not the pinned 0{64}: the ledger was rewritten/)
  assert.equal(a.summary, 'Fail: the pinned head does not match.')
  // the last records cut off: the ledger itself still verifies, the pinned head exposes it
  const cut = await IQC.verifyLedger(joinLines(L.lines.slice(0, 10)))
  assert.equal(cut.ok, true)
  a = IQC.audit(cut, null, { expectHead: IQC.formatHead(V.head) })
  assert.equal(a.verdict, 'fail')
  assert.match(a.expectations.head.message, /only 9 records: records were removed from its end/)
  // a rewrite with the key: every check passes, except the pinned head
  const items = fullItems(); items[1] = fileItem('run-0914/injection-01.csv', 'rewritten', 'existing', 2)
  const R = await build(items, { key: L.key })
  const RV = await IQC.verifyLedger(R.text)
  assert.equal(RV.ok, true)
  a = IQC.audit(RV, null, { expectHead: IQC.formatHead(V.head) })
  assert.equal(a.verdict, 'fail')
  // the genesis as a head (n = 0)
  assert.equal(IQC.audit(V, null, { expectHead: `0:${L.header.g}` }).expectations.head.ok, true)
  // uppercase hex and spaces are accepted in a pinned head; a malformed one fails
  assert.equal(IQC.audit(V, null, { expectHead: ` 5:${pin.h.toUpperCase()} ` }).expectations.head.ok, true)
  a = IQC.audit(V, null, { expectHead: 'five:abc' })
  assert.equal(a.verdict, 'fail')
  assert.match(a.expectations.head.message, /could not be read/)
  // a head after the first problem cannot be confirmed
  const broken = await IQC.verifyLedger(joinLines(editLine(L.lines, 4, (o) => { o.f.bytes = '1' })))
  assert.match(IQC.audit(broken, null, { expectHead: IQC.formatHead(pin) }).expectations.head.message, /after the first problem/)
  // expectKeyId
  a = IQC.audit(V, null, { expectKeyId: V.keyId.toUpperCase(), allowChanges: '*' })
  assert.equal(a.verdict, 'pass')
  assert.equal(a.expectations.keyId.ok, true)
  a = IQC.audit(V, null, { expectKeyId: '0123456789abcdef' })
  assert.equal(a.verdict, 'fail')
  assert.match(a.problems[0].message, /not the expected 0123456789abcdef: it was signed with another key/)
  assert.equal(a.summary, 'Fail: the key id is not the expected one.')
  assert.throws(() => IQC.parseHead('12'), /record number/)
  assert.deepEqual(IQC.parseHead(`12:${pin.h}`), { n: 12, h: pin.h })
})

test('audit: strict turns review and notes into failures', () => {
  let a = IQC.audit(V, fullFiles(), { strict: true })
  assert.equal(a.verdict, 'fail')
  assert.equal(a.strict, true)
  assert.equal(a.summary, 'Fail: 2 items for review and 2 notes count as failures in strict mode.')
  a = IQC.audit(V, fullFiles(), { strict: true, allowChanges: ['run-0914'] })
  assert.equal(a.summary, 'Fail: 2 notes count as failures in strict mode.')
  const C = IQC.audit(V, fullFiles(), { strict: false })
  assert.equal(C.verdict, 'review')
  // strict with no notes still passes
  return build([sessionItem('watch-started', 1), fileItem('a.csv', 'a', 'existing', 2), sessionItem('watch-stopped', 3)]).then(async (B) => {
    a = IQC.audit(await IQC.verifyLedger(B.text), new Map([['a.csv', F('a')]]), { strict: true })
    assert.equal(a.verdict, 'pass')
    assert.equal(a.summary, 'Pass: 1 file matches its seal, and the ledger is intact.')
  })
})

test('audit: session notes for a watch that did not stop cleanly, and for gaps', async () => {
  const B = await build([
    sessionItem('watch-started', 1), fileItem('a.csv', 'a', 'existing', 2),
    sessionItem('watch-started', 3600), sessionItem('watch-stopped', 3700),
    sessionItem('scan', 90000), removedItem('a.csv', 'removed-unwatched', 90001),
  ])
  const v = await IQC.verifyLedger(B.text)
  const a = IQC.audit(v, new Map(), { allowChanges: 'a.csv' })
  assert.equal(a.verdict, 'pass')
  assert.deepEqual(a.allowChanges, { patterns: ['a.csv'], matched: ['a.csv: removed-unwatched in record 6, 2026-10-02 09:00:01 UTC'] })
  assert.deepEqual(noteCodes(a), ['unwatched', 'unclean-stop', 'gaps'])
  const u = a.notes.find((n) => n.code === 'unclean-stop')
  assert.equal(u.count, 1)
  assert.match(u.items[0], /the watch started in record 1 \(2026-10-01 08:00:01 UTC\) has no stop record before record 3/)
  const g = a.notes.find((n) => n.code === 'gaps')
  assert.deepEqual(g.items, [
    'from 2026-10-01 08:00:02 UTC to 2026-10-01 09:00:00 UTC (59 min), between record 2 and record 3',
    'from 2026-10-01 09:01:40 UTC to 2026-10-02 09:00:00 UTC (23 h 58 min), between record 4 and record 5',
  ])
  assert.equal(states(a)['a.csv'], 'removed')
  assert.deepEqual(a.sessions.map((s) => [s.type, s.clean]), [['watch', false], ['watch', true], ['scan', true]])
  assert.equal(IQC.audit(v, new Map(), { strict: true }).verdict, 'fail')
})

test('audit: an empty ledger and an unreadable one', async () => {
  const B = await build([])
  let a = IQC.audit(await IQC.verifyLedger(B.text), new Map())
  assert.equal(a.verdict, 'pass')
  assert.equal(a.summary, 'Pass: the ledger is intact, and it seals no files yet.')
  a = IQC.audit(await IQC.verifyLedger('not a ledger\n'), new Map([['a.csv', F('a')]]), { expectHead: `1:${'a'.repeat(64)}`, expectKeyId: 'a'.repeat(16) })
  assert.equal(a.verdict, 'fail')
  assert.equal(a.ledger.keyId, null)
  assert.equal(states(a)['a.csv'], 'not sealed')
  assert.match(a.summary, /^Fail: the ledger has 1 problem, the pinned head does not match and the key id is not the expected one\.$/)
  const html = IQC.renderReportHTML(a)
  assert.match(html, /unknown/)
})

test('audit: three verdicts on one ledger: a recorded change is review, allowChanges passes it, an unrecorded change fails, strict fails review', async () => {
  const B = await build([sessionItem('watch-started', 1), fileItem('run/a.csv', 'a1', 'existing', 2), fileItem('logs/run.log', 'l1', 'existing', 3), fileItem('logs/run.log', 'l2', 'changed', 4), sessionItem('watch-stopped', 5)])
  const v = await IQC.verifyLedger(B.text)
  const files = new Map([['run/a.csv', F('a1')], ['logs/run.log', F('l2')]])
  let a = IQC.audit(v, files)
  assert.equal(a.verdict, 'review')
  assert.equal(a.summary, 'Review: 1 file was changed after it was first sealed. Each change is recorded.')
  assert.deepEqual(a.forReview.map((g) => [g.code, g.items, g.records.map((x) => x.n)]), [['sealed-more-than-once', ['logs/run.log: 2 versions (records 3, 4); changed in record 4, 2026-10-01 08:00:04 UTC'], [4]]])
  assert.deepEqual(a.notes, [])
  let html = IQC.renderReportHTML(a)
  assert.ok(html.includes('class="verdict review"') && html.includes('<span class="word">Review</span><span class="sentence">1 file was changed after it was first sealed. Each change is recorded.</span>'))
  assert.ok(html.includes('<h2>For review</h2>') && html.indexOf('<h2>Problems</h2>') < html.indexOf('<h2>For review</h2>') && html.indexOf('<h2>For review</h2>') < html.indexOf('<h2>Notes</h2>'))
  assert.ok(html.includes('<title>Audit report: review, HPLC-PC-01</title>'))
  assert.ok(!/<script/i.test(html))
  // files expected to change: a glob on a folder name, a file name, or a whole path
  for (const g of ['logs', '*.log', 'logs/*', ['x', 'run.log']]) {
    a = IQC.audit(v, files, { allowChanges: g })
    assert.equal(a.verdict, 'pass', JSON.stringify(g))
    assert.deepEqual(a.allowChanges.matched, ['logs/run.log: 2 versions (records 3, 4); changed in record 4, 2026-10-01 08:00:04 UTC'])
  }
  assert.ok(IQC.audit(v, files, { allowChanges: ['*.log'] }).rerun[1].endsWith(" --allow-changes '*.log'"))
  html = IQC.renderReportHTML(IQC.audit(v, files, { allowChanges: ['*.log'] }))
  assert.ok(html.includes('1 recorded change matches the files expected to change (*.log):'))
  assert.equal(IQC.audit(v, files, { allowChanges: ['run/*'] }).verdict, 'review', 'a pattern that does not match leaves it in review')
  // an unrecorded change fails, expected to change or not
  a = IQC.audit(v, new Map([['run/a.csv', F('a1')], ['logs/run.log', F('l3')]]), { allowChanges: ['*.log'] })
  assert.equal(a.verdict, 'fail')
  assert.equal(a.summary, 'Fail: 1 file changed since it was sealed.')
  // strict: review becomes fail
  a = IQC.audit(v, files, { strict: true })
  assert.equal(a.verdict, 'fail')
  assert.equal(a.summary, 'Fail: 1 item for review counts as a failure in strict mode.')
  assert.equal(IQC.audit(v, files, { strict: true, allowChanges: '*.log' }).verdict, 'pass')
  assert.throws(() => IQC.audit(v, files, { allowChanges: [''] }), /must be a non-empty string/)
})
