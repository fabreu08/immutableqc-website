import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { Sha256, sha256Hex, toHex, fromHex } from '../immutableqc.mjs'

const ref = (b) => createHash('sha256').update(b).digest('hex')

test('SHA-256: NIST FIPS 180-4 example vectors', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
  assert.equal(sha256Hex('abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu'), 'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1')
})

test('SHA-256: one million "a" (whole, and in 1000-byte updates)', () => {
  const m = new Uint8Array(1_000_000).fill(0x61)
  const want = 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'
  assert.equal(sha256Hex(m), want)
  const h = new Sha256()
  for (let i = 0; i < 1000; i++) h.update(m.subarray(i * 1000, (i + 1) * 1000))
  assert.equal(h.hex(), want)
})

test('SHA-256: strings are hashed as UTF-8', () => {
  for (const s of ['é', 'Ω≈ç√', '𝄞 clef', 'naïve café', '日本語']) assert.equal(sha256Hex(s), ref(Buffer.from(s, 'utf8')))
})

test('SHA-256: every message length from 0 to 300 bytes, including the padding edges 55, 56, 63, 64, 65', () => {
  const data = randomBytes(300)
  for (let L = 0; L <= 300; L++) assert.equal(sha256Hex(data.subarray(0, L)), ref(data.subarray(0, L)), `length ${L}`)
})

test('SHA-256: incremental updates at many slice sizes match node:crypto', () => {
  const sizes = [1, 2, 3, 5, 7, 8, 13, 31, 32, 33, 55, 56, 57, 63, 64, 65, 100, 127, 128, 129, 191, 192, 193, 1000, 4096, 65535, 65536, 65537]
  const lengths = [0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 70_000, 300_001]
  for (const L of lengths) {
    const data = randomBytes(L)
    const want = ref(data)
    for (const s of sizes) {
      const h = new Sha256()
      for (let i = 0; i < L; i += s) h.update(data.subarray(i, Math.min(L, i + s)))
      assert.equal(h.hex(), want, `length ${L}, slices of ${s}`)
    }
    // random slice sizes, including empty updates
    const h = new Sha256()
    let i = 0
    while (i < L) { const s = Math.floor(Math.random() * 200); h.update(data.subarray(i, i + s)); i += s }
    h.update(new Uint8Array(0))
    assert.equal(h.hex(), want, `length ${L}, random slices`)
  }
})

test('SHA-256: accepts ArrayBuffer, typed-array views and Buffer; finishes once', () => {
  const data = randomBytes(1000)
  const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  assert.equal(new Sha256().update(ab).hex(), ref(data))
  assert.equal(new Sha256().update(new DataView(ab, 10, 500)).hex(), ref(data.subarray(10, 510)))
  assert.equal(new Sha256().update(data).hex(), ref(data))
  const h = new Sha256().update('abc')
  assert.equal(h.hex(), h.hex())
  assert.deepEqual(h.digest(), new Uint8Array(fromHex(h.hex())))
  assert.throws(() => h.update('more'), /already finished/)
  assert.throws(() => new Sha256().update(42), TypeError)
})

test('hex helpers: round trip, lowercase only', () => {
  const b = randomBytes(64)
  assert.equal(toHex(b), b.toString('hex'))
  assert.deepEqual(Buffer.from(fromHex(b.toString('hex'))), b)
  assert.throws(() => fromHex('ABCD'))
  assert.throws(() => fromHex('abc'))
})
