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
// Fig. 3 (the record history) uses statusLine() with its own template words: same sentences
{
  const sayH = sayer(tplWords('partials/plate-history.html', 'iqc-hist-words'))
  const r = await IQC.replay(E, clone(), async () => true)
  eq('Fig. 3 words: sealed status', IQC.statusLine(r, { AN, signing: true, anchorOk: true }, sayH), `Checked in your browser: ${N} of ${N} records pass · simulated anchor matches`)
  eq('Fig. 3 words: status where signatures cannot be checked', IQC.statusLine(r.map((o) => ({ ...o, sig: null })), { AN, signing: false, anchorOk: true }, sayH), `Checked in your browser: ${N} of ${N} records pass the fingerprint and link checks · simulated anchor matches · signatures not checked here`)
}

// ------------------------------------------------------------------------------------------------ 3c. the Overview story
// Overview section 3 (section 2 until Draft 6) walks one real record, record 6 of the signed sequence, through seven steps. Every value in every
// state is computed here and asserted. Step 5 is Check a record's own edit of record 6 (+100 counts, as in section 3b),
// made in place; step 6 makes the same change the right way, as a correction: record 9 carries the new value with a
// reason that fits the trace of step 1 (the CDS integrated 1508811 first; a reintegration after review gave the new
// value, imported again, as Check a record's help says a reintegration should go). It is signed as Check a record signs
// a correction: with a one-time demo key, here made at build and discarded.
const STORYF = join(HERE, 'data/story.json')
if (ARG.has('--sign-story') && CHECK) { console.error('--check never writes: run it without --sign-story'); process.exit(2) }
const STORY = (() => {
  const k = SN, R6 = recs[k - 1], R5 = recs[k - 2], R7 = recs[k], R8 = recs[N - 1]
  const value = String(+R6.f.value + 100), reason = 'Peak reintegrated in the CDS after review; result imported again'
  const fx = { ...R6.f, value }, px = payload(fx), rx = H(px), hx = H(R6.prev + rx + String(k))
  const r9 = H(px), h9 = H(anchor + r9 + String(N + 1))
  return { k, R5, R6, R7, R8, value, reason, fx, px, rx, hx, r9, h9, digit: [...R6.f.value].findIndex((c, i) => c !== value[i]) }
})()
{
  const { k, R6, value, reason, r9 } = STORY
  let st = existsSync(STORYF) ? JSON.parse(readFileSync(STORYF, 'utf8')) : null
  const good = (s) => !!s && s.n === N + 1 && s.corrects === k && s.value === value && s.reason === reason && s.r === r9 && /^04[0-9a-f]{128}$/.test(s.pub) && IQC.sigForm(s.sig) && sigOk(pubFromHex(s.pub), s.sig, r9)
  if (!good(st) && !ARG.has('--sign-story')) {
    console.error('site/data/story.json no longer covers record 9 of the Overview story. Sign it on purpose with: node site/build.mjs --sign-story')
    process.exit(1)
  }
  if (ARG.has('--sign-story')) {
    // a one-time demo key, as Check a record makes for a correction; its private half is never written
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const jwk = publicKey.export({ format: 'jwk' })
    const pub = '04' + Buffer.from(jwk.x, 'base64url').toString('hex').padStart(64, '0') + Buffer.from(jwk.y, 'base64url').toString('hex').padStart(64, '0')
    st = { _note: 'Record 9 of the Overview story: a correction of record 6, signed over r_9 (ECDSA P-256, SHA-256, IEEE P1363 hex, low-S form) with a one-time demo key, as Check a record signs a correction. Written by site/build.mjs --sign-story; the private key was never written and was discarded.', n: N + 1, corrects: k, value, reason, r: r9, pub, sig: IQC.lowS(sign('sha256', Buffer.from(r9, 'hex'), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('hex')) }
    writeFileSync(STORYF, JSON.stringify(st, null, 1) + '\n')
    console.log(`story.json written with a one-time demo key ${pub.slice(0, 10)}… (private key discarded)`)
  }
  STORY.pub9 = st.pub; STORY.sig9 = st.sig
  STORY.key9 = createHash('sha256').update(pubFromHex(st.pub).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 32).toUpperCase()
  ok('story.json: no private key material', !/"d"\s*:|BEGIN [A-Z ]*PRIVATE KEY|pkcs8/.test(readFileSync(STORYF, 'utf8')))
}
{
  const { k, R5, R6, R7, R8, value, fx, px, rx, hx, r9, h9, pub9, sig9, key9 } = STORY
  // step 1, captured: injection 06 on HPLC-02, RT 4.82 min, its peak area the record's value
  eq('story: the record is the showcase record 6', k, 6)
  eq('story: record 6 is injection 06 on HPLC-02, RT 4.82 min', `${R6.ctx.inj} ${R6.f.instrumentId} ${R6.ctx.rt}`, '06 HPLC-02 4.82')
  eq('story: record 6 value', R6.f.value, '1508811')
  // step 2, fingerprinted
  eq('story: record 6 payload', R6.p, 'HPLC-02|hplc|1508811|counts|2026-09-14T08:47:50Z')
  eq('story: record 6 payload bytes', Buffer.byteLength(R6.p), 48)
  ok('story: r6 is SHA-256 of the payload (node:crypto and the pure-JS fallback)', R6.r === H(R6.p) && pure(R6.p) === R6.r && /^[0-9a-f]{64}$/.test(R6.r))
  // step 3, signed
  ok('story: record 6 signature verifies with the demo key', sigOk(pubKey, R6.sig, R6.r) && IQC.sigForm(R6.sig))
  // step 4, linked
  ok('story: h6 = SHA-256(h5 + r6 + "6"), and record 7 carries h6', R6.prev === R5.h && R6.h === H(R5.h + R6.r + '6') && R7.prev === R6.h)
  // step 5, a change shows
  eq('story: the changed value is Check a record’s +100 edit', value, '1508911')
  eq('story: one digit changes', [...R6.f.value].filter((c, i) => c !== value[i]).length, 1)
  ok('story: the changed payload is 48 bytes and gives a different fingerprint', Buffer.byteLength(px) === 48 && px === R6.p.replace(R6.f.value, value) && rx !== R6.r && rx === pure(px))
  ok('story: record 6’s signature does not cover the changed fingerprint', !sigOk(pubKey, R6.sig, rx))
  ok('story: the recomputed link of record 6 differs from the h6 record 7 carries', hx !== R6.h && hx === H(R5.h + rx + '6') && R7.prev === R6.h)
  {
    const alt = clone(); alt[k - 1].f = { ...fx }
    const rows = await IQC.replay(E, alt, async (x, rp) => rp === recs[x.n - 1].r)
    ok('story, change: record 6 fails fingerprint, signature and its link', !rows[k - 1].fp && rows[k - 1].sig === false && !rows[k - 1].link && rows[k - 1].rp === rx && rows[k - 1].hp === hx)
    ok('story, change: every other record passes its own checks (7 and 8 included)', rows.every((o) => o.n === k || o.ok))
    STORY.fhx = rows[N - 1].fh
    ok('story, change: the replayed head no longer matches the anchored fingerprint', STORY.fhx !== anchor && /^[0-9a-f]{64}$/.test(STORY.fhx))
  }
  // step 6, a correction is appended: record 9, same five fields as the change, linked from h8, signed with a one-time key
  ok('story: record 9 is the corrected record’s fields, fingerprinted', r9 === H(payload(fx)) && r9 === rx)
  ok('story: h9 = SHA-256(h8 + r9 + "9")', h9 === H(R8.h + r9 + '9') && R8.h === anchor)
  ok('story: record 9’s signature verifies with its one-time key, in low-S form', sigOk(pubFromHex(pub9), sig9, r9) && IQC.lowS(sig9) === sig9)
  ok('story: the one-time key is not the demo key that signed records 1 to 8', pub9 !== PUB && key9 !== keyId && !sigOk(pubFromHex(pub9), R6.sig, R6.r))
  {
    const k9 = await webcrypto.subtle.importKey('raw', Buffer.from(pub9, 'hex'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    ok('story: record 9’s signature verifies with WebCrypto', await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k9, Buffer.from(sig9, 'hex'), Buffer.from(r9, 'hex')))
    const c = clone()
    c.push({ n: N + 1, f: { ...fx }, r: r9, prev: anchor, h: h9, sig: sig9, corrects: k })
    const rows = await IQC.replay(E, c, async (x, rp) => (x.n <= N ? rp === recs[x.n - 1].r : webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k9, Buffer.from(x.sig, 'hex'), Buffer.from(rp, 'hex'))))
    ok('story, correction: all nine records pass; records 1 to 8 still match the anchor; the head is h9', rows.every((o) => o.ok && o.sig === true) && rows[N - 1].fh === anchor && rows[N].fh === h9)
  }
}
// the rule of step 5, in Check a record's own words (site/partials/verifier.html), never retyped here
const RULE = (rd('partials/verifier.html').match(/, so (a changed value fails that record’s fingerprint and signature and breaks only the link into the next record)\./) || [])[1]
ok('story: Check a record states the rule the story quotes', !!RULE)
// the simulated chromatogram of step 1: drawn from data. One Gaussian peak at the record's retention time, on a slowly
// drifting baseline, sampled every 15 s, and every second within the integration window. Its area above a drop line between the ends of the
// integration window (apex ± 4.5 sigma) is the record's value, in counts (µV·s): the trace is illustrative, the area is not.
const CHROM = (() => {
  const rt = +STORY.R6.ctx.rt, sig = 4.6 / 60, t0 = 3.6, t1 = 6.4, a = rt - 4.5 * sig, b = rt + 4.5 * sig
  const drift = (t) => 2600 * (t - t0) + 900 * Math.sin(1.7 * t)
  const shape = (t) => Math.exp(-0.5 * ((t - rt) / sig) ** 2)
  const ts = []
  for (let t = t0; t < a - 1e-9; t += 0.25) ts.push(+t.toFixed(4))
  for (let s = Math.ceil(a * 60); s <= Math.floor(b * 60); s++) ts.push(s / 60)
  for (let t = Math.ceil(b * 4) / 4; t <= t1 + 1e-9; t += 0.25) ts.push(+t.toFixed(4))
  const win = ts.filter((t) => t >= a && t <= b)
  const ta = win[0], tb = win[win.length - 1], line = (t) => drift(ta) + ((drift(tb) - drift(ta)) * (t - ta)) / (tb - ta)
  // trapezoid area in µV·s of shape alone, and of the baseline's own excess over the drop line
  const trap = (f) => win.slice(1).reduce((s, t, i) => s + ((f(t) + f(win[i])) / 2) * (t - win[i]) * 60, 0)
  const A1 = trap(shape), A0 = trap((t) => drift(t) - line(t))
  const Hpk = (+STORY.R6.f.value - A0) / A1
  const y = (t) => drift(t) + Hpk * shape(t)
  const area = trap((t) => y(t) - line(t))
  const ymax = Hpk * 1.08, W = 300, HH = 100
  const X = (t) => +(((t - t0) / (t1 - t0)) * W).toFixed(2), Y = (v) => +(HH - 4 - (v / ymax) * (HH - 8)).toFixed(2)
  const pts = ts.map((t) => `${X(t)},${Y(y(t))}`)
  const trace = `M${pts.join('L')}`
  const fill = `M${X(ta)},${Y(line(ta))}L${win.map((t) => `${X(t)},${Y(y(t))}`).join('L')}L${X(tb)},${Y(line(tb))}Z`
  const drop = `M${X(ta)},${Y(line(ta))}L${X(tb)},${Y(line(tb))}`
  const apex = ts.reduce((m, t) => (y(t) > y(m) ? t : m), ts[0])
  const pct = (t) => +(((t - t0) / (t1 - t0)) * 100).toFixed(2)
  return { rt, sig, t0, t1, area, Hpk, apex, trace, fill, drop, pct, ticks: [4, 5, 6], W, HH }
})()
ok(`story, chromatogram: the shaded area is the record’s value (${CHROM.area.toFixed(3)} µV·s)`, Math.abs(CHROM.area - +STORY.R6.f.value) < 0.01)
ok(`story, chromatogram: the apex is at the record’s retention time (${CHROM.apex.toFixed(3)} min)`, Math.abs(CHROM.apex - CHROM.rt) < 0.5 / 60)
ok('story, chromatogram: the window holds the whole peak and its ticks', CHROM.ticks.every((t) => t > CHROM.t0 && t < CHROM.t1) && CHROM.rt - 4.5 * (4.6 / 60) > CHROM.t0 && CHROM.rt + 4.5 * (4.6 / 60) < CHROM.t1)

// ------------------------------------------------------------------------------------------------ 4. assets
const out = {} // every output file, path -> Buffer
const put = (p, data) => { out[p] = Buffer.isBuffer(data) ? data : Buffer.from(data) }
// the printed page's running footer carries the revision (site/src/site.css, @page): stamped here from site.json
ok('css: the print footer has its revision placeholder', rd('src/site.css').includes('__REVISION__'))
ok('css: the print footer has its per-document placeholder', rd('src/site.css').includes('__DOC_PAGES__'))
// printed, every page of a document names it: a named page per document id, with the id, revision and use line in its footer
const docPage = (doc) => `doc-${doc.toLowerCase()}`
const DOC_PAGES = site.pages.map((p) => `@page ${docPage(p.doc)}{@bottom-left{content:"${p.doc} · ${site.revision} · informational draft, not a controlled document"}}\nbody[data-doc="${p.doc}"]{page:${docPage(p.doc)}}`).join('\n')
// the story's states (Overview section 3): per state, which parts show, are dimmed, drawn, grown, wiped in or failing
const STORY_STATES = [
  ['on', '{opacity:1;visibility:visible}'], ['draw', '{stroke-dashoffset:0}'], ['grow', '{transform:none}'], ['wipe', '{clip-path:inset(0)}'],
  ['dim', '{--fg:var(--p-fg2);--okc:var(--p-fg2);--okt:var(--p-fg2)}'], ['bad', '{--fg:var(--fail);--fg2:var(--fail);--okc:var(--fail);--okt:var(--fail);color:var(--fail)}'],
].map(([a, r]) => Array.from({ length: 8 }, (_, i) => `.sc[data-s="${i}"] [data-${a}~="${i}"]`).join(',') + r).join('\n')
ok('css: the story states placeholder is there', rd('src/site.css').includes('__STORY_STATES__'))
const css = rd('src/site.css').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n\s*\n/g, '\n').replace(/^\s+/gm, '').trim().replaceAll('__REVISION__', site.revision).replace('__DOC_PAGES__', DOC_PAGES).replace('__STORY_STATES__', STORY_STATES) + '\n'
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
// The one inline script (allowed by its hash in the CSP below). Before first paint it sets .js and .motion, the --svh
// token and .stage (the Overview story's wide layout). It also
// runs the Contents menu (narrow screens) by delegation, so the menu works before the deferred site script runs, and
// even if that script never loads; and on the 404 page, whose <base href="/"> would send "#main" home, the skip link.
const prepaint = [
  "(function(d){var c=d.documentElement.classList;c.add('js');try{if(!matchMedia('(prefers-reduced-motion: reduce)').matches)c.add('motion')}catch(e){}",
  // --svh: the viewport height at load, in px (a token, not a viewport unit; iqc.js renews it when the window is resized,
  // but never for a touch screen's URL bar, so that never moves it). html.stage: wide and tall enough for the Overview's
  // sticky stage at its full size (it is about 560 px tall from 1180 px wide and about 660 px below that; it never shrinks,
  // so its smallest text stays 12 px).
  "var r=d.documentElement,h=innerHeight;r.style.setProperty('--svh',h+'px');if(innerWidth>=960&&h>=(innerWidth>=1180?600:700)&&'IntersectionObserver'in window)c.add('stage');",
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
// Fig. 3: the record history, the same sequence and signed data as everywhere else on the site
const NODE = '<svg class="nd" viewBox="0 0 20 20" aria-hidden="true"><circle class="rg" cx="10" cy="10" r="6.5"/><circle class="dr" cx="10" cy="10" r="6.5" pathLength="1"/><circle class="dt" cx="10" cy="10" r="2.75"/><path class="xx" d="M7.7 7.7l4.6 4.6m0-4.6l-4.6 4.6"/></svg>'
const ST = (w) => `<span class="st"><svg class="i" aria-hidden="true"><use href="#i-open"/></svg><span class="w">${w}</span></span>`
const histRows = recs.map((x) => `<tr role="row" data-n="${x.n}"><td role="cell" class="c-sp">${NODE}</td><th scope="row" role="rowheader" class="c-n">${x.n}</th><td role="cell" class="c-smp">${x.ctx.sample}<span class="kd"> · ${x.ctx.kind === 'SST' ? 'system suitability' : 'sample'}, ${x.ctx.prep}</span></td><td role="cell" class="c-rt">${x.ctx.rt}</td><td role="cell" class="c-at"><time datetime="${x.f.capturedAt}">${x.f.capturedAt.slice(11, 19)}</time></td><td role="cell" class="c-pa" data-v>${x.f.value}</td><td role="cell" class="c-fp"><code>${x.r.slice(0, 8)}</code><span class="sr-only" data-fpw>fingerprint checked at build</span></td><td role="cell" class="c-ln" data-m="link" data-s="build">${ST('intact')}</td><td role="cell" class="c-sg" data-m="sig" data-s="build">${ST('valid')}</td></tr>`).join('\n')
const day = SEQ.records[0].capturedAt.slice(0, 10)
ok('Fig. 3: the whole run is on one day', SEQ.records.every((x) => x.capturedAt.startsWith(day)))
const runLine = `${day}, ${SEQ.records[0].capturedAt.slice(11, 16)} to ${SEQ.records[N - 1].capturedAt.slice(11, 16)} UTC`
const samples = SEQ.records.filter((x) => x.kind === 'Sample').map((x) => x.sample)
const histCaption = `${N} injections, one record each: ${sst.length} system-suitability injections of the reference standard (${SEQ.records[0].sample}), then ${samples.length} preparations of Product 200 mg tablets (${samples[0]} to ${samples[samples.length - 1]}).`
ok('Fig. 3: the caption counts come from the data', SEQ.assay.includes('Product 200 mg tablets'))

// Overview section 3, the story: one scene, drawn eight times. Each step carries its own static figure in that step's
// final state (the view without JavaScript, with reduced motion and on phones), holding only the parts that step needs;
// wide screens show one sticky stage with every part instead. A part says in which states it shows (data-on), is dimmed
// (data-dim), drawn (data-draw), grown (data-grow), wiped in (data-wipe) or failing (data-bad); site.css turns those into
// styles per [data-s], and iqc.js only moves between them. data-d is a part's delay in ms on entering a state ("2:300"),
// which the parts inside it share unless they name their own; data-fly is the part a value flies in from.
// Each step plays in under a second (iqc.js adds 120 ms for what leaves to clear and 420 ms to arrive, or 520 to fly in,
// so no delay here goes past 460): first the cause, then what it causes (step 2: the fields fly into the payload, which
// is then hashed, its fingerprint resolving left to right).
const STP = { titles: ['Captured', 'Fingerprinted', 'Signed', 'Linked', 'A change shows', 'A correction is appended', 'What comes next'] }
STP.parts = { 1: ['src', 'card'], 2: ['card', 'fp'], 3: ['card', 'fp', 'sig'], 4: ['ch'], 5: ['card', 'fp', 'sig', 'ch'], 6: ['k6', 'cor', 'ch'], 7: ['net', 'ag', 'ch'] }
// On a phone a figure waits in the state before its own and plays into it once it is in view. Fig. 2.6 waits in the
// intact chain of step 4 instead: the change of step 5 was only supposed, so its play appends record 9 and never shows
// a broken chain being mended.
STP.from = [0, 1, 2, 3, 4, 4, 6]
// Off screen, a step's figure is not rendered until it comes near (content-visibility: auto), which keeps the story out of
// the Overview's first paint; until then its plate holds an estimated content height (inside its padding), one for
// each band of widths: up to 359, 360 to 479, 480 to 699 and from 700 px (site.css picks one). Each is measured across
// its band and set between the band's lowest and highest heights, so it is off by the same share either way, except
// 360 to 479, which is exact at 390 px (to the layout's 1/64 px), the commonest phone width, so a figure rendered there
// for the first time moves nothing;
// site/tools/check.mjs fails if one is more than 25% off at 320, 390, 412, 600 or 768. The browser keeps the real height
// once it has rendered it.
STP.est = [[401, 390.578, 287, 225], [392, 382.219, 339, 339], [486, 427.109, 394, 394], [240, 216.266, 190, 181], [713, 667.344, 561, 551], [607, 549.984, 478, 431], [541, 531.422, 452, 435]]
STP.ci = (n) => STP.est[n - 1].map((v, i) => `--c${i + 1}:${v}px`).join(';')
const storyHTML = (() => {
  const { k, R5, R6, value, reason, rx, hx, r9, h9, sig9, key9, digit } = STORY
  // S: the states this figure can show (a static figure: its own and the one it waits in; the stage: all). A part, or a
  // variant of one, that shows in none of them is left out of that figure.
  let S = null
  const shows = (on) => !on || on.split(' ').some((x) => S.has(+x))
  const at = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([a, v]) => ` data-${a}="${v}"`).join('')
  const el = (tag, cls, o, inner) => (shows(o.on) ? `<${tag}${cls ? ` class="${cls}"` : ''}${at(o)}>${inner}</${tag}>` : '')
  const s8 = (h) => `<span class="h8" title="${h}">${h.slice(0, 8)}…</span>`
  const s16 = (h) => `<span title="${h}">${h.slice(0, 16)}…${h.slice(-16)}</span>`
  const chg = (v) => `${esc(v.slice(0, digit))}<b>${esc(v[digit])}</b>${esc(v.slice(digit + 1))}`
  const groups8 = (h, o, d0, step) => el('span', 'g4', o, h.match(/.{8}/g).map((g, i) => `<span class="g"${at({ on: o.on, d: `${o.on.split(' ')[0]}:${d0 + i * step}` })}>${g}</span>`).join(''))
  // the seal: a ring drawn once the record is signed, a dot filled once it is linked (both: sealed), a cross while it fails
  const seal = (o = {}) => `<svg class="sn${o.cls ? ` ${o.cls}` : ''}" viewBox="0 0 20 20" aria-hidden="true" focusable="false"${at({ bad: o.bad, d: o.d })}><circle class="rg" cx="10" cy="10" r="6.5"/><circle class="dr" cx="10" cy="10" r="6.5" pathLength="1"${at({ draw: o.draw, d: o.dd })}/><circle class="dt" cx="10" cy="10" r="2.75"${at({ on: o.dot, d: o.dtd })}/>${o.x && shows(o.x) ? `<path class="xx" d="M7.2 7.2l5.6 5.6m0-5.6l-5.6 5.6"${at({ on: o.x })}/>` : ''}</svg>`
  const F = { instrumentId: 'Instrument', sensorType: 'Measurement', value: 'Peak area', unit: 'Unit', capturedAt: 'Captured (UTC)' }
  const C = CHROM
  const part = {
    src: () => `<div class="sc-src"${at({ on: '0 1 2 3 4 5 6', dim: '2 3 4 5 6' })}>
<p class="chr-h"><span class="lab">Injection ${R6.ctx.inj}</span><span class="say sw">${el('span', '', { on: '0 1 2 3 4 5' }, 'illustrative trace')}${el('span', '', { on: '6' }, `illustrative · sealed in #${k}`)}</span></p>
<div class="chr">
<svg class="chr-g" viewBox="0 0 ${C.W} ${C.HH}" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path class="chr-pk" d="${C.fill}"${at({ on: '1 2 3 4 5 6', d: '1:160' })}/><path class="chr-dl" d="${C.drop}"${at({ on: '1 2 3 4 5 6', d: '1:160' })}/><path class="chr-tr" pathLength="1" d="${C.trace}"${at({ draw: '1 2 3 4 5 6' })}/></svg>
<span class="chr-rt" style="left:${C.pct(C.rt)}%"${at({ on: '1 2 3 4 5 6', d: '1:140' })}>${R6.ctx.rt} min</span>
<span class="chr-ar" style="left:${C.pct(C.rt + 3.4 * C.sig)}%"${at({ on: '1 2 3 4 5 6', d: '1:220', 'fly-at': 'area' })}>Area <b>${R6.f.value}</b> counts</span>
</div>
<p class="chr-x" aria-hidden="true">${C.ticks.map((t) => `<span style="left:${C.pct(t)}%">${t}</span>`).join('')}<span class="u">min</span></p>
</div>`,
    // record 6: five fields; signed in step 3, sealed once linked in step 4; its value changed in place in step 5 only
    card: () => `<div class="sc-card"${at({ on: '1 2 3 4 5 6 7', dim: '7' })}>${el('span', 'fr', { on: '4 6 7', d: '4:240 5:340' }, '')}${el('span', 'fr fr--x', { on: '5', d: '5:340' }, '')}
<div class="cd-h"><p class="lab">Record ${k} <span class="sub sw">${el('span', '', { on: '1 2' }, '· five fields')}${el('span', '', { on: '3', d: '3:300' }, '· signed')}${el('span', '', { on: '4 7', d: '4:240' }, '· sealed')}${el('span', '', { on: '5' }, '· changed after sealing')}${el('span', '', { on: '6' }, '· stays as sealed')}</span></p>${seal({ cls: 'sn--seal', draw: '3 4 5 6 7', dd: '3:300', dot: '4 6 7', dtd: '4:240', x: '5', bad: '5', d: '5:340' })}</div>
<dl class="cd">${IQC.FIELDS.map((f) => `<div><dt>${F[f]}</dt><dd${f === 'value' ? '' : at({ 'fly-at': f })}>${f === 'value' ? `<span class="sw" data-fly-at="value">${el('span', '', { on: '1 2 3 4 6 7', fly: '1:area', d: '1:280' }, R6.f.value)}${el('span', 'vx', { on: '5', bad: '5' }, chg(value))}</span>` : f === 'capturedAt' ? tsHTML(R6.f[f]) : esc(R6.f[f])}</dd></div>`).join('')}</dl>
</div>`,
    // Fig. 2.6 on a phone has no card for record 6: one sealed line says it stays as it was
    k6: () => `<div class="sc-k6"${at({ on: '6' })}>${seal()}<p class="lab">Record ${k} <span class="sub">· stays as sealed · peak area ${R6.f.value}</span></p></div>`,
    fp: (sig) => `<div class="sc-fp"${at({ on: sig ? '2 3 4 5' : '2', dim: sig ? '4' : '' })}>
<p class="lab"${at({ on: sig ? '2 3 4 5' : '2', d: '2:300' })}>Payload <span class="sub">· five fields · ${Buffer.byteLength(R6.p)} bytes</span></p>
<p class="pay">${IQC.FIELDS.map((f, i) => `${i ? `<span class="br"${at({ on: '2 3 4 5', d: '2:440' })}>|</span>` : ''}<span class="tk"${at({ on: '2 3 4 5', fly: `2:${f}`, d: `2:${i * 20}` })}>${f === 'value' ? `<span class="sw">${el('span', '', { on: '2 3 4' }, R6.f.value)}${el('span', 'vx', { on: '5', bad: '5', d: '5:30' }, chg(value))}</span>` : esc(R6.f[f])}</span>`).join('')}</p>
<div class="fpr">
<p class="fpl"><span class="arr"${at({ on: '2 3 4 5', d: '2:360' })}>${ICON('down')}<span>SHA-256</span></span><span class="lab sw">${el('span', '', { on: '2 3 4', d: '2:370' }, `Fingerprint <var>r</var><sub>${k}</sub>`)}${el('span', '', { on: '5', bad: '5', d: '5:60' }, 'Fingerprint, recomputed')}</span>${el('span', 'fps', { on: '5', d: '5:250' }, `≠ stored <var>r</var><sub>${k}</sub> ${s8(R6.r)}`)}</p>
<p class="fpw sw">${groups8(R6.r, { on: '2 3 4' }, 370, 12)}${groups8(rx, { on: '5', bad: '5' }, 80, 20)}</p>
</div>${sig ? `
<div class="sig"${at({ on: '3 4 5' })}>
<p class="fpl"><span class="arr">${ICON('down')}<span>ECDSA P-256</span></span><span class="lab">Signature <span class="sub">· over r<sub>${k}</sub> · demo key ${keyId.slice(0, 8)}…</span></span></p>
<p class="sg"><span class="hx-s"${at({ on: '3 4 5', d: '3:100' })}>${s16(R6.sig)}</span><span class="res sw">${el('span', 'ok', { on: '3 4', d: '3:250' }, `${ICON('ok')}<span>valid</span>`)}${el('span', 'bad', { on: '5', d: '5:300' }, `${ICON('x')}<span>fails</span>`)}</span></p>
</div>` : ''}
</div>`,
    // record 9: the same change, made the right way. Its reason and "corrects #6" sit beside the seal, not in it
    cor: () => `<div class="sc-cor"${at({ on: '6', d: '6:360' })}>
<div class="cor-c"><span class="fr"${at({ on: '6', d: '6:420' })}></span>
<div class="cd-h"><p class="lab">Record ${N + 1} <span class="sub">· other fields as in #${k} · one-time demo key ${key9.slice(0, 8)}…</span></p>${seal({ cls: 'sn--seal', draw: '6', dd: '6:420', dot: '6', dtd: '6:460' })}</div>
<dl class="cd cd--9">
<div><dt>Peak area</dt><dd>${value}</dd></div>
<div><dt>Fingerprint r<sub>${N + 1}</sub></dt><dd>${s8(r9)}</dd></div>
<div><dt>Link h<sub>${N + 1}</sub></dt><dd>${s8(h9)}</dd></div>
<div><dt>Signature</dt><dd><span class="hx-s">${s16(sig9)}</span> <span class="ok">${ICON('ok')}valid</span></dd></div>
</dl>
</div>
<p class="cd-n">Beside the seal: corrects #${k} · reason “${esc(reason)}”</p>
</div>`,
    net: () => `<div class="sc-net up"${at({ on: '7' })}>
<p class="lab">Public network <span class="tag">Upcoming</span></p>
<p class="net-h"${at({ on: '7', d: '7:200' })}><span class="sub">h<sub>${N}</sub></span> ${s8(anchor)}</p>
<p class="say">Only this fingerprint would go on the network, never the values.</p>
</div>`,
    ag: () => `<div class="sc-ag up"${at({ on: '7' })}>
<p class="lab">AI agent <span class="tag">Upcoming</span></p>
<ol class="agc">${['Fingerprint', 'Signature', 'Link', 'Anchor'].map((w, i) => `<li${at({ on: '7', d: `7:${200 + i * 40}` })}>${ICON('open')}<span>${w}</span></li>`).join('')}</ol>
<p class="say">It would check all four before it uses a result.</p>
</div>`,
    ch: (stage) => {
      const nodes = Array.from({ length: N + 1 }, (_, i) => {
        const n = i + 1
        // dimmed until the record's own link matters (record 6 lights up when it is signed); 7 and 8 join in step 4
        const o = n < k ? { dim: '0 1 2 3' } : n === k ? { dim: '0 1 2', d: '3:340' } : n <= N ? { on: '4 5 6 7', d: `4:${200 + (n - k - 1) * 60}` } : { on: '6 7', d: '6:360' }
        const nd = n === k ? seal({ draw: '3 4 5 6 7', dd: '3:340', dot: '4 6 7', dtd: '4:240', x: '5', bad: '5', d: '5:380' }) : n === N + 1 ? seal({ draw: '6 7', dd: '6:400', dot: '6 7', dtd: '6:440' }) : seal()
        // the link into record k+1 turns red and dashed in place while record k is changed (step 5)
        const ln = n === 1 ? '' : `<span class="ln"${at({ on: n === k + 1 ? '4 6 7' : '', grow: n === N + 1 ? '6 7' : '4 5 6 7', d: n === N + 1 ? '6:360' : n > k ? `4:${200 + (n - k - 1) * 60}${n === k + 1 ? ' 5:380' : ''}` : `4:${(n - 2) * 40}` })}></span>${n === k + 1 ? el('span', 'lnx', { on: '5', d: '5:340' }, '') : ''}`
        return el('li', `cn${n === k ? ' cn--k' : ''}${n === N + 1 ? ' cn--9' : ''}`, o, `${ln}${nd}<span class="nn">${n}</span>`)
      }).join('')
      return `<div class="sc-ch">
<div class="ch">
<div class="ch-top"><p class="lab"${at({ dim: '0 1 2 3' })}>Sequence ${SEQ.sequence}</p>${el('span', 'hl hl--a', { on: '4 5', d: '4:120' }, `h<sub>${k - 1}</sub>`)}${el('span', 'hl hl--b', { on: '4 5', d: '4:240 5:400', bad: '5' }, `h<sub>${k}</sub>${el('span', 'ne', { on: '5' }, ' ≠')}`)}${el('span', 'arc', { on: '6', wipe: '6', d: '6:440' }, `<span>corrects #${k}</span>`)}</div>
<ol class="ch-n" aria-label="${stage ? `Records of ${SEQ.sequence}` : `Records 1 to ${S.has(6) || S.has(7) ? N + 1 : N}`}">${nodes}</ol>
<div class="ch-b" aria-hidden="true">${el('span', 'ch-br', { on: '4 5 6 7', d: '4:320' }, '')}${el('span', 'ch-br9', { on: '6 7', d: '6:440' }, '')}</div>
<p class="ch-t sw">${el('span', '', { on: '4', d: '4:340' }, `simulated anchor: h<sub>${N}</sub> ${s8(anchor)}`)}${el('span', 'bad', { on: '5', d: '5:450 6:0' }, `replayed head ${s8(STORY.fhx)} ≠ simulated anchor ${s8(anchor)}`)}${el('span', '', { on: '6', d: '6:460' }, `simulated anchor matches records 1 to ${N} · record ${N + 1} not yet anchored`)}${el('span', '', { on: '7', d: '7:100' }, `h<sub>${N}</sub> ${s8(anchor)}, the head of records 1 to ${N}`)}</p>
</div>
<div class="ch-i sw">${el('p', '', { on: '4', d: '4:380' }, `h<sub>${k}</sub> = SHA-256(h<sub>${k - 1}</sub> ${s8(R5.h)} + r<sub>${k}</sub> ${s8(R6.r)} + “${k}”) = ${s8(R6.h)}`)}${el('p', 'bad', { on: '5', d: '5:420 6:0' }, `link ${k}→${k + 1} broken: recomputed h<sub>${k}</sub> ${s8(hx)} ≠ ${s8(R6.h)} · records ${k + 1} and ${N} pass`)}${el('p', '', { on: '6', d: '6:460' }, `h<sub>${N + 1}</sub> = SHA-256(h<sub>${N}</sub> + r<sub>${N + 1}</sub> + “${N + 1}”) = ${s8(h9)} · all ${N + 1} records pass`)}${el('p', '', { on: '7', d: '7:140' }, `Record ${N + 1} would go in the next batch.`)}</div>
</div>`
    },
  }
  // a static figure holds its step's parts; the payload block carries the signature from step 3 on. It is named by its
  // caption, which sits outside the plate, so it is named even before the plate is first rendered
  const fig = (n) => {
    S = new Set([STP.from[n - 1], n])
    const ps = STP.parts[n]
    const body = ps.filter((p) => p !== 'sig').map((p) => (p === 'fp' ? part.fp(ps.includes('sig')) : part[p]())).join('\n')
    return `<figure class="fig sf" data-fig="${n}" aria-labelledby="sf${n}-c">
<div class="plate sc" data-sc data-s="${n}" data-from="${STP.from[n - 1]}" style="${STP.ci(n)}">
<div class="plate-h"><p class="fig-no">Fig. 2.${n}</p><p class="plate-t">${STP.titles[n - 1]}</p><p class="sim">Simulated · demo data</p></div>
<div class="sc-b">
${body}
</div>
</div>
<figcaption class="figcap" id="sf${n}-c"><b>Fig. 2.${n}</b> · ${STP.caps[n - 1]}</figcaption>
</figure>`
  }
  // the stage shows what the static figures and their captions already say (they stay in the accessibility tree on
  // wide screens, with only their plates hidden), so it is hidden from assistive technology
  const stage = () => {
    S = new Set([0, 1, 2, 3, 4, 5, 6, 7])
    return `<figure class="fig sf sf--stage" data-stage aria-hidden="true">
<div class="plate sc sc--stage" data-sc data-s="1">
<div class="plate-h"><p class="fig-no">Fig. 2.<span class="sw">${STP.titles.map((_, i) => `<span${at({ on: i ? String(i + 1) : '0 1' })}>${i + 1}</span>`).join('')}</span></p><p class="plate-t sw">${STP.titles.map((t, i) => `<span${at({ on: i ? String(i + 1) : '0 1' })}>${t}</span>`).join('')}</p><p class="sim">Simulated · demo data</p></div>
<div class="sc-b">
${['src', 'net', 'card', 'fp', 'cor', 'ag'].map((p) => (p === 'fp' ? part.fp(true) : part[p]())).join('\n')}
${part.ch(true)}
</div>
</div>
</figure>`
  }
  return { fig, stage }
})()
// the figure captions: the text equivalent of each static figure, every number from the data
STP.caps = [
  `Injection ${STORY.R6.ctx.inj} on ${STORY.R6.f.instrumentId}, an illustrative trace. The shaded peak at ${STORY.R6.ctx.rt} min has an area of ${STORY.R6.f.value} counts, the value of record ${STORY.k}; with four more fields it forms the record.`,
  `The five fields joined by bars, ${Buffer.byteLength(STORY.R6.p)} bytes, and their SHA-256 fingerprint r<sub>${STORY.k}</sub>, shown in full.`,
  `The fingerprint signed with the demo key ${keyId.slice(0, 8)}…: the signature is valid and the record’s ring is drawn; its dot fills once the record is linked.`,
  `Records 1 to ${N}, each linked to the one before. Record ${STORY.k} takes in h<sub>${STORY.k - 1}</sub> and passes h<sub>${STORY.k}</sub> on to record ${STORY.k + 1}; signed and linked, it is sealed, and its dot fills.`,
  `The peak area changed to ${STORY.value}: the recomputed fingerprint differs, the signature fails, link ${STORY.k}→${STORY.k + 1} breaks and the replayed head no longer matches the simulated anchor. Records ${STORY.k + 1} and ${N} pass their own checks.`,
  `Record ${STORY.k} stays as sealed. Record ${N + 1} holds the new value with its own fingerprint, a link from h<sub>${N}</sub> and a signature with a one-time demo key; its reason and “corrects #${STORY.k}” sit beside the seal. All ${N + 1} records pass, and record ${N + 1} is not yet anchored.`,
  `Upcoming: h<sub>${N}</sub>, the head of records 1 to ${N}, written to a public network, and an AI agent that checks fingerprint, signature, link and anchor. Nothing here touches a network.`,
]
// the values the figures of steps 5 and 6 shorten, in full, in the step text (and so on every view and in print)
STP.vals = (rows) => `<details class="vals"><summary>Values in full</summary>
<dl>${rows.map(([t, v]) => `<div><dt>${t}</dt><dd><code>${v}</code></dd></div>`).join('')}</dl>
</details>`
STP.vals5 = STP.vals([
  [`Recomputed fingerprint of record ${STORY.k}`, STORY.rx],
  [`Recomputed link h<sub>${STORY.k}</sub>`, STORY.hx],
  [`Link h<sub>${STORY.k}</sub> that record ${STORY.k + 1} carries`, STORY.R6.h],
  ['Replayed head', STORY.fhx],
  [`Simulated anchor, h<sub>${N}</sub>`, anchor],
])
STP.vals6 = STP.vals([
  [`Fingerprint r<sub>${N + 1}</sub> (the same five fields as the change, so the same fingerprint)`, STORY.r9],
  [`Link h<sub>${N + 1}</sub>`, STORY.h9],
  [`Signature of record ${N + 1}`, STORY.sig9],
  ['One-time public key (uncompressed point)', STORY.pub9],
  ['Its key id (first 16 bytes of SHA-256 of its SPKI)', STORY.key9],
])

const base = {
  revision: site.revision, updated: site.updated, status: esc(C.status), footerHTML, historyRows, nowItems,
  h1: esc(C.h1), definition: esc(C.definition), regulatory: esc(C.regulatory), demoSig: esc(C.demoSig), independence: esc(C.independence),
  founderLine: esc(C.founderLine), whyNow: esc(C.whyNow), network: esc(C.network), buildStatus,
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
  // Overview section 3, the story
  ...Object.fromEntries(STP.titles.map((_, i) => [`storyFig${i + 1}`, storyHTML.fig(i + 1)])), storyStage: storyHTML.stage(),
  st_value: STORY.value, st_n9: String(N + 1), st_reason: esc(STORY.reason), st_key9: STORY.key9.slice(0, 8), st_vals5: STP.vals5, st_vals6: STP.vals6, st_rule: RULE,
  demoSig1: 'Demo signature. In the alpha, one server key signs imported rows; per-analyst signatures are upcoming.',
}
function render(tpl, ctx, depth = 0) {
  if (depth > 6) throw new Error('template: partials nested too deep')
  return tpl
    .replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, p) => render(rd(`partials/${p}.html`), ctx, depth + 1))
    .replace(/\{\{(\w+)\}\}/g, (_, k) => { if (!(k in ctx)) throw new Error(`template: no value for {{${k}}}`); return ctx[k] })
}
const NW = ['José A. Fernández Abreu', 'ISO/IEC 17025:2017', '21 CFR Part 11', 'EU GMP Annex 11', 'EU Annex 11', 'Annex 11', 'tamper-evident', 'FIPS 180-4', 'FIPS 186-5', 'FIPS 203', 'FIPS 204', 'FIPS 205', 'RFC 9162', 'RFC 4998', 'ECDSA P-256', 'SHA-256', 'AES-256', 'ML-DSA', 'ML-KEM', 'SLH-DSA', 'SiLA 2', 'OPC UA LADS', 'PI 041-1', SEQ.sequence, SEQ.instrumentId, ...site.pages.map((p) => p.doc)]
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
  /MetaMask/i, /\btFIL\b/i, /faucet/i, /\b(Waters|Empower|Agilent|OpenLAB|OpenLab|Shimadzu|Thermo|Chromeleon|PerkinElmer|Sciex|SCIEX|Bruker|MassLynx|LabSolutions|Alliance|LabWare|STARLIMS|Opentrons|Hamilton|Tecan|Beckman|Strateos|Emerald Cloud|Benchling|Chemspeed|Ginkgo|Synthace|Scitara|Sapio|Dotmatics|LabVantage|Transcriptic)\b/]
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
const known = new Set([ZERO, anchor, PUB, ...recs.flatMap((x) => [x.r, x.h, x.sig]), STORY.rx, STORY.hx, STORY.fhx, STORY.r9, STORY.h9, STORY.sig9, STORY.pub9])
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

// ------------------------------------------------------------------------------------------------ 7e. the automated-lab items are upcoming
// Founder decisions (Draft 6, 2026-10-07): automated research labs first. Sealing at capture (SiLA 2, OPC UA LADS
// adapters), measured and derived records, lineage and recall, Merkle batches with salted leaves and inclusion checks,
// an encrypted archive on Filecoin (and the storage tiers) and post-quantum signatures and encryption are all Upcoming;
// none exists in code. So every sentence a visitor can meet that names one of them says upcoming, conditional, simulated
// or absent: page text, template words, titles, descriptions and labels, the og card, the console and the shipped
// JavaScript. Filecoin and an archive are never called permanent, forever or unchangeable (deals are renewed), and
// "proof" stays banned (section 7: inclusion checks, not inclusion proofs). Every "IQC-RD-01 §2.n" reference, on the
// pages and in the console, carries the Roadmap's own number for the item it links to.
const NEW_FEAT = /\bseal(?:s|ed|ing)? (?:(?:each |every |a |the )?results? )?(?:at|where|when) (?:capture|the orchestrator|the driver|the instrument|the source|it is produced|they are produced)\b|\bsealing here\b|\badapters?\b|\bderived records?\b|\bmeasured records?\b|\blineage\b|\brecall\b|\bMerkle\b|\binclusion checks?\b|\bselective disclosure\b|\barchives?\b|\bFilecoin\b|\bquantum\b|\bML-DSA\b|\bML-KEM\b|\bSLH-DSA\b|\bFIPS 20[345]\b|\bRFC 9162\b|\bRFC 6962\b|\bRFC 4998\b|\balgorithm (?:agility|id)\b|\bhybrid signatures?\b|\bstorage tiers?\b|\bSiLA\b|\bOPC UA\b|\bLADS\b|\bciphertext\b|\bre-anchor/i
const NEW_OK = /\bupcoming\b|\bwill\b|\bwould\b|\bonce\b|\bshould\b|\bcould\b|\bnot yet\b|\bnothing\b|\bnever\b|\bnot\b|\bno\b|\bcannot\b|\bsimulated\b|\bthe plan\b/i
const NEW_OK_STRICT = /\bupcoming\b|\bwill\b|\bwould\b|\bonce\b|\bnot yet\b|\buntil\b|\bsimulated\b|\bthe plan\b/i
const NEW_NOW = [
  /\b(?:is|are|was|were|gets?|got) (?:sealed|signed|fingerprinted) (?:at capture|at the (?:instrument|orchestrator|driver|source)|by the (?:orchestrator|driver|instrument)(?:’s|'s)? key|where (?:it is|they are) produced)\b/i,
  /\b(?:Immutable QC|the alpha(?: app)?|the app|the console|these pages|this site|it) (?:seals|signs|fingerprints) (?:each |every )?(?:results? )?(?:at capture|at the (?:instrument|orchestrator|driver)|where)\b/i,
  /\b(?:is|are) (?:archived|stored|kept|uploaded|encrypted) (?:on|to|in) Filecoin\b|\bFilecoin (?:holds|stores|keeps)\b/i,
  /\b(?:computes|traces|tracks|walks|follows) (?:its |the |a |every )?(?:lineage|reach|recall)\b|\b(?:lineage|recall) (?:shows|finds|flags|computes|lists)\b/i,
  /\b(?:is|are) flagged\b|\bflags (?:it|a|the|every|any) /i,
  /\b(?:signs|signed|sealed|encrypts|encrypted|wraps|wrapped) (?:\w+ ){0,3}with (?:ML-DSA|ML-KEM|SLH-DSA|AES-256|a hybrid)\b|\buses (?:ML-DSA|ML-KEM|SLH-DSA|AES-256|a Merkle|Merkle|Filecoin)\b/i,
  /\b(?:is|are) (?:a |the )?leaves of\b|\b(?:an |the )?inclusion checks? (?:shows?|lets?|reveals?)\b|\b(?:the |a )?Merkle (?:root|tree|batch) (?:commits|shows|holds)\b/i,
  /\b(?:the |an? )?(?:SiLA 2|OPC UA LADS) adapters? (?:seals?|reads?|runs?|is available|exists?)\b/i,
]
const lintNew = (where, sents) => {
  bad(where, sents, 'every sentence about sealing at capture, derived records, lineage, Merkle batches, an archive, Filecoin or post-quantum says upcoming, conditional or absent', (s) => !/\?$/.test(s) && !/^IQC-[A-Z]{2}-\d+ §/.test(s) && NEW_FEAT.test(s) && !NEW_OK.test(s)) // a cross-reference's label names an item; the item's own sentences are checked
  bad(where, sents, 'Filecoin or an archive is never permanent, forever or unchangeable', (s) => /\bFilecoin\b|\barchives?\b|\bstorage\b/i.test(s) && /\bpermanent|\bforever\b|\bunchangeable\b|\bfor good\b/i.test(s))
  // stricter (lead review, Draft 6): a negation elsewhere in a sentence does not excuse a claim. Once its negated clauses
  // are removed (unneg, section 7b), a sentence that still names one of these items says upcoming, will or would, once,
  // until or simulated; "could", "no" or "not" alone is not enough
  bad(where, sents, 'a negated clause does not excuse a sentence that still names a new item: it says upcoming, will/would, once, until or simulated', (s) => !/\?$/.test(s) && !/^IQC-[A-Z]{2}-\d+ §/.test(s) && NEW_FEAT.test(unneg(s)) && !NEW_OK_STRICT.test(s))
  // and no present-tense claim that one of them works, whatever else the sentence says (read whole: a negation does not hide it)
  bad(where, sents, 'no present-tense claim that sealing at capture, derived records, lineage, Merkle batches, the archive or post-quantum signatures work', (s) => NEW_NOW.some((re) => re.test(s)))
}
for (const [file, html] of Object.entries(pagesHTML)) lintNew(`${file} (its text and template words)`, proseOf(html))
lintNew('assets/iqc.js strings', proseOfJS(jsStrings(js)))
lintNew('og card', proseOf(ogHTML))
if (DASH_HTML) { lintNew('dashboard/index.html', proseOf(DASH_HTML)); lintNew('dashboard/console.js strings', proseOfJS(jsStrings(readFileSync(join(DASH, 'console.js'), 'utf8')))) }
{
  // the 7e lints catch what they are for: sample claims that must fail, and upcoming wording that must pass
  const flagged = (s) => (NEW_FEAT.test(unneg(s)) && !NEW_OK_STRICT.test(s)) || NEW_NOW.some((re) => re.test(s))
  const mustFail = ['Immutable QC seals each result at capture.', 'Each result is sealed at the orchestrator, so nothing changes after it.', 'Records are archived on Filecoin, never readable.', 'It computes the lineage of every value.', 'A number with no measurement under it is flagged before use.', 'Records are signed with ML-DSA, not ECDSA.', 'The SiLA 2 adapter seals each result.', 'Merkle batches give no one the values.', 'An inclusion check shows that one record is in the batch.', 'Derived records cite no value that was not measured.']
  const mustPass = ['Sealing at capture is upcoming.', 'Each result would be sealed at the orchestrator.', 'An encrypted archive on Filecoin is upcoming.', 'One that does not would be flagged before use.', 'Post-quantum signatures would follow.', 'Lineage and recall, upcoming.']
  ok(`7e lints: every sample claim is caught (${mustFail.filter((x) => !flagged(x)).join(' | ') || 'all caught'})`, mustFail.every(flagged))
  ok(`7e lints: upcoming wording passes (${mustPass.filter(flagged).join(' | ') || 'all pass'})`, !mustPass.some(flagged))
}
{
  const rmap = Object.fromEntries([...pagesHTML['roadmap.html'].matchAll(/<h3 id="([\w-]+)"><span class="no">(2\.\d+)<\/span>/g)].map((m) => [m[1], m[2]]))
  let n = 0
  const refs = (where, html, re) => { for (const [, id, no] of html.matchAll(re)) { n++; ok(`${where}: IQC-RD-01 §${no} is the Roadmap’s own number for #${id} (${rmap[id] || 'no such item'})`, rmap[id] === no) } }
  for (const [file, html] of Object.entries(pagesHTML)) refs(file, html, /href="roadmap\.html#([\w-]+)"><span class="id">(?:<span class="nw">)?IQC-RD-01(?:<\/span>)? §(2\.\d+)<\/span>/g)
  if (DASH_HTML) refs('dashboard/index.html', DASH_HTML, /href="\.\.\/roadmap\.html#([\w-]+)">IQC-RD-01 §(2\.\d+)/g)
  ok(`roadmap references: every "IQC-RD-01 §2.n" on the pages and in the console was checked (${n})`, n >= 4)
}

// ------------------------------------------------------------------------------------------------ 7f. what the upcoming defenses would and would not catch
// Review (accuracy, Draft 6): three claims went further than the construction does.
// 1. Signatures that cover each record's position would show a removal, move or copy made by someone without the key; a
//    key holder signs the rewritten links again. So a sentence that names position-covering signatures and a change made
//    with the key says "without the key" (only a fingerprint anchored beforehand shows a rewrite with the key).
// 2. Anchoring would put only a fingerprint on a public network, but the encrypted archive (upcoming) would put
//    ciphertext there too. So a sentence that says only a fingerprint would go on a network names anchoring, or says
//    "by default".
// 3. Content addressing shows that fetched bytes match their address, not that they are the result as captured.
{
  const POSN = /signatures? that cover(?:s)? (?:each record’s |each record's |its |their )?position|position-covering signatures?|cover(?:s|ing)? (?:each record’s )?position\b/i
  const WITH_KEY = /\bwith the (?:signing |server )?key\b|\bwho(?:ever)? holds? (?:the |it\b)|\bkey holder\b/i
  const keyPos = (s) => POSN.test(s) && WITH_KEY.test(s) && !/\bwithout the (?:signing )?key\b/i.test(s)
  const FP_ONLY = /\bonly (?:a |one |the )?(?:batch )?fingerprints?\b/i
  const fpOnly = (s) => FP_ONLY.test(s) && /\bnetworks?\b|blockchain|on-?chain/i.test(s) && !/\banchor|\bby default\b|\bthe default\b/i.test(s)
  const captured = (s) => /\bthe one captured\b/i.test(s)
  const lint7f = (where, sents) => {
    bad(where, sents, 'position-covering signatures are never said to show a change made with the key (they would show one made without it)', keyPos)
    bad(where, sents, '"only a fingerprint" on a network is said of anchoring, or "by default" (the encrypted archive would add ciphertext)', fpOnly)
    bad(where, sents, 'an archive copy is never "the one captured" (content addressing shows the bytes match their address)', captured)
  }
  for (const [file, html] of Object.entries(pagesHTML)) lint7f(`${file} (its text and template words)`, proseOf(html))
  lint7f('assets/iqc.js strings', proseOfJS(jsStrings(js)))
  lint7f('og card', proseOf(ogHTML))
  if (DASH_HTML) { lint7f('dashboard/index.html', proseOf(DASH_HTML)); lint7f('dashboard/console.js strings', proseOfJS(jsStrings(readFileSync(join(DASH, 'console.js'), 'utf8')))) }
  // the 7f lints catch what they are for, and pass the corrected wording
  const f7 = (s) => keyPos(s) || fpOnly(s) || captured(s)
  const mustFail = ['A history rewritten with the key would show through signatures that cover each record’s position.', 'A change made with the key would show through signatures that cover position.', 'Only a fingerprint would go on a public network.', 'Only a fingerprint will go on a network, never the values.', 'Content addressing would let anyone check that a copy is the one captured.']
  const mustPass = ['A history rewritten with the key would show only against an anchor taken earlier.', 'It would also show through signatures that cover each record’s position, when done by anyone without the key.', 'Anchoring would put only a fingerprint on a public network.', 'By default it will put only one batch fingerprint on a public test network.', 'Anchoring batches on a public network is an upcoming feature; only a fingerprint will go on the network, never the values.']
  ok(`7f lints: every sample claim is caught (${mustFail.filter((x) => !f7(x)).join(' | ') || 'all caught'})`, mustFail.every(f7))
  ok(`7f lints: the corrected wording passes (${mustPass.filter(f7).join(' | ') || 'all pass'})`, !mustPass.some(f7))
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
ok('copy: the Scope definition says what works (fingerprint of five fields, signed, linked), names the audience and the snowball, and states anchoring as upcoming', C.definition.startsWith('Each result becomes a sealed record: a SHA-256 fingerprint of five of its recorded fields, signed and linked to the record before it, so a later change shows. Built for automated research labs in biotechnology, microbiology, chemistry and materials science, where results arrive faster than people can review them and models train on them. ') && /Anchoring batches on a public network is an upcoming feature/.test(C.definition) && !/can be anchored|test network/i.test(C.definition))
ok('copy: the Overview title and description name automated research labs', /automated research labs/.test(site.pages[0].title) && /automated research labs in biotechnology, microbiology, chemistry and materials science/.test(site.pages[0].description))
ok('copy: why now, in the founder’s terms (most bad data is not malicious; faster than review; models train on it)', C.whyNow.startsWith('Most bad data is not malicious. ') && /faster than people can review them/.test(C.whyNow) && /models train on them/.test(C.whyNow))
eq('copy: why now, exactly (Overview section 2’s lead; it adds to the Scope definition, not repeats it)', C.whyNow, 'Most bad data is not malicious. But when results arrive faster than people can review them, and models train on them and choose the next experiment, an ordinary mistake travels before anyone sees it.')
ok('document control: Draft 6 (2026-10-07) has its history row, one sentence on the repositioning for automated research labs', (() => { const r = site.history.find((x) => x.rev === 'Draft 6'); return !!r && r.date === '2026-10-07' && /^Repositioned for automated research labs: /.test(r.change) && r.change.split(/(?<=[.!?])\s+(?=[A-Z“])/).length === 1 && ['Why: one wrong value snowballs', 'When your process moves into GMP', 'sealing at capture', 'measured and derived records', 'lineage and recall', 'Merkle batches with salted leaves', 'encrypted archive on Filecoin', 'post-quantum signatures and encryption', 'How a record is sealed', 'What does a fingerprint cover?'].every((w) => r.change.includes(w)) && !/the Scope names the audience and the snowball/.test(r.change) })())
ok('copy: every page description and the console’s keep anchoring out of the present tense', site.pages.every((p) => !/\banchor/i.test(p.description) || /upcoming/i.test(p.description)))
ok('copy: a description that says "signed" says demo, since it is read without the page around it', site.pages.every((p) => !/\bsigned\b/i.test(p.description) || /\bdemo\b/i.test(p.description)))
ok('index: regulatory line present, verbatim, once, in 6.1 "When your process moves into GMP": after Fig. 5, before "What would go public", followed by the Regulatory map link', (() => { const t = T['index.html'], at = t.indexOf(C.regulatory); return count(t, new RegExp(C.regulatory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) === 1 && at > t.indexOf('When your process moves into GMP') && at > t.indexOf('Fig. 5') && at < t.indexOf('What would go public') && /<h3 id="gmp"><span class="no">6\.1<\/span>When your process moves into GMP<\/h3>/.test(ov) && /<p class="reg">[\s\S]*?<\/p>\s*<p><a class="xref" href="regulatory\.html"><span>Read the regulatory map<\/span>/.test(ov) && !/Regulatory position/.test(t) })())
ok('index and check: demo-signature line present', T['index.html'].includes(C.demoSig) && T['check.html'].includes(C.demoSig))
ok('index: says tamper-evident', /tamper-evident/.test(T['index.html']))
ok('index: Fig. 1 shows the full fingerprint, previous link, link and signature head', ov.includes(g(S.r)) && ov.includes(g(S.prev)) && ov.includes(g(S.h)) && ov.includes(S.sig.slice(0, 16)))
ok('index: Fig. 1 carries the signature and public key it checks', ov.includes(`data-sig="${S.sig}"`) && ov.includes(`data-pub="${PUB}"`))
ok('index: Fig. 1, why (the snowball), the story (Fig. 2.1 to 2.7), Fig. 3 record history, then today, where it fits (Fig. 4, then 6.1 GMP with Fig. 5), what would go public, agents, the document set', (() => { const t = T['index.html']; const at = ['Fig. 1', 'Why: one wrong value snowballs', 'How a result becomes a sealed record', ...STP.titles.map((_, i) => `Fig. 2.${i + 1}`), 'Record history', 'Fig. 3', 'Today, upcoming and not claimed', 'Where it fits', 'Fig. 4', 'When your process moves into GMP', 'Fig. 5', 'What would go public', 'Agentic workflows', 'The document set'].map((s) => t.indexOf(s)); return at.every((v, i) => v > 0 && (i === 0 || v > at[i - 1])) && !/Fig\. 6/.test(t) })())
eq('index: sections numbered 1 to 9, why second, the story third', [...ov.matchAll(/<h2 id="s(\d)-h"><span class="no">(\d)<\/span>/g)].map((m) => m[1] + m[2]).join(' '), '11 22 33 44 55 66 77 88 99')
ok('index: section 2 (Why) directly after Scope, and the story (section 3) directly after it', /<h2 id="s1-h"><span class="no">1<\/span>Scope<\/h2>[\s\S]*?<\/section>\s*<\/div>\s*(?:<figure class="fig"[\s\S]*?<\/figure>\s*<\/div>\s*)?<section class="sec sec--side" id="why" aria-labelledby="s2-h">\s*<h2 id="s2-h"><span class="no">2<\/span>Why: one wrong value snowballs<\/h2>[\s\S]*?<\/section>\s*<section class="sec story" id="story" aria-labelledby="s3-h" data-story>\s*<h2 id="s3-h"><span class="no">3<\/span>How a result becomes a sealed record<\/h2>/.test(ov))
// section 2, Why: the ordinary causes, the snowball, and the founder's line as its pull quote
{
  const why = (ov.match(/<section class="sec sec--side" id="why"[\s\S]*?<\/section>/) || [''])[0], wt = textOf(why, true)
  ok('index, why: opens with the whyNow copy as its lead', why.includes(`<p class="lead">${esc(C.whyNow)}</p>`))
  ok('index, why: the ordinary causes, as a compact list (script, sync, crash, backup, migration, outage, a model that filled in a blank)', count(why, /<ul class="causes">[\s\S]*?<\/ul>/g) === 1 && ['script that “fixed” the units', 'sync conflict', 'crash halfway through a write', 'backup restored from last week', 'migration that rounded values', 'outage that dropped a batch', 'model that filled in a blank'].every((w) => (why.match(/<ul class="causes">[\s\S]*?<\/ul>/) || [''])[0].includes(w)) && count(why, /<li>/g) === 7)
  ok('index, why: the snowball (analysis, model, next experiment) with a lab example, then what a seal shows today and what only the upcoming features would show', wt.includes('it feeds an analysis, the analysis feeds a model, and the model picks the next experiment, so a concentration a script wrote in mg/mL where the pipeline expects µg/mL can end up in a dose-response fit, a training set and tomorrow’s plates.') && wt.includes('Today a seal shows a value changed after it was sealed; upcoming, a restored backup or a dropped batch would show against an anchor, a filled-in blank with measured and derived records, and lineage would find every analysis, model and decision recorded as using a wrong value.'))
  ok('index, why: three to five sentences besides the list', (() => { const n = textOf(why.replace(/<ul class="causes">[\s\S]*?<\/ul>/, ' ').replace(/<blockquote[\s\S]*?<\/blockquote>/, ' ').replace(/<p class="note">[\s\S]*?<\/p>/, ' '), true).trim().split(/(?<=[.!?])\s+(?=[A-Z“])/).length; return n >= 3 && n <= 5 })())
  ok('index, why: a deliberate change by someone without the key fails the same checks; a rewrite with the key, or a deletion with relinking, passes each record’s checks; a link to About 5.7 that says where it leads; a note before the pull quote', why.includes('<p class="note"><span class="k">Deliberate changes</span>A value changed on purpose after sealing, by someone without the signing key, fails the same checks as one changed by accident. A history rewritten with the key, or a record deleted and the rest relinked (which needs no key), passes each record’s checks; <a href="about.html#q7">question 5.7 on the About page</a> says what would show it, and what is not covered.</p>') && /<\/p>\s*<blockquote class="pull">/.test(why.slice(why.indexOf('<p class="note">'))))
  ok('index, why: the causes are ordinary software and operations, and a seal shows a value is still the one sealed (not "captured": the alpha seals at import)', wt.includes('A wrong value usually comes from ordinary software and operations:') && wt.includes('Today a seal shows a value changed after it was sealed;') && !/still what was captured|A sealed record shows whether/.test(wt))
  ok('index, why: the section ends with the founder’s line (the pull quote is the last block of its body)', /<blockquote class="pull">[\s\S]*?<\/blockquote>\s*<\/div>\s*<\/section>$/.test(why))
}
{
  // the story (Overview section 3 since Draft 6; its figures stay Fig. 2.1 to 2.7, numbered in order of appearance): seven steps in order, each with its static figure in its own state; one stage
  const sec2 = (ov.match(/<section class="sec story"[\s\S]*?<\/section>/) || [''])[0].replace(/<span class="nw">([^<]*)<\/span>/g, '$1'), st = (k) => (sec2.match(new RegExp(`<li class="step" id="st-${k}" data-step="${k}">[\\s\\S]*?</li>\\n(?=<li class="step"|</ol>)`)) || [''])[0]
  const steps = [...sec2.matchAll(/<li class="step" id="st-(\d)" data-step="(\d)">[\s\S]*?<h3><span class="no">3\.(\d)<\/span><a class="step-a" href="#st-(\d)">([\s\S]*?)<\/a><\/h3>/g)]
  eq('story: seven steps, numbered 3.1 to 3.7, in order', steps.map((m) => m.slice(1, 5).join('')).join(' '), STP.titles.map((_, i) => String(i + 1).repeat(4)).join(' '))
  eq('story: the step titles, in order', steps.map((m) => m[5].replace(/<span class="tag">Upcoming<\/span>/, '').replace(/<[^>]+>/g, '').trim()).join(' | '), STP.titles.join(' | '))
  ok('story: the last step is labelled Upcoming', /<a class="step-a" href="#st-7"><span>What comes next <span class="tag">Upcoming<\/span><\/span><\/a>/.test(sec2))
  const sentences = (h) => textOf(h, true).trim().split(/(?<=[.!?])\s+(?=[A-Z“])/).length
  for (let k = 1; k <= STP.titles.length; k++) {
    const li = st(k), f = (li.match(/<figure class="fig sf" data-fig="(\d)"[\s\S]*?<\/figure>/) || ['', ''])
    ok(`story, step ${k}: its slice holds exactly one step and one static figure`, count(li, /<li class="step"/g) === 1 && count(li, /<figure class="fig sf"/g) === 1)
    ok(`story, step ${k}: its static figure (Fig. 2.${k}) follows its text, in state ${k}, waits in state ${STP.from[k - 1]}, with its parts, height estimates and a caption`, f[1] === String(k) && li.indexOf('<div class="step-t">') < li.indexOf('<figure') && f[0].includes(`<div class="plate sc" data-sc data-s="${k}" data-from="${STP.from[k - 1]}" style="${STP.ci(k)}">`) && f[0].includes(`<b>Fig. 2.${k}</b> · ${STP.caps[k - 1]}</figcaption>`) && STP.parts[k].every((p) => f[0].includes(`class="sc-${p}`) || (p === 'sig' && f[0].includes('<div class="sig"'))))
    // named by its caption, outside the plate (an off-screen plate is not rendered, so a name inside it would be lost)
    ok(`story, step ${k}: the figure is named by its caption, not by a title inside the plate`, f[0].startsWith(`<figure class="fig sf" data-fig="${k}" aria-labelledby="sf${k}-c">`) && f[0].includes(`</div>\n<figcaption class="figcap" id="sf${k}-c">`) && count(f[0], /aria-labelledby/g) === 1)
    // 1 to 3 plain sentences: the lead, plus any note (step 3's demo-signature line, step 6's key)
    const lead = (li.match(/<div class="step-t">\s*<p>([\s\S]*?)<\/p>/) || ['', ''])[1], notes = [...li.matchAll(/<p class="note">([\s\S]*?)<\/p>/g)].map((m) => m[1])
    const n = sentences(lead) + notes.reduce((a, x) => a + sentences(x), 0)
    ok(`story, step ${k}: 1 to 3 plain sentences, notes included (${n})`, n >= 1 && n <= 3 && notes.length <= 1)
  }
  const stg = (sec2.match(/<figure class="fig sf sf--stage"[\s\S]*?<\/figure>/) || [''])[0]
  ok('story: one stage, starting at step 1, with every part, hidden from assistive technology (the static figures and their captions carry it)', count(sec2, /data-stage/g) === 1 && /<figure class="fig sf sf--stage" data-stage aria-hidden="true">\n<div class="plate sc sc--stage" data-sc data-s="1">/.test(sec2) && ['src', 'net', 'card', 'fp', 'cor', 'ag', 'ch'].every((p) => stg.includes(`class="sc-${p}`)) && !/<a |<button|tabindex/.test(stg))
  ok('story: every state named in a data attribute is 0 to 7', [...sec2.matchAll(/data-(?:on|dim|draw|grow|wipe|bad|from)="([^"]*)"/g)].every((m) => /^[0-7]( [0-7])*$/.test(m[1])) && [...sec2.matchAll(/data-d="([^"]*)"/g)].every((m) => /^[0-7]:\d{1,4}( [0-7]:\d{1,4})*$/.test(m[1])) && [...sec2.matchAll(/data-fly="([^"]*)"/g)].every((m) => /^[0-7]:[\w]+$/.test(m[1]) && sec2.includes(`data-fly-at="${m[1].slice(2)}"`)))
  // each step plays in under a second: iqc.js gives what leaves 140 ms, then 120 ms before anything arrives, 420 ms to
  // arrive and 520 to fly in, so no delay passes 460 ms and no flying value's passes 320
  ok('story: iqc.js plays a step on these durations', src.includes('const T = { out: 140, clear: 120, in: 420, ret: 240, fly: 520, back: 300, jump: 300 }'))
  const ds = [...sec2.matchAll(/data-d="([^"]*)"/g)].flatMap((m) => m[1].split(' ').map((x) => +x.split(':')[1]))
  ok(`story: every delay is at most 460 ms (${Math.max(...ds)})`, ds.length > 50 && Math.max(...ds) <= 460)
  ok('story: every flying value leaves within 320 ms', [...sec2.matchAll(/<[^>]*data-fly="(\d):\w+"[^>]*>/g)].every((m) => { const d = /data-d="([^"]*)"/.exec(m[0]); const x = d && new RegExp(`(?:^| )${m[1]}:(\\d+)`).exec(d[1]); return !x || +x[1] <= 320 }))
  // step 5 in order of cause and effect: the value, the payload, the recomputed fingerprint, its mismatch, the signature,
  // the record's seal, the link into record 7, h6, the line under the chain and the replayed head
  const d5 = (re) => { const m = re.exec(stg); return m ? +m[1] : NaN }
  const order5 = [/<span class="vx" data-on="5" data-bad="5" data-d="5:(\d+)">/, /<span data-on="5" data-bad="5" data-d="5:(\d+)">Fingerprint, recomputed/, new RegExp(`<span class="g" data-on="5" data-d="5:(\\d+)">${STORY.rx.slice(0, 8)}`), /<span class="fps" data-on="5" data-d="5:(\d+)">/, /<span class="bad" data-on="5" data-d="5:(\d+)"><svg/, /<span class="fr fr--x" data-on="5" data-d="5:(\d+)">/, /<span class="lnx" data-on="5" data-d="5:(\d+)">/, /data-d="4:\d+ 5:(\d+)" data-bad="5">h<sub>6/, /<p class="bad" data-on="5" data-d="5:(\d+) 6:0">link/, /<span class="bad" data-on="5" data-d="5:(\d+) 6:0">replayed head/].map(d5)
  ok(`story, step 5: the cause before what it causes (${order5.join(' ')})`, order5.every((v, i) => Number.isFinite(v) && (i === 0 || v >= order5[i - 1])))
  // step 6 in two beats: what step 5 only supposed goes back at once; record 9 is appended after it, never at the same time
  const d6 = [/<div class="sc-cor" data-on="6" data-d="6:(\d+)">/, /<li class="cn cn--9" data-on="6 7" data-d="6:(\d+)">/, /<span class="arc" data-on="6" data-wipe="6" data-d="6:(\d+)">/, /<span class="ch-br9" data-on="6 7" data-d="6:(\d+)">/].map(d5)
  ok(`story, step 6: record 9 is appended after the change is undone (${d6.join(' ')})`, d6.every((v) => v >= 360) && !/data-bad="5"[^>]*data-d="[^"]*6:/.test(stg) && !/data-d="[^"]*6:[^"]*"[^>]*data-bad="5"/.test(stg))
  // the record card says what is true in each state: five fields, signed, sealed once linked, changed, kept as sealed
  ok('story: the record card’s label follows the state', ['<span data-on="1 2">· five fields</span>', '<span data-on="3" data-d="3:300">· signed</span>', '<span data-on="4 7" data-d="4:240">· sealed</span>', '<span data-on="5">· changed after sealing</span>', '<span data-on="6">· stays as sealed</span>'].every((w) => stg.includes(w)))
  ok('story: the seal’s ring is drawn when the record is signed (3) and its dot fills when it is linked (4); kept drawn, failing, while it is changed (5)', count(stg, /data-bad="5" data-d="5:\d+"><circle class="rg" cx="10" cy="10" r="6.5"\/><circle class="dr" cx="10" cy="10" r="6.5" pathLength="1" data-draw="3 4 5 6 7" data-d="3:\d+"\/><circle class="dt" cx="10" cy="10" r="2.75" data-on="4 6 7" data-d="4:\d+"\/>/g) === 2)
  // every number: each shortened hex is the start of the full value its title carries, which was computed above
  const shorts = [...sec2.matchAll(/<span class="h8" title="([0-9a-f]{64})">([0-9a-f]{8})…<\/span>/g)]
  ok(`story: every shortened hex is its title’s first 8 characters, and the title a computed value (${shorts.length})`, shorts.length > 20 && shorts.every((m) => m[1].startsWith(m[2]) && known.has(m[1])) && !/[0-9a-f]{8}…/.test(textOf(sec2.replace(/<span class="h8" title="[0-9a-f]{64}">[0-9a-f]{8}…<\/span>/g, ''), true).replace(/[0-9a-f]{16}…[0-9a-f]{16}/g, '').replace(/key id [0-9A-F]{8}…|key [0-9A-F]{8}…/g, '')))
  const longs = [...sec2.matchAll(/(?<![0-9A-Za-z])[0-9a-f]{64,}(?![0-9A-Za-z])/g)].map((m) => m[0])
  ok(`story: every hex value shown in full, or in a title, is a computed one (${longs.length})`, longs.length > 20 && longs.every((h) => known.has(h)))
  const sig16 = [...sec2.matchAll(/<span title="([0-9a-f]{128})">([0-9a-f]{16})…([0-9a-f]{16})<\/span>/g)]
  ok(`story: every shortened signature is its title’s ends, and the title a computed signature (${sig16.length})`, sig16.length >= 4 && sig16.every((m) => known.has(m[1]) && m[1].startsWith(m[2]) && m[1].endsWith(m[3])) && sig16.some((m) => m[1] === STORY.sig9))
  const fps = [...sec2.matchAll(/<span class="g4"[^>]*>((?:<span class="g"[^>]*>[0-9a-f]{8}<\/span>){8})<\/span>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''))
  ok(`story: every fingerprint shown in full is r6 (steps 2, 3, 5) or the changed r6 (step 5), in full (${fps.length})`, fps.length === 6 && fps.filter((h) => h === STORY.R6.r).length === 4 && fps.filter((h) => h === STORY.rx).length === 2)
  const has = (name, ...w) => ok(`story: ${name}`, w.every((x) => sec2.includes(x)))
  has('step 1: injection 06, HPLC-02, RT 4.82 min, the area as the value, the trace said to be illustrative, the CDS spelled out', `Injection ${STORY.R6.ctx.inj} on ${STORY.R6.f.instrumentId}.`, `peak at ${STORY.R6.ctx.rt} min`, `Area <b>${STORY.R6.f.value}</b> counts`, 'illustrative trace', `${STORY.R6.ctx.rt} min</span>`, 'The chromatography data system (CDS) integrates')
  has('step 2: the exact payload, 48 bytes, the one-character line', IQC.payloadHTML(STORY.R6.p), `one line of ${Buffer.byteLength(STORY.R6.p)} bytes`, `${Buffer.byteLength(STORY.R6.p)} bytes</span>`, 'One changed character gives a completely different fingerprint.', `Fingerprint <var>r</var><sub>${STORY.k}</sub>`)
  has('step 3: the demo key id and the demo-signature line, the signing step drawn as a step', `key id ${keyId.slice(0, 8)}…`, `demo key ${keyId.slice(0, 8)}…`, '<p class="note">Demo signature. In the alpha, one server key signs imported rows; per-analyst signatures are upcoming.</p>', `<span title="${STORY.R6.sig}">${STORY.R6.sig.slice(0, 16)}…${STORY.R6.sig.slice(-16)}</span>`, '<span>ECDSA P-256</span></span><span class="lab">Signature')
  has('step 4: h6 from h5, r6 and "6", carried by record 7', `h<sub>${STORY.k}</sub> = SHA-256(h<sub>${STORY.k - 1}</sub> <span class="h8" title="${STORY.R5.h}">${STORY.R5.h.slice(0, 8)}…</span> + r<sub>${STORY.k}</sub> <span class="h8" title="${STORY.R6.r}">${STORY.R6.r.slice(0, 8)}…</span> + “${STORY.k}”) = <span class="h8" title="${STORY.R6.h}">${STORY.R6.h.slice(0, 8)}…</span>`, `record ${STORY.k + 1} carries h<sub>${STORY.k}</sub> forward as its previous link`, `<span class="hl hl--b" data-on="4 5" data-d="4:`, `simulated anchor: h<sub>${N}</sub> <span class="h8" title="${anchor}">`)
  has('step 5: the change, the rule in Check a record’s words, the broken link with both values, the replayed head against the simulated anchor, every value in full', `from ${STORY.R6.f.value} to ${STORY.value}`, `So ${RULE}.`, `link ${STORY.k}→${STORY.k + 1} broken: recomputed h<sub>${STORY.k}</sub> <span class="h8" title="${STORY.hx}">${STORY.hx.slice(0, 8)}…</span> ≠ <span class="h8" title="${STORY.R6.h}">`, `replayed head <span class="h8" title="${STORY.fhx}">${STORY.fhx.slice(0, 8)}…</span> ≠ simulated anchor <span class="h8" title="${anchor}">`, `≠ stored <var>r</var><sub>${STORY.k}</sub> <span class="h8" title="${STORY.R6.r}">`, `<code>${STORY.rx}</code>`, `<code>${STORY.hx}</code>`, `<code>${STORY.fhx}</code>`, `<code>${anchor}</code>`, '<summary>Values in full</summary>')
  ok('story: the changed digit is the one marked', sec2.includes(`${STORY.value.slice(0, STORY.digit)}<b>${STORY.value[STORY.digit]}</b>${STORY.value.slice(STORY.digit + 1)}`) && STORY.value[STORY.digit] !== STORY.R6.f.value[STORY.digit])
  has('step 6: record 9, its reason and corrects #6 beside the seal, its fingerprint, link from h8, signature and one-time key in full, record 6 kept, not yet anchored', `corrects #${STORY.k}`, esc(STORY.reason), `<span class="h8" title="${STORY.r9}">`, `<span class="h8" title="${STORY.h9}">`, `one-time demo key ${STORY.key9.slice(0, 8)}…`, `key id ${STORY.key9.slice(0, 8)}…`, 'as Check a record signs a correction with a one-time demo key made in your browser', `simulated anchor matches records 1 to ${N} · record ${N + 1} not yet anchored`, `h<sub>${N + 1}</sub>, is not yet anchored`, 'sit beside the seal, not inside it', `Beside the seal: corrects #${STORY.k} · reason “${esc(STORY.reason)}”`, `<code>${STORY.r9}</code>`, `<code>${STORY.h9}</code>`, `<code>${STORY.sig9}</code>`, `<code>${STORY.pub9}</code>`, `<code>${STORY.key9}</code>`, `Record ${STORY.k} <span class="sub">· stays as sealed · peak area ${STORY.R6.f.value}</span>`, `illustrative · sealed in #${STORY.k}`)
  ok('story: record 9’s reason agrees with step 1 (a reintegration in the CDS, imported again), not with a change of source', /reintegrated in the CDS/.test(STORY.reason) && !/corrected to the CDS result/.test(sec2))
  has('step 7: h8 to a public network, only a fingerprint, the agent’s four checks, all Upcoming, and the two links', `<span class="h8" title="${anchor}">`, 'Only this fingerprint would go on the network, never the values.', 'Public network <span class="tag">Upcoming</span>', 'AI agent <span class="tag">Upcoming</span>', 'href="check.html#verifier"', 'href="roadmap.html#planned"', '<span>Check it yourself</span>')
  ok('story: nothing upcoming flies in as if it were computed (the network fingerprint fades in)', !/data-fly="7:/.test(sec2))
  ok('story: the inline script and iqc.js use the same stage thresholds (960 px wide, and 600 px tall from 1180 px wide, else 700)', prepaint.includes('innerWidth>=960&&h>=(innerWidth>=1180?600:700)') && src.includes('w >= 960 && h >= (w >= 1180 ? 600 : 700)'))
  ok('story: no animation in the CSS; motion is iqc.js’s finite WAAPI only', !/animation|transition/.test((css.match(/\.sc\{[\s\S]*?(?=\.flow\{)/) || [''])[0]))
}
ok('index: Fig. 3 rows are the same sequence (value, capture time, fingerprint per record)', (() => { const tb = ov.match(/<table class="hist"[\s\S]*?<\/table>/)[0]; return recs.every((x) => tb.includes(`<th scope="row" role="rowheader" class="c-n">${x.n}</th>`) && tb.includes(`<time datetime="${x.f.capturedAt}">`) && tb.includes(`data-v>${x.f.value}</td>`) && tb.includes(`<code>${x.r.slice(0, 8)}</code>`)) && count(tb, /<tr role="row" data-n=/g) === N })())
ok('index: Fig. 3 links to Check a record, read-only', /data-history[\s\S]*?href="check\.html#verifier"/.test(ov) && !/<input|<button/.test(ov.match(/<figure class="fig fig--hist"[\s\S]*?<\/figure>/)[0]))
ok('index: the founder’s line once, verbatim, as the pull quote of section 2 (Why), before the story, and nowhere else', count(T['index.html'], /intelligence explosion/g) === 1 && /<section class="sec sec--side" id="why" aria-labelledby="s2-h">[\s\S]*?<blockquote class="pull"><p>In an intelligence explosion, human review can’t keep up with every result; records have to verify themselves\.<\/p><footer>[\s\S]*?, founder<\/footer><\/blockquote>[\s\S]*?<\/section>\s*<section class="sec story"/.test(ov) && count(ov, /<blockquote class="pull">/g) === 1 && !/intelligence explosion/.test(ov.slice(ov.indexOf('id="agents"'))))
ok('copy: the founder’s line, exactly', C.founderLine === 'In an intelligence explosion, human review can’t keep up with every result; records have to verify themselves.')
// where it fits: Fig. 4 is the automated lab (sealing at the orchestrator or driver, upcoming; today beside the export), Fig. 5 the GMP lab
{
  const fits = (ov.match(/<section class="sec" id="fits"[\s\S]*?<\/section>/) || [''])[0], figs = fits.match(/<figure class="flow[ "][\s\S]*?<\/figure>/g) || [], ft = figs.map((f) => textOf(f, true))
  ok('index: where it fits holds two flow figures, Fig. 4 then Fig. 5, each named by its caption', figs.length === 2 && /aria-labelledby="f4-c"/.test(figs[0]) && /<b>Fig\. 4<\/b>/.test(figs[0]) && /aria-labelledby="f5-c"/.test(figs[1]) && /<b>Fig\. 5<\/b>/.test(figs[1]))
  ok('index, Fig. 4: Instrument, Orchestrator or driver (SiLA 2, OPC UA LADS), Data pipeline, Models and agents; Immutable QC sealing where the result is produced, upcoming; today beside the export', ['Instrument', 'Orchestrator or driver', 'SiLA 2', 'OPC UA LADS', 'Data pipeline', 'Models and agents', 'Upcoming: sealed here', 'Today: an HPLC CSV export', 'Today: imports an HPLC CSV export, then fingerprints, links and signs each peak area.', 'Upcoming: would seal each result as the orchestrator or driver receives it', 'Upcoming: agents would check the sealed history before use', 'Where Immutable QC would sit in an automated lab', 'Today it imports an HPLC CSV export (solid line)'].every((w) => ft[0].includes(w)) && count(figs[0], /<li class="node/g) === 4 && figs[0].includes('<span class="tag">Alpha</span>') && /^<figure class="flow flow--fits"/.test(figs[0]) && count(figs[0], /<p class="iqc-in iqc-in--up">/g) === 1 && count(figs[0], /<p class="iqc-in iqc-in--today">/g) === 1 && count(figs[0], /class="iqc-in/g) === 2 && figs[0].indexOf('iqc-in--up') < figs[0].indexOf('iqc-in--today') && !/iqc-in--(?:up|today)|flow--fits/.test(figs[1]) && !/where the orchestrator or driver produces it|reads each result/.test(ft[0]))
  ok('index, Fig. 5: Instrument, CDS, LIMS, QA review and the CSV export, as before', ['Instrument', 'CDS', 'LIMS', 'QA review', 'CSV export from the CDS', 'Upcoming: QA review would check the sealed history', 'Where Immutable QC sits in a GMP lab'].every((w) => ft[1].includes(w)) && count(figs[1], /<li class="node/g) === 4)
  ok('index, where it fits: the body names the orchestrator, the drivers and the pipeline, says sealing there is upcoming, that today it sits beside the export, and that a change before import is not covered today (before capture, once sealing moves there)', ['scheduler or orchestrator', 'device drivers', 'data pipeline', 'Sealing each result in the orchestrator or driver, as the instrument produces it, over SiLA 2 or OPC UA LADS, is upcoming.', 'Today, Immutable QC sits beside an HPLC CSV export', 'Today a change made before import is not covered; with sealing at capture, only a change made before capture would be.'].every((w) => textOf(fits, true).includes(w)))
  ok('index, today: the Upcoming item names every new upcoming feature', (() => { const li = (ov.match(/<li><span class="k"><span class="tag tag--in">Upcoming<\/span><\/span><span>[\s\S]*?<\/li>/) || [''])[0]; return ['Sealing at capture (SiLA 2 and OPC UA LADS adapters)', 'measured and derived records', 'lineage and recall', 'Merkle batches with salted leaves and inclusion checks', 'an encrypted archive on Filecoin', 'post-quantum signatures', 'agentic workflows'].every((w) => textOf(li, true).includes(w)) })())
  ok('index, agents: measured and derived records, and the one-line rule, with links to both roadmap items', ['only a record sealed at capture, by the instrument’s or orchestrator’s key, would count as measured', 'either traces back to a measurement or it does not', 'or that it was ever measured'].every((w) => T['index.html'].includes(w)) && /id="agents"[\s\S]*?href="roadmap\.html#agents"[\s\S]*?href="roadmap\.html#derived"/.test(ov))
}
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
ok('sealed, anchoring: what a registry entry would show (a time, the writing address and, as the code is written, the batch’s record numbers; no value), never "who the lab is"', T['sealed.html'].includes('A registry entry would show that a fingerprint existed by a given time, and the address that wrote it, which links a lab’s anchors to one another; as the registry code is written today, it would also show the first and last record numbers of the batch. It would show no value, and it would not keep the records.') && !/would not show who the lab is/.test(T['sealed.html']))
ok('sealed and regulatory: a system key’s signature is neither an electronic nor a digital signature in Part 11’s sense', ['sealed.html', 'regulatory.html'].every((f) => T[f].includes('A signature made with a system key on a record’s bytes is neither an electronic signature nor a digital signature as 21 CFR Part 11 uses those terms: both identify a person.')) && !/\bA digital signature\b/.test(T['sealed.html'] + T['regulatory.html']))
ok('sealed, status table: capture is Upcoming, not also Not claimed', /<tr><th scope="row">Electronic signatures, validation<\/th><td><b>Not claimed\.<\/b><\/td><\/tr>/.test(pagesHTML['sealed.html']) && !/Instrument capture/i.test(T['sealed.html']))
ok('regulatory: capture is linked to Sealing at capture with the Upcoming tag, never a bare "instrument capture"', count(pagesHTML['regulatory.html'], /<a href="roadmap\.html#capture">[Ss]ealing at capture<\/a> <span class="tag">Upcoming<\/span>/g) === 2 && !/instrument capture|Capture at the instrument/i.test(T['regulatory.html']))
ok('regulatory, Enduring: a Filecoin copy would be an extra encrypted copy; the lab’s validated archive stays the record', T['regulatory.html'].includes('for GMP retention the lab’s validated archive stays the record, and a Filecoin copy would be one more encrypted copy, whose storage providers would need the supplier controls EU Annex 11 expects'))
ok('index, what would go public: one batch fingerprint by default, and the encrypted archive’s ciphertext only if a lab chooses it', T['index.html'].includes('Once anchoring becomes available, by default one batch fingerprint will go on it for a whole run of records.') && T['index.html'].includes('Only if a lab chooses the encrypted archive, also upcoming: its records as ciphertext, encrypted in the lab with keys that stay there, never readable on the network.'))
ok('index, agents: a derived number that cites real measurements but is wrong would still pass', T['index.html'].includes('A derived number that cites real measurements but was computed or copied wrongly would still pass; a checker would re-run the analysis from its cited inputs where it is deterministic.'))
ok('sealed: a pass does not show that the value was ever measured (an invented value sealed would pass); measured and derived records are upcoming', ['That the value was ever measured: a pass shows that a record has not changed since it was sealed, not that an instrument produced it', 'invented and then sealed would pass too', 'measured and derived records, which would tell the two apart, are upcoming'].every((w) => T['sealed.html'].includes(w)))
ok('sealed, privacy: the storage principle (nothing readable leaves the lab), the encrypted archive as upcoming, and salted leaves of a Merkle batch', ['Storage would follow the same rule as anchoring: nothing readable leaves the lab.', 'An encrypted archive on Filecoin is upcoming', 'the ciphertext the lab archived under that address', 'encrypted in the lab before upload, with keys that stay in the lab', 'ciphertext and never results', 'as the leaves of a Merkle batch'].every((w) => T['sealed.html'].includes(w)))
ok('sealed, status table: every new upcoming item is a row labeled Upcoming, and Filecoin is the encrypted archive', (() => { const h = pagesHTML['sealed.html'].replace(/<span class="nw">([^<]*)<\/span>/g, '$1'); return ['Sealing at capture (SiLA 2, OPC UA LADS adapters)', 'Measured and derived records', 'Lineage and recall', 'Merkle batches with salted leaves', 'Encrypted archive on Filecoin', 'Post-quantum signatures and encryption'].every((w) => h.includes(`<th scope="row">${w}</th><td><span class="tag tag--in">Upcoming</span>`)) && !/Filecoin integration/.test(T['sealed.html']) && !/Filecoin integration/.test(T['regulatory.html']) })())
{
  const rm = T['roadmap.html'], planned = pagesHTML['roadmap.html'].match(/<section class="sec sec--side" id="planned"[\s\S]*?<\/section>/)[0]
  // the founder's list of upcoming features (step 3b), each under its own heading with the one label, in this order
  const UPCOMING = [['capture', 'Sealing at capture'], ['derived', 'Measured and derived records'], ['lineage', 'Lineage and recall'], ['agents', 'Agentic workflows'], ['merkle', 'Merkle batches with salted leaves'], ['privacy', 'Privacy on public networks'], ['anchoring', 'Anchoring on a public test network'], ['filecoin', 'Encrypted archive on Filecoin'], ['signatures', 'Per-analyst signatures'], ['position', 'Signatures that cover each record’s position'], ['review', 'Reviewer sign-off'], ['verification', 'Server-side verification in the app'], ['metadata', 'Sample and method metadata in the seal'], ['registry', 'A shared registry'], ['pq', 'Post-quantum signatures and encryption']]
  for (const [id, name] of UPCOMING) ok(`roadmap: "${name}" is labelled Upcoming`, new RegExp(`<h3 id="${id}"><span class="no">2\\.\\d+</span><span>${name} <span class="tag">Upcoming</span></span></h3>`).test(planned))
  eq('roadmap: the upcoming items, in order, and nothing else under Upcoming', [...planned.matchAll(/<h3 id="([\w-]+)">/g)].map((m) => m[1]).join(' '), UPCOMING.map(([id]) => id).join(' '))
  // the Overview's Upcoming item and How a record is sealed's status table name every roadmap item, in the Roadmap's order
  const KEY = { capture: 'sealing at capture', derived: 'measured and derived records', lineage: 'lineage and recall', agents: 'agentic workflows', merkle: 'merkle batches with salted leaves', privacy: 'privacy on public networks', anchoring: 'public test network', filecoin: 'encrypted archive on filecoin', signatures: 'per-analyst signatures', position: 'signatures that cover each record’s position', review: 'reviewer sign-off', verification: 'server-side verification in the app', metadata: 'sample and method metadata in the seal', registry: 'a shared registry', pq: 'post-quantum signatures and encryption' }
  eq('roadmap: one key phrase per upcoming item', Object.keys(KEY).join(' '), UPCOMING.map(([id]) => id).join(' '))
  {
    const li = textOf((ov.match(/<li><span class="k"><span class="tag tag--in">Upcoming<\/span><\/span><span>[\s\S]*?<\/li>/) || [''])[0], true).toLowerCase()
    const at = UPCOMING.map(([id]) => li.indexOf(KEY[id]))
    ok(`index, today: the Upcoming item names every roadmap item, in the Roadmap’s order (${UPCOMING.filter((_, i) => at[i] < 0).map(([id]) => id).join(', ') || 'all named'})`, at.every((v, i) => v >= 0 && (i === 0 || v > at[i - 1])))
    const rows = [...pagesHTML['sealed.html'].replace(/<span class="nw">([^<]*)<\/span>/g, '$1').matchAll(/<tr><th scope="row">([^<]*)<\/th><td><span class="tag tag--in">Upcoming<\/span>/g)].map((m) => m[1].toLowerCase())
    ok(`sealed, status table: one Upcoming row per roadmap item, in the Roadmap’s order (${rows.length})`, rows.length === UPCOMING.length && UPCOMING.every(([id], i) => rows[i].includes(KEY[id])))
  }
  ok('roadmap: section 2 is called Upcoming; the page keeps its name', /<h2 id="s2-h"><span class="no">2<\/span>Upcoming<\/h2>/.test(planned) && /<h1 class="h1-doc">Roadmap<\/h1>/.test(pagesHTML['roadmap.html']))
  ok('roadmap: no dates on planned items', !/\b20\d\d\b|\bQ[1-4]\b|\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/.test(textOf(planned, true)))
  ok('roadmap: the privacy reason in plain sentences, and what anchoring would write', rm.includes('A plain SHA-256 of a few guessable fields can in principle be matched by trying likely values') && rm.includes('When anchoring becomes available it will write only a batch fingerprint, never the values'))
  const item = (id) => textOf(planned.match(new RegExp(`<h3 id="${id}">[\\s\\S]*?(?=<h3 |$)`))[0], true)
  ok('roadmap: the items are numbered 2.1 to 2.15 in order, the automated-lab items (capture, derived, lineage, agents) first and post-quantum last', [...planned.matchAll(/<h3 id="[\w-]+"><span class="no">2\.(\d+)<\/span>/g)].map((m) => +m[1]).join(' ') === UPCOMING.map((_, i) => i + 1).join(' ') && UPCOMING.slice(0, 4).map(([id]) => id).join(' ') === 'capture derived lineage agents' && UPCOMING.at(-1)[0] === 'pq' && textOf(planned, true).includes('The automated-lab items first, then the rest; no dates.'))
  ok('roadmap, sealing at capture: SiLA 2 and OPC UA LADS, the first adapter, nothing before capture covered, and no vendor', ['SiLA 2', 'OPC UA LADS', 'the first adapter would seal the results of one SiLA 2 device', 'that would also carry the sample, the well or position and the method inside the seal (2.13)', 'before anything downstream could change it', 'would still not be covered'].every((w) => item('capture').includes(w)) && !/of the alpha’s construction/.test(item('capture')))
  ok('roadmap, measured and derived: the rule in one line, the hallucination point, and what a fingerprint alone shows', ['not that it was ever measured', 'would count as measured', 'would be a derived record, under a different signer', 'either traces back to a measurement or it does not', 'invented or hallucinated value with no measurement under it, which hashing alone cannot catch', 'A derived number that cites real measurements but was computed or copied wrongly would still pass, so a checker would re-run the analysis from its cited inputs', 'only if agents and scripts cannot use the capture key', 'seal the device’s identity with each result'].every((w) => item('derived').includes(w)) && !/\bthe defense against\b/i.test(item('derived')))
  ok('roadmap, lineage and recall: a lineage graph, the reach of a corrected value in one step, a data recall like an OOS impact assessment', ['lineage graph', 'computable in one step', 'every analysis, model and decision recorded as a derived record that cites it', 'which agents must re-check', 'would stay invisible to it', 'data recall', 'out-of-specification investigation'].every((w) => item('lineage').includes(w)))
  ok('roadmap, Merkle batches: one 32-byte root, inclusion checks (never "proofs"), salted leaves as the salted commitments, RFC 9162 with domain separation, CT and Rekor as prior art', ['32-byte root', 'short path of hashes', 'inclusion check', 'without revealing the others’ contents (it would show how many records the batch holds, and this one’s place)', 'selective disclosure', 'Every leaf would be salted', 'salted commitments of 2.6', 'Each anchored root would also commit to the root anchored before it', 'a dropped batch or a restored backup would break', 'the tree hash of RFC 6962, kept in RFC 9162', 'domain separation', 'no duplicated leaf', 'Certificate Transparency logs', 'Rekor'].every((w) => item('merkle').includes(w)) && !/\bproofs?\b/i.test(item('merkle')))
  ok('roadmap, privacy: salted commitments as the leaves of the Merkle batch, then zero-knowledge proofs', item('privacy').includes('Salted (hiding) commitments') && item('privacy').includes('would be the leaves of a Merkle batch (2.5)') && item('privacy').includes('Zero-knowledge proofs'))
  ok('roadmap, Filecoin: three tiers (anchor only by default, an encrypted archive, the lab’s own storage); encrypted in the lab, keys stay in the lab, content addressed, deals renewed; never readable; never permanent', ['Three storage tiers would be offered', 'Anchor only, the default', 'encrypted in the lab before upload', 'keys that stay in the lab', 'only ciphertext and never readable results', 'content addressing would let anyone who fetches a copy check that it is, byte for byte, the ciphertext the lab archived under that address, once the address is sealed and anchored with its batch', 'checked in the lab, after decryption, against their fingerprints', 'the lab’s own storage', 'must be renewed', 'with more than one storage provider, and keeps its keys'].every((w) => item('filecoin').includes(w)) && !/permanent|unchangeable|forever|for good/i.test(item('filecoin')))
  ok('roadmap, post-quantum: long term; SHA-256 and Merkle hold up, ECDSA breaks; algorithm agility first, then hybrid ML-DSA (FIPS 204) or SLH-DSA (FIPS 205); re-anchoring as RFC 4998; AES-256 and ML-KEM (FIPS 203) for an archive', ['Long term.', 'SHA-256 and Merkle trees would hold up', 'ECDSA P-256 signatures are the part', 'First would come algorithm agility', 'algorithm id on every signature', 'ML-DSA (NIST FIPS 204)', 'SLH-DSA (FIPS 205', 'RFC 4998', 'covering each record’s signature as well as its fingerprint', 'harvest-now, decrypt-later', 'AES-256-GCM', 'under keys that stay in the lab', 'Wherever a data key had to be sent to someone else’s public key', 'ML-KEM (FIPS 203) would wrap it', 'never RSA or elliptic-curve key exchange alone'].every((w) => item('pq').includes(w)))
  ok('roadmap, position: what position-covering signatures would show (a removal, move or copy, to anyone without the key) and what they would not (a rewrite by the key holder, records dropped from the end)', ['removed, moved or copied to a second position', 'and that needs no key', 'to anyone without the signing key', 'a rewrite by whoever holds it, or records dropped from the end, would still show only against an anchor'].every((w) => item('position').includes(w)))
  ok('roadmap, anchoring: what a registry entry would show as the registry code is written (the writing address, the batch’s record numbers)', ['As the registry code is written, an entry would also show the address that wrote it', 'the first and last record numbers of its batch'].every((w) => item('anchoring').includes(w)))
  ok('roadmap, not claimed: no capture, no archive, no post-quantum signatures today', ['no capture at the instrument or orchestrator', 'no archive on Filecoin', 'no post-quantum signatures'].every((w) => rm.includes(w)))
  ok('roadmap: the agent-readable record from Check, labelled roadmap', /href="check\.html#agent"/.test(planned))
}
{
  const ab = T['about.html'], qs = count(pagesHTML['about.html'], /<h3 id="q\d+">/g)
  ok(`about: 5 to 7 questions (${qs})`, qs >= 5 && qs <= 7)
  eq('about: exactly seven questions since Draft 6, in order (labs, buy or hold, blockchain, CDS/LIMS, GMP today, database edits, sabotage and espionage)', [...pagesHTML['about.html'].matchAll(/<h3 id="q(\d)"><span class="no">5\.(\d)<\/span>([^<]*)<\/h3>/g)].map((m) => `${m[1]}${m[2]} ${m[3]}`).join(' | '), ['What kinds of labs is this for?', 'Do I need to buy or hold anything?', 'Is my data put on a blockchain?', 'Does it replace my orchestrator, ELN, CDS, LIMS or audit trail?', 'Can I use it for GMP records today?', 'What if someone edits the database directly?', 'What about sabotage and espionage?'].map((q, i) => `${i + 1}${i + 1} ${q}`).join(' | '))
  ok('about: "What kinds of labs is this for?" names the four fields, the lab types, the founder’s background and GMP as the expansion path', ab.includes('What kinds of labs is this for? Automated research labs first: biotechnology, microbiology, chemistry and materials science') && ['self-driving labs', 'robotic workcells', 'cloud labs', 'AI-first research companies', 'CROs that hand automated data to clients', 'materials science, chemistry and microbiology', 'Regulated QC labs are the expansion path, not the opening'].every((w) => ab.includes(w)))
  ok('about: "What about sabotage and espionage?" says most bad data is not malicious, what is detected and not, and that nothing readable leaves the lab', ab.includes('What about sabotage and espionage? Most bad data is not malicious') && ['Sabotage is the minority case', 'Detected today, wherever the checks are run (these pages, the console, or the recipe in How a record is sealed; checking in the alpha app is upcoming): a sealed value changed after sealing by anyone without the signing key', 'A history rewritten with the key would show only against an anchor taken earlier. A record deleted, moved or copied, with the rest relinked, needs no key today; it would show against an earlier anchor too, and through signatures that cover each record’s position when done by anyone without the key. Both are upcoming.', 'Not detected: anything before sealing', 'swapped sample', 'miscalibrated instrument', 'compromised robot software', 'In the alpha app, records are sealed at import; sealing at capture (upcoming) would narrow that window, not close it.', 'Espionage is not detected: a seal makes a change show, not a copy.', 'nothing readable leaves the lab', 'Anchoring would put only a fingerprint on a public network, and once salted (upcoming) it would reveal no value; values would leave only encrypted in the lab, with keys that stay there, and only if the lab chooses the encrypted archive (upcoming).', 'Protecting the records, the keys and the people who hold them stays with the lab; Immutable QC would be one part of that, not a security program.'].every((w) => ab.includes(w)) && !/one risk to discuss with a lab|it would reveal nothing/.test(ab) && !/Detected: any change/.test(ab) && count(pagesHTML['about.html'].match(/<h3 id="q7">[\s\S]*?<\/div>/)[0], /<p>/g) === 4)
  ok('about: "Is my data put on a blockchain?" says what anchoring would put on a network by default, and that the encrypted archive (upcoming) would hold records only encrypted in the lab', ab.includes('By default it will put only one batch fingerprint') && ab.includes('A lab that chooses the encrypted archive, also upcoming, would store its records on Filecoin too, encrypted in the lab first and never readable there.') && !/At most it will put/.test(ab))
  ok('about: the fingerprint’s five fields still answered (merged into the orchestrator, ELN, CDS and LIMS question, which names today’s place beside the export and the upcoming one in or beside the orchestrator)', ab.includes('Does it replace my orchestrator, ELN, CDS, LIMS or audit trail? No. Today it sits beside an HPLC CSV export; upcoming, it would sit in or beside the orchestrator and hand each sealed result on unchanged.') && ab.includes('no capture at the instrument or orchestrator') && !/no instrument capture/.test(ab) && ab.includes('the fingerprint covers five fields: instrument, measurement type, value, unit and capture time'))
  ok('about: why it exists speaks to automated labs first, then regulated ones', ab.includes('In an automated lab, results arrive faster than anyone can review them') && ab.includes('In a regulated lab, work that is not documented is treated as not done'))
  ok('sabotage and espionage are named on About only (the question, and the Draft 6 history row)', Object.entries(T).every(([f, t]) => (f === 'about.html') === /sabotage|espionage/i.test(t)) && !/sabotage|espionage/i.test(ogHTML))
  ok('about: "Do I need to buy or hold anything?" answered plainly', ab.includes('Do I need to buy or hold anything? No. There is nothing to buy, hold or connect.'))
  ok('about: "Is my data put on a blockchain?"', ab.includes('Is my data put on a blockchain? No.'))
  ok('about: the founder’s name, joseqc.com for contact, the independence line, revision history', ab.includes('José A. Fernández Abreu') && /href="https:\/\/joseqc\.com"><span>joseqc\.com<\/span>/.test(pagesHTML['about.html']) && ab.includes(C.independence) && pagesHTML['about.html'].includes('id="history"'))
}
ok('regulatory: every framework, expectation by expectation, with approach, today and not covered', ['21 CFR Part 11', 'EU GMP Annex 11', 'ISO/IEC 17025:2017', 'ALCOA+', 'GMP records', 'TNI'].every((w) => T['regulatory.html'].includes(w)) && (() => { const cl = pagesHTML['regulatory.html'].match(/<article class="cl"[\s\S]*?<\/article>/g) || []; return cl.length >= 20 && cl.every((a) => /<dt>(Approach)<\/dt>/.test(a) && /<dt>Today<\/dt>/.test(a) && /<dt>Not covered<\/dt>/.test(a)) })())
ok('regulatory: every Upcoming tag on the map follows one of the roadmap items, linked to it', (() => { const rg = pagesHTML['regulatory.html'].replace(/<p class="note">[\s\S]*?<\/p>/, ''); const tags = count(rg, /<span class="tag">Upcoming<\/span>/g); const linked = count(rg, /<a href="roadmap\.html#(?:capture|derived|lineage|agents|merkle|privacy|anchoring|filecoin|signatures|position|review|verification|metadata|registry|pq)">[^<]+<\/a>[^<]{0,80}<span class="tag">Upcoming<\/span>/g); return tags > 0 && tags === linked })())
ok('404: short, with links home', T['404.html'].includes('Page not found') && /href="index\.html"/.test(pagesHTML['404.html']))
// Fig. 1, Fig. 3, the seven story figures and the stage
ok('pages: "Simulated · demo data" label on every plate', T['index.html'].split('Simulated · demo data').length === 3 + STP.titles.length + 1 && count(ov, /<div class="plate[ "]/g) === 2 + STP.titles.length + 1 && T['check.html'].includes('Simulated · demo data'))
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
// the Overview story (Draft 5) may add at most 8 KB gz of eager JS to Draft 4's bundle (13464 bytes gz, main 4e793fb), and
// keeps the Overview's first load at or under 130 KB gz
ok(`budget: the story adds ${((gz(Buffer.from(js)) - 13464) / 1024).toFixed(1)} KB gz of eager JS (<= 8 KB)`, gz(Buffer.from(js)) - 13464 <= 8 * 1024)
ok(`budget: index.html first load ${(sizes['index.html'].total / 1024).toFixed(1)} KB gz <= 130 KB`, sizes['index.html'].total <= 130 * 1024)
ok('budget: the story’s figures are inline SVG and HTML only (no <img>, no <picture>, no external URL)', !/<(?:img|picture|iframe|video|canvas)\b/.test((ov.match(/<section class="sec story"[\s\S]*?<\/section>/) || [''])[0]) && !/https?:/.test((ov.match(/<section class="sec story"[\s\S]*?<\/section>/) || [''])[0]))
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
