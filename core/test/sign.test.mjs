import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createPublicKey, verify as nodeVerify } from 'node:crypto'
import * as IQC from '../immutableqc.mjs'

const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551')
const twin = (sig) => sig.slice(0, 64) + (N - BigInt('0x' + sig.slice(64))).toString(16).padStart(64, '0')
const nodeKey = (pub) => createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: Buffer.from(pub.slice(2, 66), 'hex').toString('base64url'), y: Buffer.from(pub.slice(66), 'hex').toString('base64url') }, format: 'jwk' })
const nodeOk = (pub, h, sig) => nodeVerify('sha256', Buffer.from(h, 'hex'), { key: nodeKey(pub), dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'hex'))

test('keys: public key hex, key id, JWK round trip', async () => {
  const kp = await IQC.generateKeyPair({ extractable: true })
  const pub = await IQC.publicKeyHex(kp.publicKey)
  assert.match(pub, /^04[0-9a-f]{128}$/)
  assert.equal(IQC.keyIdOf(pub), createHash('sha256').update(Buffer.from(pub, 'hex')).digest('hex').slice(0, 16))
  const jwk = await IQC.exportPrivateJwk(kp.privateKey)
  assert.equal(IQC.publicKeyHexOfJwk(jwk), pub)
  const k2 = await IQC.importPrivateJwk(jwk)
  assert.equal(k2.extractable, false)
  const h = IQC.sha256Hex('link')
  assert.ok(await IQC.verifyLink(pub, h, await IQC.signLink(k2, h)))
  assert.ok(await IQC.keyMatches(k2, pub))
  const other = await IQC.generateKeyPair()
  assert.equal(other.privateKey.extractable, false)
  assert.equal(await IQC.keyMatches(other.privateKey, pub), false)
  await assert.rejects(IQC.importPublicKeyHex('04' + '00'.repeat(64)))
  await assert.rejects(IQC.importPublicKeyHex(pub.toUpperCase()), /130 lowercase hex/)
  await assert.rejects(IQC.importPrivateJwk({ kty: 'RSA' }), /P-256/)
})

test('signatures: sign and verify the link; another link, key or signature fails', async () => {
  const kp = await IQC.generateKeyPair()
  const pub = await IQC.publicKeyHex(kp.publicKey)
  const h = IQC.sha256Hex('record link')
  const sig = await IQC.signLink(kp.privateKey, h)
  assert.match(sig, /^[0-9a-f]{128}$/)
  assert.ok(await IQC.verifyLink(kp.publicKey, h, sig))
  assert.ok(await IQC.verifyLink(pub, h, sig))
  assert.ok(nodeOk(pub, h, sig), 'node:crypto agrees (ECDSA P-256, SHA-256, P1363)')
  assert.equal(await IQC.verifyLink(pub, IQC.sha256Hex('other link'), sig), false)
  const other = await IQC.generateKeyPair()
  assert.equal(await IQC.verifyLink(other.publicKey, h, sig), false)
  const bad = sig.slice(0, 10) + (sig[10] === '0' ? '1' : '0') + sig.slice(11)
  assert.equal(await IQC.verifyLink(pub, h, bad), false)
  assert.equal(await IQC.verifyLink(pub, h, 'zz'), false)
  await assert.rejects(IQC.signLink(kp.privateKey, 'abc'), /64 lowercase hex/)
})

test('signatures: always low-S; the high-S twin verifies elsewhere but is refused here', async () => {
  const kp = await IQC.generateKeyPair()
  const pub = await IQC.publicKeyHex(kp.publicKey)
  let rawHigh = 0
  for (let i = 0; i < 48; i++) {
    const h = IQC.sha256Hex(`link ${i}`)
    // what the platform returns before normalization: about half are high-S
    const raw = IQC.toHex(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, IQC.fromHex(h))))
    if (IQC.sigProblem(raw) === 'high-s') {
      rawHigh++
      assert.equal(IQC.normalizeLowS(raw), twin(raw))
      assert.ok(await IQC.verifyLink(pub, h, IQC.normalizeLowS(raw)), 'the normalized form verifies')
    }
    const sig = await IQC.signLink(kp.privateKey, h)
    assert.ok(IQC.isLowS(sig))
    assert.equal(IQC.sigProblem(sig), null)
    const hi = twin(sig)
    assert.equal(IQC.sigProblem(hi), 'high-s')
    assert.ok(nodeOk(pub, h, hi), 'the high-S twin is a valid ECDSA signature for node:crypto')
    assert.equal(await IQC.verifyLink(pub, h, hi), false, 'but verifyLink refuses it')
    assert.equal(IQC.normalizeLowS(hi), sig)
  }
  assert.ok(rawHigh > 0, 'some raw signatures were high-S, so normalization was exercised')
})

test('signatures: r or s of zero or not below the order is out of range', () => {
  const s1 = '00'.repeat(31) + '01'
  assert.equal(IQC.sigProblem('00'.repeat(32) + s1), 'range')
  assert.equal(IQC.sigProblem(s1 + '00'.repeat(32)), 'range')
  assert.equal(IQC.sigProblem(N.toString(16) + s1), 'range')
  assert.equal(IQC.sigProblem(s1 + s1), null)
  assert.equal(IQC.sigProblem('AB'.repeat(64)), 'form')
  assert.equal(IQC.sigProblem(undefined), 'form')
})
