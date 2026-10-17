// Record kinds step and review (spec addendum B), their encodings, the MCP session events, planStep / planReview,
// discoverLedgers and parsePinLines.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as IQC from '../immutableqc.mjs'
import { build, editLine, codesAt, joinLines, T, sha } from './_helpers.mjs'

const A = 'analysis-server'
const H64 = (c) => sha(c)
const ref = (path, content) => ({ path, sha256: H64(content), bytes: Buffer.byteLength(content) })
const flip = (hex, i = 5) => hex.slice(0, i) + (hex[i] === '0' ? '1' : '0') + hex.slice(i + 1)
const LID = 'cd'.repeat(16)
const stepF = (over = {}) => IQC.planStep({ station: A, actor: 'analysis-agent', tool: 'normalize.py 2.1', action: 'Normalized plate 07', inputs: [ref('inputs/plate-07.csv', 'p7')], outputs: [ref('analysis/n.csv', 'n7')], at: T(10), ...over }).f
const reviewF = (over = {}) => IQC.planReview({ station: 'Browser', reviewer: 'J. Rivera', subjects: [{ ledgerId: LID, n: 2, h: H64('x') }], decision: 'approved', note: 'Looks right.', at: T(20), ...over }).f

test('ref: encodeRef / parseRef round trip, with ",", "%", "|", control characters and unicode in the path', () => {
  const cases = ['a.csv', 'with,comma.csv', 'a,b,c/d,e.csv', '50% B.csv', 'x|y.csv', 'line\nbreak.csv', 'méthode/naïve ✓ 試験.csv', 'tab\there,%2C.csv', 'emoji 🧪.csv', 'sep\u2028line.csv']
  for (const raw of cases) {
    const path = IQC.encodePath(raw)
    const r = { sha256: H64(raw), bytes: '12', path }
    const t = IQC.encodeRef(r)
    assert.ok(!t.slice(66).includes(','), `no bare comma in ${JSON.stringify(t)}`)
    assert.ok(!/[|\u0000-\u001f\u007f]/.test(t), 'a sealed field')
    assert.deepEqual(IQC.parseRef(t), r, raw)
    assert.equal(IQC.decodePath(IQC.parseRef(t).path), raw.normalize('NFC'))
    assert.equal(IQC.encodeRef({ sha256: H64(raw), bytes: 12, rawPath: raw }), t, 'rawPath is encoded the same way')
  }
  assert.equal(IQC.encodeRef({ sha256: H64('a'), bytes: 3, path: 'a,b.csv' }), `${H64('a')}:3:a%2Cb.csv`)
  assert.equal(IQC.encodeRef({ sha256: H64('a'), bytes: 0, rawPath: '100%,x' }), `${H64('a')}:0:100%25%2Cx`)
  assert.deepEqual(IQC.parseRef(`${H64('a')}:7:dir/50%25%2C done.txt`), { sha256: H64('a'), bytes: '7', path: 'dir/50%25, done.txt' })
  // a path may hold ":" (the first two separate the fields)
  assert.equal(IQC.parseRef(`${H64('a')}:1:C:/x:y.csv`).path, 'C:/x:y.csv')
  for (const bad of ['', 'abc', `${H64('a')}:1:`, `${H64('a')}:01:a.csv`, `${H64('a')}:-1:a.csv`, `${H64('a').toUpperCase()}:1:a.csv`, `${H64('a')}:1:a,b.csv`, `${H64('a')}:1:/abs.csv`, `${H64('a')}:1:a/../b.csv`, `${H64('a')}:1:a%2cb.csv`, `${H64('a')}:1:a%41.csv`, `${H64('a')}:1:a|b.csv`, `${H64('a')}:1:a\nb.csv`, `${H64('a')}:1:cafe\u0301.csv`]) {
    assert.throws(() => IQC.parseRef(bad), /Not a valid file reference/, JSON.stringify(bad))
  }
  assert.throws(() => IQC.encodeRef({ sha256: 'x', bytes: 1, path: 'a' }), /SHA-256/)
  assert.throws(() => IQC.encodeRef({ sha256: H64('a'), bytes: -1, path: 'a' }), /size in bytes/)
  assert.throws(() => IQC.encodeRef({ sha256: H64('a'), bytes: 1, path: 'a|b' }), /Not a valid path/)
  assert.throws(() => IQC.encodeRef({ sha256: H64('a'), bytes: 1, rawPath: '../a' }), /Not a valid relative path/)
})

test('ref lists: "-" when empty, in order, duplicates left out by encodeRefList and refused by parseRefList, at most 1,000', () => {
  assert.equal(IQC.encodeRefList([]), '-')
  assert.deepEqual(IQC.parseRefList('-'), [])
  const a = ref('a,1.csv', 'a'), b = ref('b|2.csv'.replace('|', '%7C'), 'b')
  const t = IQC.encodeRefList([b, a, b])
  assert.equal(t, `${IQC.encodeRef(b)},${IQC.encodeRef(a)}`, 'order kept, the duplicate left out')
  assert.deepEqual(IQC.parseRefList(t).map((x) => x.path), ['b%7C2.csv', 'a,1.csv'])
  assert.equal(IQC.encodeRefList([IQC.encodeRef(a)]), IQC.encodeRef(a), 'encoded references are accepted')
  assert.throws(() => IQC.parseRefList(`${IQC.encodeRef(a)},${IQC.encodeRef(a)}`), /appears twice/)
  assert.throws(() => IQC.parseRefList(''), /empty/)
  assert.throws(() => IQC.parseRefList(`${IQC.encodeRef(a)},`), /file reference 2 is not valid/)
  const many = Array.from({ length: 1001 }, (_, i) => ref(`f${i}.csv`, String(i)))
  assert.throws(() => IQC.encodeRefList(many), /at most 1,000/)
  assert.equal(IQC.parseRefList(IQC.encodeRefList(many.slice(0, 1000))).length, 1000)
  assert.throws(() => IQC.parseRefList(many.map((r) => IQC.encodeRef(r)).join(',')), /at most 1,000/)
})

test('subjects: encodeSubject / parseSubject and lists; at least one, at most 1,000, no duplicates', () => {
  const s = { ledgerId: LID, n: 12, h: H64('h') }
  const t = IQC.encodeSubject(s)
  assert.equal(t, `${LID}:12:${H64('h')}`)
  assert.deepEqual(IQC.parseSubject(t), s)
  assert.equal(IQC.encodeSubject(t), t)
  const list = IQC.encodeSubjectList([s, { ...s, n: 13 }, s])
  assert.equal(list.split(',').length, 2)
  assert.deepEqual(IQC.parseSubjectList(list).map((x) => x.n), [12, 13])
  for (const bad of [`${LID}:0:${H64('h')}`, `${LID}:01:${H64('h')}`, `${LID.slice(1)}:1:${H64('h')}`, `${LID}:1:${H64('h').slice(1)}`, `${LID.toUpperCase()}:1:${H64('h')}`, `${LID}:99999999999999999999:${H64('h')}`]) {
    assert.throws(() => IQC.parseSubject(bad), /Not a valid record reference/, bad)
  }
  assert.throws(() => IQC.encodeSubjectList([]), /at least one/)
  assert.throws(() => IQC.parseSubjectList('-'), /at least one/)
  assert.throws(() => IQC.parseSubjectList(`${t},${t}`), /appears twice/)
  assert.throws(() => IQC.encodeSubjectList(Array.from({ length: 1001 }, (_, i) => ({ ...s, n: i + 1 }))), /at most 1,000/)
})

test('planStep and planReview: the fields, defaults, and every rule refused', () => {
  const f = stepF({ tool: undefined })
  assert.deepEqual(Object.keys(f), IQC.KINDS.step.fields)
  assert.equal(f.tool, '-', 'an unknown tool is "-"')
  assert.equal(IQC.planStep({ station: A, actor: 'a', action: 'b', outputs: [ref('o', 'o')], at: T(1) }).f.inputs, '-', 'no inputs is "-"')
  assert.ok(IQC.isTime(IQC.planStep({ station: A, actor: 'a', action: 'b', outputs: [ref('o', 'o')] }).f.at), 'at defaults to now')
  assert.equal(IQC.payloadOf('step', f), ['iqc-step-v1', A, 'analysis-agent', '-', 'Normalized plate 07', f.inputs, f.outputs, T(10)].join('|'))
  const rf = reviewF({ note: '' })
  assert.equal(rf.note, '-', 'an empty note is "-"')
  assert.deepEqual(Object.keys(rf), IQC.KINDS.review.fields)
  assert.equal(IQC.payloadOf('review', rf), ['iqc-review-v1', 'Browser', 'J. Rivera', `${LID}:2:${H64('x')}`, 'approved', '-', T(20)].join('|'))
  const base = { station: A, actor: 'analysis-agent', tool: 't', action: 'a', inputs: [], outputs: [ref('o.csv', 'o')], at: T(1) }
  const bad = [
    [{ actor: '' }, /the actor must be 1 to 64/], [{ actor: 'x'.repeat(65) }, /the actor/], [{ actor: 'a|b' }, /the actor/], [{ actor: 'a\nb' }, /the actor/],
    [{ tool: 'x'.repeat(129) }, /the tool must be 1 to 128/], [{ tool: 'a|b' }, /the tool/],
    [{ action: '' }, /the action must be 1 to 500/], [{ action: 'x'.repeat(501) }, /the action/], [{ action: 'two\nlines' }, /the action/], [{ action: 'a|b' }, /the action/],
    [{ outputs: [] }, /the outputs are not valid: it must name at least one file reference/], [{ at: '2026-10-01T08:00:00Z' }, /the step time must be a real UTC time/],
    [{ station: '' }, /the station/], [{ at: '2026-02-30T08:00:00.000Z' }, /the step time/],
  ]
  for (const [over, re] of bad) assert.throws(() => IQC.planStep({ ...base, ...over }), re, JSON.stringify(over))
  assert.ok(IQC.planStep({ ...base, actor: 'é'.repeat(64), tool: '試'.repeat(128), action: '🧪'.repeat(500) }), 'limits count characters, not UTF-16 units')
  const rbase = { station: 'Browser', reviewer: 'JR', subjects: [{ ledgerId: LID, n: 1, h: H64('a') }], decision: 'question', at: T(1) }
  const rbad = [
    [{ reviewer: '' }, /the reviewer must be 1 to 64/], [{ reviewer: 'x'.repeat(65) }, /the reviewer/], [{ decision: 'ok' }, /the decision must be one of approved, question, rejected/],
    [{ decision: 'Approved' }, /the decision/], [{ note: 'x'.repeat(501) }, /the note must be 1 to 500/], [{ note: 'a|b' }, /the note/], [{ note: 'a\nb' }, /the note/],
    [{ subjects: [] }, /at least one record/], [{ subjects: ['nope'] }, /Not a valid record reference/], [{ at: 'yesterday' }, /the review time/],
  ]
  for (const [over, re] of rbad) assert.throws(() => IQC.planReview({ ...rbase, ...over }), re, JSON.stringify(over))
  assert.equal(IQC.planReview({ ...rbase, note: 'x'.repeat(500) }).f.note.length, 500)
})

test('verify: step and review records round trip, and each field rule is refused by verifyLedger with a plain sentence', async () => {
  const items = [
    { kind: 'session', f: { station: A, event: 'mcp-started', at: T(1), agent: 'immutableqc-cli/0.1.0' } },
    { kind: 'step', f: stepF() },
    { kind: 'review', f: reviewF() },
    { kind: 'session', f: { station: A, event: 'mcp-stopped', at: T(30), agent: 'immutableqc-cli/0.1.0' } },
  ]
  const L = await build(items, { station: A })
  const v = await IQC.verifyLedger(L.text)
  assert.deepEqual(v.problems, [])
  assert.deepEqual(v.kinds, { file: 0, 'file-removed': 0, session: 2, reading: 0, step: 1, review: 1 })
  assert.equal(L.records[1].r, sha(`iqc-step-v1|${Object.values(L.records[1].f).join('|')}`))
  assert.equal(L.records[2].r, sha(`iqc-review-v1|${Object.values(L.records[2].f).join('|')}`))
  assert.deepEqual(v.sessions, [], 'MCP sessions are not watch sessions')
  assert.deepEqual(v.mcpSessions.map((s) => [s.type, s.startN, s.stopN, s.clean, s.steps]), [['mcp', 1, 4, true, 1]])
  // each rule, as verifyLedger states it (the record is canonical; its fingerprint fails too, since the field changed)
  const cases = [
    [2, (f) => { f.actor = '' }, /the actor must be 1 to 64 characters/],
    [2, (f) => { f.tool = '' }, /the tool must be 1 to 128 characters/],
    [2, (f) => { f.action = 'x'.repeat(501) }, /the action must be 1 to 500 characters on one line/],
    [2, (f) => { f.inputs = '' }, /the inputs are not valid: it is empty \(an empty list is written "-"\)/],
    [2, (f) => { f.inputs = `${f.inputs},${f.inputs}` }, /the inputs are not valid: file reference 2 appears twice/],
    [2, (f) => { f.outputs = '-' }, /the outputs are not valid: it must name at least one file reference/],
    [2, (f) => { f.outputs = f.outputs.replace('analysis/n.csv', 'analysis/a,b.csv') }, /the outputs are not valid: file reference 2 is not valid: it must be written <SHA-256/], // a bare "," splits the list
    [2, (f) => { f.at = 'now' }, /the step time must be a real UTC time/],
    [3, (f) => { f.reviewer = 'x'.repeat(65) }, /the reviewer must be 1 to 64/],
    [3, (f) => { f.subjects = '-' }, /the subjects are not valid: it must name at least one record reference/],
    [3, (f) => { f.subjects = 'abc' }, /the subjects are not valid: record reference 1 is not valid/],
    [3, (f) => { f.decision = 'maybe' }, /the decision must be one of approved, question, rejected/],
    [3, (f) => { f.note = '' }, /the note must be 1 to 500 characters with no "\|" and no control character, or "-"/],
    [3, (f) => { f.at = T(1).slice(0, 19) + 'Z' }, /the review time must be a real UTC time/],
    [1, (f) => { f.event = 'mcp-paused' }, /the event "mcp-paused" is not allowed for a session record \(allowed: watch-started, watch-stopped, scan, mcp-started, mcp-stopped\)/],
  ]
  for (const [line0, edit, re] of cases) {
    const line = line0 + 1
    const bad = await IQC.verifyLedger(joinLines(editLine(L.lines, line, (o) => edit(o.f))))
    assert.equal(bad.firstProblemLine, line, String(re))
    assert.ok(bad.problems.some((p) => p.line === line && re.test(p.message) && /^Line \d+ \(record \d+\): /.test(p.message)), `${re}: ${bad.problems.map((p) => p.message).join(' / ')}`)
    assert.ok(codesAt(bad, line).includes('field') || codesAt(bad, line).includes('event'))
  }
  // a field missing or extra
  let bad = await IQC.verifyLedger(joinLines(editLine(L.lines, 3, (o) => { delete o.f.tool })))
  assert.ok(codesAt(bad, 3).includes('f-key-missing'))
  const extra = L.lines.slice(); const o4 = JSON.parse(extra[3]); o4.f.extra = 'x'; extra[3] = JSON.stringify(o4)
  bad = await IQC.verifyLedger(joinLines(extra))
  assert.ok(codesAt(bad, 4).includes('f-key-unknown'))
  // an unknown kind names every kind
  bad = await IQC.verifyLedger(joinLines(editLine(L.lines, 3, (o) => { o.kind = 'stepp' })))
  assert.match(bad.problems[0].message, /\(file, file-removed, session, reading, step, review\)/)
})

test('tamper: each sealed field of step and review records changed', async () => {
  const items = [{ kind: 'step', f: stepF() }, { kind: 'review', f: reviewF() }, { kind: 'session', f: { station: A, event: 'mcp-started', at: T(40), agent: 'x/1' } }]
  const L = await build(items, { station: A })
  const alt = {
    station: () => 'OTHER', actor: () => 'other-agent', tool: () => 'other 1.0', action: () => 'Did something else',
    inputs: () => IQC.encodeRefList([ref('inputs/plate-07.csv', 'p8')]), outputs: () => IQC.encodeRefList([ref('analysis/n.csv', 'n8')]),
    at: () => T(99), reviewer: () => 'Someone', subjects: () => IQC.encodeSubject({ ledgerId: LID, n: 3, h: H64('x') }), decision: () => 'rejected', note: () => '-',
    event: () => 'mcp-stopped', agent: () => 'y/2',
  }
  const seen = new Set()
  for (let line = 2; line <= L.lines.length; line++) {
    const kind = L.records[line - 2].kind
    for (const field of IQC.KINDS[kind].fields) {
      const v = await IQC.verifyLedger(joinLines(editLine(L.lines, line, (o) => { o.f[field] = alt[field](o.f[field]) })))
      assert.deepEqual(codesAt(v, line), ['r'], `${kind}.${field}: only the fingerprint fails`)
      assert.equal(v.problems.length, 1, `${kind}.${field}`)
      assert.match(v.problems[0].message, new RegExp(`the ${IQC.KINDS[kind].label} fingerprint does not match its sealed fields`))
      seen.add(`${kind}.${field}`)
    }
  }
  assert.equal(seen.size, 7 + 6 + 4)
  // r, h and sig of a step: the same checks as every record
  let v = await IQC.verifyLedger(joinLines(editLine(L.lines, 2, (o) => { o.h = flip(o.h) })))
  assert.ok(codesAt(v, 2).includes('h'))
  v = await IQC.verifyLedger(joinLines(editLine(L.lines, 3, (o) => { o.sig = L.records[0].sig })))
  assert.deepEqual(codesAt(v, 3), ['sig'])
})

test('MCP sessions: an unclean stop is a note; a stray stop; steps outside a session; extendVerified keeps them', async () => {
  const S = (event, i) => ({ kind: 'session', f: { station: A, event, at: T(i), agent: 'immutableqc-cli/0.1.0' } })
  const L = await build([S('mcp-started', 1), { kind: 'step', f: stepF({ at: T(2) }) }, S('mcp-started', 3), S('mcp-stopped', 4), S('mcp-stopped', 5), { kind: 'step', f: stepF({ at: T(6) }) }], { station: A })
  const v = await IQC.verifyLedger(L.text)
  assert.deepEqual(v.mcpSessions.map((s) => [s.startN, s.stopN, s.clean, s.endedByN, s.steps, !!s.stray]), [[1, null, false, 3, 1, false], [3, 4, true, null, 0, false], [null, 5, false, null, 0, true]])
  const a = IQC.audit(v, null)
  const u = a.notes.find((n) => n.code === 'unclean-stop')
  assert.deepEqual(u.items, ['the MCP server session started in record 1 (2026-10-01 08:00:01 UTC) has no stop record before record 3', 'record 5 stops an MCP server session that has no start record'])
  assert.match(u.message, /^2 sessions did not end cleanly/)
  assert.equal(a.mcpSessions.length, 3)
  assert.equal(a.ledger.role, 'agent')
  assert.equal(a.verdict, 'pass', 'notes only')
  // extendVerified
  const B = await build([S('mcp-started', 1)], { station: A })
  const vb = await IQC.verifyLedger(B.text)
  const more = await IQC.createRecords({ head: vb.head, items: [{ kind: 'step', f: stepF() }, S('mcp-stopped', 20)], privateKey: B.key.privateKey })
  IQC.extendVerified(vb, more)
  assert.deepEqual(vb.mcpSessions.map((s) => [s.startN, s.stopN, s.clean, s.steps]), [[1, 3, true, 1]])
  assert.equal(vb.kinds.step, 1)
})

test('discoverLedgers: ImmutableQC/ledger.jsonl up to 6 folders deep, *.ledger.jsonl with no root, nested roots', () => {
  const paths = [
    'ImmutableQC/ledger.jsonl', 'ImmutableQC/README.txt', 'data.csv',
    'bio-line-2/ImmutableQC/ledger.jsonl', 'bio-line-2/plate-07.csv',
    'site/a/b/c/d/e/ImmutableQC/ledger.jsonl', // 6 folders above ImmutableQC
    'site/a/b/c/d/e/f/ImmutableQC/ledger.jsonl', // 7: too deep
    'reviews/j-rivera.ledger.jsonl', 'a/b/c/d/e/f/deep.ledger.jsonl', 'a/b/c/d/e/f/g/too-deep.ledger.jsonl',
    '.ledger.jsonl', 'ledger.jsonl', 'x/immutableqc/ledger.jsonl', 'x/ImmutableQC/ledger.json', 'x/ImmutableQC/old/ledger.jsonl',
    'win\\path\\ImmutableQC\\ledger.jsonl', './dot/ImmutableQC/ledger.jsonl', 'bio-line-2/ImmutableQC/ledger.jsonl',
  ]
  const got = IQC.discoverLedgers(paths)
  assert.deepEqual(got.map((x) => [x.ledgerPath, x.root]), [
    ['ImmutableQC/ledger.jsonl', ''],
    ['a/b/c/d/e/f/deep.ledger.jsonl', null],
    ['bio-line-2/ImmutableQC/ledger.jsonl', 'bio-line-2'],
    ['dot/ImmutableQC/ledger.jsonl', 'dot'],
    ['reviews/j-rivera.ledger.jsonl', null],
    ['site/a/b/c/d/e/ImmutableQC/ledger.jsonl', 'site/a/b/c/d/e'],
    ['win/path/ImmutableQC/ledger.jsonl', 'win/path'],
  ])
  assert.deepEqual(got[0].nested, ['bio-line-2', 'dot', 'site/a/b/c/d/e', 'win/path'], 'the top ledger holds the others')
  assert.deepEqual(got[2].nested, [])
  assert.equal(got[1].nested, undefined)
  assert.deepEqual(IQC.discoverLedgers([]), [])
  assert.deepEqual(IQC.discoverLedgers(new Set(['q/ImmutableQC/ledger.jsonl'])).map((x) => x.root), ['q'])
  assert.throws(() => IQC.discoverLedgers(null), /list of relative file paths/)
})

test('parsePinLines and formatPinLine', () => {
  const h = H64('h'), at = T(5)
  const line = IQC.formatPinLine(LID, { n: 7, h }, at)
  assert.equal(line, `immutableqc-head ${LID} 7:${h} ${at}`)
  const text = `# pins from bio-line-2\n${line}\r\n\n  immutableqc-head ${LID}   0:${h}   ${at}  \nimmutableqc-head ${LID} 7:${h}\nimmutableqc-head ${LID.toUpperCase()} 7:${h} ${at}\nsomething else\n`
  const got = IQC.parsePinLines(text)
  assert.deepEqual(got.slice(0, 2), [{ line: 2, ledgerId: LID, n: 7, h, at }, { line: 4, ledgerId: LID, n: 0, h, at }])
  assert.deepEqual(got.slice(2).map((x) => [x.line, !!x.error]), [[5, true], [6, true], [7, true]])
  assert.deepEqual(IQC.parsePinLines([line]), [{ line: 1, ledgerId: LID, n: 7, h, at }])
  assert.deepEqual(IQC.parsePinLines(''), [])
  assert.throws(() => IQC.formatPinLine('x', { n: 1, h }, at), /ledger id/)
})
