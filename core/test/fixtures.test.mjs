import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as IQC from '../immutableqc.mjs'
import { FIXTURES, readFolder, expectedFor, checkFixtures } from './make-fixtures.mjs'

const expected = JSON.parse(readFileSync(join(FIXTURES, 'expected.json'), 'utf8'))
const key = JSON.parse(readFileSync(join(FIXTURES, 'test-key.DO-NOT-USE.jwk'), 'utf8'))

test('fixtures: each committed variant verifies and audits to expected.json', async () => {
  assert.deepEqual(Object.keys(expected.variants), ['sample', 'tampered-file', 'tampered-ledger'])
  for (const [name, want] of Object.entries(expected.variants)) {
    const got = await expectedFor(join(FIXTURES, want.folder))
    assert.deepEqual(got, want, name)
  }
})

test('fixtures: what the variants show, checked by hand', async () => {
  const S = expected.variants.sample, F = expected.variants['tampered-file'], L = expected.variants['tampered-ledger']
  assert.equal(S.verdict, 'pass')
  assert.equal(S.records, 12)
  assert.equal(S.head.n, 12)
  assert.equal(S.keyId, IQC.keyIdOf(IQC.publicKeyHexOfJwk(key)), 'signed by the test key')
  assert.deepEqual(S.problems, [])
  assert.equal(S.files['run-0914/méthode 50%25.txt'].state, 'match', 'an NFC path with "%" encoded as %25')
  assert.equal(S.files['run-0914/scratch.csv'].state, 'removed')
  assert.equal(F.verdict, 'fail')
  assert.deepEqual(F.head, S.head, 'same ledger')
  assert.deepEqual([F.files['run-0914/injection-02.csv'].state, F.files['instrument.log'].state, F.files['instrument.log'].matchesN, F.files['run-0914/raw/injection-01.dat'].state, F.files['run-0914/injection-03.csv'].state], ['changed', 'changed', 2, 'missing', 'not sealed'])
  assert.equal(L.verdict, 'fail')
  assert.deepEqual(L.problems, [{ line: 8, code: 'r' }])
  assert.deepEqual(L.head, { n: 6, h: JSON.parse(readFileSync(join(FIXTURES, 'sample/ImmutableQC/ledger.jsonl'), 'utf8').split('\n')[6]).h })
  assert.equal(L.files['run-0914/injection-02.csv'].state, 'not sealed', 'its record is after the first problem')
  // the binary file holds bytes that are not UTF-8
  const bin = readFileSync(join(FIXTURES, 'sample/run-0914/raw/injection-01.dat'))
  assert.ok(bin.includes(0xff) && bin.includes(0x00))
  assert.throws(() => new TextDecoder('utf-8', { fatal: true }).decode(bin))
  // the ImmutableQC folder is in the data folder but never in the file states
  assert.ok(readFolder(join(FIXTURES, 'sample')).has('ImmutableQC/README.txt'))
  assert.ok(!Object.keys(S.files).some((p) => p.startsWith('ImmutableQC/')))
})

test('fixtures: the test key loads and still signs for the fixture ledger', async () => {
  const k = await IQC.importPrivateJwk(key)
  const pub = JSON.parse(readFileSync(join(FIXTURES, 'sample/ImmutableQC/ledger.jsonl'), 'utf8').split('\n')[0]).publicKey
  assert.ok(await IQC.keyMatches(k, pub))
})

test('fixtures: up to date with make-fixtures.mjs (signatures aside)', async () => {
  const errors = []
  const orig = console.error
  console.error = (...a) => errors.push(a.join(' '))
  try { assert.equal(await checkFixtures(), 0, errors.join('\n')) } finally { console.error = orig }
})

test('fixtures: the sample ledger follows the spec formulas, recomputed with node:crypto alone', async () => {
  const { createHash, createPublicKey, verify } = await import('node:crypto')
  const H = (s) => createHash('sha256').update(s).digest('hex')
  const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551')
  const lines = readFileSync(join(FIXTURES, 'sample/ImmutableQC/ledger.jsonl'), 'utf8').split('\n')
  assert.equal(lines.pop(), '', 'ends with a newline')
  const hd = JSON.parse(lines[0])
  const pub = Buffer.from(hd.publicKey, 'hex')
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' })
  const sigOk = (h, sig) => BigInt('0x' + sig.slice(64)) * 2n < N && verify('sha256', Buffer.from(h, 'hex'), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'hex'))
  assert.equal(hd.keyId, H(pub).slice(0, 16))
  assert.equal(hd.g, H(`immutableqc-ledger-v1|${hd.ledgerId}|${hd.createdAt}|${hd.station}|${hd.alg}|${hd.publicKey}`))
  assert.ok(sigOk(hd.g, hd.sig))
  const TAG = { file: 'iqc-file-v1', 'file-removed': 'iqc-file-removed-v1', session: 'iqc-session-v1' }
  let prev = hd.g
  for (let i = 1; i < lines.length; i++) {
    const o = JSON.parse(lines[i])
    assert.equal(lines[i], JSON.stringify(o), `line ${i + 1} is JSON.stringify of itself`)
    assert.equal(o.n, i)
    assert.equal(o.r, H([TAG[o.kind], ...Object.values(o.f)].join('|')), `r of record ${o.n}`)
    assert.equal(o.prev, prev)
    assert.equal(o.h, H(prev + o.r + String(o.n)), `h of record ${o.n}`)
    assert.ok(sigOk(o.h, o.sig), `signature of record ${o.n} over its link`)
    prev = o.h
  }
  assert.equal(`${lines.length - 1}:${prev}`, expected.variants.sample.headString)
})
