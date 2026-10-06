#!/usr/bin/env node
// build.mjs · Immutable QC, prototype B "Controlled document". Node 20+, no dependencies, nothing at runtime.
//   node build/build.mjs            compute, sign if needed, assert, render, write, lint
//   node build/build.mjs --resign   sign with a fresh demo key (its private key is never written anywhere). Needed
//                                   whenever the sequence changes: the build refuses to re-sign changed data silently.
// Renders proposals/b/*.html from build/partials + build/pages + build/data, writes assets/ from build/src/.
// Every hash and number in the HTML is computed here, cross-checked three ways (node:crypto, the pure-JS SHA-256 the
// page falls back to, and the page's own replay() run on Node's WebCrypto), and the written pages are linted.
import { createHash, generateKeyPairSync, sign, verify, createPublicKey, webcrypto } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url)), OUT = join(HERE, '..')
const J = '/home/user/neodimiun/neodimiun.github.io/site/fonts' // joseqc.com fonts, compared byte-for-byte when present
const rd = (p) => readFileSync(join(HERE, p), 'utf8')
const H = (s) => createHash('sha256').update(s, 'utf8').digest('hex')
const sha8 = (b) => createHash('sha256').update(b).digest('hex').slice(0, 8)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const RESIGN = process.argv.includes('--resign')

let passed = 0
const failed = []
const ok = (name, cond) => { if (cond) passed++; else failed.push(name) }
const eq = (name, a, b) => ok(`${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`, a === b)
const die = () => { if (failed.length) { console.error(`\n${failed.length} assertion(s) failed:\n  ` + failed.join('\n  ')); process.exit(1) } }

// ------------------------------------------------------------------------------------------------ 1. data
const site = JSON.parse(rd('data/site.json')), SEQ = JSON.parse(rd('data/sequence.json'))
const C = site.copy
const N = SEQ.records.length, AN = N, SN = SEQ.showcase
const recs = SEQ.records.map((x, i) => ({
  n: i + 1,
  f: { instrumentId: SEQ.instrumentId, sensorType: SEQ.sensorType, value: x.value, unit: SEQ.unit, capturedAt: x.capturedAt },
  ctx: { inj: x.inj, kind: x.kind, sample: x.sample, desc: x.desc, prep: x.desc.split(', ').pop(), rt: x.rt },
}))
ok('data: every description ends in its preparation or replicate, which the pages print', recs.every((x) => /^(preparation|replicate) \d$/.test(x.ctx.prep) && (x.ctx.kind === 'Sample') === x.ctx.prep.startsWith('preparation')))
eq('data: 8 records', N, 8)
eq('data: 5 system-suitability injections', SEQ.records.filter((x) => x.kind === 'SST').length, 5)
eq('data: 3 sample injections', SEQ.records.filter((x) => x.kind === 'Sample').length, 3)
ok('data: peak areas are integers in counts', SEQ.records.every((x) => /^[1-9]\d{5,7}$/.test(x.value)) && SEQ.unit === 'counts')
ok('data: sensorType hplc, instrument HPLC-02', SEQ.sensorType === 'hplc' && SEQ.instrumentId === 'HPLC-02')
ok('data: capturedAt is ISO-8601 UTC, in 2026', SEQ.records.every((x) => /^2026-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(x.capturedAt) && !Number.isNaN(Date.parse(x.capturedAt))))
const gaps = SEQ.records.slice(1).map((x, i) => (Date.parse(x.capturedAt) - Date.parse(SEQ.records[i].capturedAt)) / 60000)
ok(`data: injections a few minutes apart (${gaps.map((g) => g.toFixed(1)).join(', ')} min)`, gaps.every((g) => g >= 5 && g <= 10))
ok('data: injection cycle near-constant with irregular jitter, not an alternating pattern', (() => { const s = gaps.map((g) => Math.round(g * 60)); return Math.max(...s) - Math.min(...s) <= 4 && new Set(s).size >= 3 && !s.every((v, i) => i < 2 || v === s[i - 2]) })())
ok('data: injection numbers 01..08 in order', SEQ.records.every((x, i) => x.inj === String(i + 1).padStart(2, '0')))
ok('data: retention times plausible (4.7-4.9 min)', SEQ.records.every((x) => +x.rt >= 4.7 && +x.rt <= 4.9))
// system suitability: replicate standard injections, peak-area RSD (n-1)
const sst = SEQ.records.filter((x) => x.kind === 'SST').map((x) => +x.value)
const mean = sst.reduce((a, b) => a + b, 0) / sst.length
const sd = Math.sqrt(sst.reduce((a, b) => a + (b - mean) ** 2, 0) / (sst.length - 1))
const rsd = (100 * sd) / mean
ok(`data: SST peak-area RSD ${rsd.toFixed(2)}% is within 2.0%`, rsd <= 2.0)
eq('data: SST mean', Math.round(mean), 1523602)
eq('data: SST RSD shown', rsd.toFixed(2), '0.20')
const smp = SEQ.records.filter((x) => x.kind === 'Sample').map((x) => (100 * +x.value) / mean)
ok(`data: samples within 98-102% of the standard mean (${smp.map((v) => v.toFixed(1)).join(', ')})`, smp.every((v) => v >= 98 && v <= 102))

// ------------------------------------------------------------------------------------------------ 2. chain
const ZERO = '0'.repeat(64)
const payload = (f) => [f.instrumentId, f.sensorType, f.value, f.unit, f.capturedAt].join('|')
{
  let prev = ZERO
  for (const x of recs) { x.p = payload(x.f); x.r = H(x.p); x.prev = prev; x.h = H(prev + x.r + String(x.n)); prev = x.h }
}
const anchor = recs[AN - 1].h
eq('chain: payload of record 1', recs[0].p, 'HPLC-02|hplc|1523847|counts|2026-09-14T08:12:41Z')
ok('chain: every payload 48 bytes, ASCII', recs.every((x) => Buffer.byteLength(x.p) === 48 && /^[\x20-\x7e]+$/.test(x.p)))
ok('chain: every record links the one before', recs.every((x, i) => x.prev === (i ? recs[i - 1].h : ZERO)))
ok('chain: all fingerprints and links distinct', new Set(recs.flatMap((x) => [x.r, x.h])).size === 2 * N)
// cross-check 1: the pure-JS SHA-256 the page loads where crypto.subtle is missing (joseqc sha256.js, byte-for-byte)
const { sha256: pure } = await import(pathToFileURL(join(HERE, 'src/sha256.js')).href)
ok('cross-check: pure-JS SHA-256 gives every r and h', recs.every((x) => pure(x.p) === x.r && pure(x.prev + x.r + String(x.n)) === x.h))
eq('cross-check: pure-JS SHA-256 of "abc" (FIPS 180-4 example)', pure('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
eq('cross-check: SHA-256 of "" (FIPS 180-4)', H(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
// cross-check 2: the page's own replay(), run here on Node's WebCrypto
if (!globalThis.crypto) globalThis.crypto = webcrypto
const IQC = await import(pathToFileURL(join(HERE, 'src/iqc.js')).href)
const E = await IQC.engine(pure)
ok('cross-check: iqc.js engine uses WebCrypto here', !!E.S)
{
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext')
  Object.defineProperty(globalThis, 'isSecureContext', { value: false, configurable: true })
  const F = await IQC.engine(pure)
  if (saved) Object.defineProperty(globalThis, 'isSecureContext', saved); else delete globalThis.isSecureContext
  const rows = await IQC.replay(F, recs, async () => null)
  ok('cross-check: the no-WebCrypto engine (pure-JS SHA-256) replays every r and h, signatures not checked', !F.S && rows.every((o, i) => o.rp === recs[i].r && o.hp === recs[i].h && o.sig === null && o.ok))
}
{
  const rows = await IQC.replay(E, recs, async () => true)
  ok('cross-check: iqc.js replay() reproduces every r and h', rows.every((o, i) => o.rp === recs[i].r && o.hp === recs[i].h && o.ok))
  // the three behaviours, on Node, with the page's code: edit, rewrite, correct
  const k = 3, alt = recs.map((x) => ({ ...x, f: { ...x.f } }))
  alt[k - 1].f.value = String(+alt[k - 1].f.value + 9)
  const sigBuilt = (x, rp) => rp === recs[x.n - 1]?.r // a signature covers only the fingerprint it was made over
  const e1 = await IQC.replay(E, alt, async (x, rp) => sigBuilt(x, rp))
  ok('behaviour, edit: that record fails fingerprint, signature and link', !e1[k - 1].fp && e1[k - 1].sig === false && !e1[k - 1].link)
  ok('behaviour, edit: the link to the next record breaks, and every later one', e1.slice(k).every((o) => o.fp && o.sig && !o.link))
  ok('behaviour, edit: records before it still verify', e1.slice(0, k - 1).every((o) => o.ok))
  ok('behaviour, edit: replayed link of record 8 no longer matches the anchor', e1[AN - 1].hp !== anchor)
  for (const o of e1.slice(k - 1)) { o.x.r = o.rp; o.x.prev = o.pp; o.x.h = o.hp }
  const e2 = await IQC.replay(E, alt, async (x, rp) => sigBuilt(x, rp))
  ok('behaviour, rewrite: chain internally consistent again', e2.every((o) => o.fp && o.link))
  ok('behaviour, rewrite: the edited record still fails its signature', e2[k - 1].sig === false && e2.filter((o) => !o.ok).length === 1)
  ok('behaviour, rewrite: new head no longer matches the anchored fingerprint', e2[AN - 1].hp !== anchor)
  const c = recs.map((x) => ({ ...x, f: { ...x.f } }))
  const cf = { ...c[k - 1].f, value: String(+c[k - 1].f.value + 9) }, cr = H(payload(cf))
  c.push({ n: N + 1, f: cf, r: cr, prev: anchor, h: H(anchor + cr + String(N + 1)) })
  const e3 = await IQC.replay(E, c, async () => true)
  ok('behaviour, correct: chain intact with the correction appended', e3.every((o) => o.ok))
  ok('behaviour, correct: records 1-8 still match the anchor; head moved on', e3[AN - 1].hp === anchor && e3[N].hp !== anchor)
}
// ------------------------------------------------------------------------------------------------ 3. signatures
// signed.json holds the public key and one signature per record, never a private key. It is reused while every
// fingerprint and signature still verifies; otherwise (or with --resign) a fresh key signs and is then dropped.
const SIGNED = join(HERE, 'data/signed.json')
const pubFromHex = (hex) => createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: Buffer.from(hex.slice(2, 66), 'hex').toString('base64url'), y: Buffer.from(hex.slice(66), 'hex').toString('base64url') }, format: 'jwk' })
const sigOk = (pub, sig, r) => verify('sha256', Buffer.from(r, 'hex'), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'hex'))
let signed = existsSync(SIGNED) ? JSON.parse(readFileSync(SIGNED, 'utf8')) : null
const usable = signed && signed.sigs.length === N && signed.sigs.every((s, i) => s.r === recs[i].r && sigOk(pubFromHex(signed.pub), s.sig, s.r))
if (signed && !usable && !RESIGN) {
  // re-signing changed data is the rewrite-and-re-sign pattern the site warns about: never do it without being asked
  console.error('signed.json no longer covers the sequence data (a record changed). Re-sign on purpose with: node build/build.mjs --resign')
  process.exit(1)
}
if (!signed || RESIGN) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = publicKey.export({ format: 'jwk' })
  const pub = '04' + Buffer.from(jwk.x, 'base64url').toString('hex').padStart(64, '0') + Buffer.from(jwk.y, 'base64url').toString('hex').padStart(64, '0')
  const sigs = recs.map((x) => ({ n: x.n, r: x.r, sig: sign('sha256', Buffer.from(x.r, 'hex'), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('hex') }))
  signed = { _note: 'Demo signatures over r_n (ECDSA P-256, SHA-256, IEEE P1363 hex). Written by build.mjs; the private key was never written and was discarded.', pub, sigs }
  writeFileSync(SIGNED, JSON.stringify(signed, null, 1) + '\n')
  console.log(`signed.json written with a fresh demo key ${pub.slice(0, 10)}… (private key discarded)`)
}
const PUB = signed.pub, pubKey = pubFromHex(PUB)
recs.forEach((x, i) => { x.sig = signed.sigs[i].sig })
const keyId = createHash('sha256').update(pubKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 32).toUpperCase()
ok('signatures: every record verifies with the public key alone (node:crypto)', recs.every((x) => sigOk(pubKey, x.sig, x.r)))
ok('signatures: a signature does not cover an altered fingerprint', !sigOk(pubKey, recs[2].sig, H(payload({ ...recs[2].f, value: '1527419' }))))
ok('signatures: public key is a 65-byte uncompressed P-256 point', /^04[0-9a-f]{128}$/.test(PUB))
ok('signatures: each is 64 bytes (P1363)', recs.every((x) => /^[0-9a-f]{128}$/.test(x.sig)))
ok('signatures: no private key material in signed.json', !/"d"\s*:|BEGIN [A-Z ]*PRIVATE KEY|pkcs8/.test(readFileSync(SIGNED, 'utf8')))
{
  const k = await webcrypto.subtle.importKey('raw', Buffer.from(PUB, 'hex'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  const v = await Promise.all(recs.map((x) => webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, Buffer.from(x.sig, 'hex'), Buffer.from(x.r, 'hex'))))
  ok('signatures: every record verifies with WebCrypto, as the browser checks it', v.every(Boolean))
}
// the words the verifier prints, from its own results, through the page's own functions and <template> words
{
  const W = Object.fromEntries([...rd('partials/words-check.html').matchAll(/<i data-k="([\w.]+)">([\s\S]*?)<\/i>/g)].map((m) => [m[1], m[2]]))
  const say = (k, o = {}) => (k in W ? W[k] : `<<missing ${k}>>`).replace(/\{(\w+)\}/g, (_, x) => o[x] ?? `<<missing {${x}}>>`)
  const k = SN, clone = () => recs.map((x) => { const y = { ...x, f: { ...x.f } }; y.orig = { ...x, f: { ...x.f } }; return y })
  const sigBuilt = async (x, rp) => (x.n <= N ? rp === recs[x.n - 1].r : null)
  const C1 = { AN, signing: true }
  const has = (name, text, ...want) => ok(`${name}: "${text}" contains ${want.map((w) => JSON.stringify(w)).join(', ')}`, want.every((w) => text.includes(w)) && !text.includes('<<missing'))
  const hasNot = (name, text, w) => ok(`${name}: "${text}" does not contain ${JSON.stringify(w)}`, !text.includes(w))
  // sealed
  let r = await IQC.replay(E, clone(), sigBuilt)
  has('words, sealed: status', IQC.statusLine(r, { ...C1, anchorOk: true }, say), `Checked in your browser: ${N} of ${N} records pass · anchor matches`)
  has('words, sealed: agent', IQC.agentLine(r[k - 1], { AN, anchorOk: true }, say), 'fingerprint, signature, link and anchor pass', 'unchanged since it was sealed', 'says nothing about whether the result was right')
  hasNot('words, sealed: agent never claims fitness for use', IQC.agentLine(r[k - 1], { AN, anchorOk: true }, say), 'could use')
  // edited
  const ed = clone(); ed[k - 1].f.value = String(+ed[k - 1].f.value + 100)
  r = await IQC.replay(E, ed, sigBuilt)
  const aOk = r[AN - 1].hp === anchor
  ok('words, edited: the anchor no longer matches', !aOk)
  has('words, edited: status counts passes and failures from the rows', IQC.statusLine(r, { ...C1, anchorOk: aOk }, say), `Checked in your browser: ${k - 1} of ${N} records pass · ${N - k + 1} fail · anchor does not match`)
  has('words, edited: agent', IQC.agentLine(r[k - 1], { AN, anchorOk: aOk }, say), 'these checks fail: fingerprint, signature, link and anchor')
  eq('words, edited: row status of the edited record', IQC.rowStatus(r[k - 1], { AN }, say), 'altered')
  eq('words, edited: row status of the next record', IQC.rowStatus(r[k], { AN }, say), 'link broken')
  has('words, edited: live sentence', IQC.sentence(r, { ...C1, anchorOk: aOk }, null, say), `Record ${k} altered: fingerprint no match, signature fails.`, `${k - 1} of ${N} records pass.`)
  // rewritten
  for (const o of r.slice(k - 1)) { o.x.r = o.rp; o.x.prev = o.pp; o.x.h = o.hp }
  r = await IQC.replay(E, ed, sigBuilt)
  has('words, rewritten: status', IQC.statusLine(r, { ...C1, anchorOk: r[AN - 1].hp === anchor }, say), `${N - 1} of ${N} records pass · 1 fail · anchor does not match`)
  has('words, rewritten: the sentence says why the signature still fails, and that a key holder could re-sign', IQC.sentence(r, { ...C1, anchorOk: false }, { type: 'rewrite', k }, say), 'its fingerprint and every link from it on recomputed', 'only because the demo key was discarded', 'could re-sign')
  eq('words, rewritten: later rows read as relinked', IQC.rowStatus(r[k], { AN }, say), 'checks pass · relinked')
  // corrected, signed with a one-time key (WebCrypto)
  {
    const c = clone(), f = { ...c[k - 1].f, value: String(+c[k - 1].f.value + 100) }, cr = H(payload(f))
    const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
    const sg = Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, Buffer.from(cr, 'hex'))).toString('hex')
    const x9 = { n: N + 1, f, r: cr, prev: anchor, h: H(anchor + cr + String(N + 1)), sig: sg, corrects: k }
    x9.orig = { ...x9, f: { ...f } }
    c.push(x9)
    r = await IQC.replay(E, c, async (x, rp) => (x.n <= N ? sigBuilt(x, rp) : webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, Buffer.from(x.sig, 'hex'), Buffer.from(rp, 'hex'))))
    const aOk2 = r[AN - 1].hp === anchor
    ok('words, corrected: the correction verifies with its one-time key', r[N].sig === true && r.every((o) => o.ok) && aOk2)
    has('words, corrected: status names the unanchored record', IQC.statusLine(r, { ...C1, anchorOk: aOk2 }, say), `${N + 1} of ${N + 1} records pass · anchor matches records 1 to ${AN} · record ${N + 1} not yet anchored`)
    has('words, corrected: the original is superseded, not "usable"', IQC.agentLine(r[k - 1], { AN, anchorOk: aOk2, by: N + 1 }, say), `record ${N + 1} supersedes it`)
    has('words, corrected: the correction itself', IQC.agentLine(r[N], { AN, anchorOk: aOk2 }, say), 'fingerprint, signature and link pass; it is not yet anchored')
    has('words, corrected: announced as signed', IQC.sentence(r, { ...C1, anchorOk: aOk2 }, { type: 'correct', k, n: N + 1 }, say), 'signed with a one-time demo key')
  }
  // corrected where the page cannot sign (no WebCrypto): never announced or counted as signed
  {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext')
    Object.defineProperty(globalThis, 'isSecureContext', { value: false, configurable: true })
    const F = await IQC.engine(pure)
    if (saved) Object.defineProperty(globalThis, 'isSecureContext', saved); else delete globalThis.isSecureContext
    const c = clone(), f = { ...c[k - 1].f, value: String(+c[k - 1].f.value + 100) }, cr = pure(payload(f))
    const x9 = { n: N + 1, f, r: cr, prev: anchor, h: pure(anchor + cr + String(N + 1)), sig: '', corrects: k }
    x9.orig = { ...x9, f: { ...f } }
    c.push(x9)
    r = await IQC.replay(F, c, async () => null) // the page's sigOk() without WebCrypto
    const C0 = { AN, signing: false, anchorOk: r[AN - 1].hp === anchor }
    has('words, no WebCrypto: status', IQC.statusLine(r, C0, say), 'signatures not checked here', `record ${N + 1} not yet anchored`)
    const al = IQC.agentLine(r[N], { AN, anchorOk: C0.anchorOk }, say)
    has('words, no WebCrypto: the unsigned correction is "not signed"', al, 'fingerprint and link pass; it is not signed', 'not yet anchored')
    hasNot('words, no WebCrypto: the unsigned correction never counts a signature as passing', al, 'signature and link pass')
    eq('words, no WebCrypto: its history row', IQC.rowStatus(r[N], { AN }, say), `fingerprint and link pass · not signed · correction of #${k} · not yet anchored`)
    eq('words, no WebCrypto: a signed record that could not be checked', IQC.rowStatus(r[0], { AN }, say), 'fingerprint and link pass · signature not checked')
    const sn = IQC.sentence(r, C0, { type: 'correct.none', k, n: N + 1 }, say)
    has('words, no WebCrypto: the correction is announced as not signed', sn, 'Not signed')
    hasNot('words, no WebCrypto: and never as signed', sn, 'signed with')
  }
}


// ------------------------------------------------------------------------------------------------ 4. assets
const css = rd('src/site.css').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n\s*\n/g, '\n').replace(/^\s+/gm, '').trim() + '\n'
const src = rd('src/iqc.js'), shaSrc = rd('src/sha256.js')
// build/src/sha256.js stays byte-identical to joseqc.com's; its header describes joseqc's lazy chunk, so the bundle gets its own
const SHA_HEAD = /^(\/\/[^\n]*\n)+/
ok('js: sha256.js starts with a comment header to replace', SHA_HEAD.test(shaSrc))
const sha = shaSrc.replace(SHA_HEAD, '// Pure-JS SHA-256 (FIPS 180-4), from joseqc.com. Used only where crypto.subtle is missing (insecure context); inlined here.\n')
// the shipped script: one function scope, the pure-JS SHA-256 first, export keywords dropped (a classic deferred script
// runs from file:// and in sandboxed previews; a module script would need CORS there)
const unexport = (t) => t.replace(/^export (?=(async )?function |const )/gm, '')
const js = `/* Immutable QC, prototype B. Built by build/build.mjs from build/src/sha256.js + build/src/iqc.js; edit those. */\n(() => {\n'use strict'\n${unexport(sha)}\n${unexport(src)}\n})()\n`
ok('js: the bundle carries no joseqc-internal labels', !/Team DI|lazy chunk/.test(js))
ok('js: the bundle has no export or import statements left', !/^\s*(export|import)\b/m.test(js) && !/\bimport\(/.test(js))
{
  const vm = await import('node:vm')
  let parsed = true
  try { new vm.Script(js) } catch (e) { parsed = false; console.error(e) }
  ok('js: the bundle parses as a classic script', parsed)
  const box = { globalThis: null, TextEncoder, console }
  box.globalThis = box
  vm.runInNewContext(js.replace("const PURE = typeof sha256 === 'function' ? sha256 : null", "const PURE = typeof sha256 === 'function' ? sha256 : null; globalThis.__pure = PURE"), box)
  ok('js: inside the bundle the pure-JS SHA-256 is wired in as the fallback', typeof box.__pure === 'function' && box.__pure(recs[0].p) === recs[0].r)
}
mkdirSync(join(OUT, 'assets'), { recursive: true })
writeFileSync(join(OUT, 'assets/site.css'), css)
writeFileSync(join(OUT, 'assets/iqc.js'), js)
const cssv = sha8(css), jsv = sha8(js)
for (const [f, want] of Object.entries(site.fonts)) {
  const p = join(OUT, 'fonts', f), b = existsSync(p) ? readFileSync(p) : Buffer.alloc(0)
  eq(`fonts: ${f} pinned bytes`, createHash('sha256').update(b).digest('hex'), want)
  if (existsSync(join(J, f))) ok(`fonts: ${f} byte-identical to joseqc.com`, b.equals(readFileSync(join(J, f))))
}
for (const f of ['OFL-Archivo.txt', 'OFL-IBM-Plex-Mono.txt', 'OFL-IBM-Plex-Sans.txt']) ok(`fonts: ${f} next to the fonts`, existsSync(join(OUT, 'fonts', f)) && /Open Font License/i.test(readFileSync(join(OUT, 'fonts', f), 'utf8')))
ok('css: no viewport-height units', !/\d(dvh|lvh|svh|vh|vmin|vmax)\b/.test(css))
ok('css: no infinite animation, no keyframes', !/infinite|@keyframes/.test(css))
ok('css: no remote URLs or @import', !/url\(\s*['"]?https?:|@import/.test(css))
ok('css: every font face uses font-display: swap', (css.match(/@font-face\{[^}]*\}/g) || []).filter((f) => /url\(/.test(f)).every((f) => /font-display:swap/.test(f)))
ok('js: no rAF loop, no intervals', !/requestAnimationFrame|setInterval|iterations:\s*Infinity/.test(js))
ok('js: no network requests at all', !/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|import\(/.test(js))

// ------------------------------------------------------------------------------------------------ 5. render
const g = IQC.groups
const S = recs[SN - 1], Sp = recs[SN - 2]
const favicon = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#060D14"/><rect x="9" y="5.5" width="14" height="8" rx="1.5" fill="none" stroke="#00D4AA" stroke-width="2"/><path d="M16 13.5v5" stroke="#00D4AA" stroke-width="2"/><rect x="8" y="18.5" width="16" height="8" rx="1.5" fill="#00D4AA"/></svg>')
const prepaint = "(function(d){var c=d.documentElement.classList;c.add('js');try{if(!matchMedia('(prefers-reduced-motion: reduce)').matches)c.add('motion')}catch(e){}})(document)"
const footerHTML = esc(C.footer).replace('joseqc.com', '<a href="https://joseqc.com">joseqc.com</a>')
const ctxLine = (x) => `Injection ${x.ctx.inj} · ${x.ctx.kind} ${x.ctx.sample}, ${x.ctx.prep} · RT ${x.ctx.rt} min`
const ICON = (k) => `<svg class="i" aria-hidden="true"><use href="#i-${k}"/></svg>`
const M = { fp: 'fingerprint matches', sig: 'signature valid', link: 'link intact' }
const SEL = SN // the verifier opens on the record the Overview shows

const LAB = { instrumentId: 'Instrument', sensorType: 'Measurement', value: 'Peak area', unit: 'Unit', capturedAt: 'Captured (UTC)' }
const inputs = (x) => IQC.FIELDS.map((k) => `<div class="field"><label for="f-${k}">${LAB[k]} <span class="key">${k}</span></label><input id="f-${k}" name="${k}" type="text" value="${esc(x.f[k])}" readonly autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"><p class="was" id="was-${k}" hidden>sealed value: <code></code></p></div>`).join('\n')
const chips = recs.map((x) => `<label class="chip" data-chip="${x.n}" data-s="build"><input type="radio" name="rec" value="${x.n}" id="rec-${x.n}"${x.n === SEL ? ' checked' : ''}><span class="n" aria-hidden="true">${x.n}</span><span class="sr-only">Record ${x.n}, injection ${x.ctx.inj} ${x.ctx.kind}: </span><span class="sr-only" data-cs>checks passed at build</span></label>`).join('\n')
const rows = recs.map((x) => `<tr data-n="${x.n}"${x.n === SEL ? ' class="sel"' : ''}><th scope="row">${x.n}</th><td class="c-inj">${x.ctx.inj} · ${x.ctx.kind}</td><td class="c-smp">${x.ctx.sample}</td><td class="num" data-v>${x.f.value}</td><td class="c-r"><code data-r>${x.r.slice(0, 8)}…</code></td><td class="c-r"><code data-h>${x.h.slice(0, 8)}…</code></td>${['fp', 'sig', 'link'].map((k) => `<td class="c-ck" data-m="${k}">${ICON('ok')}<span class="sr-only">${M[k]}</span></td>`).join('')}<td data-st>checks passed at build</td></tr>`).join('\n')
const NOW = [['fp', 'Fingerprint', 'Match'], ['sig', 'Signature', 'Valid'], ['link', 'Link', 'Intact'], ['anc', 'Anchor', 'Matches']]
const nowItems = `<span class="now-l" data-now-list>${NOW.map(([k, n, w]) => `<span class="now-i" data-nw="${k}" data-s="build">${ICON('ok')}<span>${n}</span> <b>${w}</b></span>`).join('')}</span>`
// the timestamp may break after the date, never inside it (the plate reads textContent, so the markup adds nothing)
const tsHTML = (t) => t.replace(/^(\d{4}-\d\d-\d\d)(T.*)$/, '<span class="nw">$1</span><wbr><span class="nw">$2</span>')
const historyRows = site.history.map((r) => `<tr><td>${esc(r.rev)}</td><td class="mono">${esc(r.date)}</td><td>${esc(r.change)}</td></tr>`).join('\n')
ok('document control: revision history has a row for the current revision, dated as the header', site.history.some((r) => r.rev === site.revision && r.date === site.updated) && /^\d{4}-\d\d-\d\d$/.test(site.updated))
const consoleLink = site.consoleLink
  ? '<p><a class="xref" href="../../dashboard/"><span>Open the alpha console</span><svg class="i" aria-hidden="true"><use href="#i-arrow"/></svg></a></p>'
  : '<p class="note"><span class="k">Console</span>The alpha console is not linked from this draft: it is being reworked first.</p>'
const rc = IQC.recipe({ n: S.n, f: S.f, pp: S.prev, rp: S.r, hp: S.h, r: S.r, h: S.h })
const seqJSON = JSON.stringify({ seq: SEQ.sequence, pub: PUB, keyId, anchor, anchorN: AN, select: SEL, records: recs.map((x) => ({ n: x.n, f: x.f, r: x.r, prev: x.prev, h: x.h, sig: x.sig, ctx: x.ctx })) }).replace(/</g, '\\u003c')
const sstLine = `System suitability: ${sst.length} replicate injections of the reference standard, peak-area RSD ${rsd.toFixed(2)}% (computed at build). Sample peak areas are ${smp.map((v) => v.toFixed(1)).join('%, ')}% of the standard mean. Synthetic data.`

const base = {
  revision: site.revision, updated: site.updated, status: esc(C.status), footerHTML, historyRows, consoleLink, nowItems,
  h1: esc(C.h1), definition: esc(C.definition), regulatory: esc(C.regulatory), demoSig: esc(C.demoSig),
  seq: SEQ.sequence, instrument: SEQ.instrumentId, assay: esc(SEQ.assay), N: String(N), AN: String(AN),
  sn: String(S.n), sp: String(Sp.n), snext: String(S.n + 1), pbytes: String(Buffer.byteLength(S.p)), payload: esc(S.p),
  f_instrumentId: S.f.instrumentId, f_sensorType: S.f.sensorType, f_value: S.f.value, f_unit: S.f.unit, f_capturedAt: S.f.capturedAt, f_capturedAtHTML: tsHTML(S.f.capturedAt),
  c_inj: S.ctx.inj, c_sample: S.ctx.sample, c_desc: esc(S.ctx.desc), c_prep: esc(S.ctx.prep), c_rt: S.ctx.rt,
  rG: g(S.r), prevG: g(S.prev), hG: g(S.h), rpG: g(S.r), hpG: g(S.h), ancG: g(anchor), ancShort: anchor.slice(0, 8),
  rShort: `${S.r.slice(0, 8)}…${S.r.slice(-8)}`, hShort: `${S.h.slice(0, 8)}…${S.h.slice(-8)}`,
  ssig: S.sig, pub: PUB, keyId, keyIdShort: keyId.slice(0, 8), sigHead: S.sig.slice(0, 16), sigTail: S.sig.slice(-16),
  sel: String(SEL), selp: String(SEL - 1), selnext: String(SEL + 1), ctxLine: esc(ctxLine(S)),
  chips, fields: inputs(S), rows, recipe: IQC.recipeHTML(rc), sstLine: esc(sstLine),
  agentJSON: esc(IQC.agentJSON({ x: S, of: N, seq: SEQ.sequence, keyId, publicKey: PUB, anchor, anchorN: AN })), seqJSON,
  favicon: esc(favicon), prepaint, cssv, jsv,
}
function render(tpl, ctx, depth = 0) {
  if (depth > 6) throw new Error('template: partials nested too deep')
  return tpl
    .replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, p) => render(rd(`partials/${p}.html`), ctx, depth + 1))
    .replace(/\{\{(\w+)\}\}/g, (_, k) => { if (!(k in ctx)) throw new Error(`template: no value for {{${k}}}`); return ctx[k] })
}
const NW = ['José A. Fernández Abreu', 'ISO/IEC 17025:2017', '21 CFR Part 11', 'EU GMP Annex 11', 'EU Annex 11', 'Annex 11', 'tamper-evident', 'FIPS 180-4', 'FIPS 186-5', 'ECDSA P-256', 'SHA-256', SEQ.sequence, SEQ.instrumentId, ...site.pages.map((p) => p.doc)]
const NWRE = new RegExp(NW.map((w) => w.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|'), 'g')
function nowrap(html) {
  let skip = 0
  return html.split(/(<[^>]+>)/).map((part) => {
    if (part.startsWith('<')) {
      const m = /^<(\/?)(script|style|template|title|pre|code|textarea|svg)\b/i.exec(part)
      if (m) skip += m[1] ? -1 : 1
      return part
    }
    return skip > 0 ? part : part.replace(NWRE, (w) => `<span class="nw">${w}</span>`)
  }).join('')
}
const out = {}
for (const pg of site.pages) {
  const nav = site.pages.map((p) => `<li><a href="${p.file}"${p.file === pg.file ? ' aria-current="page"' : ''}><span class="id">${p.doc.slice(4)}</span><span class="t">${p.nav}</span></a></li>`).join('\n')
  const preloads = pg.preload.map((f) => `<link rel="preload" href="fonts/${f}" as="font" type="font/woff2" crossorigin>\n`).join('')
  const ctx = { ...base, doc: pg.doc, title: esc(pg.title), description: esc(pg.description), nav, preloads }
  ctx.body = render(rd(`pages/${pg.body}`), ctx)
  const html = nowrap(render(rd('partials/layout.html'), ctx))
  out[pg.file] = html
  writeFileSync(join(OUT, pg.file), html)
}

// ------------------------------------------------------------------------------------------------ 6. lint the output
const BANNED = [/cannot be altered/i, /\bimmutab(le|ility)\b(?! QC)/i, /guarantee/i, /compliance[- ]ready/i, /\bcomplian(t|ce)\b/i, /\bproofs?\b/i,
  /unbreakable/i, /trustless/i, /revolutionar/i, /(?<!no )\bcustomers\b(?! yet)/i, /\bpilots?\b/i, /\btrading\b/i, /\bprices?\b/i, /\bstak(e|ing)\b/i,
  /\bwallets?\b/i, /\btokens?\b/i, /token sale/i, /\bIQC token/i, /\bNFTs?\b/i, /\bmint(ed|ing)?\b/i, /crypto/i,
  /MetaMask/i, /\btFIL\b/i, /faucet/i, /blockchain/i, /\b(Waters|Empower|Agilent|OpenLAB|Shimadzu|Thermo|Chromeleon|PerkinElmer)\b/i]
const INLINE = /<\/?(?:span|a|b|i|em|strong|code|sub|sup|var|abbr|wbr)\b[^>]*>/g
const textOf = (html, glue) => (glue ? html.replace(/<template[\s\S]*?<\/template>/g, ' ').replace(INLINE, '') : html)
  .replace(/<script type="application\/json"[\s\S]*?<\/script>/g, ' ')
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<(title|template)[^>]*>|<\/(title|template)>/g, ' ')
  .replace(/\s(?:aria-label|title|alt|placeholder|content)="([^"]*)"/g, ' $1 ')
  .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ')
const known = new Set([ZERO, anchor, PUB, ...recs.flatMap((x) => [x.r, x.h, x.sig])])
for (const [file, html] of Object.entries(out)) {
  const t = textOf(html), tg = textOf(html, true)
  for (const re of BANNED) ok(`${file}: no banned wording ${re}`, !re.test(t.replace(/Immutable QC/g, '')) && !re.test(tg.replace(/Immutable QC/g, '')))
  const tok = (t.match(/tokeni[sz]ed/gi) || []).length
  ok(`${file}: "tokenized" at most once, and only as the H1`, tok <= 1 && (tok === 0 || /<h1>Tokenized lab data\.<\/h1>/.test(html)))
  ok(`${file}: status line present`, tg.includes(C.status))
  ok(`${file}: footer verbatim, joseqc.com linked`, tg.includes(C.footer) && html.includes('<a href="https://joseqc.com">joseqc.com</a>'))
  ok(`${file}: no "Effective" date on a draft`, !/Effective/.test(tg))
  ok(`${file}: header block says Revision ${site.revision} · Updated ${site.updated}`, html.includes(`<dt>Revision</dt><dd>${site.revision}</dd>`) && html.includes(`<dt>Updated</dt><dd>${site.updated}</dd>`))
  ok(`${file}: one h1, a skip link, main, nav and footer`, (html.match(/<h1[\s>]/g) || []).length === 1 && html.includes('href="#main"') && /<main id="main"/.test(html) && /<nav /.test(html) && /<footer/.test(html))
  ok(`${file}: no root-relative or protocol-relative paths`, !/(?:href|src)="\/(?!\/)|(?:href|src)="\/\//.test(html))
  const ext = [...html.matchAll(/(?:href|src)="(https?:[^"]+)"/g)].map((m) => m[1])
  ok(`${file}: no third-party requests; external links only to joseqc.com (${ext.join(' ')})`, ext.every((u) => u === 'https://joseqc.com'))
  for (const [, u0] of html.matchAll(/(?:href|src)="([^"]*)"/g)) {
    const u = u0.replace(/[?#].*$/, '')
    if (!u || /^[a-z]+:/i.test(u0) || u === '../../dashboard/') continue
    ok(`${file}: link target exists: ${u}`, !u.startsWith('../') && existsSync(join(OUT, u)))
  }
  for (const h of html.match(/\b[0-9a-f]{64}(?:[0-9a-f]{64}(?:[0-9a-f]{2})?)?\b/g) || []) ok(`${file}: every full hash on the page was computed at build (${h.slice(0, 12)}…)`, known.has(h))
  for (const s of html.match(/<span>[0-9a-f]{8}<\/span>(?:<wbr><span>[0-9a-f]{8}<\/span>){7}/g) || []) ok(`${file}: every grouped hash was computed at build`, known.has(s.replace(/<[^>]+>/g, '')))
  ok(`${file}: no viewport units inline`, !/\d(dvh|lvh|svh|vh)\b/.test(html))
}
const ov = textOf(out['index.html'], true), ck = textOf(out['check.html'], true)
ok('index: definition directly under the H1', /<h1>Tokenized lab data\.<\/h1>[\s\S]{0,200}<h2 id="s1-h"><span class="no">1<\/span>Scope<\/h2>\s*<div class="body">\s*<p class="lead">Each result becomes a sealed record/.test(out['index.html']))
ok('index: regulatory line present, high on the page', ov.includes(C.regulatory) && ov.indexOf(C.regulatory) < ov.indexOf('One sealed record') + 400)
ok('index and check: demo-signature line present', ov.includes(C.demoSig) && ck.includes(C.demoSig))
ok('index: says tamper-evident', /tamper-evident/.test(ov))
ok('index: plate shows the full fingerprint, previous link, link and signature head', out['index.html'].includes(g(S.r)) && out['index.html'].includes(g(S.prev)) && out['index.html'].includes(g(S.h)) && out['index.html'].includes(S.sig.slice(0, 16)))
ok('index: plate carries the signature and public key it checks', out['index.html'].includes(`data-sig="${S.sig}"`) && out['index.html'].includes(`data-pub="${PUB}"`))
ok('index: "Check any record yourself" link', ov.includes('Check any record yourself'))
ok('pages: "Simulated · demo data" label on both plates', ov.includes('Simulated · demo data') && ck.includes('Simulated · demo data'))
ok('check: recipe prerendered for the selected record and exactly right', out['check.html'].includes(esc(`printf '%s' '${S.p}' | sha256sum`)) && out['check.html'].includes(esc(`printf '%s' '${S.prev}${S.r}${S.n}' | sha256sum`)) && H(S.p) === S.r && H(`${S.prev}${S.r}${S.n}`) === S.h)
ok('check: agent JSON names the anchor as simulated, labelled roadmap', ck.includes('"status": "simulated, no network call"') && ck.includes('Roadmap'))
ok('check: SST line matches the computed RSD', ck.includes(`peak-area RSD ${rsd.toFixed(2)}%`))
ok('check: embedded data matches the computed chain', (() => { const d = JSON.parse(out['check.html'].match(/<script type="application\/json" id="iqc-seq">([\s\S]*?)<\/script>/)[1]); return d.anchor === anchor && d.pub === PUB && d.records.every((x, i) => x.r === recs[i].r && x.h === recs[i].h && x.prev === recs[i].prev && x.sig === recs[i].sig) })())
ok('roadmap: the alpha-console link is the only path outside the prototype', [...Object.values(out).join('').matchAll(/href="\.\.\/[^"]*"/g)].every((m) => m[0] === 'href="../../dashboard/"'))
ok('words: every key the verifier reads exists in the page templates', (() => {
  const keys = new Set([...out['check.html'].matchAll(/data-k="([\w.]+)"/g)].map((m) => m[1]))
  const used = [...js.matchAll(/say\((?:`([\w.]+)`|'([\w.]+)')/g)].map((m) => m[1] || m[2]).filter((k) => !k.includes('${'))
  const missing = used.filter((k) => !keys.has(k) && !out['index.html'].includes(`data-k="${k}"`))
  const dyn = ['s.reset', 's.rewrite', 's.correct', 's.correct.none', 'm.fp.ok', 'm.fp.bad', 'm.sig.ok', 'm.sig.bad', 'm.sig.na', 'm.sig.none', 'm.link.ok', 'm.link.bad',
    'r.sig.ok', 'r.sig.bad', 'r.sig.na', 'r.sig.none', 'd.sig.ok', 'd.sig.bad', 'd.sig.na', 'n.fp', 'n.sig', 'n.link', 'n.anc']
  const plateKeys = ['fp.ok', 'fp.bad', 'sig.ok', 'sig.bad', 'sig.na', 'link.ok', 'link.bad', 'st', 'st.nosig']
  missing.push(...dyn.filter((k) => !keys.has(k)), ...plateKeys.filter((k) => !out['index.html'].includes(`data-k="${k}"`)))
  if (missing.length) console.error('missing words:', missing)
  return missing.length === 0
})())
ok('check: status words never say "verified" (in GMP that means a second person checked)', !/verified/i.test(out['check.html'].match(/<template id="iqc-words">[\s\S]*?<\/template>/)[0]) && !/verified at build/.test(out['check.html']))

// ------------------------------------------------------------------------------------------------ 7. budgets (estimate; measured in the browser too)
const gz = (b) => gzipSync(b, { level: 9 }).length
const fontsUsed = Object.keys(site.fonts).map((f) => readFileSync(join(OUT, 'fonts', f)).length).reduce((a, b) => a + b, 0)
const sizes = {}
for (const [file, html] of Object.entries(out)) {
  const total = gz(Buffer.from(html)) + gz(Buffer.from(css)) + gz(Buffer.from(js)) + fontsUsed
  sizes[file] = { html: gz(Buffer.from(html)), total }
  ok(`budget: ${file} first load ${(total / 1024).toFixed(1)} KB gz <= 160 KB`, total <= 160 * 1024)
}
ok(`budget: eager JS ${(gz(Buffer.from(js)) / 1024).toFixed(1)} KB gz <= 22 KB`, gz(Buffer.from(js)) <= 22 * 1024)
ok(`budget: fonts ${(fontsUsed / 1024).toFixed(1)} KB <= 100 KB`, fontsUsed <= 100 * 1024)

die()
console.log(`build ok: ${passed} assertions passed · ${Object.keys(out).length} pages · anchor ${anchor.slice(0, 8)}… · key ${keyId.slice(0, 8)}… · SST RSD ${rsd.toFixed(2)}%`)
console.log(`gzip: css ${(gz(Buffer.from(css)) / 1024).toFixed(1)} KB · js ${(gz(Buffer.from(js)) / 1024).toFixed(1)} KB (incl. pure-JS SHA-256 fallback) · fonts ${(fontsUsed / 1024).toFixed(1)} KB · ` + Object.entries(sizes).map(([f, s]) => `${f} ${(s.html / 1024).toFixed(1)}/${(s.total / 1024).toFixed(1)}`).join(' · '))
