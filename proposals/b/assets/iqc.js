/* Immutable QC, prototype B. Built by build/build.mjs from build/src/sha256.js + build/src/iqc.js; edit those. */
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

// iqc.js · Immutable QC, prototype B. One small script, no dependencies. This source is an ES module so that
// build/build.mjs can import it: the build prerenders the recipe and the agent JSON with these same functions and
// replays the chain with this code. The page gets a classic deferred script (the build wraps this file and the
// pure-JS SHA-256 in one function scope, minus the export keywords), so it also runs from file:// and in sandboxed
// previews, where module scripts need CORS.
//   1. Contents menu (narrow screens)  2. Overview plate: three checks  3. Check a record: the verifier
// Every hash is recomputed here from values on the page (WebCrypto; ./sha256.js only where crypto.subtle is missing).
// Every status word comes from this verifier's own results, in words read from <template> HTML on the page.
// Motion: one-shot WAAPI on load or input, only under html.motion. No rAF, no timers that repeat, no infinite animation.

const ZERO = '0'.repeat(64)
const FIELDS = ['instrumentId', 'sensorType', 'value', 'unit', 'capturedAt']
const payload = (f) => FIELDS.map((k) => f[k]).join('|')
const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('')
const bytes = (h) => { const b = new Uint8Array(h.length >> 1); for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(2 * i, 2), 16); return b }
const groups = (h) => h.match(/.{1,8}/g).map((g) => `<span>${g}</span>`).join('<wbr>')
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`
const enc = new TextEncoder()
const ECDSA = { name: 'ECDSA', hash: 'SHA-256' }

// WebCrypto where it exists; otherwise the pure-JS SHA-256 (FIPS 180-4) handed in, and no signature checks.
async function engine(pure) {
  const c = globalThis.crypto, S = c && c.subtle && globalThis.isSecureContext !== false ? c.subtle : null
  if (S) return { S, sha: async (s) => hex(await S.digest('SHA-256', enc.encode(s))) }
  return { S: null, sha: async (s) => pure(s) }
}

// Replay a stored record history from the start of record (64 zeros). recs: [{ f, r, prev, h }].
// sig(rec, recomputedR) resolves true, false, or null (not checked). A row verifies when its fields still give its
// fingerprint, its stored links equal the replayed ones, and its signature does not fail.
async function replay(E, recs, sig) {
  const rp = await Promise.all(recs.map((x) => E.sha(payload(x.f))))
  const rows = []
  let prev = ZERO
  for (let i = 0; i < recs.length; i++) {
    const x = recs[i], h = await E.sha(prev + rp[i] + String(i + 1))
    rows.push({ x, n: i + 1, rp: rp[i], pp: prev, hp: h, fp: rp[i] === x.r, link: x.prev === prev && x.h === h })
    prev = h
  }
  const s = await Promise.all(rows.map((o) => sig(o.x, o.rp)))
  rows.forEach((o, i) => { o.sig = s[i]; o.ok = o.fp && o.link && o.sig !== false })
  return rows
}

// The shell recipe for one record, exactly as printed: [kind, text] with kind c (comment), p (command), o (output).
function recipe({ n, f, pp, rp, hp, r, h }) {
  return [
    ['c', `# record ${n}: fingerprint of the five sealed fields (macOS: shasum -a 256)`],
    ['p', `printf '%s' ${shq(payload(f))} | sha256sum`],
    ['o', `${rp}  -`],
    ['c', rp === r ? '# same as the sealed fingerprint' : `# differs from the sealed fingerprint ${r.slice(0, 8)}…`],
    ['c', n === 1 ? '# link: 64 zeros (start of record), then the fingerprint, then 1' : `# link: record ${n - 1}'s link replayed from the start, then the fingerprint, then ${n}`],
    ['p', `printf '%s' '${pp}${rp}${n}' | sha256sum`],
    ['o', `${hp}  -`],
    ['c', hp === h ? '# same as the sealed link' : `# differs from the sealed link ${h.slice(0, 8)}…`],
  ]
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const recipeHTML = (lines) => lines.map(([k, t]) => `<span class="${k}">${esc(t)}</span>`).join('\n')

// What an AI agent would receive for one stored record (roadmap): the record as stored, never the verifier's verdict.
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
const list = (ks, say) => { const w = ks.map((k) => say(k)); return w.length < 2 ? w.join('') : `${w.slice(0, -1).join(', ')} ${say('w.and')} ${w[w.length - 1]}` }
function statusLine(rows, { anchorOk, AN, signing }, say) {
  const ok = rows.filter((r) => r.ok).length, bad = rows.length - ok
  const parts = [say('st.head', { ok, n: rows.length })]
  if (bad) parts.push(say('st.fail', { bad }))
  parts.push(anchorOk ? say(rows.length > AN ? 'st.anc.part' : 'st.anc', { m: AN }) : say('st.anc.no'))
  if (rows.length > AN) parts.push(rows.length === AN + 1 ? say('st.unanch1', { a: AN + 1 }) : say('st.unanch', { a: AN + 1, b: rows.length }))
  if (!signing) parts.push(say('st.nosig'))
  return parts.join(' · ')
}
function rowStatus(o, { AN, by }, say) {
  const w = !o.fp ? say('row.alt') : o.sig === false ? say('row.sig') : !o.link ? say('row.link') : o.sig === null ? say(o.x.sig ? 'row.na' : 'row.none') : say('row.ok')
  const notes = []
  if (o.ok && o.x.orig && (o.x.h !== o.x.orig.h || o.x.r !== o.x.orig.r)) notes.push(say('row.relinked'))
  if (o.x.corrects) notes.push(say('row.corr', { k: o.x.corrects }))
  if (by) notes.push(say('row.corrby', { c: by }))
  if (o.n > AN) notes.push(say('row.unanch'))
  return [w, ...notes].join(' · ')
}
function sentence(rows, { anchorOk, AN, signing }, a, say) {
  const out = []
  if (a) out.push(say(`s.${a.type}`, a))
  const alt = rows.filter((r) => !r.fp), sg = rows.filter((r) => r.fp && r.sig === false), lk = rows.filter((r) => r.fp && r.sig !== false && !r.link)
  for (const r of alt) out.push(say(r.sig === false ? 's.alt' : 's.alt.na', { k: r.n }))
  for (const r of sg) out.push(say('s.sig', { k: r.n }))
  if (a && a.type === 'rewrite' && sg.length) out.push(say('s.rewrite.why'))
  if (lk.length) out.push(lk.length === 1 ? say('s.link1', { a: lk[0].n }) : say('s.link', { a: lk[0].n, b: lk[lk.length - 1].n }))
  const ok = rows.filter((r) => r.ok).length
  out.push(ok === rows.length ? say(signing ? 's.all' : 's.all.nosig', { n: rows.length }) : say('s.count', { ok, n: rows.length }))
  out.push(say(anchorOk ? 's.anc' : 's.anc.no', { m: AN }))
  if (rows.length > AN) out.push(rows.length === AN + 1 ? say('s.unanch1', { a: AN + 1 }) : say('s.unanch', { a: AN + 1, b: rows.length }))
  return out.join(' ')
}
// What the agent panel says about one record as it stands now. A pass says the record is unchanged since sealing,
// never that the result was right; an unsigned record never counts its signature as passing.
function agentLine(o, { AN, anchorOk, by }, say) {
  const anchored = o.n <= AN
  const failed = [!o.fp && 'w.fp', o.sig === false && 'w.sig', !o.link && 'w.link', anchored && !anchorOk && 'w.anc'].filter(Boolean)
  if (failed.length) return say('a.bad', { what: list(failed, say) }) + (by ? ` ${say('a.corrby', { c: by })}` : '')
  let s = say('a.pass', { what: list(['w.fp', o.sig === true && 'w.sig', 'w.link', anchored && 'w.anc'].filter(Boolean), say) })
  if (o.sig === null) s += say(o.x.sig ? 'a.na' : 'a.none')
  if (!anchored) s += say('a.unanch')
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
  menu()
  const p = D.querySelector('[data-plate]')
  if (p) plate(p)
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

// ---------------------------------------------------------------- 1. Contents menu: aria-expanded, Escape, outside click
function menu() {
  const btn = D.querySelector('.menu-btn'), nav = D.querySelector('.nav')
  if (!btn || !nav) return
  const open = () => btn.getAttribute('aria-expanded') === 'true'
  const set = (o) => { btn.setAttribute('aria-expanded', String(o)); nav.classList.toggle('open', o) }
  btn.addEventListener('click', () => set(!open()))
  D.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open()) { set(false); btn.focus() } })
  D.addEventListener('click', (e) => { if (open() && !nav.contains(e.target) && !btn.contains(e.target)) set(false) })
  // tabbing past the last entry (or anywhere outside) closes the overlay, so it never covers the focused content
  const away = (e) => { if (open() && e.relatedTarget && !nav.contains(e.relatedTarget) && !btn.contains(e.relatedTarget)) set(false) }
  nav.addEventListener('focusout', away)
  btn.addEventListener('focusout', away)
}

// ------------------------------------------------- 2. Overview plate: three checks, each shown as it actually completes
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
    const so = E.S ? await timed(async () => {
      const key = await E.S.importKey('raw', bytes(fig.dataset.pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
      return E.S.verify(ECDSA, key, bytes(fig.dataset.sig), bytes(rp))
    }) : null
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

// ------------------------------------------------------------------------------------- 3. Check a record: the verifier
async function verifier(root) {
  const say = words('iqc-words')
  const data = JSON.parse(D.getElementById('iqc-seq').textContent)
  const q = (s, r = root) => r.querySelector(s), qa = (s, r = root) => [...r.querySelectorAll(s)]
  const AN = data.anchorN
  const E = await engine(PURE)
  const demoKey = E.S ? await E.S.importKey('raw', bytes(data.pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']) : null
  const sealedAt = data.records.map((x) => ({ ...x, f: { ...x.f }, key: 'demo' }))
  let recs, sel = data.select, rewritten = false, ot = null, seq = 0, last = null, act = null, liveT = 0
  const fresh = () => sealedAt.map((x) => { const y = { ...x, f: { ...x.f } }; y.orig = { ...x, f: { ...x.f } }; return y })
  recs = fresh()

  const form = q('[data-fields]'), inputs = Object.fromEntries(FIELDS.map((k) => [k, q(`input[name="${k}"]`, form)]))
  const reason = q('#reason'), reasonErr = q('#reason-err')
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
  function paintRow(o, tr) {
    const s = o.ok ? 'ok' : 'bad'
    const prevS = tr.dataset.s
    tr.dataset.s = s
    tr.classList.toggle('sel', o.n === sel)
    const m = { fp: o.fp, sig: o.sig, link: o.link }
    for (const [k, v] of Object.entries(m)) {
      const td = q(`[data-m="${k}"]`, tr), st = v === null ? 'na' : v ? 'ok' : 'bad'
      const sr = k === 'sig' && v === null && !o.x.sig ? 'none' : st
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
    if (setText(q('[data-st]', tr), rowStatus(o, { AN, by: by && by.n }, say)) && prevS) pulse(q('[data-st]', tr), 'fade', 260)
  }
  function paint(v) {
    const { rows } = v, o = rows[sel - 1], x = o.x
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
    const pl = payload(x.f)
    setText(q('[data-payload]'), pl)
    setText(q('[data-bytes]'), String(new TextEncoder().encode(pl).length))
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
    ck('fp', o.fp ? 'ok' : 'bad', say(o.fp ? 'r.match' : 'r.nomatch'), say(o.fp ? 'd.fp.ok' : 'd.fp.bad'))
    const sk = o.sig === null ? 'na' : o.sig ? 'ok' : 'bad'
    ck('sig', sk, say(`r.sig.${x.sig ? sk : 'none'}`), x.sig ? say(`d.sig.${sk}`, { key: keyName(x) }) : say('d.sig.none'))
    if (setHex(q('[data-hx="hp"]'), o.hp)) pulse(q('[data-hx="hp"]'), 'fade', 160)
    setHex(q('[data-hx="h"]'), x.h)
    const up = x.prev !== o.pp
    const first = rows.find((r) => !r.fp || !r.link)
    ck('link', o.link ? 'ok' : 'bad', say(o.link ? 'r.intact' : 'r.broken'),
      o.link ? say(o.n < rows.length ? 'd.link.ok' : 'd.link.head', { n: o.n, next: o.n + 1 }) : up ? say('d.link.up', { k: first ? first.n : o.n }) : say('d.link.bad', { n: o.n }))
    const a = rows[AN - 1]
    if (nowEl) {
      const items = [['fp', o.fp ? 'ok' : 'bad', say(o.fp ? 'r.match' : 'r.nomatch')], ['sig', sk, say(`r.sig.${x.sig ? sk : 'none'}`)], ['link', o.link ? 'ok' : 'bad', say(o.link ? 'r.intact' : 'r.broken')],
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
    if (setHex(q('[data-hx="ap"]'), a.hp)) pulse(q('[data-hx="ap"]'), 'fade', 160)
    // the record's context (not sealed in the alpha)
    setText(q('[data-ctx]'), x.corrects ? say('ctx.corr', { k: x.corrects, reason: x.reason, at: x.at }) : say('ctx', x.ctx))
    // recipe
    const rc = recipe({ n: o.n, f: x.f, pp: o.pp, rp: o.rp, hp: o.hp, r: x.r, h: x.h })
    const code = q('[data-recipe]'), html = recipeHTML(rc)
    if (code.dataset.v !== html) { if (code.dataset.v) setText(q('[data-copied]'), ''); code.dataset.v = html; code.innerHTML = html }
    // history table
    rows.forEach((r) => paintRow(r, q(`tr[data-n="${r.n}"]`, tbody)))
    // the anchor line under the table
    const al = q('[data-anchor-line]')
    al.dataset.s = v.anchor ? 'ok' : 'bad'
    const ar = q('.res', al), aw = say(v.anchor ? 'r.anc' : 'r.anc.no')
    if (ar.dataset.w !== aw) { ar.dataset.w = aw; ar.innerHTML = `${ICON(v.anchor ? 'ok' : 'x')}<span data-anchor-st>${aw}</span>` }
    setText(q('[data-head]', al), rows.length > AN ? say(rows.length === AN + 1 ? 'head.after1' : 'head.after', { a: AN + 1, b: rows.length }) : '')
    // actions
    const anyEdit = recs.some(edited)
    btn.rewrite.disabled = !rows.some((r) => !r.fp || !r.link)
    btn.correct.disabled = rewritten || !edited(x)
    btn.reset.disabled = !anyEdit && !rewritten && recs.length === sealedAt.length
    setText(q('[data-hint]'), rewritten ? say('hint.rewritten') : edited(x) ? say('hint.edit', { n: o.n }) : anyEdit ? say('hint.other') : say('hint'))
    // what an AI agent would receive (roadmap)
    if (agent) {
      const demo = x.key === 'demo', signed = !!x.sig
      setText(agent, agentJSON({ x, of: rows.length, seq: data.seq, keyId: demo ? data.keyId : signed && ot ? ot.id : null, publicKey: demo ? data.pub : signed && ot ? ot.hex : null, anchor: data.anchor, anchorN: AN }))
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
    const v = { rows, anchor: rows[AN - 1].hp === data.anchor }
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
  async function rewrite() {
    const rows = await replay(E, recs, sigOk)
    const i0 = rows.findIndex((o) => !o.fp || !o.link)
    if (i0 < 0) return
    for (const o of rows.slice(i0)) { o.x.r = o.rp; o.x.prev = o.pp; o.x.h = o.hp }
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
  async function correct() {
    const x = recs[sel - 1]
    if (rewritten || !edited(x)) return
    const why = reason.value.trim()
    reason.setAttribute('aria-invalid', String(!why))
    reasonErr.hidden = !!why
    if (!why) { reason.focus(); announce(say('s.need'), true); return }
    const f = { ...x.f }
    Object.assign(x.f, x.orig.f) // the original stays as sealed
    const tail = recs[recs.length - 1], n = recs.length + 1
    const r = await E.sha(payload(f)), h = await E.sha(tail.h + r + String(n))
    let sig = ''
    if (E.S) { ot = ot || await makeKey(); sig = hex(await E.S.sign(ECDSA, ot.priv, bytes(r))) }
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
    reason.value = ''; reason.removeAttribute('aria-invalid'); reasonErr.hidden = true
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
    c.dataset.chip = x.n; c.dataset.extra = ''
    const i = q('input', c)
    i.value = String(x.n); i.id = `rec-${x.n}`; i.checked = false
    setText(q('.n', c), String(x.n))
    chips.append(c)
  }

  // ---- wire up (inputs were read-only for the prerendered, no-JS page)
  for (const i of Object.values(inputs)) i.readOnly = false
  reason.readOnly = false
  form.addEventListener('input', (e) => {
    const k = e.target.name
    if (!FIELDS.includes(k)) return
    recs[sel - 1].f[k] = e.target.value
    act = null
    update()
  })
  form.addEventListener('submit', (e) => e.preventDefault())
  chips.addEventListener('change', (e) => { if (e.target.name === 'rec') { sel = +e.target.value; fill(); update() } })
  reason.addEventListener('input', () => { if (reason.value.trim()) { reason.removeAttribute('aria-invalid'); reasonErr.hidden = true } })
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
