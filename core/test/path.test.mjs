import test from 'node:test'
import assert from 'node:assert/strict'
import { encodePath, decodePath, validatePath, isLedgerFolderPath, ignoreMatcher, isTime, isReadingTime, isSealedText } from '../immutableqc.mjs'

test('paths: encode and decode round trip, with %, |, newline and other control characters', () => {
  const cases = [
    ['QC/run-0914/injection-06.csv', 'QC/run-0914/injection-06.csv'],
    ['50% B.csv', '50%25 B.csv'],
    ['a|b.txt', 'a%7Cb.txt'],
    ['line\nbreak.txt', 'line%0Abreak.txt'],
    ['tab\there/x\u0000y\u001f\u007f', 'tab%09here/x%00y%1F%7F'],
    ['%25 literal', '%2525 literal'],
    ['spaces and (parens) & [brackets] #hash ?q=1 +plus', 'spaces and (parens) & [brackets] #hash ?q=1 +plus'],
    ['back\\slash', 'back\\slash'],
    ['日本語/データ.csv', '日本語/データ.csv'],
    ['.hidden/..dots/...', '.hidden/..dots/...'],
  ]
  for (const [raw, enc] of cases) {
    assert.equal(encodePath(raw), enc, raw)
    assert.equal(validatePath(enc), null, enc)
    assert.equal(decodePath(enc), raw.normalize('NFC'), enc)
    assert.equal(encodePath(decodePath(enc)), enc)
  }
})

test('paths: NFD input is stored as NFC; an NFD stored path is refused', () => {
  const nfd = 'Méthode/résultat.csv'
  const nfc = 'Méthode/résultat.csv'
  assert.notEqual(nfd, nfc)
  assert.equal(encodePath(nfd), nfc)
  assert.equal(encodePath(nfc), nfc)
  assert.equal(decodePath(nfc), nfc)
  assert.match(validatePath(nfd), /NFC/)
  // a combining mark after an encoded control character is checked on the decoded text
  assert.equal(validatePath('x%0Á'), null)
})

test('paths: refuse "..", ".", empty segments, a leading "/" and bad escapes', () => {
  for (const bad of ['', '/abs.csv', 'a//b', 'a/', '../up.csv', 'a/../b', './a', 'a/./b', '.', '..']) {
    assert.throws(() => encodePath(bad), /Not a valid relative path/, JSON.stringify(bad))
    assert.notEqual(validatePath(bad), null, JSON.stringify(bad))
    assert.throws(() => decodePath(bad), /Not a valid encoded path/)
  }
  assert.match(validatePath('a|b'), /percent-encoded/)
  assert.match(validatePath('a\nb'), /percent-encoded/)
  assert.match(validatePath('a%7cb'), /two uppercase hex/)
  assert.match(validatePath('a%41b'), /written as itself/)
  assert.match(validatePath('a%2'), /two uppercase hex/)
  assert.match(validatePath('a%2E%2E'), /written as itself/)
  assert.match(validatePath('\ud800x'), /lone surrogate/)
  assert.throws(() => encodePath('\udc00'), /lone surrogate/)
  assert.throws(() => encodePath(42), TypeError)
})

test('paths: the root ImmutableQC folder and the ignore rules', () => {
  assert.ok(isLedgerFolderPath('ImmutableQC/ledger.jsonl'))
  assert.ok(isLedgerFolderPath('ImmutableQC'))
  assert.ok(!isLedgerFolderPath('data/ImmutableQC/ledger.jsonl'))
  assert.ok(!isLedgerFolderPath('ImmutableQC2/x'))
  const ig = ignoreMatcher(['*.bak', 'scratch/*.csv', 'cache'])
  for (const p of ['.DS_Store', 'run/.DS_Store', 'Thumbs.db', 'thumbs.db', 'desktop.ini', 'run/~$report.docx', 'x.tmp', 'run/X.TMP', 'a.bak', 'scratch/a.csv', 'cache/x/y.csv', 'run/cache/z']) assert.ok(ig(p), p)
  for (const p of ['run/data.csv', 'x.tmp.csv', 'scratch/sub/a.csv', 'other/scratch/a.csv', 'cached/x', 'report~$.docx']) assert.ok(!ig(p), p)
  assert.ok(ignoreMatcher(['50%*'])('50%25 B.csv'), 'matched on the decoded path')
})

test('text rules: times, reading times, sealed text', () => {
  assert.ok(isTime('2026-10-13T14:02:11.123Z'))
  assert.ok(isTime(new Date().toISOString()))
  for (const t of ['2026-10-13T14:02:11Z', '2026-10-13T14:02:11.12Z', '2026-02-30T00:00:00.000Z', '2026-13-01T00:00:00.000Z', '2026-10-13 14:02:11.123Z', '2026-10-13T14:02:11.123+00:00', '2026-10-13T24:00:00.000Z', 20261013]) assert.ok(!isTime(t), String(t))
  assert.ok(isReadingTime('2026-10-01T08:15:00Z'))
  assert.ok(isReadingTime('2026-10-01T08:15:00.250Z'))
  assert.ok(!isReadingTime('2026-02-29T08:15:00Z'))
  assert.ok(isSealedText('plain text, with spaces; and ünïcödé'))
  for (const s of ['a|b', 'a\nb', 'a\u007fb', 'a\u0000', '\ud83d', 1]) assert.ok(!isSealedText(s), JSON.stringify(s))
  assert.ok(isSealedText('emoji 😀'))
})
