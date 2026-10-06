// app.js: Immutable QC, prototype A. The record-history panel, plus the phone menu.
// On load the browser replays every record shown on the page. It hashes the instrument ID, the peak areas and the capture
// times it reads from the page (measurement type and unit are the fixed "hplc" and "counts" of the alpha's payload),
// relinks them, checks each ECDSA P-256 signature with the public key in #iqc-data, and compares the replayed head with
// the anchored fingerprint. Every word and mark in the panel is chosen from that output, never from the button pressed.
// Motion: one WAAPI pass the first time the rows are on screen (rows seal in turn, about 1.2 s), then nothing runs
// until the visitor acts.
const doc = document, root = doc.documentElement
const $ = (s, r = doc) => r.querySelector(s), $$ = (s, r = doc) => [...r.querySelectorAll(s)]
// if anything below fails, show the no-JS page (prerendered results, "needs JavaScript" notes) rather than dead controls
const fail = (e) => { root.classList.remove('js', 'motion'); console.error(e) }
try { menu() } catch (e) { console.error(e) }
const dataEl = $('#iqc-data')
if (dataEl) { try { start(JSON.parse(dataEl.textContent)) } catch (e) { fail(e) } }

// ---- phone menu: a disclosure button for the section links; closes on Escape, on a link, or on a tap outside
function menu() {
  const top = $('.top'), b = $('.menu-b'), nav = $('#nav')
  if (!b || !nav) return
  const set = (open, refocus) => {
    top.classList.toggle('open', open)
    b.setAttribute('aria-expanded', String(open))
    if (!open && refocus) b.focus()
  }
  b.addEventListener('click', () => set(b.getAttribute('aria-expanded') !== 'true'))
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) set(false) })
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && top.classList.contains('open')) set(false, true) })
  doc.addEventListener('click', (e) => { if (top.classList.contains('open') && !top.contains(e.target)) set(false) })
}

function start(D) {
  const ZERO = '0'.repeat(64), A = D.anchorN, MAXREC = 12
  const pad = (n) => String(n).padStart(2, '0')
  const upTo = (n) => `01–\u2060${pad(n)}` // a range that never breaks after its dash
  const short = (h) => h.slice(0, 8)
  const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('')
  const bytes = (h) => { const b = new Uint8Array(h.length >> 1); for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16); return b }
  const noop = () => {}
  const S = globalThis.crypto && crypto.subtle && globalThis.isSecureContext !== false ? crypto.subtle : null
  const ECDSA = { name: 'ECDSA', hash: 'SHA-256' }

  // ---- hashing and signature engines (pure-JS SHA-256 where crypto.subtle is missing; signatures then go unchecked)
  const enc = new TextEncoder(), memo = new Map(), sigMemo = new Map()
  const sha = (s) => {
    let p = memo.get(s)
    if (!p) {
      if (memo.size > 800) memo.clear()
      p = S ? S.digest('SHA-256', enc.encode(s)).then(hex) : Promise.resolve(sha256(s))
      memo.set(s, p)
    }
    return p
  }
  const demoKey = S ? S.importKey('raw', bytes(D.pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']).catch(() => null) : Promise.resolve(null)
  let sigMode = 'unchecked' // 'checked' once this browser has the demo public key and can verify
  let once = null // the one-time key for corrections, made in this browser; private half not extractable
  async function sigCheck(rec, r) {
    if (!S || !rec.sig) return null
    const key = rec.key === 'once' ? once && once.pub : await demoKey
    if (!key) return null
    const k = rec.sig + r
    if (!sigMemo.has(k)) sigMemo.set(k, S.verify(ECDSA, key, bytes(rec.sig), bytes(r)).catch(() => false))
    return sigMemo.get(k)
  }
  async function oneTime() {
    if (once || !S) return once
    try {
      const k = await S.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
      const raw = await S.exportKey('raw', k.publicKey)
      once = { priv: k.privateKey, pub: k.publicKey, fp: hex(await S.digest('SHA-256', raw)).slice(0, 16) } // same derivation as the demo key
    } catch { once = null }
    return once
  }

  // ---- page parts
  const tbody = $('#seq tbody'), form = $('#reason'), why = $('#why'), pick = $('#pick'), live = $('#live')
  const O = Object.fromEntries($$('[data-o]').map((e) => [e.dataset.o, e]))
  const B = Object.fromEntries($$('.btns [data-act]').map((e) => [e.dataset.act, e]))
  const NODE = $('.nd', tbody).outerHTML
  const ST = (w) => `<span class="st"><svg class="ic" aria-hidden="true"><use href="#i-open"/></svg><span class="w">${w}</span></span>`
  const els = (tr) => ({ dr: $('.dr', tr), dt: $('.dt', tr), fp: $('.fp', tr), fpn: $('.fpn', tr), ln: $('.c-ln .st', tr), lnn: $('.lnn', tr), sg: $('.c-sg .st', tr), at: $('time', tr) })
  const REC = D.rec.map((d, i) => {
    const tr = tbody.rows[i]
    return { ...d, key: 'demo', tr, btn: $('.pa', tr), el: els(tr), built: { v: d.v, r: d.r, prev: d.prev, h: d.h } }
  })
  // the sealed fields, as shown on the page
  const inst = () => (O.inst ? O.inst.textContent.trim() : D.inst)
  const atOf = (rec) => rec.el.at.getAttribute('datetime')
  const shown = (rec) => (rec.input ? rec.input.value : rec.btn ? rec.btn.textContent : rec.pv.textContent)
  const payload = (v, at) => `${inst()}|${D.type}|${v}|${D.unit}|${at}`
  let sel = 0, last = null, note = '', rewritten = false, busy = false, seq = 0, sayT = 0, touched = false

  // ---- the verifier: fingerprint, link (each stored link against the replay of the record before it), signature;
  // and the head replayed from 64 zeros over every value shown, compared with the anchored fingerprint at record A
  async function verifyAll() {
    const N = REC.length
    const rs = await Promise.all(REC.map((rec) => sha(payload(shown(rec), atOf(rec)))))
    const links = await Promise.all(REC.map((rec, i) => sha(rec.prev + rs[i] + rec.n)))
    const so = await Promise.all(REC.map((rec, i) => sigCheck(rec, rs[i])))
    let full = ZERO
    const fulls = []
    for (let i = 0; i < N; i++) fulls.push((full = await sha(full + rs[i] + REC[i].n)))
    const checked = sigMode === 'checked'
    const rows = REC.map((rec, i) => {
      const fpOk = rs[i] === rec.r, linkOk = rec.prev === (i ? links[i - 1] : ZERO), sigOk = so[i]
      // with signatures checkable, a record counts only when its signature verifies; without, fingerprint and link only
      const pass = fpOk && linkOk && (checked ? sigOk === true : sigOk !== false)
      return { r: rs[i], link: links[i], fpOk, linkOk, sigOk, pass, sealed: fpOk && linkOk && sigOk === true }
    })
    return { rows, N, pass: rows.filter((x) => x.pass).length, head: fulls[N - 1], anchorOk: fulls[A - 1] === D.anchor }
  }

  // ---- paint: classes, marks and words from the verifier output
  function setSt(st, word, cls) {
    st.className = 'st' + (cls ? ' ' + cls : '')
    $('use', st).setAttribute('href', cls === 'n' ? '#i-no' : cls === 'y' ? '#i-ok' : '#i-open')
    $('.w', st).textContent = word
  }
  function markDigits(rec) {
    const v = shown(rec), o = rec.built.v
    const html = v === o ? v : `<span>${[...v].map((c, j) => (c !== o[j] ? `<span class="chg">${c}</span>` : c)).join('')}</span>`
    if (rec.btn.innerHTML !== html) rec.btn.innerHTML = html
    rec.btn.setAttribute('aria-label', `${v} counts, record ${pad(rec.n)}${v !== o ? `, recorded as ${o}` : ''}: change peak area`)
  }
  function paintRow(i, x, hold) {
    const rec = REC[i], tr = rec.tr, e = rec.el
    tr.classList.toggle('alt', !x.fpOk || x.sigOk === false)
    tr.classList.toggle('lb', !x.linkOk)
    if (!hold) tr.classList.toggle('ok', x.sealed)
    e.fp.textContent = short(x.r)
    const rwFp = x.fpOk && rec.r !== rec.built.r
    e.fpn.textContent = !x.fpOk ? 'changed' : rwFp ? 'rewritten' : ''
    e.fpn.classList.toggle('rw', rwFp)
    setSt(e.ln, x.linkOk ? 'linked' : 'broken', hold ? '' : x.linkOk ? 'y' : 'n')
    e.lnn.textContent = x.linkOk && rec.prev !== rec.built.prev ? 'rewritten' : ''
    const sw = x.sigOk === true ? 'verifies' : x.sigOk === false ? 'fails' : sigMode === 'checked' ? 'unsigned' : 'unchecked'
    setSt(e.sg, sw, hold || x.sigOk === null ? '' : x.sigOk ? 'y' : 'n')
    if (rec.btn && !rec.input) markDigits(rec)
  }
  function vs(el, text, cls) {
    el.className = 'vs ' + cls
    $('use', el).setAttribute('href', cls === 'n' ? '#i-no' : cls === 'p' ? '#i-open' : '#i-ok')
    el.lastChild.textContent = text
  }
  function summary(v) {
    const checked = sigMode === 'checked', all = v.pass === v.N
    O['chk-k'].textContent = checked ? 'Checked in your browser:' : 'Checked in your browser, fingerprints and links only:'
    O.count.textContent = `${v.pass} of ${v.N}`
    vs(O.verdict, !all ? `${v.N - v.pass} fail` : checked ? 'all verify' : 'pass; signatures not checked', !all ? 'n' : checked ? 'y' : 'p')
    O.head.textContent = short(v.head)
    const ext = v.N > A
    vs(O['head-st'], !v.anchorOk ? 'no longer matches the anchored fingerprint' : ext ? `not yet anchored; records ${upTo(A)} still match` : 'matches the anchored fingerprint', !v.anchorOk ? 'n' : ext ? 'p' : 'y')
  }
  function paint(v, hold = false) {
    v.rows.forEach((x, i) => paintRow(i, x, hold))
    if (!hold) summary(v)
  }

  // ---- words for the state line and the live region (built from the verifier output)
  const list = (a) => (a.length < 2 ? a[0] : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1])
  function sentence(v, lead) {
    const checked = sigMode === 'checked'
    const verb = checked ? 'verify' : 'pass the fingerprint and link checks'
    const tail = checked ? '' : ' Signatures could not be checked in this browser.'
    const parts = []
    v.rows.forEach((x, i) => {
      const p = []
      if (!x.fpOk) p.push('its fingerprint no longer matches')
      if (x.sigOk === false) p.push('its signature fails')
      if (x.sigOk === null && checked) p.push('it is not signed')
      if (!x.linkOk) p.push(`its link to record ${pad(REC[i - 1].n)} is broken`)
      if (p.length) parts.push(`Record ${pad(REC[i].n)}: ${list(p)}.`)
    })
    if (!parts.length && v.anchorOk && v.N === A) return `${lead || 'As recorded.'} All ${v.N} records ${verb}, and the replayed head matches the anchored fingerprint.${tail}`
    let s = (lead ? lead + ' ' : '') + parts.join(' ')
    if (rewritten && parts.length && v.rows.every((x) => x.linkOk)) s += ' All links check.'
    s += ` ${v.pass} of ${v.N} records ${verb}.`
    if (!v.anchorOk) s += ' The replayed head no longer matches the anchored fingerprint.'
    else if (v.N > A) s += ` Records ${upTo(A)} still match the anchored fingerprint; the new head is not yet anchored.`
    else s += ' The replayed head matches the anchored fingerprint.'
    return (s + tail).trim()
  }
  function say(s) { clearTimeout(sayT); live.textContent = s }
  function hint(s) { O.state.textContent = s; say(s) }

  // ---- "check it yourself": the exact recipe for the selected record, from the values on screen
  function cmp(el, good, text) { el.textContent = text; el.classList.toggle('n', !good) }
  function recipe(v) {
    const i = Math.min(sel, REC.length - 1), rec = REC[i], x = v.rows[i], nx = REC[i + 1], pv = REC[i - 1]
    O.sel.textContent = pad(rec.n)
    O.cmd1.textContent = `printf '%s' '${payload(shown(rec), atOf(rec))}' | sha256sum`
    O.out1.textContent = `${x.r}  -`
    cmp(O.cmp1, x.fpOk, x.fpOk ? `Matches the fingerprint stored with record ${pad(rec.n)} (${short(rec.r)}).` : `Differs from the fingerprint stored with record ${pad(rec.n)} (${short(rec.r)}): the value changed after it was sealed.`)
    if (!pv) cmp(O.cmp0, true, `Record ${pad(rec.n)} starts from 64 zeros.`)
    else cmp(O.cmp0, x.linkOk, x.linkOk
      ? `It starts from the previous link stored with record ${pad(rec.n)} (${short(rec.prev)}), which matches record ${pad(pv.n)} as replayed here.`
      : `It starts from the previous link stored with record ${pad(rec.n)} (${short(rec.prev)}). Record ${pad(pv.n)} now replays to ${short(v.rows[i - 1].link)}, so the link from record ${pad(pv.n)} is broken.`)
    O.cmd2.textContent = `printf '%s' '${rec.prev}${x.r}${rec.n}' | sha256sum`
    O.out2.textContent = `${x.link}  -`
    const same = x.link === rec.h
    cmp(O.cmp2, same, same ? `Matches the link stored with record ${pad(rec.n)}${nx ? `, which record ${pad(nx.n)} carries as its previous link` : ''} (${short(rec.h)}).` : `Differs from the link stored with record ${pad(rec.n)} (${short(rec.h)})${nx ? `, so the link to record ${pad(nx.n)} is broken` : ''}.`)
    $$('[data-copy]').forEach((b) => { b.textContent = `Copy command ${b.dataset.copy.slice(-1)}` })
  }
  function options() {
    pick.innerHTML = REC.map((rec, i) => `<option value="${i}">${pad(rec.n)} · ${rec.corr ? `correction of ${pad(rec.corr)}` : `injection ${rec.inj}`}</option>`).join('')
    pick.value = String(sel)
  }
  // one tab stop for the peak-area column; Up/Down/Home/End move it (roving tabindex)
  function rove(i) { REC.forEach((rec, j) => { if (rec.btn) rec.btn.tabIndex = j === i ? 0 : -1 }) }
  function select(i) {
    sel = i
    REC.forEach((rec, j) => rec.tr.classList.toggle('sel', j === i))
    pick.value = String(i)
    if (REC[i].btn) rove(i)
  }

  // ---- controls
  const pending = () => REC.some((rec) => rec.btn && shown(rec) !== rec.v)
  const changed = () => REC.length > A || rewritten || REC.some((rec) => rec.btn && shown(rec) !== rec.built.v)
  function controls() {
    B.rewrite.setAttribute('aria-disabled', String(!pending()))
    B.correct.setAttribute('aria-disabled', String(!pending() || rewritten || REC.length >= MAXREC))
    B.reset.setAttribute('aria-disabled', String(!changed()))
  }
  async function update(speak, lead) {
    const my = ++seq
    const v = await verifyAll()
    if (my !== seq) return v
    last = v
    paint(v)
    recipe(v)
    controls()
    const s = (note ? note + ' ' : '') + sentence(v, lead)
    O.state.textContent = s
    clearTimeout(sayT)
    if (speak === true) say(s)
    else if (speak === 'later') sayT = setTimeout(() => say(s), 1200)
    return v
  }

  // ---- editing a peak area: an input in place of the value; every keystroke re-verifies
  function startEdit(rec) {
    if (rec.input || busy) return
    settle()
    touched = true
    const inp = doc.createElement('input')
    Object.assign(inp, { type: 'text', inputMode: 'numeric', autocomplete: 'off', spellcheck: false, className: 'pa-in', value: shown(rec), maxLength: 9 })
    inp.setAttribute('aria-label', `Peak area for record ${pad(rec.n)}, counts`)
    inp.setAttribute('enterkeyhint', 'done')
    rec.start = inp.value
    rec.btn.hidden = true
    rec.btn.after(inp)
    rec.input = inp
    select(REC.indexOf(rec))
    note = ''
    inp.focus()
    inp.select()
    inp.addEventListener('input', () => {
      const c = inp.value.replace(/\D+/g, '').slice(0, 9)
      if (c !== inp.value) inp.value = c
      update('later')
    })
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); endEdit(rec, true) }
      else if (e.key === 'Escape') { e.preventDefault(); inp.value = rec.start; endEdit(rec, true) }
    })
    inp.addEventListener('blur', () => endEdit(rec, false))
    update(false)
  }
  function endEdit(rec, refocus) {
    const inp = rec.input
    if (!inp) return
    rec.input = null
    rec.btn.textContent = inp.value || rec.start
    rec.btn.hidden = false
    inp.remove()
    if (refocus) rec.btn.focus()
    update(true)
  }
  const commitEdit = () => REC.forEach((rec) => rec.input && endEdit(rec, false))

  async function rewrite() {
    commitEdit()
    const k = REC.findIndex((rec) => rec.btn && shown(rec) !== rec.v)
    if (k < 0) return hint(rewritten ? 'The history is already rewritten. Reset to start again.' : 'Nothing to hide yet. Change a peak area first.')
    busy = true
    let prev = REC[k].prev
    for (let i = k; i < REC.length; i++) {
      const rec = REC[i], r = await sha(payload(shown(rec), atOf(rec)))
      rec.v = shown(rec); rec.r = r; rec.prev = prev; rec.h = await sha(prev + r + rec.n); prev = rec.h
    }
    rewritten = true
    busy = false
    note = `History rewritten from record ${pad(REC[k].n)}: its stored fingerprint and every later link were recomputed, but it could not be re-signed without the key.` +
      (sigMode === 'checked' ? '' : ' This browser cannot check signatures, so here the rewrite shows only against the anchored fingerprint.')
    select(k)
    update(true)
  }
  function openReason() {
    commitEdit()
    if (rewritten) return hint('The history was rewritten. Reset first, then try the correction.')
    if (!pending()) return hint('Change a peak area first; the correction will carry the new value.')
    if (REC.length >= MAXREC) return hint('That is enough corrections for one demo. Reset to start again.')
    form.hidden = false
    why.focus()
    why.select()
  }
  function closeReason(refocus) { form.hidden = true; if (refocus) B.correct.focus() }
  // a correction note spans every column the table shows at this width (the capture-time column comes and goes)
  const span = () => [...tbody.rows[0].cells].filter((c) => getComputedStyle(c).display !== 'none').length - 1
  const respan = () => { const n = span(); $$('td.c-nt', tbody).forEach((td) => { td.colSpan = n }) }
  function addRow(c) {
    const tr = doc.createElement('tr')
    tr.className = 'rec cor'
    tr.setAttribute('role', 'row')
    const day = c.at.slice(0, 10), time = c.at.slice(11, 19)
    tr.innerHTML = `<td class="c-sp" role="cell">${NODE}</td><th scope="row" role="rowheader" class="c-inj">${pad(c.n)}</th><td class="c-smp" role="cell">Corr. of ${pad(c.corr)}</td><td class="c-rt" role="cell"><span aria-hidden="true">—</span><span class="sr-only">not measured again</span></td><td class="c-at" role="cell"><time datetime="${c.at}"><span class="d">${day}</span>${time}</time></td><td class="c-pa" role="cell"><span class="pv">${c.v}</span></td><td class="c-fp" role="cell"><code class="fp"></code><span class="fpn"></span></td><td class="c-ln" role="cell">${ST('linked')}<span class="lnn"></span></td><td class="c-sg" role="cell">${ST('verifies')}${c.sig ? '<span class="tg">one-time key</span>' : ''}</td>`
    const nt = doc.createElement('tr')
    nt.className = 'note'
    nt.setAttribute('role', 'row')
    nt.innerHTML = `<td class="c-sp" role="cell"></td><td class="c-nt" role="cell">Record ${pad(c.n)} corrects record ${pad(c.corr)} (injection ${c.inj}); record ${pad(c.corr)} keeps its recorded value. Reason: <span class="rs"></span> Sealed with the time of the correction, ${day} ${time} UTC. ${c.sig ? `Signed with a one-time demo key made in your browser (key ${once.fp}).` : 'Not signed: this browser cannot make a key here.'} The reason and the reference sit beside the sealed fields; sealing them is on the roadmap.</td>`
    $('.rs', nt).textContent = c.reason
    tbody.append(tr, nt)
    respan()
    Object.assign(c, { tr, pv: $('.pv', tr), el: els(tr) })
  }
  async function appendCorrection(reason) {
    if (busy) return
    busy = true
    const key = await oneTime()
    const edited = REC.filter((rec) => rec.btn && shown(rec) !== rec.v)
    const made = []
    for (const rec of edited) {
      if (REC.length >= MAXREC) break
      const cv = shown(rec)
      rec.btn.textContent = rec.v // the original stays as recorded
      // the correction is its own record: the new value, sealed with the time the correction was made
      const n = REC.length + 1, prev = REC[REC.length - 1].h, at = new Date().toISOString().slice(0, 19) + 'Z'
      const r = await sha(payload(cv, at)), h = await sha(prev + r + n)
      const sig = key ? hex(await S.sign(ECDSA, key.priv, bytes(r))) : null
      const c = { n, inj: rec.inj, smp: `Corr. of ${pad(rec.n)}`, rt: '', at, v: cv, r, prev, h, sig, key: 'once', corr: rec.n, reason }
      c.built = { v: cv, r, prev, h }
      addRow(c)
      REC.push(c)
      made.push(c)
    }
    busy = false
    closeReason(false)
    const m = made.map((c) => pad(c.n)), o = made.map((c) => pad(c.corr))
    note = made.length ? `Correction appended as record ${list(m)}${key ? ', signed with a one-time demo key made in your browser' : ', unsigned'}; record ${list(o)} keeps its recorded value.` : ''
    options()
    select(REC.length - 1)
    await update(true)
    B.correct.focus()
  }
  function reset() {
    commitEdit()
    closeReason(false)
    for (const rec of REC.splice(A)) { if (rec.tr.nextElementSibling) rec.tr.nextElementSibling.remove(); rec.tr.remove() }
    for (const rec of REC) { Object.assign(rec, rec.built); rec.btn.textContent = rec.v }
    rewritten = false
    once = null
    note = ''
    sel = Math.min(sel, A - 1)
    options()
    select(sel)
    update(true, 'Reset to the recorded history.')
  }

  // ---- the one-time entrance: the first time the rows are on screen, they seal one after another (WAAPI, ~1.2 s),
  // then hold. Until then they keep their prerendered, neutral "checked at build" look. Skipped when motion is off or the
  // tab is hidden; cut short by any input, a hidden tab, or the rows leaving the view; settled at once if scrolled past.
  const anims = []
  let io = null, phase = 'done' // 'wait' | 'play' | 'done'
  function settle() {
    if (phase === 'done') return
    phase = 'done'
    if (io) { io.disconnect(); io = null }
    anims.splice(0).forEach((a) => a.cancel())
    if (last) paint(last)
  }
  function intro(v) {
    const can = root.classList.contains('motion') && !doc.hidden && tbody.animate && 'IntersectionObserver' in window
    if (!can || !v.anchorOk || v.rows.some((x) => !x.sealed)) return paint(v)
    paint(v, true)
    phase = 'wait'
    io = new IntersectionObserver((es) => {
      const e = es[es.length - 1]
      if (phase === 'wait' && e.isIntersecting && e.intersectionRatio >= 0.25) play(last)
      else if (phase === 'wait' && !e.isIntersecting && e.boundingClientRect.bottom < 0) settle()
      else if (phase === 'play' && !e.isIntersecting) settle()
    }, { threshold: [0, 0.25] })
    io.observe(tbody)
  }
  function play(v) {
    if (doc.hidden || !root.classList.contains('motion')) return settle()
    phase = 'play'
    const cs = getComputedStyle(root), from = cs.getPropertyValue('--fg-2').trim(), to = cs.getPropertyValue('--acc').trim()
    const done = []
    REC.forEach((rec, i) => {
      const x = v.rows[i]
      if (!x.sealed) return paintRow(i, x, false)
      const o = { duration: 300, delay: 140 * i, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both' }
      const a = rec.el.dr.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], o)
      const b = rec.el.dt.animate([{ fill: from, transform: 'scale(.55)' }, { fill: to, transform: 'scale(1)' }], o)
      anims.push(a, b)
      done.push(a.finished.then(() => { if (phase === 'play') { paintRow(i, x, false); a.cancel(); b.cancel() } }))
    })
    Promise.all(done).then(() => { if (phase === 'play') settle() }, noop)
  }

  // ---- wiring
  async function boot() {
    sigMode = S && (await demoKey) ? 'checked' : 'unchecked'
    for (const rec of REC) rec.btn.disabled = false
    rove(0)
    if (sigMode !== 'checked') {
      if (S) O['subtle-note'].textContent = 'This browser could not load the demo public key, so signatures could not be checked; fingerprints and links were checked.'
      O['subtle-note'].hidden = false
    }
    tbody.addEventListener('click', (e) => { const b = e.target.closest('.pa'); if (b) startEdit(REC.find((rec) => rec.btn === b)) })
    tbody.addEventListener('keydown', (e) => {
      const b = e.target.closest('.pa')
      if (!b) return
      const col = REC.filter((rec) => rec.btn), k = col.findIndex((rec) => rec.btn === b)
      const j = { ArrowDown: k + 1, ArrowUp: k - 1, Home: 0, End: col.length - 1 }[e.key]
      if (j === undefined) return
      e.preventDefault()
      const t = col[Math.max(0, Math.min(col.length - 1, j))]
      select(REC.indexOf(t))
      if (last) recipe(last)
      t.btn.focus()
    })
    const act = { rewrite, correct: openReason, reset: () => (B.reset.getAttribute('aria-disabled') === 'true' ? hint('Nothing to reset yet.') : reset()) }
    for (const [k, b] of Object.entries(B)) b.addEventListener('click', () => { settle(); act[k]() })
    form.addEventListener('submit', (e) => { e.preventDefault(); appendCorrection(why.value.trim() || why.defaultValue) })
    $('[data-act=cancel]', form).addEventListener('click', () => closeReason(true))
    form.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeReason(true) } })
    pick.addEventListener('change', () => { select(+pick.value); if (last) recipe(last) })
    $$('[data-copy]').forEach((b) => {
      if (!navigator.clipboard || !globalThis.isSecureContext) { b.hidden = true; return }
      b.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(O[b.dataset.copy].textContent); b.textContent = `Copied command ${b.dataset.copy.slice(-1)}`; say('Command copied.') }
        catch { say('Copy did not work here; select the command instead.') }
      })
    })
    const check = $('#check')
    const openCheck = () => { if (location.hash === '#check') check.open = true }
    addEventListener('hashchange', openCheck)
    doc.addEventListener('click', (e) => { if (e.target.closest('a[href="#check"]')) { check.open = true; setTimeout(() => $('summary', check).focus({ preventScroll: true })) } })
    openCheck()
    doc.addEventListener('visibilitychange', () => { if (doc.hidden) settle() })
    try {
      const mq = matchMedia('(prefers-reduced-motion: reduce)')
      mq.addEventListener('change', () => { root.classList.toggle('motion', !mq.matches); if (mq.matches) settle() })
      matchMedia('(max-width:759px),(min-width:1200px) and (max-width:1359px)').addEventListener('change', respan)
    } catch { /* old engine */ }
    const v = await verifyAll()
    last = v
    recipe(v)
    controls()
    if (!touched && (sigMode !== 'checked' || v.pass !== v.N || !v.anchorOk)) O.state.textContent = sentence(v)
    if (!touched) intro(v)
    root.classList.add('ready')
  }
  boot().catch(fail)
}

// FIPS 180-4 SHA-256 for pages without crypto.subtle (insecure context). UTF-8 in, lowercase hex out.
// From joseqc.com, chapters/06-data-integrity/sha256.js.
function sha256(str) {
  const K = new Uint32Array(64), H0 = new Uint32Array(8)
  for (let c = 2, n = 0; n < 64; c++) {
    let p = 1
    for (let d = 2; d * d <= c; d++) if (c % d === 0) { p = 0; break }
    if (!p) continue
    if (n < 8) H0[n] = (c ** 0.5 % 1) * 4294967296
    K[n++] = (c ** (1 / 3) % 1) * 4294967296
  }
  const ror = (x, n) => (x >>> n) | (x << (32 - n))
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
