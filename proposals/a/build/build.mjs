// build.mjs: Immutable QC, prototype A. Computes, signs, asserts and prerenders the demo record history.
//
//   node build/build.mjs            re-check the signed data already in index.html (sign only if it is missing or stale)
//   node build/build.mjs --resign   make a fresh one-time P-256 key, sign every record again, discard the private key
//
// Construction (the alpha app's, A/services/crypto.js:16-23,82-86):
//   r_n = SHA-256( UTF-8 "instrumentId|sensorType|value|unit|capturedAt" )
//   h_n = SHA-256( ASCII lowercase-hex h_{n-1} + lowercase-hex r_n + decimal n ),  h_0 = 64 zeros
//   sig_n = ECDSA P-256 / SHA-256 over the 32 raw bytes of r_n, IEEE P1363 (r||s) so WebCrypto can verify it
//   anchor = h_8, shown as "Anchored fingerprint (simulated, no network call)"
//   key fingerprint = first 16 hex of SHA-256 over the 65 raw bytes of the uncompressed public key
// Every hash on the page comes from here. The build also runs the exact printf | sha256sum recipe the page prints, in a
// shell, and stops if any number disagrees. It writes only between <!--gen:name--> and <!--/gen:name--> in index.html.
import { createHash, generateKeyPairSync, sign, verify, createPublicKey } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PAGE = join(ROOT, 'index.html')
const RESIGN = process.argv.includes('--resign')
const H = (s) => createHash('sha256').update(s, 'utf8').digest('hex')
const B = (hex) => Buffer.from(hex, 'hex')
const ZERO = '0'.repeat(64)
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const pad = (n) => String(n).padStart(2, '0')
let fails = 0, checks = 0
const ok = (name, cond) => { checks++; if (!cond) { fails++; console.error('FAIL ' + name) } }
const eq = (name, a, b) => ok(`${name} (${a} vs ${b})`, a === b)

// ---- 1. The synthetic sequence (vendor-neutral; fictional product and lot)
const SEQ = {
  id: 'SEQ-260915-A', product: 'Product 200 mg tablets', instrument: 'HPLC-02', sensorType: 'hplc', unit: 'counts',
  date: '2026-09-15',
  // injection, sample, retention time (min), capturedAt (UTC), peak area (counts)
  rows: [
    ['01', 'STD-A', '4.82', '2026-09-15T09:14:07Z', 1523847],
    ['02', 'STD-A', '4.81', '2026-09-15T09:22:19Z', 1519662],
    ['03', 'STD-A', '4.83', '2026-09-15T09:30:31Z', 1527310],
    ['04', 'STD-A', '4.82', '2026-09-15T09:38:42Z', 1521945],
    ['05', 'STD-A', '4.82', '2026-09-15T09:46:55Z', 1525108],
    ['06', 'L26031-1', '4.81', '2026-09-15T09:55:08Z', 1508312],
    ['07', 'L26031-2', '4.83', '2026-09-15T10:03:20Z', 1516740],
    ['08', 'L26031-3', '4.82', '2026-09-15T10:11:33Z', 1511025],
  ],
}
const payload = (v, at) => `${SEQ.instrument}|${SEQ.sensorType}|${v}|${SEQ.unit}|${at}`

// ---- 2. Plausibility asserts on the data itself
const areas = SEQ.rows.map((r) => r[4]), sst = areas.slice(0, 5)
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length
const rsd = (a) => { const m = mean(a); return 100 * Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) / m }
ok('8 injections', SEQ.rows.length === 8)
ok('peak areas are positive integers', areas.every((x) => Number.isInteger(x) && x > 0))
ok('SST: 5 standard injections of one solution', SEQ.rows.slice(0, 5).every((r) => r[1] === 'STD-A'))
ok(`SST peak-area RSD ${rsd(sst).toFixed(2)} % is under 2.0 %`, rsd(sst) < 2)
const rts = SEQ.rows.map((r) => +r[2])
ok('retention times within 1 % of their mean', rts.every((t) => Math.abs(t - mean(rts)) / mean(rts) < 0.01))
const times = SEQ.rows.map((r) => r[3])
ok('capturedAt is ISO-8601 UTC, on the sequence date', times.every((t) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(t) && t.startsWith(SEQ.date) && !isNaN(Date.parse(t))))
ok('capturedAt strictly increasing, 5 to 15 minutes apart', times.every((t, i) => i === 0 || ((Date.parse(t) - Date.parse(times[i - 1])) / 60000 >= 5 && (Date.parse(t) - Date.parse(times[i - 1])) / 60000 <= 15)))
ok('payloads are printable ASCII with no single quote (safe inside printf \'%s\' \'...\')', SEQ.rows.every((r) => /^[\x20-\x7e]+$/.test(payload(r[4], r[3])) && !payload(r[4], r[3]).includes("'")))

// ---- 3. Fingerprints and links
let prev = ZERO
const REC = SEQ.rows.map(([inj, smp, rt, at, area], i) => {
  const n = i + 1, v = String(area), r = H(payload(v, at)), h = H(prev + r + String(n))
  const o = { n, inj, smp, rt, at, v, r, prev, h }
  prev = h
  return o
})
const ANCHOR = prev

// the recipe the page prints, run in a real shell (coreutils sha256sum)
const sh = (cmd) => execFileSync('sh', ['-c', cmd], { encoding: 'utf8' }).trim()
const cmd1 = (o) => `printf '%s' '${payload(o.v, o.at)}' | sha256sum`
const cmd2 = (o) => `printf '%s' '${o.prev}${o.r}${o.n}' | sha256sum`
let haveShell = true
try { sh('printf x | sha256sum') } catch { haveShell = false; console.warn('note: sha256sum not found; shell recipe check skipped') }
for (const o of REC) {
  if (haveShell) {
    eq(`record ${pad(o.n)}: printf | sha256sum = r`, sh(cmd1(o)), `${o.r}  -`)
    eq(`record ${pad(o.n)}: chain step via shell = h`, sh(cmd2(o)), `${o.h}  -`)
  }
  eq(`record ${pad(o.n)}: payload bytes = chars (ASCII)`, Buffer.byteLength(payload(o.v, o.at)), payload(o.v, o.at).length)
}
REC.forEach((o, i) => eq(`record ${pad(o.n)}: prev = h of record ${pad(i)}`, o.prev, i ? REC[i - 1].h : ZERO))
eq('anchor = h_8', ANCHOR, REC[7].h)

// tamper arithmetic the page's behaviours rely on (an edit to record 03, transposed digits)
{
  const t = REC[2], tv = '1572310'
  const rT = H(payload(tv, t.at)), hT = H(t.prev + rT + '3')
  ok('edit: record 03 fingerprint changes', rT !== t.r)
  ok('edit: the stored link to record 04 no longer matches', hT !== REC[3].prev)
  let p = hT
  for (let i = 3; i < 8; i++) p = H(p + REC[i].r + String(i + 1))
  ok('rewrite: the recomputed head differs from the anchor', p !== ANCHOR)
  const c9 = H(ANCHOR + rT + '9')
  ok('correction: record 09 extends the chain from the anchored head', c9 !== ANCHOR && c9.length === 64)
}

// ---- 4. Signatures: re-use the ones already on the page if they still verify; otherwise sign with a fresh key
const DATA_RE = /<!--gen:data-->([\s\S]*?)<!--\/gen:data-->/
let html = readFileSync(PAGE, 'utf8')
const keyOf = (pubHex) => {
  const p = B(pubHex)
  if (p.length !== 65 || p[0] !== 4) throw new Error('public key must be a 65-byte uncompressed P-256 point')
  return createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: p.subarray(1, 33).toString('base64url'), y: p.subarray(33).toString('base64url') }, format: 'jwk' })
}
const sigOk = (key, rHex, sig) => { try { return verify('sha256', B(rHex), { key, dsaEncoding: 'ieee-p1363' }, B(sig)) } catch { return false } }
let pub = null, sigs = null, signedNow = false
const old = html.match(DATA_RE)
if (!RESIGN && old) {
  const m = old[1].match(/<script type="application\/json" id="iqc-data">([\s\S]*?)<\/script>/)
  if (m) {
    try {
      const d = JSON.parse(m[1])
      const k = keyOf(d.pub)
      if (d.rec.length === REC.length && d.rec.every((x, i) => x.r === REC[i].r && sigOk(k, REC[i].r, x.sig))) { pub = d.pub; sigs = d.rec.map((x) => x.sig) }
    } catch { /* stale or malformed: re-sign */ }
  }
}
if (!pub) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = publicKey.export({ format: 'jwk' })
  pub = '04' + Buffer.from(jwk.x, 'base64url').toString('hex').padStart(64, '0') + Buffer.from(jwk.y, 'base64url').toString('hex').padStart(64, '0')
  sigs = REC.map((o) => sign('sha256', B(o.r), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('hex'))
  signedNow = true
  // privateKey goes out of scope here; it is never serialised
}
const KEY = keyOf(pub)
REC.forEach((o, i) => { o.sig = sigs[i]; ok(`record ${pad(o.n)}: signature verifies with the shipped public key`, sigOk(KEY, o.r, o.sig)) })
ok('a signature does not verify for a changed value', !sigOk(KEY, H(payload('1572310', REC[2].at)), REC[2].sig))
const KEYFP = createHash('sha256').update(B(pub)).digest('hex').slice(0, 16) // over the 65 key bytes, not the hex text
eq('key fingerprint is over the 65 raw key bytes', B(pub).length, 65)

// ---- 5. What the page gets
const DATA = { inst: SEQ.instrument, type: SEQ.sensorType, unit: SEQ.unit, pub, anchor: ANCHOR, anchorN: 8, rec: REC.map(({ n, inj, smp, rt, at, v, r, prev, h, sig }) => ({ n, inj, smp, rt, at, v, r, prev, h, sig })) }
const json = JSON.stringify(DATA)
ok('no private key material in the page data', !/"d"\s*:|PRIVATE|pkcs8/i.test(json))

const NODE = '<svg class="nd" viewBox="0 0 20 20" aria-hidden="true"><circle class="rg" cx="10" cy="10" r="6.5"/><circle class="dr" cx="10" cy="10" r="6.5" pathLength="1"/><circle class="dt" cx="10" cy="10" r="2.75"/><path class="xx" d="M7.7 7.7l4.6 4.6m0-4.6l-4.6 4.6"/></svg>'
// Status marks are prerendered neutral (open ring): nothing is shown as verified until this browser has checked it.
const ST = (w) => `<span class="st"><svg class="ic" aria-hidden="true"><use href="#i-open"/></svg><span class="w">${w}</span></span>`
const row = (o) => `<tr class="rec" role="row" data-i="${o.n - 1}">` +
  `<td class="c-sp" role="cell">${NODE}</td>` +
  `<th scope="row" role="rowheader" class="c-inj">${pad(o.n)}</th>` +
  `<td class="c-smp" role="cell">${esc(o.smp)}</td>` +
  `<td class="c-rt" role="cell">${o.rt}</td>` +
  `<td class="c-at" role="cell"><time datetime="${o.at}">${o.at.slice(11, 19)}</time></td>` +
  `<td class="c-pa" role="cell"><button type="button" class="pa" disabled aria-describedby="pa-hint" aria-label="${o.v} counts, record ${pad(o.n)}: change peak area">${o.v}</button></td>` +
  `<td class="c-fp" role="cell"><code class="fp">${o.r.slice(0, 8)}</code><span class="fpn"></span></td>` +
  `<td class="c-ln" role="cell">${ST('linked')}<span class="lnn"></span></td>` +
  `<td class="c-sg" role="cell">${ST('verifies')}</td></tr>`
REC.forEach((o) => eq(`record ${pad(o.n)} is injection ${o.inj} (records 01-08 are injections 01-08)`, pad(o.n), o.inj))

const first = REC[0]
const t0 = REC[0].at.slice(11, 16), t1 = REC[7].at.slice(11, 16)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = `${+SEQ.date.slice(8)} ${MON[+SEQ.date.slice(5, 7) - 1]} ${SEQ.date.slice(0, 4)}`
// the caption is generated from the data, so it cannot go stale
const nStd = SEQ.rows.filter((r) => r[1] === 'STD-A').length, nSmp = SEQ.rows.length - nStd
ok('standards come first, then samples', SEQ.rows.every((r, i) => (i < nStd) === (r[1] === 'STD-A')))
const lots = [...new Set(SEQ.rows.slice(nStd).map((r) => r[1].replace(/-\d+$/, '')))]
eq('one sample lot', lots.length, 1)
const GEN = {
  meta: `<div><dt>Sequence</dt><dd>${SEQ.id}</dd></div><div><dt>Instrument</dt><dd data-o="inst">${SEQ.instrument}</dd></div><div><dt>Method</dt><dd>Assay, ${esc(SEQ.product)}</dd></div><div><dt>Run</dt><dd>${day}, ${t0}–${t1} UTC</dd></div>`,
  caption: `${REC.length} injections, one record each: ${nStd} system-suitability standards (STD-A), then ${nSmp} samples of lot ${lots[0]}.`,
  rows: REC.map(row).join(''),
  arange: `01–&#8288;${pad(REC.length)}`, // word joiner: the range never breaks after its dash
  count: `${REC.length} of ${REC.length}`,
  anchor8: ANCHOR.slice(0, 8),
  anchor64: ANCHOR.match(/.{16}/g).join('<wbr>'),
  sel: '01',
  pick: REC.map((o) => `<option value="${o.n - 1}">${pad(o.n)} · injection ${o.inj}</option>`).join(''),
  cmp0: 'Record 01 starts from 64 zeros.',
  cmd1: esc(cmd1(first)),
  out1: `${first.r}  -`,
  cmp1: `Matches the fingerprint stored with record 01 (${first.r.slice(0, 8)}).`,
  cmd2: esc(cmd2(first)),
  out2: `${first.h}  -`,
  cmp2: `Matches the link stored with record 01, which record 02 carries as its previous link (${first.h.slice(0, 8)}).`,
  keyfp: KEYFP,
  pubkey: pub.match(/.{1,16}/g).join('<wbr>'),
  // each sealed field stays whole; lines may break only after a separator
  payload1: payload(first.v, first.at).split('|').map((f) => `<span class="nw">${esc(f)}</span>`).join('|<wbr>'),
  data: `<script type="application/json" id="iqc-data">${json}</script>`,
}
for (const [name, body] of Object.entries(GEN)) {
  const re = new RegExp(`<!--gen:${name}-->[\\s\\S]*?<!--/gen:${name}-->`, 'g')
  const hits = html.match(re)
  ok(`marker gen:${name} present`, !!hits)
  html = html.replace(re, `<!--gen:${name}-->${body}<!--/gen:${name}-->`)
}

// ---- 6. Copy and code lint on the built page
const css = readFileSync(join(ROOT, 'styles.css'), 'utf8')
const js = readFileSync(join(ROOT, 'app.js'), 'utf8')
const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ')
const metaText = [...html.matchAll(/<(?:title)>([^<]*)<|content="([^"]*)"/g)].map((m) => m[1] || m[2]).join(' ')
const all = text + ' ' + metaText
const BANNED = [
  /cannot be altered/i, /\bimmutable\b(?! QC)/i, /guarantee/i, /compliance[- ]ready/i, /\bcompliant\b/i, /\bproofs?\b/i, /unbreakable/i,
  /trustless/i, /revolutionary/i, /\bpilots?\b/i, /\bpartners?\b/i, /\btrading\b/i, /\bprices?\b/i, /staking/i, /\bwallets?\b/i, /token sale/i, /\bIQC\b/,
  /\bNFTs?\b/i, /\bmint(ed|ing|s)?\b/i, /\bcrypto\b/i, /\btokens?\b/i, /blockchain/i, /MetaMask/i, /\btFIL\b/, /faucet/i,
  /Empower|OpenLAB|Waters|Agilent|Thermo|Shimadzu|Chromeleon|Sciex|PerkinElmer|LabSolutions|Dionex/i,
]
for (const re of BANNED) { const m = all.match(re); ok(`banned wording ${re} absent${m ? ` (found "${m[0]}")` : ''}`, !m) }
// the runtime sentences in app.js (state line, notes, correction text) get the same lint: every string and template literal
// a small scanner (strings, nested template literals, comments) so that text inside ${...} expressions is linted too
const jsStrings = (src) => {
  const out = [], st = []
  let buf = ''
  for (let i = 0; i < src.length; i++) {
    const c = src[i], top = st[st.length - 1]
    if (top && top.k === 't') {
      if (c === '\\') { buf += src[++i]; continue }
      if (c === '`') { out.push(buf); buf = ''; st.pop(); continue }
      if (c === '$' && src[i + 1] === '{') { out.push(buf); buf = ''; st.push({ k: 'e', d: 0 }); i++; continue }
      buf += c
      continue
    }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue }
    if (c === "'" || c === '"') { let j = i + 1, t = ''; while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; t += src[j++] } out.push(t); i = j; continue }
    if (c === '`') { st.push({ k: 't' }); continue }
    if (top && top.k === 'e') { if (c === '{') top.d++; else if (c === '}') { if (top.d === 0) { st.pop(); continue } top.d-- } }
  }
  ok('app.js scanner ends outside any literal', st.length === 0)
  return out.join(' ')
}
const jsText = jsStrings(js)
for (const s of ['History rewritten', 'one-time demo key', 'which record', 'Signatures could not be checked']) ok(`app.js strings include "${s}"`, jsText.includes(s))
ok('app.js has runtime strings to lint', jsText.length > 2000)
for (const re of BANNED) { const m = jsText.match(re); ok(`app.js strings: banned wording ${re} absent${m ? ` (found "${m[0]}")` : ''}`, !m) }
ok('app.js strings: no "cryptocurrency"', !/cryptocurrenc/i.test(jsText))
eq('"cryptocurrency" only in the FAQ question', (all.match(/cryptocurrenc/gi) || []).length, 1)
ok('the one use is the question "Is this a cryptocurrency?"', all.includes('Is this a cryptocurrency?'))
eq('"tokenized" once, as the H1', (html.match(/tokeni[sz]ed/gi) || []).length, 1)
ok('H1 is "Tokenized lab data."', /<h1[^>]*>Tokenized lab(?: |&nbsp;)data\.<\/h1>/.test(html))
const FIXED = {
  definition: 'Each result becomes a sealed record: a SHA-256 fingerprint of its recorded fields, linked to the record before it. Batches can be anchored on a public test network, so a later rewrite shows. Only fingerprints go on the network; the values stay with the lab.',
  status: 'Independent project · Open alpha · Public test network · Synthetic demo data · No customers yet',
  regulatory: 'Built toward the audit-trail expectations of 21 CFR Part 11, EU Annex 11 and ISO/IEC 17025:2017. Not validated. No electronic signatures yet. Not a substitute for your computerized-system validation or SOPs.',
  footer: 'Immutable QC is an independent project built on the founder’s own time. It is not affiliated with or endorsed by any employer. Founder: José A. Fernández Abreu · joseqc.com',
  signatures: 'Demo signatures. In the alpha, one server key signs imported rows; per-analyst signatures are on the roadmap.',
  label: 'Simulated · demo data',
  anchor: 'Anchored fingerprint (simulated, no network call)',
  faq: 'How each principle is approached; not a compliance claim.',
}
for (const [k, s] of Object.entries(FIXED)) ok(`fixed copy present: ${k}`, text.includes(s))
ok('footer links joseqc.com', html.includes('<a href="https://joseqc.com">joseqc.com</a>'))
ok('"tamper-evident" is used', /tamper-evident/i.test(text))
// paths: relative only; the one exception is the console link; no third-party requests
for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
  const u = m[1]
  ok(`relative path: ${u.slice(0, 60)}`, !u.startsWith('/') || u === '../../dashboard/')
  ok(`no third-party URL: ${u.slice(0, 60)}`, !/^(https?:)?\/\//.test(u) || u === 'https://joseqc.com')
}
ok('CSS has no url() outside fonts/', [...css.matchAll(/url\(([^)]*)\)/g)].every((m) => /^fonts\//.test(m[1].replace(/['"]/g, ''))))
ok('CSS: no viewport-height units', !/\d(?:s|l|d)?vh\b/.test(css))
ok('CSS: no infinite animations', !/infinite/.test(css))
ok('CSS: every @font-face uses font-display: swap', [...css.matchAll(/@font-face\s*{([^}]*)}/g)].every((m) => /src:\s*local/.test(m[1]) || /font-display:\s*swap/.test(m[1])))
ok('JS: no rAF loops or intervals', !/requestAnimationFrame|setInterval/.test(js))
ok('JS: no network calls', !/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|import\(/.test(js))
ok('fonts and their OFL texts are next to each other', ['archivo-c-115-620.woff2', 'ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-latin-500-normal.woff2', 'ibm-plex-sans-latin-400-normal.woff2', 'OFL-Archivo.txt', 'OFL-IBM-Plex-Mono.txt', 'OFL-IBM-Plex-Sans.txt'].every((f) => existsSync(join(ROOT, 'fonts', f))))

if (fails) { console.error(`\n${fails} of ${checks} checks failed; index.html not written.`); process.exit(1) }
writeFileSync(PAGE, html)

// ---- 7. Report
const kb = (b) => (b / 1024).toFixed(1)
const size = (f) => { const b = readFileSync(join(ROOT, f)); return [b.length, gzipSync(b, { level: 9 }).length] }
console.log(`${checks} checks passed. ${signedNow ? 'Signed with a fresh one-time key (private key discarded).' : 'Existing signatures re-verified.'}`)
console.log(`anchor h_8 ${ANCHOR}\npublic key ${pub.slice(0, 18)}… (fingerprint ${KEYFP})\nSST area RSD ${rsd(sst).toFixed(2)} %`)
for (const f of ['index.html', 'styles.css', 'app.js']) { const [r, g] = size(f); console.log(`${f.padEnd(12)} ${kb(r).padStart(6)} KB raw ${kb(g).padStart(6)} KB gzip`) }
