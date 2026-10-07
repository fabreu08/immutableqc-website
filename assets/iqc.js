/* Immutable QC. Built by site/build.mjs from site/src/sha256.js + site/src/iqc.js; edit those. */
(() => {
'use strict'
// Pure-JS SHA-256 (FIPS 180-4), from joseqc.com. Used only where crypto.subtle is missing (insecure context); inlined here.
const K = new Uint32Array(64), H0 = new Uint32Array(8)
for (let c = 2, n = 0; n < 64; c++) {
  let p = 1
  for (let d = 2; d * d <= c; d++) if (c % d === 0) { p = 0; break }
  if (!p) continue
  if (n < 8) H0[n] = (c ** 0.5 % 1) * 4294967296
  K[n++] = (c ** (1 / 3) % 1) * 4294967296
}
const ror = (x, n) => (x >>> n) | (x << (32 - n))

function sha256(str) {
  const m = new TextEncoder().encode(str), L = m.length, N = (L + 72) >> 6
  const W = new Uint32Array(N * 16), w = new Uint32Array(64), h = H0.slice()
  for (let i = 0; i < L; i++) W[i >> 2] |= m[i] << (24 - (i & 3) * 8)
  W[L >> 2] |= 0x80 << (24 - (L & 3) * 8)
  W[N * 16 - 1] = L * 8
  for (let j = 0; j < W.length; j += 16) {
    for (let i = 0; i < 64; i++) {
      if (i < 16) { w[i] = W[j + i]; continue }
      const a = w[i - 15], b = w[i - 2]
      w[i] = (ror(a, 7) ^ ror(a, 18) ^ (a >>> 3)) + w[i - 7] + (ror(b, 17) ^ ror(b, 19) ^ (b >>> 10)) + w[i - 16]
    }
    let [a, b, c, d, e, f, g, k] = h
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += k
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('')
}

// iqc.js · Immutable QC site script. One small script, no dependencies. This source is an ES module so that
// site/build.mjs can import it: the build prerenders the recipe and the agent JSON with these same functions and
// replays the record history with this code. The page gets a classic deferred script (the build wraps this file and
// the pure-JS SHA-256 in one function scope, minus the export keywords), so it also runs from file:// and in sandboxed
// previews, where module scripts need CORS.
//   1. Overview, Fig. 1: three checks on one record  2. Overview, Fig. 2: the record history, sealed in once
//   3. Check a record: the verifier. The Contents menu lives in the inline script in <head> (site/build.mjs, prepaint), so
//   it works before this deferred script runs, and even if it never loads.
// Every hash is recomputed here from values on the page (WebCrypto; ./sha256.js only where crypto.subtle is missing).
// Every status word comes from the verifier's own results, in words read from <template> HTML on the page.
// Motion: one-shot WAAPI on load, on first view or on input, only under html.motion. No rAF, no repeating timers.

const ZERO = '0'.repeat(64)
const FIELDS = ['instrumentId', 'sensorType', 'value', 'unit', 'capturedAt']
const payload = (f) => FIELDS.map((k) => f[k]).join('|')
const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('')
const bytes = (h) => { const b = new Uint8Array(h.length >> 1); for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(2 * i, 2), 16); return b }
const groups = (h) => h.match(/.{1,8}/g).map((g) => `<span>${g}</span>`).join('<wbr>')
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`
// A sealed field may not hold the separator "|" or a control character: the payload joins the five fields with "|"
// (the alpha app's canonical payload), so such a field would let two different records give the same bytes.
const SEP = /[|\u0000-\u001f\u007f]/
const sepIn = (f) => FIELDS.some((k) => SEP.test(String(f[k])))
// ECDSA signatures are 64 bytes, r then s, with s in the lower half of the P-256 group order (low-S). Any signature also
// has a high-S twin that verifies; accepting only low-S gives each signature one valid form.
const P256_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551')
const sigForm = (h) => typeof h === 'string' && /^[0-9a-f]{128}$/.test(h) && BigInt('0x' + h.slice(64)) * BigInt(2) < P256_N && BigInt('0x' + h.slice(64)) > BigInt(0)
const lowS = (h) => { const s = BigInt('0x' + h.slice(64)); return s * BigInt(2) < P256_N ? h : h.slice(0, 64) + (P256_N - s).toString(16).padStart(64, '0') }
const enc = new TextEncoder()
const ECDSA = { name: 'ECDSA', hash: 'SHA-256' }

// WebCrypto where it exists; otherwise the pure-JS SHA-256 (FIPS 180-4) handed in, and no signature checks.
async function engine(pure) {
  const c = globalThis.crypto, S = c && c.subtle && globalThis.isSecureContext !== false ? c.subtle : null
  if (S) return { S, sha: async (s) => hex(await S.digest('SHA-256', enc.encode(s))) }
  return { S: null, sha: async (s) => pure(s) }
}

// The auditor's rule, one for the whole site. recs: [{ f, r, prev, h, sig }] as stored, record n at index n-1.
//  fingerprint  SHA-256 of the five fields, against the stored fingerprint r.
//  link         SHA-256 of (the previous link this record stores + its recomputed fingerprint + n), against the link
//               it stores, which the next record carries as its previous link. A changed value therefore breaks only
//               the link INTO the next record; the later records still pass their own checks.
//  anchor       the whole history replayed from 64 zeros over the recomputed fingerprints (fh); the caller compares
//               the replayed link of the anchored record with the anchored fingerprint.
//  separator    a field that holds "|" or a control character fails the fingerprint check (sep), whatever the hash.
// sig(rec, recomputedR) resolves true, false, or null (not checked). Where this browser can check signatures (E.S),
// every record on these pages is signed, so a record with no signature, or one not in its single low-S form, fails
// (nosig) without asking sig(). A record passes when its fingerprint and its link match and its signature does not fail.
async function replay(E, recs, sig) {
  const rp = await Promise.all(recs.map((x) => E.sha(payload(x.f))))
  const hl = await Promise.all(recs.map((x, i) => E.sha(x.prev + rp[i] + String(i + 1))))
  const rows = []
  let full = ZERO
  for (let i = 0; i < recs.length; i++) {
    const x = recs[i], nx = recs[i + 1], sep = sepIn(x.f)
    full = await E.sha(full + rp[i] + String(i + 1))
    const link = hl[i] === x.h && (!nx || nx.prev === x.h) && (i > 0 || x.prev === ZERO)
    rows.push({ x, n: i + 1, rp: rp[i], pp: x.prev, hp: hl[i], fh: full, fp: rp[i] === x.r && !sep, sep, link })
  }
  const s = await Promise.all(rows.map((o) => (E.S && !sigForm(o.x.sig) ? false : sig(o.x, o.rp))))
  rows.forEach((o, i) => { o.nosig = !!E.S && !o.x.sig; o.sig = s[i]; o.ok = o.fp && o.link && o.sig !== false })
  return rows
}

// The shell recipe for one record, exactly as printed: [kind, text] with kind c (comment), p (command), o (output).
// Only values that are 64 lowercase hex characters go into the link command, quoted: a stored previous link is read from
// a store that may have been edited, and it must never run as shell code.
const HEX64 = /^[0-9a-f]{64}$/
function recipe({ n, f, pp, rp, hp, r, h, last }) {
  const linkOk = HEX64.test(pp) && HEX64.test(rp)
  return [
    ['c', `# record ${n}: fingerprint of the five sealed fields, in a UTF-8 terminal (macOS: shasum -a 256)`],
    ['p', `printf '%s' ${shq(payload(f))} | sha256sum`],
    ['o', `${rp}  -`],
    ['c', sepIn(f) ? '# a field holds the separator | or a control character: the payload no longer reads as five fields' : rp === r ? '# same as the stored fingerprint' : `# differs from the stored fingerprint ${r.slice(0, 8)}…`],
    ['c', n === 1 ? '# link: 64 zeros (the start), then the fingerprint, then 1' : `# link: the previous link stored with record ${n}, then the fingerprint, then ${n}`],
    linkOk ? ['p', `printf '%s' ${shq(pp + rp + n)} | sha256sum`] : ['c', '# the stored previous link is not 64 lowercase hex characters, so no command is printed for it'],
    [linkOk ? 'o' : 'c', linkOk ? `${hp}  -` : `# recomputed in your browser: ${hp}`],
    ['c', hp === h ? (last ? '# same as the stored link (the newest record)' : `# same as the stored link, which record ${n + 1} carries`) : `# differs from the stored link ${String(h).slice(0, 8)}…${last ? '' : `: link ${n}→${n + 1} broken`}`],
  ]
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
// A payload may break after each bar, never inside a value; "| sha256sum" stays whole. Copying reads textContent, so
// the <wbr> and spans add nothing to what is copied.
const payloadHTML = (p) => esc(p).replace(/\|/g, '|<wbr>')
function cmdHTML(t) {
  const m = /^(printf '%s' )('(?:[^']|'\\'')*')( \| sha256sum)$/.exec(t)
  if (!m) return esc(t)
  return `${esc(m[1])}${/^'[0-9a-f]+'$/.test(m[2]) ? esc(m[2]) : payloadHTML(m[2])} <span class="nw">| sha256sum</span>`
}
const recipeHTML = (lines) => lines.map(([k, t]) => `<span class="${k}">${k === 'p' ? cmdHTML(t) : esc(t)}</span>`).join('\n')

// What an AI agent would receive for one stored record (upcoming): the record as stored, never the verifier's verdict.
function agentJSON({ x, of, seq, keyId, publicKey, anchor, anchorN }) {
  const o = { record: x.n, sequence: seq, fields: Object.fromEntries(FIELDS.map((k) => [k, x.f[k]])) }
  if (x.corrects) Object.assign(o, { corrects: x.corrects, reason: x.reason })
  Object.assign(o, {
    fingerprint: x.r, previous: x.prev, link: x.h, position: { n: x.n, of },
    signature: { alg: 'ECDSA P-256 with SHA-256 over the fingerprint bytes', encoding: 'IEEE P1363, hex', value: x.sig || null },
    publicKeyId: keyId || null, publicKey: publicKey || null,
    anchor: x.n <= anchorN ? { status: 'simulated, no network call', covers: `records 1 to ${anchorN}`, fingerprint: anchor } : { status: 'not yet anchored' },
  })
  return JSON.stringify(o, null, 2)
}

// ------------------------------------------------------------------------------------------------- words from results
// Each takes the replayed rows and a say(key, params) built from the page's <template>; none looks at which button
// was pressed, except sentence(), which names the action first. Exported so build.mjs tests them on Node.
const join = (w, say) => (w.length < 2 ? w.join('') : `${w.slice(0, -1).join(', ')} ${say('w.and')} ${w[w.length - 1]}`)
const list = (ks, say) => join(ks.map((k) => say(k)), say)
// the broken links, named by the records they join ("6→7"); the newest record's own link has no next record
const brokenLinks = (rows) => rows.filter((r) => !r.link && r.n < rows.length).map((r) => `${r.n}→${r.n + 1}`)
function statusLine(rows, { anchorOk, AN, signing }, say) {
  const ok = rows.filter((r) => r.ok).length
  const chg = rows.filter((r) => !r.fp).length, sg = rows.filter((r) => r.fp && r.sig === false).length, lk = brokenLinks(rows)
  const parts = [say(signing ? 'st.head' : 'st.head.nosig', { ok, n: rows.length })]
  if (chg) parts.push(say('st.chg', { c: chg }))
  if (sg) parts.push(say(sg === 1 ? 'st.sig1' : 'st.sig', { s: sg }))
  if (lk.length) parts.push(say(lk.length === 1 ? 'st.link1' : 'st.link', { l: lk.join(', ') }))
  parts.push(anchorOk ? say(rows.length > AN ? 'st.anc.part' : 'st.anc', { m: AN }) : say('st.anc.no'))
  if (rows.length > AN) parts.push(rows.length === AN + 1 ? say('st.unanch1', { a: AN + 1 }) : say('st.unanch', { a: AN + 1, b: rows.length }))
  if (!signing) parts.push(say('st.nosig'))
  return parts.join(' · ')
}
function rowStatus(o, { AN, by, len }, say) {
  const w = !o.fp ? say(o.sep ? 'row.sep' : 'row.chg') : o.sig === false ? say(o.nosig ? 'row.sigm' : 'row.sig') : !o.link ? '' : o.sig === null ? say(o.x.sig ? 'row.na' : 'row.none') : say('row.ok')
  const notes = []
  if (!o.link) notes.push(o.n < len ? say('row.lnk', { l: `${o.n}→${o.n + 1}` }) : say('row.lnk.head'))
  if (o.ok && o.x.orig && (o.x.h !== o.x.orig.h || o.x.r !== o.x.orig.r)) notes.push(say('row.relinked'))
  if (o.x.corrects) notes.push(say('row.corr', { k: o.x.corrects }))
  if (by) notes.push(say('row.corrby', { c: by }))
  if (o.n > AN) notes.push(say('row.unanch'))
  return [w, ...notes].filter(Boolean).join(' · ')
}
function sentence(rows, { anchorOk, AN, signing }, a, say) {
  const out = []
  if (a) out.push(say(`s.${a.type}`, a))
  let sg = false
  for (const r of rows) {
    const what = [!r.fp && say(r.sep ? 'w.fpsep' : 'w.fpno'), r.sig === false && say(r.nosig ? 'w.sigm' : 'w.sigf'), !r.link && (r.n < rows.length ? say('w.linkb', { a: r.n, b: r.n + 1 }) : say('w.linkh'))].filter(Boolean)
    if (!what.length) continue
    out.push(say(r.fp ? 's.rec' : 's.chg', { k: r.n, what: join(what, say) }))
    if (r.fp && r.sig === false) sg = true
  }
  if (a && a.type === 'rewrite' && sg) out.push(say('s.rewrite.why'))
  const ok = rows.filter((r) => r.ok).length
  out.push(ok === rows.length ? say(signing ? 's.all' : 's.all.nosig', { n: rows.length }) : say('s.count', { ok, n: rows.length }))
  out.push(say(anchorOk ? 's.anc' : 's.anc.no', { m: AN }))
  if (rows.length > AN) out.push(rows.length === AN + 1 ? say('s.unanch1', { a: AN + 1 }) : say('s.unanch', { a: AN + 1, b: rows.length }))
  return out.join(' ')
}
// What the agent panel says about one record as it stands now. A pass says the record is unchanged since sealing by
// these checks, never that the result was right; where a signature was not checked (or there is none), not all four
// checks ran, and the record is never called unchanged.
function agentLine(o, { AN, anchorOk, by }, say) {
  const anchored = o.n <= AN
  const failed = [!o.fp && 'w.fp', o.sig === false && 'w.sig', !o.link && 'w.link', anchored && !anchorOk && 'w.anc'].filter(Boolean)
  if (failed.length) return say('a.bad', { what: list(failed, say) }) + (by ? ` ${say('a.corrby', { c: by })}` : '')
  let s = say('a.pass', { what: list(['w.fp', o.sig === true && 'w.sig', 'w.link', anchored && 'w.anc'].filter(Boolean), say) })
  if (o.sig === null) s += say(o.x.sig ? 'a.na' : 'a.none')
  if (!anchored) s += say('a.unanch')
  if (o.sig === null) return s + say('a.notall') + (by ? ` ${say('a.corrby', { c: by })}` : '')
  return s + say(by ? 'a.super' : 'a.ok', { c: by })
}

// ---------------------------------------------------------------------------------------------------------------- DOM
const D = globalThis.document
// in the shipped bundle, sha256() is the pure-JS fallback defined just above this code
const PURE = typeof sha256 === 'function' ? sha256 : null
if (D) boot()

function boot() {
  const root = D.documentElement
  const mq = matchMedia('(prefers-reduced-motion: reduce)')
  const setMotion = () => root.classList.toggle('motion', !mq.matches)
  if (mq.addEventListener) mq.addEventListener('change', setMotion)
  const p = D.querySelector('[data-plate]')
  if (p) plate(p)
  const h = D.querySelector('[data-history]')
  if (h) history(h).catch(() => {})
  const v = D.querySelector('[data-verifier]')
  if (v) verifier(v)
}

const moving = () => D.documentElement.classList.contains('motion') && !D.hidden
const KF = {
  tick: [{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
  fade: [{ opacity: 0.25 }, { opacity: 1 }],
}
function pulse(el, k, dur = 200) {
  if (!el || !el.animate || !moving()) return null
  return el.animate(KF[k], { duration: dur, easing: 'cubic-bezier(.2,.7,.2,1)' })
}
function words(id) {
  const W = {}, t = D.getElementById(id)
  if (t) for (const i of t.content.querySelectorAll('[data-k]')) W[i.dataset.k] = i.textContent
  return (k, o = {}) => (W[k] ?? k).replace(/\{(\w+)\}/g, (_, s) => o[s] ?? '')
}
const ICON = (k) => `<svg class="i" aria-hidden="true"><use href="#i-${k}"/></svg>`
const setHex = (el, h) => { if (el && el.dataset.v !== h && /^[0-9a-f]+$/.test(h)) { el.dataset.v = h; el.innerHTML = groups(h); return true } return false }
const setText = (el, t) => { if (el && el.textContent !== t) { el.textContent = t; return true } return false }

// ------------------------------------------------- 1. Overview, Fig. 1: three checks, each shown as it actually completes
function plate(fig) {
  const say = words('iqc-plate-words')
  const q = (s) => fig.querySelector(s)
  const flat = (s) => q(s).textContent.replace(/\s+/g, '')
  async function run() {
    const E = await engine(PURE)
    const f = Object.fromEntries(FIELDS.map((k) => [k, q(`[data-f="${k}"]`).textContent.trim()]))
    const n = +fig.dataset.n, r = flat('[data-h="r"]'), prev = flat('[data-h="prev"]'), h = flat('[data-h="h"]')
    let ms = 0, pass = 0
    const timed = async (fn) => { const t = performance.now(); const v = await fn(); ms += performance.now() - t; return v }
    const show = async (k, ok) => {
      const li = q(`[data-check="${k}"]`)
      li.dataset.s = ok === null ? 'na' : ok ? 'ok' : 'bad'
      li.querySelector('.i').outerHTML = ICON(ok === null ? 'dash' : ok ? 'ok' : 'x')
      setText(li.querySelector('.w'), say(`${k}.${ok === null ? 'na' : ok ? 'ok' : 'bad'}`))
      if (ok) pass++
      const a = pulse(li.querySelector('.i'), 'tick', 220)
      pulse(li.querySelector('.w'), 'fade', 220)
      if (a) await a.finished.catch(() => {})
    }
    const rp = await timed(() => E.sha(payload(f)))
    await show('fp', rp === r)
    const so = E.S ? (sigForm(fig.dataset.sig) ? await timed(async () => {
      const key = await E.S.importKey('raw', bytes(fig.dataset.pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
      return E.S.verify(ECDSA, key, bytes(fig.dataset.sig), bytes(rp))
    }) : false) : null
    await show('sig', so)
    const hp = await timed(() => E.sha(prev + rp + String(n)))
    await show('link', hp === h)
    const st = q('[data-pst]')
    st.textContent = say(E.S ? 'st' : 'st.nosig', { pass, n: 3, ms: ms.toFixed(1) })
    fig.dataset.checked = String(pass)
  }
  // start when the plate is on screen, so each check ticks in where it can be seen
  if ('IntersectionObserver' in globalThis) {
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); run() } }, { threshold: 0.2 })
    io.observe(fig)
  } else run()
}

// ------------------------------------- 2. Overview, Fig. 2: the record history, checked here and sealed in once, in view
// Read-only. The rows are prerendered "checked at build" with neutral open rings. This browser replays the history from
// the values shown in the table (instrument from the header, peak area and capture time from each row) with the rule
// above. The first time a quarter of the rows are on screen, each row's ring draws and its dot fills in turn (WAAPI,
// about 1.3 s), then everything holds. Skipped under reduced motion or a hidden tab; cut short if the tab hides, the
// rows leave the view or reduced motion switches on; settled at once if the rows were scrolled past unseen.
async function history(fig) {
  const say = words('iqc-hist-words')
  const data = JSON.parse(D.getElementById('iqc-seq').textContent)
  const q = (s, r = fig) => r.querySelector(s)
  const tbody = q('tbody'), trs = [...tbody.rows]
  const E = await engine(PURE)
  const key = E.S ? await E.S.importKey('raw', bytes(data.pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']).catch(() => null) : null
  const inst = q('[data-inst]').textContent.trim()
  const recs = data.records.map((d, i) => ({ ...d, f: { ...d.f, instrumentId: inst, value: q('[data-v]', trs[i]).textContent.trim(), capturedAt: q('time', trs[i]).getAttribute('datetime') } }))
  const sig = (x, rp) => (key && x.sig ? E.S.verify(ECDSA, key, bytes(x.sig), bytes(rp)).catch(() => false) : Promise.resolve(null))
  const rows = await replay(E, recs, sig)
  const AN = data.anchorN, anchorOk = rows[AN - 1].fh === data.anchor, signing = !!key
  const mark = (el, s, w) => { el.dataset.s = s; q('use', el).setAttribute('href', s === 'ok' ? '#i-ok' : s === 'bad' ? '#i-x' : '#i-open'); setText(q('.w', el), w) }
  function paintRow(o, i) {
    const tr = trs[i]
    tr.classList.toggle('ok', o.ok && o.sig !== null)
    tr.classList.toggle('alt', !o.fp)
    tr.classList.toggle('lb', !o.link)
    setText(q('[data-fpw]', tr), say(o.fp ? 'fp.ok' : 'fp.bad'))
    mark(q('[data-m="link"]', tr), o.link ? 'ok' : 'bad', say(o.link ? 'link.ok' : 'link.bad'))
    mark(q('[data-m="sig"]', tr), o.sig === null ? 'na' : o.sig ? 'ok' : 'bad', say(o.sig === null ? (o.x.sig ? 'sig.na' : 'sig.none') : o.sig ? 'sig.ok' : 'sig.bad'))
  }
  function summary() {
    const st = q('[data-hist-st]')
    setText(st, statusLine(rows, { anchorOk, AN, signing }, say))
    st.dataset.s = rows.every((o) => o.ok) && anchorOk ? 'ok' : 'bad'
    setHex(q('[data-head]'), rows[rows.length - 1].fh.slice(0, 8))
    const hs = q('[data-head-st]')
    hs.dataset.s = anchorOk ? 'ok' : 'bad'
    hs.innerHTML = `${ICON(anchorOk ? 'ok' : 'x')}<span>${say(anchorOk ? 'head.ok' : 'head.bad')}</span>`
  }
  const anims = []
  let io = null, phase = 'wait'
  function settle() {
    if (phase === 'done') return
    phase = 'done'
    if (io) { io.disconnect(); io = null }
    anims.splice(0).forEach((a) => a.cancel())
    rows.forEach(paintRow)
    summary()
    fig.dataset.checked = '1'
  }
  function play() {
    if (!moving()) return settle()
    phase = 'play'
    const cs = getComputedStyle(fig), from = cs.getPropertyValue('--p-fg2').trim(), to = cs.getPropertyValue('--ok').trim()
    const done = rows.map((o, i) => {
      const dr = q('.dr', trs[i]), dt = q('.dt', trs[i])
      const t = { duration: 300, delay: 140 * i, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both' }
      const a = dr.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], t)
      const b = dt.animate([{ fill: from, transform: 'scale(.55)' }, { fill: to, transform: 'scale(1)' }], t)
      anims.push(a, b)
      return a.finished.then(() => { if (phase === 'play') { paintRow(o, i); a.cancel(); b.cancel() } })
    })
    Promise.all(done).then(() => { if (phase === 'play') settle() }, () => {})
  }
  // the seal-in plays only for a history that checks out, with motion allowed and the tab visible
  const can = moving() && 'IntersectionObserver' in globalThis && !!tbody.animate && signing && anchorOk && rows.every((o) => o.ok)
  if (!can) return settle()
  io = new IntersectionObserver((es) => {
    const e = es[es.length - 1]
    if (phase === 'wait' && e.isIntersecting && e.intersectionRatio >= 0.25) play()
    else if (phase === 'wait' && !e.isIntersecting && e.boundingClientRect.bottom < 0) settle()
    else if (phase === 'play' && !e.isIntersecting) settle()
  }, { threshold: [0, 0.25] })
  io.observe(tbody)
  D.addEventListener('visibilitychange', () => { if (D.hidden) settle() })
  const mq = matchMedia('(prefers-reduced-motion: reduce)')
  if (mq.addEventListener) mq.addEventListener('change', () => { if (mq.matches) settle() })
}

// ------------------------------------------------------------------------------------- 3. Check a record: the verifier
async function verifier(root) {
  const say = words('iqc-words')
  const data = JSON.parse(D.getElementById('iqc-seq').textContent)
  const q = (s, r = root) => r.querySelector(s), qa = (s, r = root) => [...r.querySelectorAll(s)]
  const AN = data.anchorN
  const E = await engine(PURE)
  const demoKey = E.S ? await E.S.importKey('raw', bytes(data.pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']) : null
  const sealedAt = data.records.map((x) => ({ ...x, f: { ...x.f }, key: 'demo' }))
  let recs, sel = data.select, rewritten = false, ot = null, seq = 0, last = null, liveT = 0
  const fresh = () => sealedAt.map((x) => { const y = { ...x, f: { ...x.f } }; y.orig = { ...x, f: { ...x.f } }; return y })
  recs = fresh()

  const form = q('[data-fields]'), inputs = Object.fromEntries(FIELDS.map((k) => [k, q(`input[name="${k}"]`, form)]))
  const reason = q('#reason'), reasonErr = q('#reason-err'), fieldsErr = q('#fields-err')
  const btn = Object.fromEntries(qa('[data-act]').map((b) => [b.dataset.act, b]))
  const tbody = q('[data-rows]'), chips = q('[data-chips]')
  const agent = D.querySelector('[data-agent]'), agentNow = D.querySelector('[data-agent-now]')
  const live = q('[data-live]')
  const nowEl = q('[data-now-list]')
  // without WebCrypto nothing can be signed here: say so before anyone presses the button
  if (!E.S) setText(q('[data-help-correct]'), say('help.correct.none'))

  // signature checks are cached per (key, signature, fingerprint)
  const sc = new Map()
  const sigOk = (x, rp) => {
    if (!E.S || !x.sig) return null
    const k = `${x.key}|${x.sig}|${rp}`
    if (!sc.has(k)) sc.set(k, E.S.verify(ECDSA, x.key === 'demo' ? demoKey : ot.pub, bytes(x.sig), bytes(rp)).catch(() => false))
    return sc.get(k)
  }
  const edited = (x) => FIELDS.some((k) => x.f[k] !== x.orig.f[k])
  const keyName = (x) => (x.key === 'demo' ? say('k.demo', { id: data.keyId.slice(0, 8) }) : say('k.ot', { id: ot ? ot.id.slice(0, 8) : '' }))

  // ---- paint: classes, icons and words from the verifier's output only
  function paintRow(o, tr, len) {
    const s = o.ok ? 'ok' : 'bad'
    const prevS = tr.dataset.s
    tr.dataset.s = s
    tr.classList.toggle('sel', o.n === sel)
    const m = { fp: o.fp, sig: o.sig, link: o.link }
    for (const [k, v] of Object.entries(m)) {
      const td = q(`[data-m="${k}"]`, tr), st = v === null ? 'na' : v ? 'ok' : 'bad'
      const sr = k === 'sig' && !o.x.sig ? (v === null ? 'none' : 'missing') : st
      if (td.dataset.s !== st || td.dataset.w !== sr) {
        td.dataset.s = st; td.dataset.w = sr
        td.innerHTML = `${ICON(v === null ? 'dash' : v ? 'ok' : 'x')}<span class="sr-only">${say(`m.${k}.${sr}`)}</span>`
      }
    }
    setText(q('[data-v]', tr), o.x.f.value)
    q('[data-v]', tr).classList.toggle('ed', o.x.f.value !== o.x.orig.f.value)
    setText(q('[data-r]', tr), `${o.x.r.slice(0, 8)}…`)
    setText(q('[data-h]', tr), `${o.x.h.slice(0, 8)}…`)
    q('[data-r]', tr).classList.toggle('ed', o.x.r !== o.x.orig.r)
    q('[data-h]', tr).classList.toggle('ed', o.x.h !== o.x.orig.h)
    const by = recs.find((y) => y.corrects === o.n)
    if (setText(q('[data-st]', tr), rowStatus(o, { AN, by: by && by.n, len }, say)) && prevS) pulse(q('[data-st]', tr), 'fade', 260)
  }
  function paint(v) {
    const { rows } = v, o = rows[sel - 1], x = o.x, L = rows.length
    const bad = rows.filter((r) => !r.ok).length
    // status line: counts from the replayed rows
    setText(q('[data-status]'), statusLine(rows, { anchorOk: v.anchor, AN, signing: !!E.S }, say))
    q('[data-status]').dataset.s = bad || !v.anchor ? 'bad' : 'ok'
    // chips
    rows.forEach((r) => {
      const c = q(`[data-chip="${r.n}"]`, chips)
      if (!c) return
      c.dataset.s = r.ok ? 'ok' : 'bad'
      setText(q('[data-cs]', c), say(r.ok ? 'chip.ok' : 'chip.bad'))
    })
    // fields: what changed since sealing
    for (const k of FIELDS) {
      const ed = x.f[k] !== x.orig.f[k], wrap = inputs[k].closest('.field'), was = q('.was', wrap)
      wrap.classList.toggle('ed', ed)
      was.hidden = !ed
      if (ed) setText(q('code', was), x.orig.f[k])
      if (ed) inputs[k].setAttribute('aria-describedby', was.id); else inputs[k].removeAttribute('aria-describedby')
    }
    const pl = payload(x.f), pe = q('[data-payload]')
    if (pe.textContent !== pl) pe.innerHTML = payloadHTML(pl)
    setText(q('[data-bytes]'), String(enc.encode(pl).length))
    // checks for the selected record
    const ck = (k, s, word, detail) => {
      const row = q(`[data-ck="${k}"]`), was = row.dataset.s
      row.dataset.s = s
      q('.res', row).innerHTML = `${ICON(s === 'ok' ? 'ok' : s === 'bad' ? 'x' : 'dash')}<span>${word}</span>`
      setText(q('.d', row), detail)
      if (was && was !== s) pulse(q('.res', row), 'fade', 240)
    }
    for (const el of qa('[data-seln]')) setText(el, String(o.n))
    for (const el of qa('[data-selp]')) setText(el, String(o.n - 1))
    if (setHex(q('[data-hx="rp"]'), o.rp)) pulse(q('[data-hx="rp"]'), 'fade', 160)
    setHex(q('[data-hx="r"]'), x.r)
    ck('fp', o.fp ? 'ok' : 'bad', say(o.fp ? 'r.match' : o.sep ? 'r.sep' : 'r.nomatch'), say(o.fp ? 'd.fp.ok' : o.sep ? 'd.fp.sep' : 'd.fp.bad'))
    const sk = o.sig === null ? 'na' : o.sig ? 'ok' : 'bad', sw = x.sig ? sk : E.S ? 'missing' : 'none'
    ck('sig', sk, say(`r.sig.${sw}`), x.sig ? say(`d.sig.${sk}`, { key: keyName(x) }) : say(`d.sig.${sw}`))
    if (setHex(q('[data-hx="hp"]'), o.hp)) pulse(q('[data-hx="hp"]'), 'fade', 160)
    setHex(q('[data-hx="h"]'), x.h)
    const lastRec = o.n === L, pv = rows[o.n - 2]
    let ld = o.link ? say(lastRec ? 'd.link.head' : 'd.link.ok', { next: o.n + 1 }) : say(lastRec ? 'd.link.bad.head' : 'd.link.bad', { n: o.n, next: o.n + 1 })
    if (pv && !pv.link) ld += ` ${say('d.link.in', { p: pv.n })}`
    ck('link', o.link ? 'ok' : 'bad', say(o.link ? 'r.intact' : 'r.broken'), ld)
    const a = rows[AN - 1]
    if (nowEl) {
      const items = [['fp', o.fp ? 'ok' : 'bad', say(o.fp ? 'r.match' : o.sep ? 'r.sep' : 'r.nomatch')], ['sig', sk, say(`r.sig.${sw}`)], ['link', o.link ? 'ok' : 'bad', say(o.link ? 'r.intact' : 'r.broken')],
        ['anc', o.n > AN ? 'na' : v.anchor ? 'ok' : 'bad', say(o.n > AN ? 'r.anc.later' : v.anchor ? 'r.anc' : 'r.anc.no')]]
      for (const [k, s, w] of items) {
        const el = q(`[data-nw="${k}"]`, nowEl), was = el.dataset.s
        if (was === s && q('b', el).textContent === w) continue
        el.dataset.s = s
        el.innerHTML = `${ICON(s === 'ok' ? 'ok' : s === 'bad' ? 'x' : 'dash')}<span>${say(`n.${k}`)}</span> <b>${w}</b>`
        if (was && was !== s) pulse(el, 'fade', 240)
      }
    }
    ck('anc', v.anchor ? 'ok' : 'bad', say(v.anchor ? 'r.anc' : 'r.anc.no'),
      say(v.anchor ? 'd.anc.ok' : 'd.anc.bad', { m: AN }) + (o.n > AN ? ` ${say('d.anc.after', { n: o.n })}` : ''))
    setHex(q('[data-hx="anc"]'), data.anchor)
    if (setHex(q('[data-hx="ap"]'), a.fh)) pulse(q('[data-hx="ap"]'), 'fade', 160)
    // the record's context (not sealed in the alpha)
    setText(q('[data-ctx]'), x.corrects ? say('ctx.corr', { k: x.corrects, reason: x.reason, at: x.at }) : say('ctx', x.ctx))
    // recipe
    const rc = recipe({ n: o.n, f: x.f, pp: o.pp, rp: o.rp, hp: o.hp, r: x.r, h: x.h, last: lastRec })
    const code = q('[data-recipe]'), html = recipeHTML(rc)
    if (code.dataset.v !== html) { if (code.dataset.v) setText(q('[data-copied]'), ''); code.dataset.v = html; code.innerHTML = html }
    // history table
    rows.forEach((r) => paintRow(r, q(`tr[data-n="${r.n}"]`, tbody), L))
    // the anchor line under the table
    const al = q('[data-anchor-line]')
    al.dataset.s = v.anchor ? 'ok' : 'bad'
    const ar = q('.res', al), aw = say(v.anchor ? 'r.anc' : 'r.anc.no')
    if (ar.dataset.w !== aw) { ar.dataset.w = aw; ar.innerHTML = `${ICON(v.anchor ? 'ok' : 'x')}<span data-anchor-st>${aw}</span>` }
    setText(q('[data-head]', al), L > AN ? say(L === AN + 1 ? 'head.after1' : 'head.after', { a: AN + 1, b: L }) : '')
    // actions
    const anyEdit = recs.some(edited)
    btn.rewrite.disabled = !rows.some((r) => !r.fp || !r.link)
    btn.correct.disabled = rewritten || !edited(x)
    btn.reset.disabled = !anyEdit && !rewritten && recs.length === sealedAt.length
    setText(q('[data-hint]'), rewritten ? say('hint.rewritten') : edited(x) ? say('hint.edit', { n: o.n }) : anyEdit ? say('hint.other') : say('hint'))
    // what an AI agent would receive (upcoming)
    if (agent) {
      const demo = x.key === 'demo', signed = !!x.sig
      setText(agent, agentJSON({ x, of: L, seq: data.seq, keyId: demo ? data.keyId : signed && ot ? ot.id : null, publicKey: demo ? data.pub : signed && ot ? ot.hex : null, anchor: data.anchor, anchorN: AN }))
      const by = recs.find((y) => y.corrects === o.n)
      setText(agentNow, agentLine(o, { AN, anchorOk: v.anchor, by: by && by.n }, say))
    }
    last = v
  }

  // ---- the live sentence for screen readers: sentence() above, from the verifier output (final values only)
  function announce(text, now) {
    clearTimeout(liveT)
    const go = () => { live.textContent = ''; live.textContent = text }
    if (now) go(); else liveT = setTimeout(go, 700)
  }

  async function update(a, now, quiet) {
    const my = ++seq
    const rows = await replay(E, recs, sigOk)
    if (my !== seq) return
    const v = { rows, anchor: rows[AN - 1].fh === data.anchor }
    paint(v)
    const text = sentence(rows, { anchorOk: v.anchor, AN, signing: !!E.S }, a, say)
    setText(q('[data-out]'), a ? text : '')
    if (!quiet) announce(text, now)
  }

  // ---- selection
  function fill() {
    const x = recs[sel - 1]
    for (const k of FIELDS) if (inputs[k].value !== x.f[k]) inputs[k].value = x.f[k]
  }
  function select(n, focus) {
    sel = n
    const r = q(`input[name="rec"][value="${n}"]`, chips)
    if (r) { r.checked = true; if (focus) r.focus() }
    fill()
  }

  // ---- actions
  // Rewrite: from the first record that fails, store the recomputed fingerprint and relink every later record, so the
  // links are consistent again. The changed record's signature still covers only its old fingerprint.
  async function rewrite() {
    const rows = await replay(E, recs, sigOk)
    const i0 = rows.findIndex((o) => !o.fp || !o.link)
    if (i0 < 0) return
    let prev = recs[i0].prev
    for (let i = i0; i < recs.length; i++) { const x = recs[i]; x.r = rows[i].rp; x.prev = prev; x.h = await E.sha(prev + x.r + String(i + 1)); prev = x.h }
    rewritten = true
    await update({ type: 'rewrite', k: i0 + 1 }, true)
    keep(btn.rewrite)
  }
  // an action button that disables itself would drop keyboard focus on the page body: hand it to Reset
  const keep = (b) => { if (b.disabled && (D.activeElement === b || D.activeElement === D.body)) btn.reset.focus() }
  async function makeKey() {
    const kp = await E.S.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
    const id = hex(await E.S.digest('SHA-256', await E.S.exportKey('spki', kp.publicKey))).slice(0, 32).toUpperCase()
    return { priv: kp.privateKey, pub: kp.publicKey, id, hex: hex(await E.S.exportKey('raw', kp.publicKey)) }
  }
  // a reason of a few words, at least three: "x" is not a reason a reviewer could follow
  const reasonOk = (t) => t.split(/\s+/).filter((w) => /\w/.test(w)).length >= 3
  async function correct() {
    const x = recs[sel - 1]
    if (rewritten || !edited(x)) return
    // a sealed field never holds the separator or a control character (it would make the payload ambiguous)
    const sepBad = sepIn(x.f)
    fieldsErr.hidden = !sepBad
    if (sepBad) { announce(say('s.sep'), true); return }
    const why = reason.value.trim(), good = reasonOk(why)
    reason.setAttribute('aria-invalid', String(!good))
    reasonErr.hidden = good
    if (!good) { reason.focus(); announce(say('s.need'), true); return }
    const f = { ...x.f }
    Object.assign(x.f, x.orig.f) // the original stays as sealed
    const tail = recs[recs.length - 1], n = recs.length + 1
    const r = await E.sha(payload(f)), h = await E.sha(tail.h + r + String(n))
    let sig = ''
    if (E.S) { ot = ot || await makeKey(); sig = lowS(hex(await E.S.sign(ECDSA, ot.priv, bytes(r)))) }
    const at = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
    const rec = { n, f, r, prev: tail.h, h, sig, key: 'ot', corrects: x.n, reason: why, at, ctx: x.ctx }
    rec.orig = { ...rec, f: { ...f } }
    recs.push(rec)
    addRow(rec); addChip(rec)
    reason.value = ''
    select(n)
    await update({ type: sig ? 'correct' : 'correct.none', k: x.n, n }, true)
    keep(btn.correct)
  }
  async function reset() {
    recs = fresh(); rewritten = false; ot = null
    for (const k of [...sc.keys()]) if (!k.startsWith('demo|')) sc.delete(k)
    qa('tr[data-extra]', tbody).forEach((t) => t.remove())
    qa('[data-extra]', chips).forEach((c) => c.remove())
    reason.value = ''; reason.removeAttribute('aria-invalid'); reasonErr.hidden = true; fieldsErr.hidden = true
    select(Math.min(sel, sealedAt.length))
    await update({ type: 'reset' }, true)
  }
  function addRow(x) {
    const tr = tbody.rows[0].cloneNode(true)
    tr.dataset.n = x.n; tr.dataset.extra = ''; delete tr.dataset.s
    tr.querySelector('th').textContent = String(x.n)
    setText(q('.c-inj', tr), say('row.inj.corr', { k: x.corrects }))
    setText(q('.c-smp', tr), x.ctx.sample)
    for (const td of qa('[data-m]', tr)) delete td.dataset.s
    tbody.append(tr)
    pulse(tr, 'fade', 300)
  }
  function addChip(x) {
    const c = chips.firstElementChild.cloneNode(true)
    c.dataset.chip = x.n; c.dataset.extra = ''; delete c.dataset.s
    const i = q('input', c)
    i.value = String(x.n); i.id = `rec-${x.n}`; i.checked = false
    setText(q('.n', c), String(x.n))
    // its accessible name is its own: the correction it is, never the record the chip was cloned from
    setText(q('.sr-only:not([data-cs])', c), say('chip.corr', { n: x.n, k: x.corrects }))
    setText(q('[data-cs]', c), '')
    chips.append(c)
  }

  // ---- wire up (inputs were read-only for the prerendered, no-JS page)
  for (const i of Object.values(inputs)) i.readOnly = false
  reason.readOnly = false
  form.addEventListener('input', (e) => {
    const k = e.target.name
    if (!FIELDS.includes(k)) return
    recs[sel - 1].f[k] = e.target.value
    if (!sepIn(recs[sel - 1].f)) fieldsErr.hidden = true
    update()
  })
  form.addEventListener('submit', (e) => e.preventDefault())
  chips.addEventListener('change', (e) => { if (e.target.name === 'rec') { sel = +e.target.value; fill(); update() } })
  reason.addEventListener('input', () => { if (reasonOk(reason.value.trim())) { reason.removeAttribute('aria-invalid'); reasonErr.hidden = true } })
  reason.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); correct() } })
  btn.rewrite.addEventListener('click', rewrite)
  btn.correct.addEventListener('click', correct)
  btn.reset.addEventListener('click', reset)
  if (btn.copy) {
    btn.copy.hidden = false
    btn.copy.addEventListener('click', async () => {
      const text = qa('[data-recipe] .p').map((s) => s.textContent).join('\n')
      let okc = false
      try { await navigator.clipboard.writeText(text); okc = true } catch { /* no clipboard: select instead */ }
      if (!okc) { const rg = D.createRange(); rg.selectNodeContents(q('[data-recipe]')); const s = getSelection(); s.removeAllRanges(); s.addRange(rg) }
      setText(q('[data-copied]'), say(okc ? 'cp.done' : 'cp.sel'))
    })
  }
  const m = /^#record-(\d+)$/.exec(location.hash)
  if (m && +m[1] >= 1 && +m[1] <= recs.length) select(+m[1]); else select(sel)
  root.dataset.ready = '1'
  await update(null, true, true)
  globalThis.__iqc = { get last() { return last }, get recs() { return recs } }
}

})()
