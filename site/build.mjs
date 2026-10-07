#!/usr/bin/env node
// build.mjs · immutableqc.com. Node 20+, no dependencies, nothing at runtime.
//   node site/build.mjs            compute, assert, render, lint, then write the site to the repo root
//   node site/build.mjs --check    the same in memory; fails if any committed output differs, or any assert/lint fails
//   node site/build.mjs --resign   sign the sequence with a fresh demo key (its private key is never written). Needed
//                                  whenever the sequence changes: the build refuses to re-sign changed data silently.
//   node site/build.mjs --og       also render og.png and apple-touch-icon.png with Playwright (dev only; committed)
// Sources: site/data (sequence, signatures, copy), site/partials + site/pages (HTML), site/src (CSS, JS, SHA-256).
// Output (repo root): index.html sealed.html check.html regulatory.html roadmap.html about.html 404.html, assets/,
// favicon.svg, og.png, apple-touch-icon.png; fonts/ is committed and pinned by hash. Every hash and number in the HTML is
// computed here and cross-checked three ways (node:crypto, the pure-JS SHA-256 the page falls back to, and the page's
// own replay() on Node's WebCrypto). The lint covers the written pages and the alpha console (dashboard/) too.
import { createHash, generateKeyPairSync, sign, verify, createPublicKey, webcrypto } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { jsStrings } from './tools/jsstrings.mjs'

const HERE = dirname(fileURLToPath(import.meta.url)), OUT = join(HERE, '..')
const J = '/home/user/neodimiun/neodimiun.github.io/site/fonts' // joseqc.com fonts, compared byte-for-byte when present
const rd = (p) => readFileSync(join(HERE, p), 'utf8')
const H = (s) => createHash('sha256').update(s, 'utf8').digest('hex')
const HB = (b) => createHash('sha256').update(b).digest('hex')
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const ARG = new Set(process.argv.slice(2))
const CHECK = ARG.has('--check'), RESIGN = ARG.has('--resign'), OG = ARG.has('--og')
if (CHECK && (RESIGN || OG)) { console.error('--check never writes: run it without --resign or --og'); process.exit(2) }

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
  ctx: { inj: x.inj, kind: x.kind, kw: x.kind === 'SST' ? 'system suitability' : 'sample', sample: x.sample, desc: x.desc, prep: x.desc.split(', ').pop(), rt: x.rt },
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
// cross-check 1: the pure-JS SHA-256 the page uses where crypto.subtle is missing (joseqc sha256.js, byte-for-byte)
const { sha256: pure } = await import(pathToFileURL(join(HERE, 'src/sha256.js')).href)
ok('cross-check: pure-JS SHA-256 gives every r and h', recs.every((x) => pure(x.p) === x.r && pure(x.prev + x.r + String(x.n)) === x.h))
eq('cross-check: pure-JS SHA-256 of "abc" (FIPS 180-4 example)', pure('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
eq('cross-check: SHA-256 of "" (FIPS 180-4)', H(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
// cross-check 2: the page's own replay(), run here on Node's WebCrypto
if (!globalThis.crypto) globalThis.crypto = webcrypto
const IQC = await import(pathToFileURL(join(HERE, 'src/iqc.js')).href)
const E = await IQC.engine(pure)
ok('cross-check: iqc.js engine uses WebCrypto here', !!E.S)

// ------------------------------------------------------------------------------------------------ 3. signatures
// signed.json holds the public key and one signature per record, never a private key. It is reused while every
// fingerprint and signature still verifies; otherwise (or with --resign) a fresh key signs and is then dropped.
const SIGNED = join(HERE, 'data/signed.json')
const pubFromHex = (hex) => createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: Buffer.from(hex.slice(2, 66), 'hex').toString('base64url'), y: Buffer.from(hex.slice(66), 'hex').toString('base64url') }, format: 'jwk' })
const sigOk = (pub, sig, r) => verify('sha256', Buffer.from(r, 'hex'), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'hex'))
let signed = existsSync(SIGNED) ? JSON.parse(readFileSync(SIGNED, 'utf8')) : null
const usable = signed && signed.sigs.length === N && signed.sigs.every((s, i) => s.r === recs[i].r && sigOk(pubFromHex(signed.pub), s.sig, s.r))
if (!usable && !RESIGN) {
  // re-signing changed data is the rewrite-and-re-sign pattern the site warns about: never do it without being asked
  console.error('site/data/signed.json no longer covers the sequence data (a record changed). Re-sign on purpose with: node site/build.mjs --resign')
  process.exit(1)
}
if (RESIGN) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = publicKey.export({ format: 'jwk' })
  const pub = '04' + Buffer.from(jwk.x, 'base64url').toString('hex').padStart(64, '0') + Buffer.from(jwk.y, 'base64url').toString('hex').padStart(64, '0')
  const sigs = recs.map((x) => ({ n: x.n, r: x.r, sig: IQC.lowS(sign('sha256', Buffer.from(x.r, 'hex'), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('hex')) }))
  signed = { _note: 'Demo signatures over r_n (ECDSA P-256, SHA-256, IEEE P1363 hex, low-S form). Written by site/build.mjs; the private key was never written and was discarded.', pub, sigs }
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
ok('signatures: each is in its one low-S form (the form the pages accept)', recs.every((x) => IQC.sigForm(x.sig) && IQC.lowS(x.sig) === x.sig))
{
  // ECDSA malleability: the high-S twin (r, n − s) of a signature also verifies, so the pages accept only the low-S form
  const s1 = recs[0].sig, n = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551')
  const twin = s1.slice(0, 64) + (n - BigInt('0x' + s1.slice(64))).toString(16).padStart(64, '0')
  ok('signatures: the high-S twin verifies with node:crypto (so it must be refused by form)', sigOk(pubKey, twin, recs[0].r) && !IQC.sigForm(twin) && IQC.lowS(twin) === s1)
}
ok('signatures: no private key material in signed.json', !/"d"\s*:|BEGIN [A-Z ]*PRIVATE KEY|pkcs8/.test(readFileSync(SIGNED, 'utf8')))
{
  const k = await webcrypto.subtle.importKey('raw', Buffer.from(PUB, 'hex'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  const v = await Promise.all(recs.map((x) => webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, Buffer.from(x.sig, 'hex'), Buffer.from(x.r, 'hex'))))
  ok('signatures: every record verifies with WebCrypto, as the browser checks it', v.every(Boolean))
}
// ------------------------------------------------------------------------------------------------ 3b. the auditor's rule, replayed
// (after the signatures are loaded: where WebCrypto exists, replay() fails a record with no signature)
const clone = () => recs.map((x) => { const y = { ...x, f: { ...x.f } }; y.orig = { ...x, f: { ...x.f } }; return y })
async function rewriteFrom(list, rows) { // the page's rewrite(), step for step
  const i0 = rows.findIndex((o) => !o.fp || !o.link)
  let prev = list[i0].prev
  for (let i = i0; i < list.length; i++) { const x = list[i]; x.r = rows[i].rp; x.prev = prev; x.h = H(prev + x.r + String(i + 1)); prev = x.h }
  return i0 + 1
}
{
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext')
  Object.defineProperty(globalThis, 'isSecureContext', { value: false, configurable: true })
  const F = await IQC.engine(pure)
  if (saved) Object.defineProperty(globalThis, 'isSecureContext', saved); else delete globalThis.isSecureContext
  const rows = await IQC.replay(F, recs, async () => null)
  ok('cross-check: the no-WebCrypto engine (pure-JS SHA-256) replays every r, link and full replay; signatures not checked', !F.S && rows.every((o, i) => o.rp === recs[i].r && o.hp === recs[i].h && o.fh === recs[i].h && o.sig === null && o.ok))
}
{
  const rows = await IQC.replay(E, recs, async () => true)
  ok('cross-check: iqc.js replay() reproduces every r, every link and the full replay', rows.every((o, i) => o.rp === recs[i].r && o.hp === recs[i].h && o.fh === recs[i].h && o.pp === recs[i].prev && o.ok))
  // the auditor's rule, on Node, with the page's code: a change breaks only the link into the next record
  const sigBuilt = async (x, rp) => rp === recs[x.n - 1]?.r // a signature covers only the fingerprint it was made over
  for (const k of [1, 3, 6, 8]) {
    const alt = clone()
    alt[k - 1].f.value = String(+alt[k - 1].f.value + 9)
    const e1 = await IQC.replay(E, alt, sigBuilt)
    ok(`rule, edit record ${k}: it fails fingerprint, signature and its link`, !e1[k - 1].fp && e1[k - 1].sig === false && !e1[k - 1].link)
    ok(`rule, edit record ${k}: every other record passes its own checks`, e1.every((o) => o.n === k || (o.fp && o.sig && o.link && o.ok)))
    ok(`rule, edit record ${k}: the full replay no longer matches the anchor`, e1[AN - 1].fh !== anchor)
    const n2 = await rewriteFrom(alt, e1)
    eq(`rule, rewrite after editing record ${k}: rewritten from that record`, n2, k)
    const e2 = await IQC.replay(E, alt, sigBuilt)
    ok(`rule, rewrite after editing record ${k}: links consistent again`, e2.every((o) => o.fp && o.link))
    ok(`rule, rewrite after editing record ${k}: only its signature fails`, e2[k - 1].sig === false && e2.filter((o) => !o.ok).length === 1)
    ok(`rule, rewrite after editing record ${k}: the head no longer matches the anchor`, e2[AN - 1].fh !== anchor && e2[N - 1].hp === e2[N - 1].fh)
  }
  const c = clone()
  const cf = { ...c[2].f, value: String(+c[2].f.value + 9) }, cr = H(payload(cf))
  c.push({ n: N + 1, f: cf, r: cr, prev: anchor, h: H(anchor + cr + String(N + 1)), sig: recs[2].sig }) // the callback below stands in for the check
  const e3 = await IQC.replay(E, c, async () => true)
  ok('rule, correct: every record passes with the correction appended', e3.every((o) => o.ok))
  ok('rule, correct: records 1-8 still match the anchor; the head moved on', e3[AN - 1].fh === anchor && e3[N].fh !== anchor)
  // signature stripping: edit a record, rewrite every link from it, then delete its signature. Where signatures can be
  // checked, a missing one fails; it is never read as "not signed here".
  for (const k of [6, 8]) {
    const alt = clone()
    alt[k - 1].f.value = String(+alt[k - 1].f.value + 9)
    await rewriteFrom(alt, await IQC.replay(E, alt, sigBuilt))
    alt[k - 1].sig = ''
    const e4 = await IQC.replay(E, alt, sigBuilt)
    ok(`stripped signature, record ${k}: it fails, as a missing signature`, e4[k - 1].sig === false && e4[k - 1].nosig && !e4[k - 1].ok && e4.filter((o) => !o.ok).length === 1)
  }
  {
    const alt = clone(); alt.push({ n: N + 1, f: cf, r: cr, prev: anchor, h: H(anchor + cr + String(N + 1)), sig: '' })
    ok('stripped signature on an appended record: it fails where signatures can be checked', (await IQC.replay(E, alt, async () => null))[N].sig === false)
  }
  {
    // the high-S twin of a stored signature is refused before any check, so a signature has one valid form
    const alt = clone(), s1 = alt[0].sig, n = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551')
    alt[0].sig = s1.slice(0, 64) + (n - BigInt('0x' + s1.slice(64))).toString(16).padStart(64, '0')
    const e5 = await IQC.replay(E, alt, async () => true)
    ok('high-S twin: refused as a signature that fails', e5[0].sig === false && !e5[0].ok)
  }
  // the payload joins fields with "|": a field holding "|" (or a control character) could give another record's bytes,
  // so it fails its fingerprint check whatever the hash
  {
    const a = { ...recs[5].f, value: '1508812', unit: 'counts|x' }, b = { ...recs[5].f, value: '1508812|counts', unit: 'x' }
    ok('separator: two different records can give the same payload bytes', payload(a) === payload(b) && JSON.stringify(a) !== JSON.stringify(b))
    for (const [name, f] of [['a bar in the unit', a], ['a bar in the value', b], ['a newline in the value', { ...recs[5].f, value: '1508811\n' }], ['a tab in the instrument', { ...recs[5].f, instrumentId: 'HPLC-02\t' }]]) {
      const alt = clone(), r6 = H(payload(f))
      alt[5].f = f; alt[5].r = r6 // stored as if sealed that way: the hash alone would match
      const e6 = await IQC.replay(E, alt, async () => true)
      ok(`separator, ${name}: the record fails its fingerprint check although the hash matches`, e6[5].rp === r6 && e6[5].sep && !e6[5].fp && !e6[5].ok)
    }
    ok('separator: none in the sealed sequence', recs.every((x) => !IQC.sepIn(x.f)))
  }
  // the recipe never puts a stored previous link that is not 64 hex characters into a shell command
  {
    const evil = "'; echo INJECTED; printf '%s' '"
    const rc = IQC.recipe({ n: 6, f: recs[5].f, pp: evil, rp: recs[5].r, hp: recs[5].h, r: recs[5].r, h: recs[5].h, last: false })
    ok('recipe: a stored previous link that is not hex prints no command', rc.filter(([k]) => k === 'p').length === 1 && !rc.some(([k, t]) => k === 'p' && t.includes('INJECTED')))
    const rq = IQC.recipe({ n: 6, f: { ...recs[5].f, value: "1'2" }, pp: recs[5].prev, rp: recs[5].r, hp: recs[5].h, r: recs[5].r, h: recs[5].h, last: false })
    ok('recipe: a quote in a field is quoted for the shell', rq[1][1] === `printf '%s' 'HPLC-02|hplc|1'\\''2|counts|${recs[5].f.capturedAt}' | sha256sum`)
  }
}

// the words the verifier prints, from its own results, through the page's own functions and <template> words
const tplWords = (file, id) => Object.fromEntries([...rd(file).replace(new RegExp(`^[\\s\\S]*?<template id="${id}">`), '').replace(/<\/template>[\s\S]*$/, '').matchAll(/<i data-k="([\w.]+)">([\s\S]*?)<\/i>/g)].map((m) => [m[1], m[2]]))
const sayer = (W) => (k, o = {}) => (k in W ? W[k] : `<<missing ${k}>>`).replace(/\{(\w+)\}/g, (_, x) => o[x] ?? `<<missing {${x}}>>`)
{
  const say = sayer(tplWords('partials/words-check.html', 'iqc-words'))
  const k = SN, len = N
  const sigBuilt = async (x, rp) => (x.n <= N ? rp === recs[x.n - 1].r : null)
  const C1 = { AN, signing: true }
  const has = (name, text, ...want) => ok(`${name}: "${text}" contains ${want.map((w) => JSON.stringify(w)).join(', ')}`, want.every((w) => text.includes(w)) && !text.includes('<<missing'))
  const hasNot = (name, text, w) => ok(`${name}: "${text}" does not contain ${JSON.stringify(w)}`, !text.includes(w))
  // sealed
  let r = await IQC.replay(E, clone(), sigBuilt)
  has('words, sealed: status', IQC.statusLine(r, { ...C1, anchorOk: true }, say), `Checked in your browser: ${N} of ${N} records pass · simulated anchor matches`)
  has('words, sealed: agent', IQC.agentLine(r[k - 1], { AN, anchorOk: true }, say), 'fingerprint, signature, link and anchor pass', 'unchanged since it was sealed', 'says nothing about whether the result was right')
  hasNot('words, sealed: agent never claims fitness for use', IQC.agentLine(r[k - 1], { AN, anchorOk: true }, say), 'could use')
  // edited: the brief's summary, word for word
  const ed = clone(); ed[k - 1].f.value = String(+ed[k - 1].f.value + 100)
  r = await IQC.replay(E, ed, sigBuilt)
  const aOk = r[AN - 1].fh === anchor
  ok('words, edited: the anchor no longer matches', !aOk)
  eq('words, edited: status line', IQC.statusLine(r, { ...C1, anchorOk: aOk }, say), `Checked in your browser: ${N - 1} of ${N} records pass · 1 changed · link ${k}→${k + 1} broken · simulated anchor does not match`)
  eq('words, edited: row status of the edited record', IQC.rowStatus(r[k - 1], { AN, len }, say), `changed · link ${k}→${k + 1} broken`)
  eq('words, edited: the next record is not reported as failing', IQC.rowStatus(r[k], { AN, len }, say), 'checks pass')
  eq('words, edited: nor any later record', r.slice(k).map((o) => IQC.rowStatus(o, { AN, len }, say)).join('|'), r.slice(k).map(() => 'checks pass').join('|'))
  has('words, edited: agent line for the edited record', IQC.agentLine(r[k - 1], { AN, anchorOk: aOk }, say), 'these checks fail: fingerprint, signature, link and anchor')
  has('words, edited: agent line for the next record names only the anchor', IQC.agentLine(r[k], { AN, anchorOk: aOk }, say), 'these checks fail: anchor.')
  has('words, edited: live sentence', IQC.sentence(r, { ...C1, anchorOk: aOk }, null, say), `Record ${k} changed: fingerprint no match, signature fails and link from ${k} to ${k + 1} broken.`, `${N - 1} of ${N} records pass.`, 'no longer matches the anchored fingerprint')
  {
    const e8 = clone(); e8[N - 1].f.value = '1516040'
    const r8 = await IQC.replay(E, e8, sigBuilt)
    eq('words, edited newest record: status', IQC.statusLine(r8, { ...C1, anchorOk: r8[AN - 1].fh === anchor }, say), `Checked in your browser: ${N - 1} of ${N} records pass · 1 changed · simulated anchor does not match`)
    eq('words, edited newest record: row status', IQC.rowStatus(r8[N - 1], { AN, len }, say), 'changed · stored link does not match')
  }
  {
    const e2 = clone(); e2[2].f.value = '1527411'; e2[k - 1].f.value = '1508812'
    const r2 = await IQC.replay(E, e2, sigBuilt)
    eq('words, two edits: status', IQC.statusLine(r2, { ...C1, anchorOk: false }, say), `Checked in your browser: ${N - 2} of ${N} records pass · 2 changed · links 3→4, ${k}→${k + 1} broken · simulated anchor does not match`)
  }
  // rewritten
  await rewriteFrom(ed, r)
  r = await IQC.replay(E, ed, sigBuilt)
  eq('words, rewritten: status', IQC.statusLine(r, { ...C1, anchorOk: r[AN - 1].fh === anchor }, say), `Checked in your browser: ${N - 1} of ${N} records pass · 1 signature fails · simulated anchor does not match`)
  has('words, rewritten: the sentence says why the signature still fails, and that a key holder could re-sign', IQC.sentence(r, { ...C1, anchorOk: false }, { type: 'rewrite', k }, say), 'its stored fingerprint and every link from it on recomputed', 'only because the demo key was discarded', 'could re-sign')
  eq('words, rewritten: later rows read as relinked', IQC.rowStatus(r[k], { AN, len }, say), 'checks pass · relinked')
  eq('words, rewritten: the rewritten record', IQC.rowStatus(r[k - 1], { AN, len }, say), 'signature fails')
  {
    // the same record with its signature deleted: still a failing signature, named as missing, never "not signed here"
    const st = r.map((o) => ({ ...o.x, f: { ...o.x.f }, orig: o.x.orig })); st[k - 1].sig = ''
    const rs = await IQC.replay(E, st, sigBuilt)
    eq('words, stripped signature: status', IQC.statusLine(rs, { ...C1, anchorOk: false }, say), `Checked in your browser: ${N - 1} of ${N} records pass · 1 signature fails · simulated anchor does not match`)
    eq('words, stripped signature: row', IQC.rowStatus(rs[k - 1], { AN, len }, say), 'signature missing')
    has('words, stripped signature: agent', IQC.agentLine(rs[k - 1], { AN, anchorOk: false }, say), 'these checks fail: signature and anchor')
    hasNot('words, stripped signature: never "unchanged"', IQC.agentLine(rs[k - 1], { AN, anchorOk: false }, say), 'unchanged')
  }
  {
    const sp = clone(); sp[k - 1].f.unit = 'counts|x'
    const rs = await IQC.replay(E, sp, sigBuilt)
    eq('words, separator: row', IQC.rowStatus(rs[k - 1], { AN, len }, say), `changed (separator in a field) · link ${k}→${k + 1} broken`)
    has('words, separator: sentence', IQC.sentence(rs, { ...C1, anchorOk: false }, null, say), `Record ${k} changed: a field holds the separator |`)
  }
  // the recipe follows the rule: step 2 starts from the previous link the record stores
  {
    const o = r[k] // record k+1 after the rewrite
    const rc = IQC.recipe({ n: o.n, f: o.x.f, pp: o.pp, rp: o.rp, hp: o.hp, r: o.x.r, h: o.x.h, last: false })
    ok('recipe: step 2 hashes the stored previous link + fingerprint + n', rc[5][0] === 'p' && rc[5][1] === `printf '%s' '${o.x.prev}${o.rp}${o.n}' | sha256sum` && rc[6][1] === `${H(o.x.prev + o.rp + o.n)}  -`)
  }
  {
    const e = clone(); e[k - 1].f.value = '1508812'
    const rr = await IQC.replay(E, e, sigBuilt), o = rr[k - 1]
    const rc = IQC.recipe({ n: o.n, f: o.x.f, pp: o.pp, rp: o.rp, hp: o.hp, r: o.x.r, h: o.x.h, last: false })
    ok('recipe, edited: names the broken link into the next record', rc[7][1].endsWith(`link ${k}→${k + 1} broken`) && rc[3][1].startsWith('# differs'))
  }
  // corrected, signed with a one-time key (WebCrypto)
  {
    const c = clone(), f = { ...c[k - 1].f, value: String(+c[k - 1].f.value + 100) }, cr = H(payload(f))
    const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
    const sg = IQC.lowS(Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, Buffer.from(cr, 'hex'))).toString('hex'))
    const x9 = { n: N + 1, f, r: cr, prev: anchor, h: H(anchor + cr + String(N + 1)), sig: sg, corrects: k }
    x9.orig = { ...x9, f: { ...f } }
    c.push(x9)
    r = await IQC.replay(E, c, async (x, rp) => (x.n <= N ? sigBuilt(x, rp) : webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, Buffer.from(x.sig, 'hex'), Buffer.from(rp, 'hex'))))
    const aOk2 = r[AN - 1].fh === anchor
    ok('words, corrected: the correction verifies with its one-time key', r[N].sig === true && r.every((o) => o.ok) && aOk2)
    eq('words, corrected: status names the unanchored record', IQC.statusLine(r, { ...C1, anchorOk: aOk2 }, say), `Checked in your browser: ${N + 1} of ${N + 1} records pass · simulated anchor matches records 1 to ${AN} · record ${N + 1} not yet anchored`)
    has('words, corrected: the original is superseded, not "usable"', IQC.agentLine(r[k - 1], { AN, anchorOk: aOk2, by: N + 1 }, say), `record ${N + 1} supersedes it`)
    has('words, corrected: the correction itself', IQC.agentLine(r[N], { AN, anchorOk: aOk2 }, say), 'fingerprint, signature and link pass; it is not yet anchored')
    has('words, corrected: announced as signed', IQC.sentence(r, { ...C1, anchorOk: aOk2 }, { type: 'correct', k, n: N + 1 }, say), 'signed with a one-time demo key')
    eq('words, corrected: its history row', IQC.rowStatus(r[N], { AN, len: N + 1 }, say), `checks pass · correction of #${k} · not yet anchored`)
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
    const C0 = { AN, signing: false, anchorOk: r[AN - 1].fh === anchor }
    has('words, no WebCrypto: status', IQC.statusLine(r, C0, say), `Checked in your browser: ${N + 1} of ${N + 1} records pass the fingerprint and link checks`, 'signatures not checked here', `record ${N + 1} not yet anchored`)
    const al = IQC.agentLine(r[N], { AN, anchorOk: C0.anchorOk }, say)
    has('words, no WebCrypto: the unsigned correction is "not signed"', al, 'fingerprint and link pass; it is not signed', 'not yet anchored', 'Not all four checks ran')
    hasNot('words, no WebCrypto: the unsigned correction is never called unchanged', al, 'unchanged since')
    const a0 = IQC.agentLine(r[0], { AN, anchorOk: C0.anchorOk }, say)
    has('words, no WebCrypto: a signed record whose signature was not checked', a0, 'the signature could not be checked', 'Not all four checks ran')
    hasNot('words, no WebCrypto: and it is never called unchanged', a0, 'unchanged since')
    hasNot('words, no WebCrypto: the unsigned correction never counts a signature as passing', al, 'signature and link pass')
    eq('words, no WebCrypto: its history row', IQC.rowStatus(r[N], { AN, len: N + 1 }, say), `fingerprint and link pass · not signed · correction of #${k} · not yet anchored`)
    eq('words, no WebCrypto: a signed record that could not be checked', IQC.rowStatus(r[0], { AN, len: N + 1 }, say), 'fingerprint and link pass · signature not checked')
    const sn = IQC.sentence(r, C0, { type: 'correct.none', k, n: N + 1 }, say)
    has('words, no WebCrypto: the correction is announced as not signed', sn, 'Not signed')
    hasNot('words, no WebCrypto: and never as signed', sn, 'signed with')
  }
}
// Fig. 2 uses statusLine() with its own template words: same sentences
{
  const sayH = sayer(tplWords('partials/plate-history.html', 'iqc-hist-words'))
  const r = await IQC.replay(E, clone(), async () => true)
  eq('Fig. 2 words: sealed status', IQC.statusLine(r, { AN, signing: true, anchorOk: true }, sayH), `Checked in your browser: ${N} of ${N} records pass · simulated anchor matches`)
  eq('Fig. 2 words: status where signatures cannot be checked', IQC.statusLine(r.map((o) => ({ ...o, sig: null })), { AN, signing: false, anchorOk: true }, sayH), `Checked in your browser: ${N} of ${N} records pass the fingerprint and link checks · simulated anchor matches · signatures not checked here`)
}

// ------------------------------------------------------------------------------------------------ 4. assets
const out = {} // every output file, path -> Buffer
const put = (p, data) => { out[p] = Buffer.isBuffer(data) ? data : Buffer.from(data) }
// the printed page's running footer carries the revision (site/src/site.css, @page): stamped here from site.json
ok('css: the print footer has its revision placeholder', rd('src/site.css').includes('__REVISION__'))
ok('css: the print footer has its per-document placeholder', rd('src/site.css').includes('__DOC_PAGES__'))
// printed, every page of a document names it: a named page per document id, with the id, revision and use line in its footer
const docPage = (doc) => `doc-${doc.toLowerCase()}`
const DOC_PAGES = site.pages.map((p) => `@page ${docPage(p.doc)}{@bottom-left{content:"${p.doc} · ${site.revision} · informational draft, not a controlled document"}}\nbody[data-doc="${p.doc}"]{page:${docPage(p.doc)}}`).join('\n')
const css = rd('src/site.css').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n\s*\n/g, '\n').replace(/^\s+/gm, '').trim().replaceAll('__REVISION__', site.revision).replace('__DOC_PAGES__', DOC_PAGES) + '\n'
ok('css: every document has its named print page', site.pages.every((p) => css.includes(`@page ${docPage(p.doc)}{@bottom-left{content:"${p.doc} · ${site.revision} ·`)))
const src = rd('src/iqc.js'), shaSrc = rd('src/sha256.js')
// site/src/sha256.js stays byte-identical to joseqc.com's; its header describes joseqc's lazy chunk, so the bundle gets its own
const SHA_HEAD = /^(\/\/[^\n]*\n)+/
ok('js: sha256.js starts with a comment header to replace', SHA_HEAD.test(shaSrc))
const sha = shaSrc.replace(SHA_HEAD, '// Pure-JS SHA-256 (FIPS 180-4), from joseqc.com. Used only where crypto.subtle is missing (insecure context); inlined here.\n')
const unexport = (t) => t.replace(/^export (?=(async )?function |const )/gm, '')
const js = `/* Immutable QC. Built by site/build.mjs from site/src/sha256.js + site/src/iqc.js; edit those. */\n(() => {\n'use strict'\n${unexport(sha)}\n${unexport(src)}\n})()\n`
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
put('assets/site.css', css)
put('assets/iqc.js', js)
const v8 = (s) => H(s).slice(0, 8)
const cssv = v8(css), jsv = v8(js)
// the one mark: a dark disc, a teal ring and a dot (nav, favicon, apple-touch-icon and og card)
const MARK = { bg: '#060D14', ok: '#00D4AA' }
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="${MARK.bg}"/><circle cx="16" cy="16" r="9.5" fill="none" stroke="${MARK.ok}" stroke-width="3"/><circle cx="16" cy="16" r="3.75" fill="${MARK.ok}"/></svg>\n`
put('favicon.svg', favicon)
ok('mark: the sprite symbol draws the same ring and dot as the favicon', /<symbol id="i-mark" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16"[^>]*\/><circle cx="16" cy="16" r="9.5"[^>]*stroke-width:3[^>]*\/><circle cx="16" cy="16" r="3.75"/.test(rd('partials/sprite.html')))
for (const [f, want] of Object.entries(site.fonts)) {
  const p = join(OUT, 'fonts', f), b = existsSync(p) ? readFileSync(p) : Buffer.alloc(0)
  eq(`fonts: ${f} pinned bytes`, HB(b), want)
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
// The one inline script (allowed by its hash in the CSP below). Before first paint it sets .js and .motion. It also
// runs the Contents menu (narrow screens) by delegation, so the menu works before the deferred site script runs, and
// even if that script never loads; and on the 404 page, whose <base href="/"> would send "#main" home, the skip link.
const prepaint = [
  "(function(d){var c=d.documentElement.classList;c.add('js');try{if(!matchMedia('(prefers-reduced-motion: reduce)').matches)c.add('motion')}catch(e){}",
  "var q=function(s){return d.querySelector(s)},b=function(){return q('.menu-btn')},n=function(){return q('.nav')},o=function(){var x=b();return!!x&&x.getAttribute('aria-expanded')==='true'},",
  "s=function(v){var x=b(),y=n();if(x&&y){x.setAttribute('aria-expanded',String(v));y.classList.toggle('open',v)}};",
  "d.addEventListener('click',function(e){var t=e.target,x=b(),y=n();if(!t||!t.closest)return;",
  "if(q('base')&&t.closest('.skip')){e.preventDefault();var m=d.getElementById('main');if(m){m.focus();m.scrollIntoView()}return}",
  "if(!x||!y)return;if(x.contains(t))s(!o());else if(o()&&!y.contains(t))s(false)});",
  "d.addEventListener('keydown',function(e){if(e.key==='Escape'&&o()){s(false);b().focus()}});",
  "d.addEventListener('focusout',function(e){var x=b(),y=n(),r=e.relatedTarget;if(o()&&r&&(y.contains(e.target)||x.contains(e.target))&&!y.contains(r)&&!x.contains(r))s(false)})})(document)",
].join('')
const SRC_HASH = (t) => `'sha256-${createHash('sha256').update(t, 'utf8').digest('base64')}'`
// Content-Security-Policy, as a <meta> (GitHub Pages sets no headers): same-origin files only, the inline script by its
// hash, inline style attributes only (the sprite's mark uses them), no network calls, no form posts.
const cspFor = (script) => `default-src 'none'; script-src 'self' ${SRC_HASH(script)}; style-src 'self'; style-src-attr 'unsafe-inline'; font-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'self'; form-action 'none'`
const CSP = cspFor(prepaint)
ok('js: the inline script parses', (() => { try { new Function(prepaint); return true } catch { return false } })())
const footerHTML = esc(C.footer).replace('joseqc.com', '<a href="https://joseqc.com">joseqc.com</a>')
const ctxLine = (x) => `Injection ${x.ctx.inj} · ${x.ctx.kw} ${x.ctx.sample}, ${x.ctx.prep} · retention time ${x.ctx.rt} min`
const ICON = (k) => `<svg class="i" aria-hidden="true"><use href="#i-${k}"/></svg>`
const M = { fp: 'fingerprint matches', sig: 'signature valid', link: 'link to the next record intact' }
const SEL = SN // the verifier opens on the record the Overview shows
const buildStatus = `Checked at build: ${N} of ${N} records pass · simulated anchor matches.`

const LAB = { instrumentId: 'Instrument', sensorType: 'Measurement', value: 'Peak area', unit: 'Unit', capturedAt: 'Captured (UTC)' }
const inputs = (x) => IQC.FIELDS.map((k) => `<div class="field"><label for="f-${k}">${LAB[k]} <span class="key">${k}</span></label><input id="f-${k}" name="${k}" type="text" value="${esc(x.f[k])}" readonly autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"><p class="was" id="was-${k}" hidden>sealed value: <code></code></p></div>`).join('\n')
const chips = recs.map((x) => `<label class="chip" data-chip="${x.n}" data-s="build"><input type="radio" name="rec" value="${x.n}" id="rec-${x.n}"${x.n === SEL ? ' checked' : ''}><span class="n" aria-hidden="true">${x.n}</span><span class="sr-only">Record ${x.n}, injection ${x.ctx.inj}, ${x.ctx.kw}: </span><span class="sr-only" data-cs>checks passed at build</span></label>`).join('\n')
const rows = recs.map((x) => `<tr data-n="${x.n}"${x.n === SEL ? ' class="sel"' : ''}><th scope="row">${x.n}</th><td class="c-inj">${x.ctx.inj} · ${x.ctx.kind === 'SST' ? '<abbr title="system suitability test">SST</abbr>' : x.ctx.kind}</td><td class="c-smp">${x.ctx.sample}</td><td class="num" data-v>${x.f.value}</td><td class="c-r"><code data-r>${x.r.slice(0, 8)}…</code></td><td class="c-r"><code data-h>${x.h.slice(0, 8)}…</code></td>${['fp', 'sig', 'link'].map((k) => `<td class="c-ck" data-m="${k}">${ICON('ok')}<span class="sr-only">${M[k]}</span></td>`).join('')}<td data-st>checks passed at build</td></tr>`).join('\n')
const NOW = [['fp', 'Fingerprint', 'Match'], ['sig', 'Signature', 'Valid'], ['link', 'Link', 'Intact'], ['anc', 'Anchor', 'Matches']]
const nowItems = `<span class="now-l" data-now-list>${NOW.map(([k, n, w]) => `<span class="now-i" data-nw="${k}" data-s="build">${ICON('ok')}<span>${n}</span> <b>${w}</b></span>`).join('')}</span>`
// the timestamp may break after the date, never inside it (the plate reads textContent, so the markup adds nothing)
const tsHTML = (t) => t.replace(/^(\d{4}-\d\d-\d\d)(T.*)$/, '<span class="nw">$1</span><wbr><span class="nw">$2</span>')
const historyRows = site.history.map((r) => `<tr><td class="nw">${esc(r.rev)}</td><td class="mono">${esc(r.date)}</td><td>${esc(r.change)}</td></tr>`).join('\n')
ok('document control: revision history has a row for the current revision, dated as the header', site.history[0].rev === site.revision && site.history[0].date === site.updated && /^\d{4}-\d\d-\d\d$/.test(site.updated))
const rc = IQC.recipe({ n: S.n, f: S.f, pp: S.prev, rp: S.r, hp: S.h, r: S.r, h: S.h, last: S.n === N })
const seqJSON = JSON.stringify({ seq: SEQ.sequence, pub: PUB, keyId, anchor, anchorN: AN, select: SEL, records: recs.map((x) => ({ n: x.n, f: x.f, r: x.r, prev: x.prev, h: x.h, sig: x.sig, ctx: x.ctx })) }).replace(/</g, '\\u003c')
const sstLine = `System suitability: ${sst.length} replicate injections of the reference standard, peak-area RSD ${rsd.toFixed(2)}% (computed at build). Sample peak areas are ${smp.map((v) => v.toFixed(1)).join('%, ')}% of the standard mean. Synthetic and illustrative: acceptance criteria come from your method, these area ratios are not an assay calculation, and blanks and bracketing standards are left out for brevity.`
// Fig. 2: the record history, the same sequence and signed data as everywhere else on the site
const NODE = '<svg class="nd" viewBox="0 0 20 20" aria-hidden="true"><circle class="rg" cx="10" cy="10" r="6.5"/><circle class="dr" cx="10" cy="10" r="6.5" pathLength="1"/><circle class="dt" cx="10" cy="10" r="2.75"/><path class="xx" d="M7.7 7.7l4.6 4.6m0-4.6l-4.6 4.6"/></svg>'
const ST = (w) => `<span class="st"><svg class="i" aria-hidden="true"><use href="#i-open"/></svg><span class="w">${w}</span></span>`
const histRows = recs.map((x) => `<tr role="row" data-n="${x.n}"><td role="cell" class="c-sp">${NODE}</td><th scope="row" role="rowheader" class="c-n">${x.n}</th><td role="cell" class="c-smp">${x.ctx.sample}<span class="kd"> · ${x.ctx.kind === 'SST' ? 'system suitability' : 'sample'}, ${x.ctx.prep}</span></td><td role="cell" class="c-rt">${x.ctx.rt}</td><td role="cell" class="c-at"><time datetime="${x.f.capturedAt}">${x.f.capturedAt.slice(11, 19)}</time></td><td role="cell" class="c-pa" data-v>${x.f.value}</td><td role="cell" class="c-fp"><code>${x.r.slice(0, 8)}</code><span class="sr-only" data-fpw>fingerprint checked at build</span></td><td role="cell" class="c-ln" data-m="link" data-s="build">${ST('intact')}</td><td role="cell" class="c-sg" data-m="sig" data-s="build">${ST('valid')}</td></tr>`).join('\n')
const day = SEQ.records[0].capturedAt.slice(0, 10)
ok('Fig. 2: the whole run is on one day', SEQ.records.every((x) => x.capturedAt.startsWith(day)))
const runLine = `${day}, ${SEQ.records[0].capturedAt.slice(11, 16)} to ${SEQ.records[N - 1].capturedAt.slice(11, 16)} UTC`
const samples = SEQ.records.filter((x) => x.kind === 'Sample').map((x) => x.sample)
const histCaption = `${N} injections, one record each: ${sst.length} system-suitability injections of the reference standard (${SEQ.records[0].sample}), then ${samples.length} preparations of Product 200 mg tablets (${samples[0]} to ${samples[samples.length - 1]}).`
ok('Fig. 2: the caption counts come from the data', SEQ.assay.includes('Product 200 mg tablets'))

const base = {
  revision: site.revision, updated: site.updated, status: esc(C.status), footerHTML, historyRows, nowItems,
  h1: esc(C.h1), definition: esc(C.definition), regulatory: esc(C.regulatory), demoSig: esc(C.demoSig), independence: esc(C.independence),
  founderLine: esc(C.founderLine), network: esc(C.network), buildStatus,
  seq: SEQ.sequence, instrument: SEQ.instrumentId, assay: esc(SEQ.assay), N: String(N), AN: String(AN),
  sn: String(S.n), sp: String(Sp.n), snext: String(S.n + 1), pbytes: String(Buffer.byteLength(S.p)), payload: esc(S.p),
  f_instrumentId: S.f.instrumentId, f_sensorType: S.f.sensorType, f_value: S.f.value, f_unit: S.f.unit, f_capturedAt: S.f.capturedAt, f_capturedAtHTML: tsHTML(S.f.capturedAt),
  c_inj: S.ctx.inj, c_sample: S.ctx.sample, c_desc: esc(S.ctx.desc), c_prep: esc(S.ctx.prep), c_rt: S.ctx.rt,
  rG: g(S.r), prevG: g(S.prev), hG: g(S.h), rpG: g(S.r), hpG: g(S.h), ancG: g(anchor), ancShort: anchor.slice(0, 8), headShort: g(anchor.slice(0, 8)),
  linkInput: `${S.prev}${S.r}${S.n}`, payloadW: IQC.payloadHTML(S.p),
  payloadCmd: IQC.cmdHTML(`printf '%s' ${IQC.shq(S.p)} | sha256sum`), linkCmd: IQC.cmdHTML(`printf '%s' ${IQC.shq(S.prev + S.r + S.n)} | sha256sum`),
  useLine: 'Informational draft. Not a controlled document; not a regulatory assessment or a validation statement.',
  csp: `<meta http-equiv="Content-Security-Policy" content="${CSP}">\n<meta name="referrer" content="no-referrer">\n`,
  ssig: S.sig, pub: PUB, keyId, keyIdShort: keyId.slice(0, 8), sigHead: S.sig.slice(0, 16), sigTail: S.sig.slice(-16),
  sel: String(SEL), selp: String(SEL - 1), selnext: String(SEL + 1), ctxLine: esc(ctxLine(S)),
  chips, fields: inputs(S), rows, recipe: IQC.recipeHTML(rc), sstLine: esc(sstLine),
  histRows, runLine, histCaption: esc(histCaption),
  agentJSON: esc(IQC.agentJSON({ x: S, of: N, seq: SEQ.sequence, keyId, publicKey: PUB, anchor, anchorN: AN })), seqJSON,
  prepaint, cssv, jsv,
}
function render(tpl, ctx, depth = 0) {
  if (depth > 6) throw new Error('template: partials nested too deep')
  return tpl
    .replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, p) => render(rd(`partials/${p}.html`), ctx, depth + 1))
    .replace(/\{\{(\w+)\}\}/g, (_, k) => { if (!(k in ctx)) throw new Error(`template: no value for {{${k}}}`); return ctx[k] })
}
const NW = ['José A. Fernández Abreu', 'ISO/IEC 17025:2017', '21 CFR Part 11', 'EU GMP Annex 11', 'EU Annex 11', 'Annex 11', 'tamper-evident', 'FIPS 180-4', 'FIPS 186-5', 'ECDSA P-256', 'SHA-256', 'PI 041-1', SEQ.sequence, SEQ.instrumentId, ...site.pages.map((p) => p.doc)]
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
const pagesHTML = {}
const navPages = site.pages.filter((p) => p.nav)
for (const pg of site.pages) {
  const nav = navPages.map((p) => `<li><a href="${p.file}"${p.file === pg.file ? ' aria-current="page"' : ''}><span class="id">${p.doc.slice(4)}</span><span class="t">${p.nav}</span></a></li>`)
    .concat(`<li class="nav-demo"><a href="${site.console.href}"><span class="id">${site.console.tag}</span><span class="t">${site.console.nav}</span><span class="demo">${site.console.tag}</span></a></li>`).join('\n')
  const preloads = pg.preload.map((f) => `<link rel="preload" href="fonts/${f}" as="font" type="font/woff2" crossorigin>\n`).join('')
  const is404 = pg.file === '404.html', url = site.origin + (pg.file === 'index.html' ? '' : pg.file)
  const meta = is404 ? '<meta name="robots" content="noindex">\n' : [
    `<link rel="canonical" href="${url}">`,
    '<meta property="og:type" content="website">', '<meta property="og:site_name" content="Immutable QC">',
    `<meta property="og:title" content="${esc(pg.file === 'index.html' ? 'Immutable QC' : pg.title)}">`, `<meta property="og:description" content="${esc(pg.description)}">`,
    `<meta property="og:url" content="${url}">`, `<meta property="og:image" content="${site.origin}og.png">`,
    '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">',
    '<meta property="og:image:alt" content="Immutable QC card with the ring-and-dot mark and the status line: Independent project · Open alpha · Synthetic demo data · No customers yet">', '<meta name="twitter:card" content="summary_large_image">',
  ].join('\n') + '\n'
  // GitHub Pages serves 404.html at any missing path, so its relative links resolve from the site root
  const ctx = { ...base, doc: pg.doc, title: esc(pg.title), description: esc(pg.description), nav, preloads, meta, base: is404 ? '<base href="/">\n' : '' }
  ctx.body = render(rd(`pages/${pg.body}`), ctx)
  const html = nowrap(render(rd('partials/layout.html'), ctx))
  pagesHTML[pg.file] = html
  put(pg.file, html)
}
// the console page (dashboard/, written by hand) gets stamped here: content-hashed URLs for its stylesheet and script, as
// the site's pages have, so a returning visitor never mixes a new page with an old cached script; and its CSP, with the
// hash of its one inline script.
const DASH = join(OUT, 'dashboard')
let DASH_HTML = null
if (existsSync(join(DASH, 'index.html'))) {
  const src0 = readFileSync(join(DASH, 'index.html'), 'utf8')
  const inl = [...src0.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  ok('dashboard/index.html: exactly one inline script', inl.length === 1)
  const dcss = readFileSync(join(DASH, 'console.css')), djs = readFileSync(join(DASH, 'console.js'))
  DASH_HTML = src0
    .replace(/href="console\.css(?:\?v=[0-9a-f]*)?"/, `href="console.css?v=${HB(dcss).slice(0, 8)}"`)
    .replace(/src="console\.js(?:\?v=[0-9a-f]*)?"/, `src="console.js?v=${HB(djs).slice(0, 8)}"`)
    .replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/, `<meta http-equiv="Content-Security-Policy" content="${cspFor(inl[0] || '')}">`)
  ok('dashboard/index.html: console.css and console.js load by content hash', DASH_HTML.includes(`console.css?v=${HB(dcss).slice(0, 8)}"`) && DASH_HTML.includes(`console.js?v=${HB(djs).slice(0, 8)}"`))
  ok('dashboard/index.html: a CSP with the hash of its inline script, before any script', DASH_HTML.includes(`content="${cspFor(inl[0] || '')}"`) && DASH_HTML.indexOf('Content-Security-Policy') < DASH_HTML.indexOf('<script'))
  ok('dashboard/index.html: no inline event handlers and no <style>', !/<[a-z][^>]*\son[a-z]+=/i.test(DASH_HTML) && !/<style[\s>]/i.test(DASH_HTML))
  put('dashboard/index.html', DASH_HTML)
}

// ------------------------------------------------------------------------------------------------ 6. og card + touch icon
// Rendered with Playwright only on --og (they are committed); every build checks them against site/data/og.json.
const OGJ = join(HERE, 'data/og.json')
// the templates are hashed with a placeholder for the font folder, so the hash is the same on every machine
const ogCtx = { ...base, fontsDir: '__FONTS__', statusSpans: C.status.split(' · ').map((w, i, a) => `<span>${esc(w)}${i < a.length - 1 ? ' ·' : ''}</span>`).join(' ') }
const ogHTML = render(rd('og/card.html'), ogCtx), iconHTML = render(rd('og/icon.html'), ogCtx)
const ogSource = H(ogHTML + iconHTML + Object.values(site.fonts).join(''))
const withFonts = (html) => html.replaceAll('__FONTS__', pathToFileURL(join(OUT, 'fonts')).href)
if (OG) {
  let pw
  try { pw = await import('playwright') } catch { pw = (await import('/opt/node22/lib/node_modules/playwright/index.js')).default }
  const b = await pw.chromium.launch()
  const tmp = mkdtempSync(join(tmpdir(), 'iqc-og-'))
  const shot = async (html, w, h, file) => {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
    writeFileSync(join(tmp, 'card.html'), html)
    await p.goto(pathToFileURL(join(tmp, 'card.html')).href)
    await p.evaluate(() => document.fonts.ready)
    const png = await p.screenshot({ type: 'png', clip: { x: 0, y: 0, width: w, height: h } })
    await p.close()
    writeFileSync(join(OUT, file), png)
    return png
  }
  const og = await shot(withFonts(ogHTML), 1200, 630, 'og.png'), icon = await shot(withFonts(iconHTML), 180, 180, 'apple-touch-icon.png')
  await b.close()
  rmSync(tmp, { recursive: true, force: true })
  writeFileSync(OGJ, JSON.stringify({ _note: 'Written by node site/build.mjs --og. source = SHA-256 of the og and icon templates as rendered, plus the font hashes.', source: ogSource, og: HB(og), icon: HB(icon), renderer: `Chromium ${b.version ? b.version() : ''}`.trim() }, null, 1) + '\n')
  console.log(`og.png and apple-touch-icon.png rendered (${og.length} and ${icon.length} bytes)`)
}
const pngSize = (b) => (b.length > 24 && b.readUInt32BE(0) === 0x89504e47 ? [b.readUInt32BE(16), b.readUInt32BE(20)] : [0, 0])
{
  const oj = existsSync(OGJ) ? JSON.parse(readFileSync(OGJ, 'utf8')) : {}
  const ogp = join(OUT, 'og.png'), icp = join(OUT, 'apple-touch-icon.png')
  const og = existsSync(ogp) ? readFileSync(ogp) : Buffer.alloc(0), icon = existsSync(icp) ? readFileSync(icp) : Buffer.alloc(0)
  ok('og: og.png is a 1200×630 PNG', pngSize(og).join('×') === '1200×630')
  ok('og: apple-touch-icon.png is a 180×180 PNG', pngSize(icon).join('×') === '180×180')
  ok('og: og.png and the icon were rendered from the current templates (else run: node site/build.mjs --og)', oj.source === ogSource && oj.og === HB(og) && oj.icon === HB(icon))
  ok('og: the card says the name, the tagline and the status line, with the mark', ogHTML.includes('Immutable QC') && ogHTML.includes(C.h1) && ogHTML.replace(/<[^>]+>/g, '').includes(esc(C.status)) && ogHTML.includes('r="9.5"'))
}

// ------------------------------------------------------------------------------------------------ 7. lint the output
// Banned everywhere: the marketing pages, the console's HTML and every string literal in the shipped JavaScript.
const BANNED = [/cannot be altered/i, /\bimmutab(le|ility)\b/i, /guarantee/i, /compliance[- ]ready/i, /\bcompliant\b/i, /\bproofs?\b/i,
  /unbreakable/i, /trustless/i, /revolutionar/i, /(?<!no )\bcustomers?\b(?! yet)/i, /\bpilots?\b/i, /\btrading\b/i, /\bprices?\b/i, /\bstak(e|es|ed|ing)\b/i,
  /\bwallets?\b/i, /\btokens?\b/i, /token sale/i, /\bIQC token/i, /\bNFTs?\b/i, /\bmint(s|ed|ing)?\b/i, /\bcrypto\b/i, /cryptocurrenc/i,
  /MetaMask/i, /\btFIL\b/i, /faucet/i, /\b(Waters|Empower|Agilent|OpenLAB|OpenLab|Shimadzu|Thermo|Chromeleon|PerkinElmer|Sciex|SCIEX|Bruker|MassLynx|LabSolutions|Alliance|LabWare|STARLIMS)\b/]
// Stricter on the marketing pages: no "crypto" inside any word (WebCrypto, cryptographic), no "compliance" at all.
const BANNED_SITE = [/crypto/i, /\bcomplian(t|ce)\b/i]
// allowed uses: the product name and domain, and the roadmap's zero-knowledge proofs
const scrub = (t) => t.replace(/Immutable QC/g, '').replace(/immutableqc/gi, '').replace(/zero-knowledge proofs?/gi, '')
const INLINE = /<\/?(?:span|a|b|i|em|strong|code|sub|sup|var|abbr|wbr)\b[^>]*>/g
const textOf = (html, glue) => (glue ? html.replace(/<template[\s\S]*?<\/template>/g, ' ').replace(INLINE, '') : html)
  .replace(/<script type="application\/json"[\s\S]*?<\/script>/g, ' ')
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<(title|template)[^>]*>|<\/(title|template)>/g, ' ')
  .replace(/\s(?:aria-label|title|alt|placeholder|content)="([^"]*)"/g, ' $1 ')
  .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&shy;/g, '').replace(/\s+/g, ' ')
const count = (t, re) => (t.match(re) || []).length
const known = new Set([ZERO, anchor, PUB, ...recs.flatMap((x) => [x.r, x.h, x.sig])])
const jsText = jsStrings(js).join('\n')
for (const re of BANNED) ok(`assets/iqc.js strings: no banned wording ${re}`, !re.test(scrub(jsText)))
ok('assets/iqc.js strings: no "tokeniz", no "intelligence explosion", no "Filecoin Calibration"', !/tokeni[sz]|intelligence explosion|Filecoin Calibration/i.test(jsText))
const EMAIL = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i
const tally = { ie: [], fc: [] }
for (const [file, html] of Object.entries(pagesHTML)) {
  const t = textOf(html), tg = textOf(html, true)
  for (const re of [...BANNED, ...BANNED_SITE]) ok(`${file}: no banned wording ${re}`, !re.test(scrub(t)) && !re.test(scrub(tg)))
  ok(`${file}: "blockchain" only in About’s question`, file === 'about.html' ? count(t, /blockchain/gi) === 2 && tg.includes('Is my data put on a blockchain?') : !/blockchain/i.test(t))
  const tok = count(t, /tokeni[sz]/gi)
  ok(`${file}: "tokeniz" at most once, and only as the H1`, tok <= 1 && (tok === 0 || /<h1>Tokenized lab data\.<\/h1>/.test(html)))
  tally.ie.push(...Array(count(t, /intelligence explosion/gi)).fill(file))
  tally.fc.push(...Array(count(t, /Filecoin Calibration/gi)).fill(file))
  ok(`${file}: no email address`, !EMAIL.test(t) && !/mailto:/i.test(html))
  ok(`${file}: status line present`, tg.includes(C.status))
  ok(`${file}: footer verbatim, joseqc.com linked`, tg.includes(C.footer) && html.includes('<a href="https://joseqc.com">joseqc.com</a>'))
  ok(`${file}: no "Effective" date on a draft`, !/Effective/.test(tg))
  ok(`${file}: header block says Revision ${site.revision} · Updated ${site.updated}`, html.includes(`<dt>Revision</dt><dd>${site.revision}</dd>`) && html.includes(`<dt>Updated</dt><dd>${site.updated}</dd>`))
  ok(`${file}: one h1, a skip link, main, nav and footer`, count(html, /<h1[\s>]/g) === 1 && html.includes('href="#main"') && /<main id="main"/.test(html) && /<nav /.test(html) && /<footer class="foot"/.test(html))
  const navHrefs = [...html.match(/<ol class="nav-list"[\s\S]*?<\/ol>/)[0].matchAll(/href="([^"]+)"/g)].map((m) => m[1])
  eq(`${file}: nav links every document and the alpha console`, navHrefs.join(' '), 'index.html sealed.html check.html regulatory.html roadmap.html about.html dashboard/')
  ok(`${file}: the console is marked as a demo in the nav`, /<a href="dashboard\/"><span class="id">Demo<\/span><span class="t">Alpha console<\/span><span class="demo">Demo<\/span><\/a>/.test(html))
  ok(`${file}: no root-relative or protocol-relative paths`, !/(?:href|src)="\/(?!\/)|(?:href|src)="\/\//.test(html.replace('<base href="/">', '')))
  ok(`${file}: a <base> only on the 404 page`, (file === '404.html') === html.includes('<base href="/">'))
  const ext = [...html.matchAll(/(?:href|src)="(https?:[^"]+)"/g)].map((m) => m[1])
  ok(`${file}: no third-party requests; external links only to joseqc.com (and this page’s canonical URL)`, ext.every((u) => u === 'https://joseqc.com' || (u.startsWith(site.origin) && html.includes(`<link rel="canonical" href="${u}">`))))
  for (const [, u0] of html.matchAll(/(?:href|src)="([^"]*)"/g)) {
    const u = u0.replace(/[?#].*$/, '')
    if (!u || /^[a-z]+:/i.test(u0) || u === '/') continue
    ok(`${file}: link target exists: ${u}`, !u.startsWith('../') && (u in out || existsSync(join(OUT, u))))
  }
  for (const [, id] of html.matchAll(/href="#([\w-]+)"/g)) ok(`${file}: in-page link #${id} has a target`, html.includes(`id="${id}"`))
  for (const [, f, id] of html.matchAll(/href="([\w-]+\.html)#([\w-]+)"/g)) ok(`${file}: link ${f}#${id} has a target`, f in pagesHTML && pagesHTML[f].includes(`id="${id}"`))
  for (const h of html.match(/\b[0-9a-f]{64}(?:[0-9a-f]{64}(?:[0-9a-f]{2})?)?\b/g) || []) ok(`${file}: every full hash on the page was computed at build (${h.slice(0, 12)}…)`, known.has(h))
  for (const s of html.match(/<span>[0-9a-f]{8}<\/span>(?:<wbr><span>[0-9a-f]{8}<\/span>){7}/g) || []) ok(`${file}: every grouped hash was computed at build`, known.has(s.replace(/<[^>]+>/g, '')))
  ok(`${file}: no viewport units inline`, !/\d(dvh|lvh|svh|vh)\b/.test(html))
  ok(`${file}: no duplicate ids`, (() => { const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]); return new Set(ids).size === ids.length })())
  // the CSP: present once, before any script; the only inline script is the one it allows by hash (JSON data blocks do
  // not run); no inline event handlers, no <style> elements
  ok(`${file}: one CSP meta, before any script`, count(html, /http-equiv="Content-Security-Policy"/g) === 1 && html.indexOf('Content-Security-Policy') < html.indexOf('<script') && html.includes(`content="${CSP}"`))
  ok(`${file}: the only inline script is the one the CSP allows`, [...html.matchAll(/<script(?![^>]*\ssrc=)([^>]*)>([\s\S]*?)<\/script>/g)].every(([, a, b]) => /type="application\/json"/.test(a) || b === prepaint))
  ok(`${file}: no inline event handlers and no <style>`, !/<[a-z][^>]*\son[a-z]+=/i.test(html) && !/<style[\s>]/i.test(html))
  // copy rules: US spelling, no software slang for "becomes available", the alpha app's capture time as it is
  ok(`${file}: US spelling`, !/\b(?:labelled|labelling|modelled|modelling|computerised|organisation|behaviour|colour|licence|analysed)\b/i.test(textOf(html, true)))
  ok(`${file}: no "ship"/"ships" for a feature or a key`, !/\bship(?:s|ped|ping)?\b/i.test(textOf(html, true)))
  ok(`${file}: the capture time is never said to come from the export`, !/comes? from the (?:CSV )?export/i.test(textOf(html, true)))
  // headings are flex rows: after the number, one item only (bare text, or one element), so no space is lost between items
  for (const [, tag, inner] of html.matchAll(/<(h[23])\b[^>]*><span class="no">[^<]*<\/span>([\s\S]*?)<\/\1>/g)) {
    let depth = 0, text = false, el = 0
    for (const part of inner.split(/(<[^>]+>)/)) {
      if (!part) continue
      if (part.startsWith('</')) depth--
      else if (part.startsWith('<')) { if (depth === 0) el++; if (!/^<(?:wbr|br)\b|\/>$/.test(part)) depth++ }
      else if (depth === 0 && part.trim()) text = true
    }
    ok(`${file}: ${tag} "${inner.replace(/<[^>]+>/g, '').slice(0, 40)}" is one flex item after its number`, !(text && el) && el <= 1)
  }
}
// the console (dashboard/, owned by its own build): its HTML text and every string in the JavaScript it ships
const dashText = []
if (DASH_HTML) {
  const dh = DASH_HTML, t = textOf(dh)
  dashText.push(t)
  for (const re of BANNED) ok(`dashboard/index.html: no banned wording ${re}`, !re.test(scrub(t)))
  ok('dashboard/index.html: no third-party requests (no remote stylesheet, script, font or image)', !/<(?:link|script|img|iframe|source)\b[^>]*\s(?:href|src)="(?:https?:)?\/\//.test(dh) && !/fonts\.(googleapis|gstatic)/.test(dh))
  ok('dashboard/index.html: footer independence line', textOf(dh, true).replace(/'/g, '’').includes(C.independence))
  ok('dashboard/index.html: status line prerendered', /Independent project · Open alpha · Synthetic demo data · No customers yet · Runs only in your browser/.test(textOf(dh, true)))
  ok('dashboard/index.html: no email address', !EMAIL.test(t))
  ok('dashboard/index.html: "tokeniz" at most once', count(t, /tokeni[sz]/gi) <= 1)
  tally.ie.push(...Array(count(t, /intelligence explosion/gi)).fill('dashboard/index.html'))
  const loaded = [...dh.matchAll(/<script[^>]+src="([^"?#]+)/g)].map((m) => m[1]).filter((s) => !/^https?:/.test(s))
  for (const f of readdirSync(DASH).filter((f) => f.endsWith('.js'))) {
    const strs = jsStrings(readFileSync(join(DASH, f), 'utf8')).join('\n')
    dashText.push(strs)
    const shipped = loaded.includes(f) || loaded.includes(`./${f}`)
    for (const re of BANNED) ok(`dashboard/${f}${shipped ? '' : ' (not loaded)'} strings: no banned wording ${re}`, !re.test(scrub(strs)))
    ok(`dashboard/${f} strings: no email address`, !EMAIL.test(strs))
    tally.ie.push(...Array(count(strs, /intelligence explosion/gi)).fill(`dashboard/${f}`))
  }
  ok('dashboard: no registry scripts loaded', !loaded.some((s) => /registry-/.test(s)))
  // its links and assets resolve from dashboard/ (the site's pages, favicon and fonts one level up), and it uses the one mark
  for (const [, u0] of dh.matchAll(/(?:href|src)="([^"]*)"/g)) {
    if (/^[a-z]+:/i.test(u0)) continue
    const [u, frag] = u0.split('#')
    if (!u) { ok(`dashboard/index.html: in-page link #${frag} has a target`, dh.includes(`id="${frag}"`)); continue }
    const rel = relative(OUT, join(DASH, u.replace(/\?.*$/, ''))).replace(/\\/g, '/')
    const file = !rel || rel.endsWith('/') || existsSync(join(OUT, rel)) && !/\.\w+$/.test(rel) ? join(rel, 'index.html').replace(/\\/g, '/') : rel
    ok(`dashboard/index.html: link target exists: ${u0}`, !rel.startsWith('..') && (file in out || existsSync(join(OUT, file))))
    if (frag) ok(`dashboard/index.html: link ${u0} has a target`, file in pagesHTML && pagesHTML[file].includes(`id="${frag}"`))
  }
  if (existsSync(join(DASH, 'console.css'))) {
    const urls = [...readFileSync(join(DASH, 'console.css'), 'utf8').matchAll(/url\(\s*['"]?([^'")]+)/g)].map((m) => m[1])
    ok(`dashboard/console.css: every url() resolves (${urls.length})`, urls.every((u) => existsSync(join(DASH, u))))
    ok('dashboard/console.css: its fonts are the site’s pinned fonts, at ../fonts/', urls.filter((u) => /\.woff2$/.test(u)).length > 0 && urls.filter((u) => /\.woff2$/.test(u)).every((u) => /^\.\.\/fonts\/[\w.-]+\.woff2$/.test(u) && u.slice(9) in site.fonts))
  }
  // one sequence site-wide: the console seeds its demo lab with the site's eight records and starts from the site's anchor
  if (existsSync(join(DASH, 'console.js'))) {
    const cj = readFileSync(join(DASH, 'console.js'), 'utf8')
    const rowsC = [...cj.matchAll(/\['(\d\d)', '(SST|Sample)', '([^']+)', '([^']+)', '(\d+)', '([\d.]+)', '([^']+)'\]/g)].map((m) => m.slice(1).join('|'))
    eq('dashboard/console.js: seeds the site’s sequence, record for record', rowsC.join('\n'), SEQ.records.map((x) => [x.inj, x.kind, x.sample, x.desc, x.value, x.rt, x.capturedAt].join('|')).join('\n'))
    eq('dashboard/console.js: starts from the site’s anchored fingerprint', (cj.match(/SITE_ANCHOR = '([0-9a-f]{64})'/) || [])[1], anchor)
    eq('dashboard/console.js: names the site’s sequence', (cj.match(/SEQ_ID = '([^']+)'/) || [])[1], SEQ.sequence)
  }
  const markOf = (h) => (h.match(/<symbol id="i-mark"[\s\S]*?<\/symbol>/) || [''])[0]
  ok('dashboard: the ring-and-dot mark is the site’s, symbol for symbol', markOf(dh) !== '' && markOf(dh) === markOf(rd('partials/sprite.html')))
  ok('dashboard: the favicon is the site’s', /<link rel="icon" href="\.\.\/favicon\.svg"/.test(dh))
}
ok(`"intelligence explosion" exactly once across all output pages, on the Overview (found: ${tally.ie.join(', ') || 'none'})`, tally.ie.length === 1 && tally.ie[0] === 'index.html')
ok(`"Filecoin Calibration" exactly once across the marketing pages, on How a record is sealed (found: ${tally.fc.join(', ') || 'none'})`, tally.fc.length === 1 && tally.fc[0] === 'sealed.html')

// ------------------------------------------------------------------------------------------------ 7b. present tense only for what works
// Founder decision (step 3b): anything that does not work yet is an upcoming feature, under one label, "Upcoming".
// Present tense only for what works today on these pages and in the console: the SHA-256 fingerprint of the five sealed
// fields, the chain from 64 zeros, the demo signatures, corrections appended with a reason, every check recomputed in
// the browser, and the alpha app's HPLC CSV import signed by one server key. Anchoring on a public network is upcoming,
// and every anchor shown is simulated. These lints read every sentence a visitor can meet: page text, <template> words,
// titles, meta descriptions and labels, the og card, the console's HTML and every string in the JavaScript either ships.
const STATUS_LINE = 'Independent project · Open alpha · Synthetic demo data · No customers yet'
eq('copy: the status line, exactly (nothing on the site touches a network)', C.status, STATUS_LINE)
const ENT = (t) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&shy;/g, '')
// a sentence ends at its block (a paragraph, list item, table row, heading, template word) or at . ! ?; cells of one table
// row and the term and description of one <dl> row read as one sentence ("Not yet  A shared registry…")
const BLOCK = /<\/?(?:p|li|i|title|template|caption|figcaption|blockquote|pre|div|section|header|footer|summary|button|label|option|tr|ul|ol|dl|table|figure|nav|main|article|aside|legend|h[1-6]|br)\b[^>]*>/g
const proseOf = (html) => [
  ...[...html.matchAll(/\s(?:aria-label|title|alt|placeholder|content)="([^"]*)"/g)].map((m) => ENT(m[1])),
  ...ENT(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '\n').replace(BLOCK, '\n').replace(/<[^>]+>/g, ' ')).split('\n'),
].flatMap((t) => t.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)).map((s) => s.trim()).filter((s) => /[a-z]{2}/i.test(s))
const proseOfJS = (strs) => strs.flatMap((t) => ENT(t.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)).map((s) => s.trim()).filter((s) => /[a-z]{2}/i.test(s))
// a clause that is negated ("nothing … writes to a network", "no shared registry") is not a claim that something works
const unneg = (s) => s.replace(/\b(?:nothing|never|not|no)\b[^,;:.]*/gi, '')
// 1. present-tense claims that something is anchored, written or published to a network today, whatever surrounds them
const ANCHOR_NOW = [
  /\b(?:can|could|may) be (?:anchored|written|published|recorded|sent)\b/i, /\bbatches can\b/i, /\bcan go on\b/i,
  /(?<!\b(?:will|would|could|should|might|may|to) )\b(?:goes|go|is written|are written|gets written|is published|are published|is sent|are sent) (?:on|to) (?:a |the |any )?(?:public )?(?:test )?(?:network|blockchain|registry)/i,
  /(?<!\b(?:will|would|could|should|might|may) be )\b(?:is|are|was|were) anchored (?:on|to) /i, /\banchor(?:ing|s)? (?:writes|keeps|records|publishes|stores)\b/i, /\banchoring is (?:manual|a manual step|available|live|possible)\b/i,
  /\bmanual(?:ly)?\b[^.]{0,60}\banchor|\banchor\w*\b[^.]{0,60}\bmanual(?:ly)?\b/i, /\b(?:the alpha|it|the console|the app|the site) (?:writes|publishes|anchors|sends)\b/i,
  /\bby hand\b/i, /\bpaused\b/i, /\bpublishing (?:screen|UI|step)\b/i, /\bregistry entry (?:shows|proves)\b/i,
]
// 2. any sentence about a network, a registry or a blockchain says it is upcoming, conditional, simulated or absent
const NET = /\bnetworks?\b|\bregistr(?:y|ies)\b|blockchain|Filecoin|on-?chain/i
const NET_OK = /\bupcoming\b|\bwill\b|\bwould\b|\bonce\b|\bshould\b|\bsimulated\b|\bno network calls?\b|\bnothing\b|\bnever\b|\bnot yet\b|\bin use\b/i
const NET_NAMES = /privacy on public networks/gi // a topic's name, not a claim; the sentences about it are checked
// 3. nothing about the product is called broken or "not working"; the demo's own verdicts ("link 6→7 broken", its Broken
// status word) live in <template> words and the console's scripts, and are the only "broken" a visitor reads
const NOT_WORKING = /\b(?:do|does) not work\b|\b(?:don|doesn)[’']t work\b|\bnot working\b|\bnot work(?:ing)? yet\b|\bnon-?functional\b|\bdead (?:button|link)s?\b|\bbroken in\b/i
const VERDICTS = (s) => s.replace(/\blinks? (?:\d+→\d+(?:, )?)+ broken\b/g, '').replace(/\blink (?:from \d+ to \d+|to the next record) broken\b/g, '')
// 4. one label for what is not built yet
const LABEL_OLD = /\bon the roadmap\b|\bplanned\b|\bcoming soon\b|\bin progress\b/i
const bad = (where, sents, name, f) => { const hit = sents.filter(f); ok(`${where}: ${name}${hit.length ? ` (${hit.slice(0, 3).map((s) => JSON.stringify(s.slice(0, 110))).join(' | ')})` : ''}`, hit.length === 0) }
const lintProse = (where, sents) => {
  bad(where, sents, 'no present-tense anchoring or publishing claim', (s) => ANCHOR_NOW.some((re) => re.test(unneg(s))))
  bad(where, sents, 'every sentence about a network, registry or blockchain says upcoming, simulated or absent', (s) => !/\?$/.test(s) && NET.test(s.replace(NET_NAMES, '')) && !NET_OK.test(s))
  bad(where, sents, 'nothing called "not working" or "does not work"', (s) => NOT_WORKING.test(s))
  bad(where, sents, 'one label for what is not built: "Upcoming" (no "on the roadmap", "planned", "in progress")', (s) => LABEL_OLD.test(s))
}
const lintBroken = (where, sents) => bad(where, sents, '"broken" only in the demo’s own verdicts', (s) => /\bbroken\b/i.test(VERDICTS(s)))
const noTemplates = (h) => h.replace(/<template[\s\S]*?<\/template>/g, ' ')
for (const [file, html] of Object.entries(pagesHTML)) {
  lintProse(`${file} (its text and template words)`, proseOf(html))
  lintBroken(`${file} (its text)`, proseOf(noTemplates(html)))
  ok(`${file}: no status-style "Public test network"`, !/Public test network/.test(html))
  eq(`${file}: header status line exact`, ENT((html.match(/<div class="st"><dt>Status<\/dt><dd>([\s\S]*?)<\/dd><\/div>/) || [])[1] || '').replace(/<[^>]+>/g, ''), STATUS_LINE)
  for (const [, t] of html.matchAll(/<span class="tag[^"]*">([^<]*)<\/span>/g)) ok(`${file}: tag "${t}" is Upcoming (or the Alpha label)`, t === 'Upcoming' || t === 'Alpha')
}
lintProse('assets/iqc.js strings', proseOfJS(jsStrings(js)))
lintProse('og card', proseOf(ogHTML))
lintBroken('og card', proseOf(ogHTML))
ok('og card: the status line, exactly, and no "Public test network"', ENT(ogHTML.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').includes(STATUS_LINE) && !/test network/i.test(ogHTML))
if (DASH_HTML) {
  const dh = DASH_HTML
  lintProse('dashboard/index.html', proseOf(dh))
  lintBroken('dashboard/index.html', proseOf(dh))
  ok('dashboard/index.html: no status-style "Public test network"', !/Public test network/.test(dh))
  for (const f of readdirSync(DASH).filter((f) => f === 'console.js')) lintProse(`dashboard/${f} strings`, proseOfJS(jsStrings(readFileSync(join(DASH, f), 'utf8'))))
}

// ------------------------------------------------------------------------------------------------ 7c. clause numbers
// Founder decision (step 3b): the unconfirmed clause numbers are removed; the standard stays named, with the expectation
// in plain words. Removed: ISO/IEC 17025:2017 7.11.3 a), b), d); EU GMP Chapter 4, 4.9; TNI 2016 V1M2 4.13 and 5.8, and
// the Module 4 reference. Anywhere, the Regulatory map included, a clause number may appear only if it is one of the
// founder's confirmed list, and only on its own subject: 21 CFR 11.10(a), 11.10(e), 11.50 and 11.70, and EU Annex 11
// clauses 9 and 14. Every other expectation names its standard and says what it expects in plain words.
{
  const REMOVED = [[/7\.11\.3/, 'ISO/IEC 17025:2017 7.11.3'], [/Chapter\s*4\b|\b4\.9\b/i, 'EU GMP Chapter 4, 4.9'], [/\bV1\s*M\s*\d|\bModule\s*\d/i, 'TNI module'], [/\b4\.13\b/, 'TNI 4.13']]
  const everywhere = [...Object.entries(pagesHTML).map(([f, h]) => [f, textOf(h)]), ['og card', textOf(ogHTML)]]
  if (DASH_HTML) everywhere.push(['dashboard/index.html', textOf(DASH_HTML)], ['dashboard/console.js strings', jsStrings(readFileSync(join(DASH, 'console.js'), 'utf8')).join('\n')])
  everywhere.push(['assets/iqc.js strings', jsText])
  for (const [where, t] of everywhere) for (const [re, name] of REMOVED) ok(`${where}: removed clause number absent: ${name}`, !re.test(t))
  const rg = pagesHTML['regulatory.html']
  const art = (id) => (rg.match(new RegExp(`<article class="cl" aria-labelledby="${id}">[\\s\\S]*?</article>`)) || [''])[0]
  const ids = [...rg.matchAll(/<span class="cl-id">([^<]*)<\/span>/g)].map((m) => m[1])
  // the clause numbers the Regulatory map shows: exactly the founder's confirmed list; any change is a decision, made here
  const KEPT = ['§11.10(a)', '§11.10(e)', '§11.50, §11.70', '§9', '§14']
  eq('regulatory: the clause ids shown are exactly the confirmed ones', ids.join(' | '), KEPT.join(' | '))
  for (const [id, cl, subject] of [['c-2-1', '§11.10(a)', 'Validation; discerning altered records'], ['c-2-4', '§11.10(e)', 'Audit trails'], ['c-2-6', '§11.50, §11.70', 'Signature manifestations and linking'], ['c-3-3', '§9', 'Audit trails'], ['c-3-5', '§14', 'Electronic signature']])
    ok(`regulatory: ${cl} sits on its own subject (${subject})`, art(id).includes(`${subject} <span class="cl-id">${cl}</span></span></h3>`))
  ok('regulatory: ISO/IEC 17025:2017 protection and integrity of data, named in plain words with no clause number', /<h3 id="c-4-4"><span class="no">4\.4<\/span>Protection and integrity of data<\/h3>/.test(art('c-4-4')) && /<h2 id="s4-h"><span class="no">4<\/span>(?:<span class="nw">)?ISO\/IEC 17025:2017(?:<\/span>)?<\/h2>/.test(rg))
  ok('regulatory: EU GMP alterations to entries, with no chapter or clause number', art('c-6-3').includes('<span class="no">6.3</span>Alterations to entries (EU GMP)</h3>'))
  ok('regulatory: the 21 CFR Part 211 expectations named by their part, with no section number', art('c-6-1').includes('Computer systems (<span class="nw">21 CFR</span> Part 211)</h3>') || art('c-6-1').includes('Computer systems (21 CFR Part 211)</h3>'))
  const tni = (rg.match(/<section class="sec" id="tni"[\s\S]*?<\/section>/) || [''])[0]
  ok('regulatory: TNI named, its expectations in plain words, with no module or section numbers', /The TNI Standard \(2016\)/.test(tni) && !/cl-id/.test(tni) && !/\d+\.\d+/.test(textOf(tni.replace(/<span class="no">[\d.]+<\/span>/g, ''))))
  const CLAUSE_REF = /§\s*\d+(?:\.\d+)*(?:\([a-z]\))?|\b(?:211|11)\.\d+(?:\([a-z]\))?|\b\d+\.\d+\.\d+\b/g
  const OUTSIDE = new Set(['§11.10(a)', '§11.10(e)', '§11.50', '§11.70', '§9', '§14'])
  for (const [where, t] of everywhere) {
    const refs = (t.replace(/IQC-[A-Z]{2}-\d\d §[\d.]+/g, '').match(CLAUSE_REF) || []).map((r) => r.replace(/\s+/g, ''))
    ok(`${where}: clause numbers only from 11.10(a), 11.10(e), 11.50, 11.70, Annex 11 §9, §14 (${refs.join(', ') || 'none'})`, refs.every((r) => OUTSIDE.has(r)))
  }
  ok('regulatory: Not covered, never "Not yet", as the label for what is not done', /<dt>Not covered<\/dt>/.test(rg) && !/<dt>Not yet<\/dt>/.test(rg) && rg.includes('Not covered lists what Immutable QC does not do'))
}

// ------------------------------------------------------------------------------------------------ 7d. what GitHub Pages publishes
// Founder decision (step 3b): Pages publishes only the built site, through GitHub Actions (.github/workflows/pages.yml),
// from the one allowlist in site/tools/deploy.mjs. Everything a page or the console links to must be on it.
{
  const D = await import(pathToFileURL(join(HERE, 'tools/deploy.mjs')).href)
  const pub = new Set(D.FILES)
  for (const [d, re] of Object.entries(D.DIRS)) {
    for (const p of Object.keys(out).filter((p) => p.startsWith(`${d}/`))) pub.add(p)
    if (existsSync(join(OUT, d))) for (const f of readdirSync(join(OUT, d))) if (re.test(f)) pub.add(`${d}/${f}`)
  }
  ok('deploy: every page the build writes is on the allowlist', site.pages.every((p) => D.FILES.includes(p.file)) && D.FILES.filter((f) => /^[\w-]+\.html$/.test(f)).length === site.pages.length)
  ok('deploy: every file the build writes is on the allowlist', Object.keys(out).every((p) => pub.has(p)))
  ok('deploy: the og card, touch icon, favicon and CNAME are on it', ['og.png', 'apple-touch-icon.png', 'favicon.svg', 'CNAME'].every((f) => pub.has(f)))
  ok('deploy: nothing from site/, contracts/, .github/, no registry script, no .md, no dotfile', [...pub].every((f) => !/^(site|contracts|\.github)\/|^dashboard\/registry-|\.md$|(^|\/)\./i.test(f)))
  let ok2 = true
  try { D.manifest(OUT) } catch (e) { ok2 = false; console.error(e.message) }
  ok('deploy: the allowlist assembles from the repo as committed (site/tools/deploy.mjs manifest)', ok2 || !CHECK)
  const linked = (from, html) => [...html.matchAll(/(?:href|src)="([^"#?]*)/g)].map((m) => m[1]).filter((u) => u && !/^[a-z]+:/i.test(u) && u !== '/')
    .map((u) => { const p = relative(OUT, join(OUT, from, u)).replace(/\\/g, '/'); return !p || u.endsWith('/') ? join(p, 'index.html').replace(/\\/g, '/') : p })
  for (const [file, html] of Object.entries(pagesHTML)) for (const p of linked('', html.replace('<base href="/">', ''))) ok(`deploy: ${file} links ${p}, which is published`, pub.has(p))
  if (DASH_HTML) for (const p of linked('dashboard', DASH_HTML)) ok(`deploy: dashboard/index.html links ${p}, which is published`, pub.has(p))
  const wf = existsSync(join(OUT, '.github/workflows/pages.yml')) ? readFileSync(join(OUT, '.github/workflows/pages.yml'), 'utf8') : ''
  const has = (name, re) => ok(`pages.yml: ${name}`, re.test(wf))
  has('runs on push to main and by hand', /\non:\n  push:\n    branches: \[main\]\n  workflow_dispatch:\n/)
  // contents: read, pages: write and id-token: write, each where it is needed: the build job (which runs the repo's own
  // scripts) reads only; only the deploy job can write to Pages
  ok('pages.yml: permissions: the workflow and the build job read only', /\npermissions:\n  contents: read\n\n/.test(wf) && /\n  build:\n[\s\S]*?\n    permissions:\n      contents: read\n    steps:/.test(wf))
  has('permissions: pages write and id-token write in the deploy job only', /\n  deploy:\n[\s\S]*?\n    permissions:\n      pages: write\n      id-token: write\n    environment:/)
  ok('pages.yml: pages write and id-token write appear once each (the deploy job)', count(wf, /pages: write/g) === 1 && count(wf, /id-token: write/g) === 1)
  has('one deployment at a time (concurrency group "pages")', /\nconcurrency:\n  group: pages\n/)
  ok('pages.yml: both jobs build and deploy only from main (a run by hand on another branch does nothing)', count(wf, /\n    if: github\.ref == 'refs\/heads\/main'\n/g) === 2)
  has('the build job checks out without keeping the token, and sets up Node 22', /uses: actions\/checkout@[0-9a-f]{40} # v[\d.]+\n\s+with:\n\s+persist-credentials: false\n\s+- uses: actions\/setup-node@[0-9a-f]{40} # v[\d.]+\n\s+with:\n\s+node-version: 22\n/)
  has('the build job runs node site/build.mjs --check, then assembles _site/ from the allowlist and uploads it', /run: node site\/build\.mjs --check\n[\s\S]*?run: node site\/tools\/deploy\.mjs _site\n\s+- uses: actions\/upload-pages-artifact@[0-9a-f]{40} # v[\d.]+\n\s+with:\n\s+path: _site\/\n/)
  has('the deploy job needs the build and uses actions/deploy-pages in the github-pages environment', /\n  deploy:\n[\s\S]*needs: build\n[\s\S]*environment:\n\s+name: github-pages\n[\s\S]*uses: actions\/deploy-pages@[0-9a-f]{40} # v[\d.]+\n/)
  ok('pages.yml: publishes only _site/ (no other upload path, no checkout of the repo root as the artifact)', count(wf, /path:/g) === 1)
  for (const f of ['pages.yml', 'site-check.yml']) {
    const w = existsSync(join(OUT, '.github/workflows', f)) ? readFileSync(join(OUT, '.github/workflows', f), 'utf8') : ''
    const uses = [...w.matchAll(/uses: (\S+)(.*)/g)]
    ok(`${f}: every action pinned to a full commit SHA, with its version in a comment (${uses.length})`, uses.length > 0 && uses.every(([, u, c]) => /^actions\/[\w-]+@[0-9a-f]{40}$/.test(u) && /^ # v\d+(\.\d+)*$/.test(c)))
    ok(`${f}: every checkout drops the job token after cloning`, count(w, /uses: actions\/checkout@/g) === count(w, /uses: actions\/checkout@\S+ # v[\d.]+\n\s+with:\n\s+persist-credentials: false\n/g))
    ok(`${f}: no event payload reaches a run step`, !/\$\{\{\s*github\.event/.test(w))
  }
}

// page content the brief asks for, asserted
const T = Object.fromEntries(Object.entries(pagesHTML).map(([f, h]) => [f, textOf(h, true)]))
ok('document control: every page says it is informational, not a controlled document', Object.values(pagesHTML).every((h) => h.includes('<div class="use"><dt>Use</dt><dd>Informational draft. Not a controlled document')))
const ov = pagesHTML['index.html'], ck = pagesHTML['check.html']
ok('index: definition directly under the H1', /<h1>Tokenized lab data\.<\/h1>[\s\S]{0,200}<h2 id="s1-h"><span class="no">1<\/span>Scope<\/h2>\s*<div class="body">\s*<p class="lead">Each result becomes a sealed record/.test(ov))
ok('index: the definition never implies a fingerprint reveals nothing', T['index.html'].includes('only a fingerprint will go on the network, never the values.') && !/values stay with the lab/.test(T['index.html']))
ok('copy: the Scope definition says what works (fingerprint of five fields, signed, linked) and states anchoring as upcoming', C.definition.startsWith('Each result becomes a sealed record: a SHA-256 fingerprint of five of its recorded fields, signed and linked to the record before it') && /Anchoring batches on a public network is an upcoming feature/.test(C.definition) && !/can be anchored|test network/i.test(C.definition))
ok('copy: every page description and the console’s keep anchoring out of the present tense', site.pages.every((p) => !/\banchor/i.test(p.description) || /upcoming/i.test(p.description)))
ok('copy: a description that says "signed" says demo, since it is read without the page around it', site.pages.every((p) => !/\bsigned\b/i.test(p.description) || /\bdemo\b/i.test(p.description)))
ok('index: regulatory line present, high on the page (1.1, before Fig. 1)', T['index.html'].includes(C.regulatory) && T['index.html'].indexOf(C.regulatory) < T['index.html'].indexOf('One sealed record'))
ok('index and check: demo-signature line present', T['index.html'].includes(C.demoSig) && T['check.html'].includes(C.demoSig))
ok('index: says tamper-evident', /tamper-evident/.test(T['index.html']))
ok('index: Fig. 1 shows the full fingerprint, previous link, link and signature head', ov.includes(g(S.r)) && ov.includes(g(S.prev)) && ov.includes(g(S.h)) && ov.includes(S.sig.slice(0, 16)))
ok('index: Fig. 1 carries the signature and public key it checks', ov.includes(`data-sig="${S.sig}"`) && ov.includes(`data-pub="${PUB}"`))
ok('index: Fig. 1 and Fig. 2 in order, then today, where it fits, what would go public, agents, the document set', (() => { const t = T['index.html']; const at = ['Fig. 1', 'Fig. 2', 'Today, upcoming and not claimed', 'Where it fits', 'What would go public', 'Agentic workflows', 'The document set'].map((s) => t.indexOf(s)); return at.every((v, i) => v > 0 && (i === 0 || v > at[i - 1])) })())
ok('index: Fig. 2 rows are the same sequence (value, capture time, fingerprint per record)', (() => { const tb = ov.match(/<table class="hist"[\s\S]*?<\/table>/)[0]; return recs.every((x) => tb.includes(`<th scope="row" role="rowheader" class="c-n">${x.n}</th>`) && tb.includes(`<time datetime="${x.f.capturedAt}">`) && tb.includes(`data-v>${x.f.value}</td>`) && tb.includes(`<code>${x.r.slice(0, 8)}</code>`)) && count(tb, /<tr role="row" data-n=/g) === N })())
ok('index: Fig. 2 links to Check a record, read-only', /data-history[\s\S]*?href="check\.html#verifier"/.test(ov) && !/<input|<button/.test(ov.match(/<figure class="fig fig--hist"[\s\S]*?<\/figure>/)[0]))
ok('index: the founder’s line once, where the agent roadmap is introduced', count(T['index.html'], /intelligence explosion/g) === 1 && /<section class="sec sec--side" id="agents"[\s\S]*?<blockquote class="pull"><p>In an intelligence explosion, human review can’t keep up with every result; records have to verify themselves\.<\/p>/.test(ov))
ok('index: where it fits names instrument, CDS, LIMS, QA review and the CSV export', ['Instrument', 'CDS', 'LIMS', 'QA review', 'CSV export'].every((w) => T['index.html'].includes(w)))
ok('index and check: embedded data matches the computed chain', ['index.html', 'check.html'].every((f) => { const d = JSON.parse(pagesHTML[f].match(/<script type="application\/json" id="iqc-seq">([\s\S]*?)<\/script>/)[1]); return d.anchor === anchor && d.pub === PUB && d.records.every((x, i) => x.r === recs[i].r && x.h === recs[i].h && x.prev === recs[i].prev && x.sig === recs[i].sig) }))
// the commands as a reader copies them: the text, without the <wbr> and spans that only let a long line break
const cmdText = (h) => [...h.matchAll(/<span class="p">([\s\S]*?)<\/span>\n|<pre class="rc-p"><code>([\s\S]*?)<\/code><\/pre>/g)].map((m) => ENT((m[1] ?? m[2]).replace(/<[^>]+>/g, '')))
ok('check: recipe prerendered for the selected record and exactly right', (() => { const c = cmdText(ck); return c.length === 2 && c[0] === `printf '%s' '${S.p}' | sha256sum` && c[1] === `printf '%s' '${S.prev}${S.r}${S.n}' | sha256sum` && H(S.p) === S.r && H(`${S.prev}${S.r}${S.n}`) === S.h })())
ok('sealed: both printf commands are exactly right', (() => { const c = cmdText(pagesHTML['sealed.html']); return c.length === 2 && c[0] === `printf '%s' '${S.p}' | sha256sum` && c[1] === `printf '%s' '${S.prev}${S.r}${S.n}' | sha256sum` })())
ok('check and sealed: a payload breaks only after a bar, never inside a value; the hex commands break anywhere', /HPLC-02\|<wbr>hplc\|<wbr>\d+\|<wbr>counts\|<wbr>2026-/.test(ck) && /HPLC-02\|<wbr>hplc\|<wbr>\d+\|<wbr>counts\|<wbr>2026-/.test(pagesHTML['sealed.html']) && /<span class="nw">\| sha256sum<\/span>/.test(ck))
ok('check: agent JSON names the anchor as simulated, labelled Upcoming', T['check.html'].includes('"status": "simulated, no network call"') && /What an AI agent would receive <span class="tag">Upcoming<\/span>/.test(ck))
ok('check: SST line matches the computed RSD', T['check.html'].includes(`peak-area RSD ${rsd.toFixed(2)}%`))
ok('check: the explanation follows the rule (only the link into the next record breaks)', T['check.html'].includes('breaks only the link into the next record'))
ok('check: status words never say "verified" (in GMP that means a second person checked)', !/verified/i.test(ck.match(/<template id="iqc-words">[\s\S]*?<\/template>/)[0]) && !/verified at build/.test(ck))
ok('sealed: the privacy note, the reason in plain words, two anchors one record apart, and what anchoring would write', ['A plain SHA-256 of a few guessable fields', 'can in principle be matched by trying likely values', 'Nothing on this site or in the console writes to a public network. When anchoring becomes available, it will write only a batch fingerprint, never the values', 'two anchors one record apart', 'zero-knowledge proofs', 'Salted (hiding) commitments'].every((w) => T['sealed.html'].includes(w)))
ok('sealed: anchoring is upcoming, the registry code is written, every anchor here is simulated, no shared registry', ['Anchoring is an upcoming feature', 'The registry code for that network (a smart contract) is written, but nothing on this site or in the console writes to a network', 'no shared registry exists yet', 'Every anchor here is simulated'].every((w) => T['sealed.html'].includes(w)) && /<h2 id="s7-h"><span class="no">7<\/span><span>Anchoring a batch <span class="tag">Upcoming<\/span>/.test(pagesHTML['sealed.html']))
ok('sealed: what a pass and a fail do and do not show', ['A pass shows', 'A pass does not show', 'A fail shows', 'A fail does not show'].every((w) => T['sealed.html'].includes(w)))
ok('sealed: a pass does not show that no record was removed; only an anchor fixes a record’s place', T['sealed.html'].includes('That no record was removed') && T['sealed.html'].includes('only an anchor fixes its place in the history') && !/sits where it was sealed/.test(T['sealed.html']))
ok('about and regulatory: a removed record with every later link rewritten is said to need no key', T['about.html'].includes('Deleting a record and relinking the ones after it needs no key') && T['regulatory.html'].includes('which needs no key') && !/so a missing one shows/.test(T['regulatory.html']))
ok('sealed: corrections are appended with a reason', T['sealed.html'].includes('Corrections appended with a reason'))
{
  const rm = T['roadmap.html'], planned = pagesHTML['roadmap.html'].match(/<section class="sec sec--side" id="planned"[\s\S]*?<\/section>/)[0]
  // the founder's list of upcoming features (step 3b), each under its own heading with the one label, in this order
  const UPCOMING = [['agents', 'Agentic workflows'], ['privacy', 'Privacy on public networks'], ['anchoring', 'Anchoring on a public test network'], ['filecoin', 'Filecoin integration'], ['signatures', 'Per-analyst signatures'], ['review', 'Reviewer sign-off'], ['verification', 'Server-side verification in the app'], ['metadata', 'Sample and method metadata in the seal'], ['registry', 'A shared registry']]
  for (const [id, name] of UPCOMING) ok(`roadmap: "${name}" is labelled Upcoming`, new RegExp(`<h3 id="${id}"><span class="no">2\\.\\d</span><span>${name} <span class="tag">Upcoming</span></span></h3>`).test(planned))
  eq('roadmap: the upcoming items, in order, and nothing else under Upcoming', [...planned.matchAll(/<h3 id="([\w-]+)">/g)].map((m) => m[1]).join(' '), UPCOMING.map(([id]) => id).join(' '))
  ok('roadmap: section 2 is called Upcoming; the page keeps its name', /<h2 id="s2-h"><span class="no">2<\/span>Upcoming<\/h2>/.test(planned) && /<h1 class="h1-doc">Roadmap<\/h1>/.test(pagesHTML['roadmap.html']))
  ok('roadmap: no dates on planned items', !/\b20\d\d\b|\bQ[1-4]\b|\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/.test(textOf(planned, true)))
  ok('roadmap: the privacy reason in plain sentences, and what anchoring would write', rm.includes('A plain SHA-256 of a few guessable fields can in principle be matched by trying likely values') && rm.includes('When anchoring becomes available it will write only a batch fingerprint, never the values'))
  ok('roadmap: Filecoin integration promises no storage of records', !/\bstorage\b/i.test(textOf(planned.match(/<h3 id="filecoin">[\s\S]*?(?=<h3 )/)[0], true)))
  ok('roadmap: the agent-readable record from Check, labelled roadmap', /href="check\.html#agent"/.test(planned))
}
{
  const ab = T['about.html'], qs = count(pagesHTML['about.html'], /<h3 id="q\d+">/g)
  ok(`about: 5 to 7 questions (${qs})`, qs >= 5 && qs <= 7)
  ok('about: "Do I need to buy or hold anything?" answered plainly', ab.includes('Do I need to buy or hold anything? No. There is nothing to buy, hold or connect.'))
  ok('about: "Is my data put on a blockchain?"', ab.includes('Is my data put on a blockchain? No.'))
  ok('about: the founder’s name, joseqc.com for contact, the independence line, revision history', ab.includes('José A. Fernández Abreu') && /href="https:\/\/joseqc\.com"><span>joseqc\.com<\/span>/.test(pagesHTML['about.html']) && ab.includes(C.independence) && pagesHTML['about.html'].includes('id="history"'))
}
ok('regulatory: every framework, expectation by expectation, with approach, today and not covered', ['21 CFR Part 11', 'EU GMP Annex 11', 'ISO/IEC 17025:2017', 'ALCOA+', 'GMP records', 'TNI'].every((w) => T['regulatory.html'].includes(w)) && (() => { const cl = pagesHTML['regulatory.html'].match(/<article class="cl"[\s\S]*?<\/article>/g) || []; return cl.length >= 20 && cl.every((a) => /<dt>(Approach)<\/dt>/.test(a) && /<dt>Today<\/dt>/.test(a) && /<dt>Not covered<\/dt>/.test(a)) })())
ok('regulatory: every Upcoming tag on the map follows one of the nine roadmap items, linked to it', (() => { const rg = pagesHTML['regulatory.html'].replace(/<p class="note">[\s\S]*?<\/p>/, ''); const tags = count(rg, /<span class="tag">Upcoming<\/span>/g); const linked = count(rg, /<a href="roadmap\.html#(?:agents|privacy|anchoring|filecoin|signatures|review|verification|metadata|registry)">[^<]+<\/a>[^<]{0,80}<span class="tag">Upcoming<\/span>/g); return tags > 0 && tags === linked })())
ok('404: short, with links home', T['404.html'].includes('Page not found') && /href="index\.html"/.test(pagesHTML['404.html']))
ok('pages: "Simulated · demo data" label on every plate', T['index.html'].split('Simulated · demo data').length === 3 && T['check.html'].includes('Simulated · demo data'))
ok('words: every key the scripts read exists in the page templates', (() => {
  const keys = (f) => new Set([...pagesHTML[f].matchAll(/data-k="([\w.]+)"/g)].map((m) => m[1]))
  const ck2 = keys('check.html'), ov2 = keys('index.html')
  const used = [...js.matchAll(/say\((?:`([\w.]+)`|'([\w.]+)')/g)].map((m) => m[1] || m[2]).filter((k) => !k.includes('${'))
  const missing = used.filter((k) => !ck2.has(k) && !ov2.has(k))
  const dyn = ['s.reset', 's.rewrite', 's.correct', 's.correct.none', 'm.fp.ok', 'm.fp.bad', 'm.sig.ok', 'm.sig.bad', 'm.sig.na', 'm.sig.none', 'm.link.ok', 'm.link.bad',
    'r.sig.ok', 'r.sig.bad', 'r.sig.na', 'r.sig.none', 'r.sig.missing', 'd.sig.ok', 'd.sig.bad', 'd.sig.na', 'd.sig.none', 'd.sig.missing', 'n.fp', 'n.sig', 'n.link', 'n.anc',
    'm.sig.missing', 'st.head', 'st.head.nosig', 'row.sep', 'row.sigm', 'r.sep', 'd.fp.sep', 'w.fpsep', 'w.sigm', 'chip.corr', 's.sep', 's.need', 'a.notall', 'a.na', 'a.none']
  const plateKeys = ['fp.ok', 'fp.bad', 'sig.ok', 'sig.bad', 'sig.na', 'link.ok', 'link.bad', 'st', 'st.nosig']
  const histKeys = ['fp.ok', 'fp.bad', 'link.ok', 'link.bad', 'sig.ok', 'sig.bad', 'sig.na', 'sig.none', 'head.ok', 'head.bad', 'st.head', 'st.head.nosig', 'st.chg', 'st.sig1', 'st.sig', 'st.link1', 'st.link', 'st.anc', 'st.anc.part', 'st.anc.no', 'st.unanch1', 'st.unanch', 'st.nosig']
  const hist = new Set(Object.keys(tplWords('partials/plate-history.html', 'iqc-hist-words')))
  missing.push(...dyn.filter((k) => !ck2.has(k)), ...plateKeys.filter((k) => !ov2.has(k)), ...histKeys.filter((k) => !hist.has(k)))
  if (missing.length) console.error('missing words:', missing)
  return missing.length === 0
})())

// ------------------------------------------------------------------------------------------------ 8. budgets (estimate; measured in the browser by site/tools/check.mjs)
const gz = (b) => gzipSync(b, { level: 9 }).length
const fontsUsed = Object.keys(site.fonts).map((f) => readFileSync(join(OUT, 'fonts', f)).length).reduce((a, b) => a + b, 0)
const sizes = {}
for (const [file, html] of Object.entries(pagesHTML)) {
  const total = gz(Buffer.from(html)) + gz(Buffer.from(css)) + gz(Buffer.from(js)) + fontsUsed + gz(Buffer.from(favicon))
  sizes[file] = { html: gz(Buffer.from(html)), total }
  ok(`budget: ${file} first load ${(total / 1024).toFixed(1)} KB gz <= 160 KB`, total <= 160 * 1024)
}
ok(`budget: eager JS ${(gz(Buffer.from(js)) / 1024).toFixed(1)} KB gz <= 22 KB`, gz(Buffer.from(js)) <= 22 * 1024)
ok(`budget: fonts ${(fontsUsed / 1024).toFixed(1)} KB <= 100 KB`, fontsUsed <= 100 * 1024)

// ------------------------------------------------------------------------------------------------ 9. write, or compare with what is committed
const stale = []
for (const [p, b] of Object.entries(out)) {
  const f = join(OUT, p)
  const same = existsSync(f) && readFileSync(f).equals(b)
  if (CHECK) { if (!same) stale.push(p) } else if (!same) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, b) }
}
// files under assets/ that the build no longer makes
for (const f of existsSync(join(OUT, 'assets')) ? readdirSync(join(OUT, 'assets')) : []) if (!(`assets/${f}` in out)) stale.push(`assets/${f} (not made by the build)`)
if (CHECK) ok(`output up to date (run node site/build.mjs): ${stale.join(', ') || 'all files match'}`, stale.length === 0)
die()
console.log(`${CHECK ? 'check' : 'build'} ok: ${passed} assertions passed · ${Object.keys(pagesHTML).length} pages · anchor ${anchor.slice(0, 8)}… · key ${keyId.slice(0, 8)}… · SST RSD ${rsd.toFixed(2)}%`)
console.log(`gzip: css ${(gz(Buffer.from(css)) / 1024).toFixed(1)} KB · js ${(gz(Buffer.from(js)) / 1024).toFixed(1)} KB · fonts ${(fontsUsed / 1024).toFixed(1)} KB · ` + Object.entries(sizes).map(([f, s]) => `${f} ${(s.html / 1024).toFixed(1)}/${(s.total / 1024).toFixed(1)}`).join(' · '))
