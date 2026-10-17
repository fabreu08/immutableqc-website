import test from 'node:test'
import assert from 'node:assert/strict'
import * as IQC from '../immutableqc.mjs'
import { build, fullItems, editLine, codesAt, joinLines, testKey, sessionItem, fileItem, T, STATION, sha } from './_helpers.mjs'

const L = await build(fullItems())
const verify = (lines) => IQC.verifyLedger(Array.isArray(lines) ? joinLines(lines) : lines)
const flip = (hex, i = 5) => hex.slice(0, i) + (hex[i] === '0' ? '1' : '0') + hex.slice(i + 1)

// a tampered ledger fails exactly at `line`, with `codes` there, and the state comes only from the records before it
function brokenAt(v, line, codes, label) {
  assert.equal(v.ok, false, `${label}: fails`)
  assert.equal(v.firstProblemLine, line, `${label}: first problem on line ${line} (got ${JSON.stringify(v.problems.map((p) => p.message))})`)
  for (const c of codes) assert.ok(codesAt(v, line).includes(c), `${label}: ${c} on line ${line} (got ${codesAt(v, line)})`)
  assert.equal(v.goodCount, Math.max(0, line - 2), `${label}: ${line - 2} good records`)
  if (line >= 2) assert.deepEqual(v.head, line === 2 ? { n: 0, h: L.header.g } : { n: line - 2, h: L.records[line - 3].h }, `${label}: head`)
  else assert.equal(v.head, null)
  for (const p of v.problems) assert.match(p.message, /^(Line \d+( \((header|record \d+)\))?: |The ledger)/, `${label}: plain sentence with a line number`)
}

test('round trip: a ledger made by core verifies, with its head, files, sessions and gaps', async () => {
  const v = await verify(L.text)
  assert.deepEqual(v.problems, [])
  assert.equal(v.ok, true)
  assert.equal(v.recordCount, 13)
  assert.equal(v.goodCount, 13)
  assert.deepEqual(v.head, { n: 13, h: L.records[12].h })
  assert.equal(v.keyId, IQC.keyIdOf(L.pk))
  assert.deepEqual(v.kinds, { file: 7, 'file-removed': 2, session: 3, reading: 1, step: 0, review: 0 })
  const a = v.files.get('run-0914/injection-01.csv')
  assert.deepEqual(a.versions.map((x) => [x.n, x.event]), [[2, 'existing'], [6, 'changed']])
  assert.equal(a.latest.sha256, sha('sample,area\nS-01,1523.4\nS-02,1498.0\n'))
  assert.equal(v.files.get('run-0914/blank.csv').latest.kind, 'file-removed')
  assert.equal(v.files.get('notes 50%25 done.txt').latest.event, 'added-unwatched')
  assert.equal(v.sessions.length, 2)
  assert.deepEqual([v.sessions[0].type, v.sessions[0].startN, v.sessions[0].stopN, v.sessions[0].clean], ['watch', 1, 9, true])
  assert.deepEqual([v.sessions[1].type, v.sessions[1].startN, v.sessions[1].files], ['scan', 10, 3])
  assert.equal(v.gaps.length, 1)
  assert.deepEqual([v.gaps[0].afterN, v.gaps[0].beforeN, v.gaps[0].from, v.gaps[0].to, v.gaps[0].ms], [9, 10, T(8), T(100), 92000])
  // every line is canonical, and serializeLine adds the newline
  for (const [i, o] of [L.header, ...L.records].entries()) assert.equal(IQC.serializeLine(o), L.lines[i] + '\n')
  // header and links follow the spec's formulas
  assert.equal(L.header.g, sha(`immutableqc-ledger-v1|${L.header.ledgerId}|${L.header.createdAt}|${STATION}|ECDSA-P256-SHA256|${L.pk}`))
  const r1 = L.records[1]
  assert.equal(r1.r, sha(`iqc-file-v1|${Object.values(r1.f).join('|')}`))
  assert.equal(r1.h, sha(r1.prev + r1.r + '2'))
  assert.equal(L.records[0].prev, L.header.g)
  assert.equal(L.records[7].r, sha('LC-02|peak-area|1523.4|mAU*s|2026-10-01T08:15:00Z'), 'reading payload has no tag (the docs pages construction)')
  assert.equal(L.records[0].r, sha(`iqc-session-v1|${STATION}|watch-started|${T(1)}|immutableqc-cli/0.1.0`))
  assert.equal(L.records[6].r, sha(`iqc-file-removed-v1|${STATION}|run-0914/blank.csv|${T(7)}|removed`))
  // bytes too: a Uint8Array ledger verifies the same
  const vb = await IQC.verifyLedger(new TextEncoder().encode(L.text))
  assert.equal(vb.ok, true)
  // the header's ctx is not sealed: changing it changes nothing
  const v2 = await verify(editLine(L.lines, 1, (o) => { o.ctx = { agent: 'someone-else/9' } }))
  assert.equal(v2.ok, true)
})

test('tamper: each sealed field of each kind changed', async () => {
  const alt = {
    station: () => 'OTHER-PC', path: () => 'run-0914/other.csv', sha256: (x) => flip(x), bytes: (x) => String(Number(x) + 1),
    observedAt: () => T(999), at: () => T(998), agent: () => 'immutableqc-app/0.1.0',
    instrumentId: () => 'LC-03', sensorType: () => 'height', value: () => '1523.5', unit: () => 'mAU', capturedAt: () => '2026-10-01T08:16:00Z',
  }
  const altEvent = { existing: 'added', added: 'existing', changed: 'changed-unwatched', 'added-unwatched': 'added', 'changed-unwatched': 'changed', removed: 'removed-unwatched', 'removed-unwatched': 'removed', 'watch-started': 'scan', 'watch-stopped': 'scan', scan: 'watch-started' }
  const seen = new Set()
  for (let line = 2; line <= L.lines.length; line++) {
    const kind = L.records[line - 2].kind
    for (const field of IQC.KINDS[kind].fields) {
      const lines = editLine(L.lines, line, (o) => { o.f[field] = field === 'event' ? altEvent[o.f.event] : alt[field](o.f[field]) })
      const v = await verify(lines)
      brokenAt(v, line, ['r'], `${kind}.${field} on line ${line}`)
      assert.deepEqual(codesAt(v, line), ['r'], `${kind}.${field}: only the fingerprint fails`)
      assert.equal(v.problems.length, 1)
      if (kind === 'file') assert.equal(v.problems[0].message, `Line ${line} (record ${line - 1}): the file fingerprint does not match its sealed fields.`)
      seen.add(`${kind}.${field}`)
    }
  }
  assert.equal(seen.size, 6 + 4 + 4 + 5, 'every field of every kind')
})

test('tamper: r, prev, h and sig changed', async () => {
  const line = 7
  let v = await verify(editLine(L.lines, line, (o) => { o.r = flip(o.r) }))
  brokenAt(v, line, ['r'], 'r')
  assert.deepEqual(codesAt(v, line), ['r'])
  v = await verify(editLine(L.lines, line, (o) => { o.prev = flip(o.prev) }))
  brokenAt(v, line, ['prev'], 'prev')
  assert.deepEqual(codesAt(v, line), ['prev'])
  v = await verify(editLine(L.lines, 2, (o) => { o.prev = flip(o.prev) }))
  assert.match(v.problems[0].message, /^Line 2 \(record 1\): it does not continue from the header/)
  const blankFirst = editLine(L.lines, 2, (o) => { o.prev = flip(o.prev) }); blankFirst.splice(1, 0, '')
  v = await verify(blankFirst)
  assert.deepEqual(v.problems.map((p) => [p.line, p.code]), [[2, 'blank'], [3, 'prev']])
  assert.match(v.problems[1].message, /continue from the header/)
  v = await verify(editLine(L.lines, line, (o) => { o.h = flip(o.h) }))
  brokenAt(v, line, ['h', 'sig'], 'h')
  assert.deepEqual(codesAt(v, line + 1), ['prev'], 'and the next record no longer continues from it')
  v = await verify(editLine(L.lines, line, (o) => { o.sig = L.records[0].sig }))
  brokenAt(v, line, ['sig'], 'sig from another record')
  assert.deepEqual(codesAt(v, line), ['sig'])
  v = await verify(editLine(L.lines, line, (o) => { o.sig = flip(o.sig, 70) }))
  brokenAt(v, line, ['sig'], 'sig changed')
  const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551')
  v = await verify(editLine(L.lines, line, (o) => { o.sig = o.sig.slice(0, 64) + (N - BigInt('0x' + o.sig.slice(64))).toString(16).padStart(64, '0') }))
  brokenAt(v, line, ['sig-high-s'], 'high-S twin')
  assert.deepEqual(codesAt(v, line), ['sig-high-s'])
})

test('tamper: a record deleted, two swapped, one inserted, a copy inserted, an n gap', async () => {
  // deleted: line 6 (record 5) removed; record 6 now sits on line 6
  let lines = L.lines.filter((_, i) => i !== 5)
  let v = await verify(lines)
  brokenAt(v, 6, ['n-gap', 'prev'], 'deleted')
  assert.equal(v.problems.length, 2, 'one gap, one broken link, nothing after')
  assert.match(v.problems.find((p) => p.code === 'n-gap').message, /^Line 6 \(record 6\): the record number jumps from 4 to 6: record 5 is missing\.$/)
  // the last record deleted: only an expected head shows it (see the audit tests); the ledger itself still verifies
  v = await verify(L.lines.slice(0, -1))
  assert.equal(v.ok, true)
  // swapped: lines 6 and 7
  lines = L.lines.slice(); [lines[5], lines[6]] = [lines[6], lines[5]]
  v = await verify(lines)
  brokenAt(v, 6, ['n-gap', 'prev'], 'swapped')
  assert.ok(codesAt(v, 7).includes('n-order') && codesAt(v, 7).includes('prev'))
  // inserted: a record made with another key, numbered and linked to fit
  const other = await IQC.generateKeyPair()
  const forged = await IQC.createRecord({ n: 5, prev: L.records[3].h, ...fileItem('run-0914/forged.csv', 'x', 'added', 50), privateKey: other.privateKey })
  lines = L.lines.slice(); lines.splice(5, 0, IQC.canonicalJSON(forged))
  v = await verify(lines)
  brokenAt(v, 6, ['sig'], 'inserted')
  assert.ok(codesAt(v, 7).includes('n-order') && codesAt(v, 7).includes('prev'))
  // a copy of an existing line inserted after it
  lines = L.lines.slice(); lines.splice(6, 0, L.lines[5])
  v = await verify(lines)
  brokenAt(v, 7, ['n-order', 'prev'], 'duplicated')
  // n changed: record 5 says 7
  v = await verify(editLine(L.lines, 6, (o) => { o.n = 7 }))
  brokenAt(v, 6, ['n-gap'], 'n gap')
  assert.ok(!codesAt(v, 6).includes('h'), 'the link is not named when the number explains it')
  v = await verify(editLine(L.lines, 6, (o) => { o.n = 0 }))
  brokenAt(v, 6, ['n-form'], 'n zero')
  v = await verify(editLine(L.lines, 2, (o) => { o.n = 2 }))
  brokenAt(v, 2, ['n-gap'], 'first record not 1')
  v = await verify(editLine(L.lines, 6, (o) => { o.n = '5' }))
  brokenAt(v, 6, ['n-form'], 'n as text')
})

test('tamper: header station, publicKey, keyId, sig, format, version', async () => {
  let v = await verify(editLine(L.lines, 1, (o) => { o.station = 'OTHER-PC' }))
  brokenAt(v, 1, ['header-g'], 'header station')
  assert.equal(v.files.size, 0, 'no state from a broken header')
  const other = await IQC.generateKeyPair()
  const otherPk = await IQC.publicKeyHex(other.publicKey)
  v = await verify(editLine(L.lines, 1, (o) => { o.publicKey = otherPk }))
  brokenAt(v, 1, ['header-keyid', 'header-g', 'header-sig'], 'header publicKey')
  assert.ok(v.problems.filter((p) => p.code === 'sig').length === 13, 'every record signature fails with the other key')
  v = await verify(editLine(L.lines, 1, (o) => { o.publicKey = flip(o.publicKey, 40) }))
  brokenAt(v, 1, ['header-keyid', 'header-g'], 'header publicKey not a point')
  v = await verify(editLine(L.lines, 1, (o) => { o.keyId = flip(o.keyId, 3) }))
  brokenAt(v, 1, ['header-keyid'], 'header keyId')
  assert.deepEqual(codesAt(v, 1), ['header-keyid'])
  v = await verify(editLine(L.lines, 1, (o) => { o.sig = L.records[0].sig }))
  brokenAt(v, 1, ['header-sig'], 'header sig')
  assert.deepEqual(codesAt(v, 1), ['header-sig'])
  v = await verify(editLine(L.lines, 1, (o) => { o.ledgerId = flip(o.ledgerId) }))
  brokenAt(v, 1, ['header-g'], 'header ledgerId')
  v = await verify(editLine(L.lines, 1, (o) => { o.createdAt = T(5) }))
  brokenAt(v, 1, ['header-g'], 'header createdAt')
  v = await verify(editLine(L.lines, 1, (o) => { o.g = flip(o.g) }))
  brokenAt(v, 1, ['header-g', 'header-sig'], 'header g')
  assert.ok(codesAt(v, 2).includes('prev'), 'record 1 no longer continues from g')
  v = await verify(editLine(L.lines, 1, (o) => { o.version = 2 }))
  brokenAt(v, 1, ['header-version'], 'version')
  assert.match(v.problems[0].message, /format version 2; this tool reads version 1/)
  v = await verify(editLine(L.lines, 1, (o) => { o.format = 'something-else' }))
  brokenAt(v, 1, ['header-format'], 'format')
  v = await verify(editLine(L.lines, 1, (o) => { o.alg = 'ECDSA-P384-SHA384' }))
  brokenAt(v, 1, ['header-field', 'header-g'], 'alg')
})

test('tamper: non-canonical lines (extra space, duplicate key, key order, escapes), unknown key', async () => {
  const at = (line, text) => { const l = L.lines.slice(); l[line - 1] = text; return l }
  let v = await verify(at(5, L.lines[4].replace('","', '", "')))
  brokenAt(v, 5, ['canonical'], 'extra space')
  assert.deepEqual(codesAt(v, 5), ['canonical'])
  v = await verify(at(5, L.lines[4].replace('"kind":"file",', '"kind":"file","kind":"file",')))
  brokenAt(v, 5, ['canonical'], 'duplicate key')
  v = await verify(at(5, L.lines[4].replace(/^\{"n":4,"kind":"file",/, '{"kind":"file","n":4,')))
  brokenAt(v, 5, ['canonical'], 'key order')
  v = await verify(at(5, L.lines[4].replace('"existing"', '"\\u0065xisting"')))
  brokenAt(v, 5, ['canonical'], 'escaped character')
  v = await verify(at(1, L.lines[0].replace('"version":1', '"version":1.0')))
  brokenAt(v, 1, ['canonical'], 'number written another way')
  v = await verify(at(5, L.lines[4] + ' '))
  brokenAt(v, 5, ['canonical'], 'trailing space')
  // canonicalJSON refuses unknown keys, so this one is written by hand
  v = await verify(at(5, L.lines[4].slice(0, -1) + ',"note":"hi"}'))
  brokenAt(v, 5, ['key-unknown'], 'unknown key')
  v = await verify(at(5, L.lines[4].replace('"event":"existing"', '"event":"existing","extra":"x"')))
  brokenAt(v, 5, ['f-key-unknown'], 'unknown sealed field')
  v = await verify(at(5, L.lines[4].replace(',"event":"existing"', '')))
  brokenAt(v, 5, ['f-key-missing'], 'missing sealed field')
  v = await verify(at(1, L.lines[0].replace(/,"ctx":\{[^}]*\}/, ',"extra":1')))
  brokenAt(v, 1, ['key-unknown'], 'unknown header key')
  v = await verify(editLine(L.lines, 5, (o) => { o.ctx = 'note' }))
  brokenAt(v, 5, ['ctx-form'], 'ctx not an object')
  v = await verify(editLine(L.lines, 5, (o) => { o.kind = 'note' }))
  brokenAt(v, 5, ['kind'], 'unknown kind')
  v = await verify(editLine(L.lines, 5, (o) => { o.f.bytes = Number(o.f.bytes) }))
  brokenAt(v, 5, ['field'], 'bytes as a number')
  v = await verify(editLine(L.lines, 5, (o) => { o.f.bytes = '0' + o.f.bytes }))
  brokenAt(v, 5, ['field'], 'bytes with a leading zero')
  v = await verify(editLine(L.lines, 5, (o) => { o.f.event = 'removed' }))
  brokenAt(v, 5, ['event'], 'event of another kind')
  v = await verify(editLine(L.lines, 5, (o) => { o.f.path = '../escape.csv' }))
  brokenAt(v, 5, ['field'], 'bad path')
  v = await verify(editLine(L.lines, 5, (o) => { o.f.observedAt = '2026-10-01T08:00:04Z' }))
  brokenAt(v, 5, ['field'], 'time without milliseconds')
  v = await verify(editLine(L.lines, 5, (o) => { o.f.station = 'A|B' }))
  brokenAt(v, 5, ['field'], 'separator in a field')
  v = await verify(editLine(L.lines, 5, (o) => { o.r = o.r.toUpperCase() }))
  brokenAt(v, 5, ['r-form'], 'uppercase hex')
})

test('tamper: trailing line without newline, blank line, truncated last line, CRLF, BOM, bad UTF-8, empty', async () => {
  const last = L.lines.length
  let v = await verify(L.text.slice(0, -1))
  brokenAt(v, last, ['no-newline'], 'no final newline')
  assert.deepEqual(codesAt(v, last), ['no-newline'])
  // a blank line: the record after it continues from the one before it
  let lines = L.lines.slice(); lines.splice(5, 0, '')
  v = await verify(lines)
  brokenAt(v, 6, ['blank'], 'blank line')
  assert.equal(v.problems.length, 1, 'only the blank line')
  v = await verify(L.text + '\n')
  brokenAt(v, last + 1, ['blank'], 'blank line at the end')
  const cut = L.text.slice(0, L.text.length - 40)
  v = await verify(cut)
  brokenAt(v, last, ['truncated'], 'truncated last line')
  assert.match(v.problems[0].message, /cut off/)
  v = await verify(L.text.replace(/\n/g, '\r\n'))
  brokenAt(v, 1, ['crlf'], 'CRLF line endings')
  assert.equal(v.problems.length, last, 'one problem per line, nothing else')
  v = await verify('﻿' + L.text)
  brokenAt(v, 1, ['bom'], 'byte order mark')
  const bytes = Buffer.from(L.text)
  const i = bytes.indexOf('injection-01.bin')
  bytes[i] = 0xff
  v = await IQC.verifyLedger(new Uint8Array(bytes))
  const ln = L.text.slice(0, i).split('\n').length
  brokenAt(v, ln, ['not-utf8'], 'invalid UTF-8')
  v = await verify('')
  assert.equal(v.ok, false)
  assert.deepEqual(v.problems.map((p) => p.code), ['empty'])
  assert.equal(v.head, null)
  lines = L.lines.slice(); lines[4] = '{"n":4,'
  v = await verify(lines)
  brokenAt(v, 5, ['json'], 'not JSON')
  assert.equal(v.problems.length, 1, 'the next record is not blamed for the unreadable one')
  lines = L.lines.slice(); lines[4] = '[1,2]'
  v = await verify(lines)
  brokenAt(v, 5, ['not-object'], 'not an object')
  v = await verify(L.lines.slice(1))
  brokenAt(v, 1, ['header-missing'], 'header missing')
})

test('verify reports every problem, not only the first', async () => {
  const lines = editLine(editLine(editLine(L.lines, 4, (o) => { o.f.bytes = '1' }), 9, (o) => { o.f.value = '9999' }), 12, (o) => { o.sig = L.records[0].sig })
  const v = await verify(lines)
  assert.deepEqual(v.problems.map((p) => [p.line, p.code]), [[4, 'r'], [9, 'r'], [12, 'sig']])
  assert.equal(v.goodCount, 2)
  assert.equal(v.files.size, 1, 'state only from records 1 and 2')
})

test('a header-only ledger has head {n: 0, h: g}; createHeader validates', async () => {
  const kp = await testKey()
  const pk = await IQC.publicKeyHex(kp.publicKey)
  const h = await IQC.createHeader({ station: 'Browser', privateKey: kp.privateKey, publicKey: kp.publicKey, agent: 'immutableqc-app/0.1.0' })
  assert.match(h.ledgerId, /^[0-9a-f]{32}$/)
  assert.ok(IQC.isTime(h.createdAt))
  const v = await IQC.verifyLedger(IQC.serializeLine(h))
  assert.equal(v.ok, true)
  assert.deepEqual(v.head, { n: 0, h: h.g })
  assert.ok(IQC.isFirstScan(v))
  await assert.rejects(IQC.createHeader({ station: '', privateKey: kp.privateKey, publicKeyHex: pk }), /station/)
  await assert.rejects(IQC.createHeader({ station: 'x'.repeat(65), privateKey: kp.privateKey, publicKeyHex: pk }), /station/)
  assert.ok(await IQC.createHeader({ station: '𝄞'.repeat(64), privateKey: kp.privateKey, publicKeyHex: pk }), '64 characters, counted as code points')
  const other = await IQC.generateKeyPair()
  await assert.rejects(IQC.createHeader({ station: 'PC', privateKey: other.privateKey, publicKeyHex: pk }), /does not belong/)
  await assert.rejects(IQC.createRecord({ n: 1, prev: h.g, kind: 'file', f: { station: 'PC' }, privateKey: kp.privateKey }), /Not a valid file record/)
  await assert.rejects(IQC.createRecord({ n: 1, prev: h.g, ...sessionItem('paused', 1), privateKey: kp.privateKey }), /event/)
  assert.throws(() => IQC.canonicalJSON({ n: 1, kind: 'file', extra: 1 }), /Unknown record key/)
})

test('a ledger with a key holder rewriting history still verifies (only a pinned head exposes it)', async () => {
  const items = fullItems()
  items[2] = fileItem('run-0914/raw/injection-01.bin', 'rewritten', 'existing', 3)
  const R = await build(items, { key: L.key })
  const v = await verify(R.text)
  assert.equal(v.ok, true)
  assert.notEqual(v.head.h, L.records[12].h)
})

test('records and sessions: unclean stop, stray stop, gaps, sessions with no files', async () => {
  const R = await build([
    sessionItem('watch-started', 1), fileItem('a.csv', 'a', 'existing', 2),
    sessionItem('watch-started', 50), fileItem('b.csv', 'b', 'added', 51), sessionItem('watch-stopped', 60),
    sessionItem('watch-stopped', 61),
    sessionItem('scan', 100),
    sessionItem('watch-started', 200),
  ])
  const v = await verify(R.text)
  assert.equal(v.ok, true)
  const s = v.sessions
  assert.deepEqual(s.map((x) => [x.type, x.startN, x.stopN, x.clean, x.open, x.endedByN, !!x.stray]), [
    ['watch', 1, null, false, false, 3, false],
    ['watch', 3, 5, true, false, null, false],
    ['watch', null, 6, false, false, null, true],
    ['scan', 7, null, true, false, null, false],
    ['watch', 8, null, null, true, null, false],
  ])
  assert.deepEqual(v.gaps.map((g) => [g.afterN, g.beforeN, g.from, g.to]), [[2, 3, T(2), T(50)], [5, 7, T(60), T(100)], [7, 8, T(100), T(200)]])
  assert.equal(IQC.isFirstScan(v), false)
})

test('isFirstScan: only before any file record, stop, or second session', async () => {
  const one = await verify((await build([sessionItem('scan', 1)])).text)
  assert.equal(IQC.isFirstScan(one), true)
  const two = await verify((await build([sessionItem('scan', 1), sessionItem('scan', 2)])).text)
  assert.equal(IQC.isFirstScan(two), false)
  const stopped = await verify((await build([sessionItem('watch-started', 1), sessionItem('watch-stopped', 2)])).text)
  assert.equal(IQC.isFirstScan(stopped), false)
  const withFile = await verify((await build([fileItem('a', 'a', 'existing', 1)])).text)
  assert.equal(IQC.isFirstScan(withFile), false)
})

test('parseLedger reads structure only', () => {
  const p = IQC.parseLedger(L.text)
  assert.equal(p.lines.length, 14)
  assert.equal(p.header.keyId, L.header.keyId)
  assert.equal(p.records.length, 13)
  assert.deepEqual(p.problems, [])
})

test('verifyLedger reports progress for the signature checks', async () => {
  const seen = []
  await IQC.verifyLedger(L.text, { onProgress: (d, t) => seen.push([d, t]), concurrency: 3 })
  assert.deepEqual(seen[0], [0, 13])
  assert.deepEqual(seen[seen.length - 1], [13, 13])
})

test('verifyBatch: signature checks handed out in batches give the same answers; a failing batch is "could not be checked"', async () => {
  const lines = editLine(editLine(L.lines, 7, (o) => { o.sig = L.records[0].sig }), 11, (o) => { o.h = flip(o.h) })
  const plain = await verify(lines)
  const calls = []
  const viaBatch = await IQC.verifyLedger(joinLines(lines), { batchSize: 4, concurrency: 2, verifyBatch: (pub, items) => { calls.push(items.length); return IQC.verifyLinks(pub, items) } })
  assert.deepEqual(viaBatch.problems, plain.problems)
  assert.deepEqual(viaBatch.head, plain.head)
  assert.deepEqual(calls, [4, 4, 4, 1])
  const good = await IQC.verifyLedger(L.text, { verifyBatch: (pub, items) => IQC.verifyLinks(pub, items) })
  assert.equal(good.ok, true)
  const thrown = await IQC.verifyLedger(L.text, { batchSize: 5, verifyBatch: async (pub, items) => { if (items.length === 5) throw new Error('worker gone'); return IQC.verifyLinks(pub, items) } })
  assert.deepEqual(thrown.problems.map((p) => [p.line, p.code]), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((l) => [l, 'sig-error']))
  assert.match(thrown.problems[0].message, /could not be checked/)
  const short = await IQC.verifyLedger(L.text, { verifyBatch: async () => [true] })
  assert.equal(short.problems.length, 13)
  assert.ok(short.problems.every((p) => p.code === 'sig-error'))
  const progress = []
  await IQC.verifyLedger(L.text, { batchSize: 3, verifyBatch: (pub, items) => IQC.verifyLinks(pub, items), onProgress: (d, t) => progress.push([d, t]) })
  assert.deepEqual(progress[progress.length - 1], [13, 13])
  // verifyLinks: false for a high-S or malformed signature, in order
  const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551')
  const r = L.records[0]
  const hi = r.sig.slice(0, 64) + (N - BigInt('0x' + r.sig.slice(64))).toString(16).padStart(64, '0')
  assert.deepEqual(await IQC.verifyLinks(L.pk, [{ h: r.h, sig: r.sig }, { h: r.h, sig: hi }, { h: r.h, sig: 'x' }, { h: L.records[1].h, sig: r.sig }]), [true, false, false, false])
})
