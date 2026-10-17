// Immutable QC app: the page (docs/product-v1.md, section 5). One page, two modes and a demo:
//   Audit (default)  drop a data folder, or choose one: the ledger is found and the audit starts at once; one verdict,
//                    then problems, notes, the watch sessions, the ledger and a searchable file list; reports to download
//   Seal             drop a folder: the browser's key (IndexedDB, not extractable) seals every file into ledger.jsonl
//   Demo (#demo)     the sample folder from ui/sample-data.mjs, sealed, audited (pass), one value changed in a copy,
//                    audited again (fail), all with the same code as a real folder
// The work is in engine.mjs (folders, the worker pool, the audit and the seal) and core (../core/immutableqc.mjs); this
// module draws. Markup is built from escaped strings, with no inline style or handler (the CSP allows neither): sizes
// and positions are custom properties set with style.setProperty. Every failure is shown as a readable message.
import * as IQC from '../core/immutableqc.mjs'
import { AppError, Canceled, Pool, KeyStore, DemoKeys, entriesOfDrop, listEntries, listInput, measure, yieldNow, locate, runAudit, runSeal, demoListing, DEMO, TOOL } from './engine.mjs'
import { hexGroups } from '../ui/sample-data.mjs'

// test hooks, only with ?test in the address: ?test&worker=<name>.mjs (a worker that fails, say) and ?test&max=<n>
const TEST = /[?&]test\b/.test(location.search) ? new URLSearchParams(location.search) : null
const POOL = () => { const w = TEST && TEST.get('worker'); return w && /^[\w-]+\.mjs$/.test(w) ? { url: new URL(w, import.meta.url) } : {} }
const MAX_FILES = TEST && Number(TEST.get('max')) > 0 ? Number(TEST.get('max')) : undefined
const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]
const esc = (s) => IQC.escapeHTML(s)
const fmtN = (n) => IQC.formatCount(n)
const fmtB = (n) => IQC.formatBytes(n)
const plural = (n, one, many) => `${fmtN(n)} ${n === 1 ? one : many}`
const ic = (name) => `<svg aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`
const cap = (s) => s.replace(/^./, (c) => c.toUpperCase())
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n) => String(n).padStart(2, '0')
const asDate = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d }
const when = (iso) => { const d = asDate(iso); return d ? `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC` : String(iso) }
const day = (iso) => { const d = asDate(iso); return d ? `${d.getUTCDate()} ${MON[d.getUTCMonth()]}` : '' }
const dayTime = (iso) => { const d = asDate(iso); return d ? `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : '' }
const dur = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) return '…'
  if (ms < 100) return 'under 0.1 s'
  if (ms < 10000) return `${(ms / 1000).toFixed(1)} s`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${pad(s % 60)} s`
  return `${Math.floor(m / 60)} h ${pad(m % 60)} min`
}
const hashHTML = (hex, cls = '') => `<code class="hash${cls ? ' ' + cls : ''}">${hexGroups(String(hex)).map((g) => `<span>${esc(g)}</span>`).join('')}</code>`
const shortHash = (hex, cls = '') => `<code class="hash hash-short${cls ? ' ' + cls : ''}"><span>${esc(String(hex).slice(0, 8))}</span>…</code>`
const headHTML = (head) => `<code class="hash">${hexGroups(head.h).map((g, i) => `<span>${i ? '' : `${esc(head.n)}:`}${esc(g)}</span>`).join('')}</code>`
const headText = (head) => IQC.formatHead(head)
// a path as the person's folder names it (the ledger stores "50%25.txt" for "50%.txt"); kept encoded if decoding would
// show a control character, or fails. Reports keep the ledger's form.
const nameOf = (path) => { try { const d = IQC.decodePath(path); return /[\u0000-\u001f\u007f]/.test(d) ? path : d } catch { return path } }
const slug = (s) => String(s || 'folder').normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'folder'

// the state tags (theme.css .tag): every state has an icon and a word, never color alone
const STATE = {
  match: ['tag-match', 'check', 'Match'],
  changed: ['tag-changed', 'x', 'Changed'],
  missing: ['tag-missing', 'missing', 'Missing'],
  removed: ['tag-removed', 'removed', 'Removed'],
  'back after removal': ['tag-back', 'back', 'Back after removal'],
  'not sealed': ['tag-unsealed', 'unsealed', 'Not sealed'],
  'not checked': ['tag-unchecked', 'unchecked', 'Not checked'],
}
const CI = '<span class="ci" aria-hidden="true"><svg class="ci-ok" focusable="false"><use href="#i-check"/></svg><svg class="ci-bad" focusable="false"><use href="#i-x"/></svg></span>'
const tag = (state, extra = '') => { const [c, i, w] = STATE[state] || STATE['not checked']; return `<span class="tag ${c}${extra}">${ic(i)}${esc(w)}</span>` }

// ------------------------------------------------------------------------------------------------------ the state
const S = {
  mode: 'audit',
  keys: new KeyStore(),
  audit: { run: null, pending: null, last: null },
  seal: { run: null, last: null, text: null },
  demo: { phase: 'idle', run: null, ledgerText: null, seal: null, auto: false },
}
const TITLES = { audit: 'Audit a data folder · Immutable QC', seal: 'Seal a data folder · Immutable QC', demo: 'Demo with sample data · Immutable QC' }
const section = (mode) => document.getElementById(mode) // the sections are #audit, #seal and #demo, as the tabs link them
const viewEl = (mode, v) => $(`:scope > .wrap > [data-view="${v}"]`, section(mode))
function show(mode, v) {
  for (const el of $$(':scope > .wrap > [data-view]', section(mode))) el.hidden = el.dataset.view !== v
  return viewEl(mode, v)
}

// ------------------------------------------------------------------------------------------------- announcements
let liveTimer = 0
function announce(text) {
  const el = $('#live')
  clearTimeout(liveTimer)
  el.textContent = ''
  liveTimer = setTimeout(() => { el.textContent = text }, 60)
}
function focusEl(el) {
  if (!el) return
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
  el.focus({ preventScroll: true })
  const top = el.getBoundingClientRect().top
  if (top < 90 || top > innerHeight * 0.6) el.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}

// ----------------------------------------------------------------------------------------------------------- modes
const modeOf = (hash) => ({ '#audit': 'audit', '#seal': 'seal', '#demo': 'demo', '': 'audit', '#': 'audit' })[hash]
function setMode(m, { focus = false } = {}) {
  S.mode = m
  for (const sec of $$('.mode')) sec.hidden = sec.dataset.mode !== m
  for (const a of $$('.modes a')) { if (a.dataset.mode === m) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current') }
  document.title = TITLES[m]
  if (m === 'demo' && S.demo.phase === 'idle') { startDemo({ focus: true }); return }
  if (focus) {
    const vis = $$(':scope > .wrap > [data-view]', section(m)).find((el) => !el.hidden)
    focusEl(m === 'demo' ? $('#demo-h') : vis && ($('.verdict', vis) || $('h1', vis)))
  }
}

// ------------------------------------------------------------------------------------------------------- progress
const AUDIT_STEPS = [
  { id: 'list', label: 'Folder read', wait: 'every file listed' },
  { id: 'ledger', label: 'Ledger checked', wait: 'every signature and link' },
  { id: 'hash', label: 'Files re-read', wait: 'the SHA-256 of every file' },
  { id: 'audit', label: 'Verdict', wait: 'once every file is checked' },
]
const SEAL_STEPS = [
  { id: 'list', label: 'Folder read', wait: 'every file listed' },
  { id: 'ledger', label: 'Ledger', wait: 'a new one, or the one in the folder' },
  { id: 'hash', label: 'Files fingerprinted', wait: 'the SHA-256 of every file' },
  { id: 'sign', label: 'Records signed', wait: 'one per file, linked in order' },
  { id: 'audit', label: 'Checked', wait: 'the new ledger, audited at once' },
]

function progressView(box, { verb, root, steps, onCancel }) {
  box.innerHTML = `<div class="prog">
<div class="prog-head">
<svg class="ring" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><circle class="ring-bg" cx="24" cy="24" r="20"/><circle class="ring-fg" cx="24" cy="24" r="20"/></svg>
<div><h1 tabindex="-1">${esc(verb)} <span class="mono" data-p="root">${esc(root || 'the folder')}</span></h1><p>Files and bytes checked, live. Nothing is written to the folder.</p></div>
<button class="btn btn-ghost btn-s" type="button" data-p="cancel">Cancel</button>
</div>
<ol class="checks">${steps.map((s) => `<li class="wait" data-s="${s.id}">${CI}<span><b>${esc(s.label)}</b> <span data-t>${esc(s.wait)}</span></span></li>`).join('')}</ol>
<div class="meter" role="progressbar" aria-label="Checked so far" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="Starting"><span></span></div>
<div class="meter-meta"><span data-p="files"><b>0</b> files</span><span data-p="bytes"><b>0 B</b></span></div>
<dl class="prog-stats"><div><dt>Elapsed</dt><dd data-p="elapsed">0.0 s</dd></div><div><dt>Time left</dt><dd data-p="left">…</dd></div><div><dt>Read rate</dt><dd data-p="rate">…</dd></div><div><dt>Ledger</dt><dd data-p="records">…</dd></div></dl>
<div class="nowfile" data-p="now" hidden><span class="label">Now reading</span><code data-p="now-path"></code><span class="nf-meta" data-p="now-meta"></span><div class="meter meter-thin" aria-hidden="true"><span></span></div></div>
<p class="prog-foot" data-p="foot">Reading runs in background workers, so the page stays responsive. Nothing is uploaded.</p>
</div>`
  const q = (k) => $(`[data-p="${k}"]`, box)
  q('cancel').addEventListener('click', onCancel)
  const ring = $('.ring', box), meter = $('.prog > .meter', box), nowMeter = $('.nowfile .meter', box)
  const order = steps.map((s) => s.id)
  let p = null, frame = 0, last = Date.now(), shown = -1
  const started = Date.now()
  const stepText = {}, fixed = new Set() // fixed: texts the run set itself (prog.text), never redrawn from older progress
  const auto = (step, t) => { if (!fixed.has(step)) stepText[step] = t }
  const draw = () => {
    frame = 0
    if (!p) return
    const now = Date.now()
    const at = order.indexOf(p.stage)
    if (p.stage === 'ledger' && p.ledgerTotal) auto('ledger', `${fmtN(p.ledgerDone)} of ${plural(p.ledgerTotal, 'record', 'records')}: signatures and links`)
    if (p.stage === 'hash') auto('hash', `${fmtN(p.files)} of ${plural(p.filesTotal, 'file', 'files')}, ${fmtB(p.bytes)} of ${fmtB(p.bytesTotal)}`)
    if (p.stage === 'list' && p.listed) auto('list', p.measured ? `${plural(p.listed, 'file', 'files')} found: sizes read for ${fmtN(p.measured)} of them` : `${plural(p.listed, 'file', 'files')} found so far`)
    if (p.ledgerProblems !== undefined && p.stage !== 'ledger') auto('ledger', p.ledgerProblems ? `${plural(p.records, 'record', 'records')}: ${plural(p.ledgerProblems, 'problem', 'problems')} found` : `${plural(p.records, 'record', 'records')}: every signature and link verified`)
    if ((p.stage === 'audit' || p.stage === 'sign') && p.filesTotal !== undefined) auto('hash', `${plural(p.filesTotal, 'file', 'files')}, ${fmtB(p.bytesTotal)} re-read`)
    $$('.checks li', box).forEach((li, i) => {
      li.className = i < at ? 'done' : i === at ? 'run' : 'wait'
      const t = stepText[li.dataset.s]
      if (t) $('[data-t]', li).textContent = t
    })
    // overall: a tenth for the ledger, the rest by bytes read
    let frac = 0
    if (p.stage === 'ledger') frac = p.ledgerTotal ? 0.1 * (p.ledgerDone / p.ledgerTotal) : 0
    else if (p.stage === 'hash') frac = 0.1 + 0.88 * (p.bytesTotal ? p.bytes / p.bytesTotal : p.filesTotal ? p.files / p.filesTotal : 1)
    else if (p.stage === 'sign' || p.stage === 'audit') frac = 0.98
    ring.style.setProperty('--p', String(Math.min(1, frac)))
    meter.style.setProperty('--p', String(Math.min(1, frac)))
    const pct = Math.round(frac * 100)
    if (pct !== shown) {
      shown = pct
      meter.setAttribute('aria-valuenow', String(pct))
      meter.setAttribute('aria-valuetext', p.stage === 'hash' ? `${fmtN(p.files)} of ${fmtN(p.filesTotal)} files, ${fmtB(p.bytes)} of ${fmtB(p.bytesTotal)} checked` : p.stage === 'ledger' ? 'Checking the ledger' : p.stage === 'list' ? 'Reading the folder' : 'Finishing')
    }
    if (p.filesTotal !== undefined) {
      q('files').innerHTML = `<b>${esc(fmtN(p.files || 0))}</b> / ${esc(plural(p.filesTotal, 'file', 'files'))}`
      q('bytes').innerHTML = `<b>${esc(fmtB(p.bytes || 0))}</b> / ${esc(fmtB(p.bytesTotal || 0))}`
    } else if (p.stage === 'list') {
      q('files').innerHTML = `<b>${esc(fmtN(p.listed || 0))}</b> files found`
    }
    q('elapsed').textContent = dur(now - started)
    if (p.stage === 'hash' && p.hashStarted && now - p.hashStarted > 800 && p.bytes > 0) {
      const rate = p.bytes / ((now - p.hashStarted) / 1000)
      q('rate').textContent = `${fmtB(rate)}/s`
      q('left').textContent = p.bytesTotal > p.bytes ? `about ${dur(((p.bytesTotal - p.bytes) / rate) * 1000)}` : 'a moment'
    } else if (p.stage === 'sign' || p.stage === 'audit') q('left').textContent = 'a moment'
    if (p.ledgerTotal !== undefined) q('records').textContent = p.stage === 'ledger' ? `${fmtN(p.ledgerDone)} / ${fmtN(p.ledgerTotal)}` : plural(p.records ?? p.ledgerTotal, 'record', 'records')
    const nowBox = q('now')
    if (p.stage === 'hash' && p.cur) {
      nowBox.hidden = false
      q('now-path').textContent = p.cur.path
      q('now-meta').textContent = p.cur.whole ? `${fmtB(p.cur.size)}, read at once` : `${fmtB(p.cur.size)} · slice ${fmtN(p.cur.k)} of ${fmtN(p.cur.n)} (8 MiB each)`
      nowMeter.style.setProperty('--p', String(p.cur.size ? p.cur.done / p.cur.size : 1))
    } else nowBox.hidden = true
    const foot = q('foot')
    const slow = now - last > 30000
    foot.classList.toggle('is-slow', slow)
    foot.textContent = slow ? `No progress for ${dur(now - last)}. The browser may be waiting for a slow or disconnected drive, or for a file another program holds open. You can cancel and try again.` : 'Reading runs in background workers, so the page stays responsive. Nothing is uploaded.'
  }
  const timer = setInterval(() => { if (!frame) frame = requestAnimationFrame(draw) }, 500)
  return {
    heading: $('h1', box),
    update(np) { p = np; last = Date.now(); if (!frame) frame = requestAnimationFrame(draw) },
    text(step, t) { stepText[step] = t; fixed.add(step); if (!frame) frame = requestAnimationFrame(draw) },
    setRoot(r) { q('root').textContent = r || 'the folder' },
    done() { clearInterval(timer); if (frame) cancelAnimationFrame(frame) },
  }
}

// ------------------------------------------------------------------------------------------------------- errors
function errorHTML(err, { actions = [] } = {}) {
  const title = err && err.title ? err.title : 'Something went wrong'
  const msg = err instanceof AppError ? err.message : `The app stopped with this message: ${(err && err.message) || String(err)} Nothing was uploaded or changed. Try again, or reload the page.`
  return `<div class="err"><h1 tabindex="-1">${ic('x')}${esc(title)}</h1><p>${esc(msg)}</p>${err && err.list && err.list.length ? `<ul class="err-list">${err.list.slice(0, 8).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}<div class="btn-row">${actions.join('')}</div></div>`
}
function showError(mode, err, actions) {
  const box = show(mode, 'error')
  const acts = actions || [`<button class="btn btn-primary" type="button" data-act="reset">${ic('folder')}${mode === 'seal' ? 'Seal another folder' : 'Audit another folder'}</button>`]
  if (err && err.action === 'audit' && mode === 'seal') acts.push(`<button class="btn btn-ghost" type="button" data-act="audit-this">${ic('arrow')}Audit this folder</button>`)
  box.innerHTML = errorHTML(err, { actions: acts })
  focusEl($('h1', box))
  announce(`${err && err.title ? err.title : 'Something went wrong'}. ${err && err.message ? err.message : ''}`)
}

// ---------------------------------------------------------------------------------------------- the expectations
function fieldError(input, msg) {
  const id = input.id + '-err'
  let p = document.getElementById(id)
  if (!msg) {
    input.removeAttribute('aria-invalid')
    if (p) p.remove()
    input.setAttribute('aria-describedby', input.getAttribute('aria-describedby').replace(` ${id}`, ''))
    return
  }
  if (!p) {
    p = document.createElement('p')
    p.className = 'field-error'
    p.id = id
    input.after(p)
    input.setAttribute('aria-describedby', `${input.getAttribute('aria-describedby')} ${id}`)
  }
  p.textContent = msg
  input.setAttribute('aria-invalid', 'true')
}
function readExpectations() {
  const hi = $('#audit-head'), ki = $('#audit-key')
  const head = hi.value.trim(), key = ki.value.trim().toLowerCase()
  let bad = null
  fieldError(hi, null)
  fieldError(ki, null)
  if (head) { try { IQC.parseHead(head) } catch { fieldError(hi, 'Write it as the record number, a colon and the 64-character link, for example 12:9a0ed7c9… (as iqc head prints it).'); bad = hi } }
  if (key && !/^[0-9a-f]{16}$/.test(key)) { fieldError(ki, 'A key id is 16 characters, 0 to 9 and a to f.'); bad = bad || ki }
  if (bad) {
    $('#audit-opts').open = true
    bad.focus()
    announce('Check the optional fields: one of them cannot be read.')
    return null
  }
  return { expectHead: head || undefined, expectKeyId: key || undefined }
}

// ----------------------------------------------------------------------------------------------- reading a folder
// source: {drop: {entries, loose}} or {input: FileList}
async function listingOf(source, { signal, prog, modified = false }) {
  const sizes = (l) => measure(l, { signal, modified, onProgress: (x) => prog.update({ stage: 'list', listed: x.total, measured: x.measured }) })
  if (source.input) return sizes(listInput(source.input, { max: MAX_FILES }))
  const listing = await listEntries(source.drop, { signal, max: MAX_FILES, onProgress: (x) => prog.update({ stage: 'list', listed: x.listed }) })
  await sizes(listing)
  if (listing.errors.length) {
    throw new AppError('Part of the folder could not be read', `The browser could not open ${plural(listing.errors.length, 'item', 'items')} in it, so their files would count as missing. Check that the folder is not on a disconnected drive and that you can open it, then try again; the agent reads it on the command line too.`, { code: 'list', list: listing.errors.map((e) => `${e.raw}: ${e.error}`) })
  }
  return listing
}
const rootLabel = (located) => located.root || (located.kind === 'ledger-only' ? located.ledger.raw : 'the dropped files')

// ---------------------------------------------------------------------------------------------------- the audit
async function startAudit(source) {
  const A = S.audit
  if (A.run) { announce('An audit is running. Cancel it first to audit another folder.'); return }
  const exp = readExpectations()
  if (!exp) return
  if (S.mode !== 'audit') { history.replaceState(null, '', '#audit'); setMode('audit') }
  const ctl = new AbortController()
  A.run = { ctl, pool: null }
  A.pending = null
  const box = show('audit', 'run')
  const prog = progressView(box, { verb: 'Auditing', root: source.name || '', steps: AUDIT_STEPS, onCancel: () => cancel('audit') })
  A.run.prog = prog
  prog.update({ stage: 'list', listed: 0 })
  focusEl(prog.heading)
  announce('Audit started: reading the folder.')
  try {
    const listing = await listingOf(source, { signal: ctl.signal, prog })
    const located = locate(listing)
    const total = listing.items.reduce((a, x) => a + (x.size || 0), 0)
    prog.text('list', `${plural(listing.items.length, 'file', 'files')}, ${fmtB(total)}`)
    if (located.kind === 'no-ledger') { A.pending = located; askLedger(located); return }
    await auditLocated(located, exp, prog, ctl)
  } catch (e) {
    finishRun('audit')
    if (e instanceof Canceled) return
    showError('audit', e)
  }
}

async function auditLocated(located, exp, prog, ctl, { chosen = false } = {}) {
  const A = S.audit
  prog.setRoot(rootLabel(located))
  const pool = new Pool(POOL())
  A.run.pool = pool
  try {
    const res = await runAudit(located, {
      ...exp, pool, signal: ctl.signal, chosen,
      onProgress: (p) => prog.update(p),
    })
    await yieldNow()
    finishRun('audit')
    A.last = res
    const box = show('audit', 'result')
    renderResult(box, res, { mode: 'audit', level: 'h1', exp })
    afterVerdict(box, res)
  } finally {
    pool.terminate()
  }
}

function askLedger(located) {
  finishRun('audit')
  const box = show('audit', 'ledger')
  const n = located.files.length
  $('[data-slot="ask-text"]', box).innerHTML = `There is no <code>ImmutableQC/ledger.jsonl</code> in <b>${esc(located.root || 'the dropped files')}</b> (${esc(plural(n, 'file', 'files'))}), at the top or one folder down. If the ledger is kept somewhere else, choose it: the audit starts at once, with this folder’s files.`
  $('[data-slot="ask-error"]', box).innerHTML = ''
  focusEl($('h1', box))
  announce('No ledger was found in the folder. Choose the ledger file to continue.')
}

async function chosenLedger(file) {
  const A = S.audit
  const pending = A.pending
  if (!pending || !file) return
  const exp = readExpectations()
  if (!exp) return
  const ctl = new AbortController()
  A.run = { ctl, pool: null }
  const box = show('audit', 'run')
  const prog = progressView(box, { verb: 'Auditing', root: pending.root || '', steps: AUDIT_STEPS, onCancel: () => cancel('audit') })
  A.run.prog = prog
  prog.text('list', `${plural(pending.files.length, 'file', 'files')}, with the ledger ${file.name}`)
  prog.update({ stage: 'ledger', ledgerDone: 0, ledgerTotal: 0 })
  focusEl(prog.heading)
  try {
    await auditLocated({ kind: 'folder', root: pending.root, ledger: { raw: file.name, file }, files: pending.files }, exp, prog, ctl, { chosen: true })
    A.pending = null
  } catch (e) {
    finishRun('audit')
    if (e instanceof Canceled) { askLedger(pending); return }
    if (e instanceof AppError && e.code === 'not-ledger') {
      const ask = show('audit', 'ledger')
      $('[data-slot="ask-error"]', ask).innerHTML = `<p class="callout callout-fail">${ic('x')}<span><b>${esc(e.title)}.</b> ${esc(e.message)}</span></p>`
      focusEl($('h1', ask))
      announce(`${e.title}. ${e.message}`)
      return
    }
    showError('audit', e)
  }
}

function finishRun(mode) {
  const R = S[mode].run
  if (!R) return
  if (R.prog) R.prog.done()
  S[mode].run = null
}
function cancel(mode) {
  const R = S[mode].run
  if (!R) return
  R.ctl.abort()
  if (R.pool) R.pool.terminate()
  finishRun(mode)
  resetMode(mode)
  announce(mode === 'seal' ? 'Seal canceled. Nothing was written.' : 'Audit canceled.')
}
function resetMode(mode) {
  if (mode === 'demo') { startDemo(); return }
  if (mode === 'audit') S.audit.pending = null
  const box = show(mode, 'ready')
  focusEl($('h1', box))
}

function afterVerdict(box, res) {
  const v = $('.verdict', box)
  focusEl(v)
  const r = res.report
  announce(`Audit finished. ${r.verdict === 'pass' ? 'Pass' : r.verdict === 'review' ? 'Review' : 'Fail'}: ${headline(r)}`)
}

// --------------------------------------------------------------------------------------------- the result view
function headline(r) {
  const c = r.counts
  if (r.verdict === 'pass') {
    if (!r.filesChecked) return `Ledger intact: ${plural(c.records, 'record', 'records')}, every signature and link verified. The files were not checked.`
    if (c.sealed === 0) return 'Ledger intact. It seals no files yet.'
    if (c.match === 0 && c.notChecked === 0) return 'Ledger intact. Every sealed file is recorded as removed.'
    if (c.notChecked) return `${fmtN(c.match)} of ${fmtN(c.match + c.notChecked)} sealed files match their seals; ${fmtN(c.notChecked)} could not be read. Ledger intact.`
    if (c.match === 1) return '1 file matches its seal. Ledger intact.'
    return `All ${fmtN(c.match)} files match their seals. Ledger intact.`
  }
  return cap(String(r.summary).replace(/^(?:Review|Fail): /, ''))
}

// a review: recorded changes (a file sealed again, a recorded removal), not failures, each one listed
function reviewPanel(id, r) {
  const groups = r.forReview || []
  if (!groups.length) return ''
  return `<section class="panel" aria-labelledby="${id}-rev-h"><h2 id="${id}-rev-h">For review <span class="label">${esc(fmtN(groups.length))} · recorded, not failures</span></h2><ul class="notes">${groups.map((n) => `<li><span class="tag tag-note">${ic('note')}Review</span><div><p>${esc(n.message)}</p>${noteItems(n)}</div></li>`).join('')}</ul></section>`
}

const NOTE_SHORT = {
  'sealed-more-than-once': (n) => `${plural(n, 'file', 'files')} sealed more than once`,
  unwatched: (n) => `${plural(n, 'change', 'changes')} found by a later scan`,
  'not-sealed': (n) => `${plural(n, 'file', 'files')} never sealed`,
  'back-after-removal': (n) => `${plural(n, 'file', 'files')} back after removal`,
  'not-checked': (n) => `${plural(n, 'file', 'files')} not readable`,
  'unclean-stop': (n) => `${plural(n, 'session', 'sessions')} without a clean stop`,
  gaps: (n) => `${plural(n, 'gap', 'gaps')} between sessions`,
}

// one entry per file of the report, with what the list needs: group (0 problem, 1 note, 2 the rest), why, search text
const readError = (e) => {
  const s = String(e || '')
  if (/^NotReadableError/.test(s)) return 'the browser could not read it (open in another program, moved, or on a drive that went away)'
  if (/^NotFoundError/.test(s)) return 'it was moved or deleted after the folder was listed'
  if (/^(?:SecurityError|NotAllowedError)/.test(s)) return 'the browser blocked access to it'
  return s
}
function rowsOf(res) {
  const vf = res.verified.files
  const unread = new Map(res.unreadable.map((u) => [u.path, readError(u.error)]))
  return res.report.files.map((f, i) => {
    const e = vf.get(f.path)
    const versions = e ? e.versions : []
    const unwatched = versions.some((v) => v.event.endsWith('-unwatched'))
    const problem = f.state === 'changed' || f.state === 'missing'
    const stateNote = f.state === 'not sealed' || f.state === 'back after removal' || f.state === 'not checked'
    const note = !problem && (stateNote || f.versions > 1 || unwatched)
    const hay = `${nameOf(f.path)} ${f.path} ${f.sealed ? f.sealed.sha256 : ''} ${f.present ? f.present.sha256 : ''}`.toLowerCase()
    return { f, i, group: problem ? 0 : note ? 1 : 2, problem, note, unwatched, unread: unread.get(f.path), hay }
  }).sort((a, b) => a.group - b.group || a.i - b.i)
}

function whyOf(row) {
  const f = row.f, out = []
  if (f.state === 'changed') out.push(f.matchesN ? `matches the earlier version sealed in record ${f.matchesN}` : `different bytes from record ${f.sealed ? f.sealed.n : f.latest.n}`)
  else if (f.state === 'missing') out.push(`sealed in record ${f.latest.n}, not in the folder`)
  else if (f.state === 'not sealed') out.push('in the folder, never sealed')
  else if (f.state === 'back after removal') out.push(`removed in record ${f.latest.n}, present again`)
  else if (f.state === 'not checked') out.push(row.unread ? `could not be read: ${row.unread}` : 'not checked')
  else if (f.state === 'removed') out.push(`removal recorded in record ${f.latest.n}`)
  if (f.versions > 1) out.push(`sealed ${f.versions} times (records ${f.records.join(', ')})`)
  if (row.unwatched) out.push('a change found by a later scan')
  return out.join(' · ')
}

function rowHTML(row) {
  const f = row.f
  const size = f.present ? f.present.bytes : f.sealed ? f.sealed.bytes : null
  let sha = '<span class="faint">none</span>'
  if (f.state === 'changed' && f.present) sha = `${shortHash(f.present.sha256, 'hash-changed')}<span class="vh"> now; sealed </span>`
  else if (f.present) sha = shortHash(f.present.sha256)
  else if (f.sealed) sha = shortHash(f.sealed.sha256)
  const why = whyOf(row)
  const cls = row.problem ? 'is-problem' : row.note ? 'is-note' : ''
  return `<tr${cls ? ` class="${cls}"` : ''}><td class="c-state" data-label="State">${tag(f.state)}</td><td class="c-path" data-label="Path"><code>${esc(nameOf(f.path))}</code>${why ? `<span class="why${row.problem ? ' bad' : row.note ? '' : ' faint'}">${esc(why)}</span>` : ''}</td><td class="num" data-label="Size">${size !== null ? esc(fmtB(size)) : '<span class="faint">none</span>'}</td><td class="c-sha" data-label="SHA-256"><span class="lbl" aria-hidden="true">SHA-256</span>${sha}</td><td class="num" data-label="Versions"><span class="lbl" aria-hidden="true">Versions</span>${esc(f.versions)}</td></tr>`
}

const PAGE = 100
function filesPanel(id, rows, { title = 'Files', sub } = {}) {
  const probs = rows.filter((r) => r.problem).length, notes = rows.filter((r) => r.note).length
  return `<section class="panel files" aria-labelledby="${id}-files-h" data-files>
<div class="files-h"><h2 id="${id}-files-h">${esc(title)} <span class="label">${esc(sub || `${plural(rows.length, 'path', 'paths')} · problems first`)}</span></h2></div>
<div class="files-tools">
<div class="filters" role="group" aria-label="Show">
<button class="filter" type="button" aria-pressed="true" data-filter="all">All <span class="n">${esc(fmtN(rows.length))}</span></button>
<button class="filter" type="button" aria-pressed="false" data-filter="problems">Problems <span class="n">${esc(fmtN(probs))}</span></button>
<button class="filter" type="button" aria-pressed="false" data-filter="notes">Notes <span class="n">${esc(fmtN(notes))}</span></button>
</div>
<label class="search">${ic('search')}<span class="vh">Search files by path or SHA-256</span><input type="search" placeholder="Path or fingerprint" autocomplete="off" spellcheck="false" data-search></label>
</div>
<table class="table ftable"><caption class="vh">${esc(title)}: state, path, size, SHA-256 and number of sealed versions</caption>
<thead><tr><th scope="col">State</th><th scope="col">Path</th><th scope="col" class="num">Size</th><th scope="col">SHA-256</th><th scope="col" class="num">Versions</th></tr></thead>
<tbody data-rows></tbody></table>
<div class="pager"><p data-pageinfo></p><div class="btn-row"><button class="btn btn-ghost btn-s" type="button" data-page="-1">Previous</button><button class="btn btn-ghost btn-s" type="button" data-page="1">Next</button></div></div>
</section>`
}
function bindFiles(panel, rows) {
  const st = { filter: 'all', q: '', page: 0, list: rows }
  const tbody = $('[data-rows]', panel), info = $('[data-pageinfo]', panel), prev = $('[data-page="-1"]', panel), next = $('[data-page="1"]', panel), input = $('[data-search]', panel)
  const apply = () => {
    const q = st.q
    st.list = rows.filter((r) => (st.filter === 'all' || (st.filter === 'problems' ? r.problem : r.note)) && (!q || r.hay.includes(q)))
    st.page = 0
    draw()
  }
  const draw = () => {
    const n = st.list.length, pages = Math.max(1, Math.ceil(n / PAGE))
    st.page = Math.min(st.page, pages - 1)
    const a = st.page * PAGE, slice = st.list.slice(a, a + PAGE)
    tbody.innerHTML = slice.length ? slice.map(rowHTML).join('') : `<tr class="empty-row"><td colspan="5">${esc(st.q ? `No file matches “${input.value.trim()}”.` : st.filter === 'problems' ? 'No problems.' : st.filter === 'notes' ? 'No notes.' : 'No files.')}</td></tr>`
    info.textContent = n ? `${fmtN(a + 1)}–${fmtN(a + slice.length)} of ${plural(n, 'path', 'paths')}` : 'No path to show'
    prev.disabled = st.page === 0
    next.disabled = st.page >= pages - 1
    $('.pager .btn-row', panel).hidden = pages < 2
  }
  panel.addEventListener('click', (e) => {
    const f = e.target.closest('[data-filter]')
    if (f) {
      st.filter = f.dataset.filter
      for (const b of $$('[data-filter]', panel)) b.setAttribute('aria-pressed', String(b === f))
      apply()
      announce(`${info.textContent}.`)
      return
    }
    const pg = e.target.closest('[data-page]')
    if (pg && !pg.disabled) {
      st.page += Number(pg.dataset.page)
      draw()
      announce(`${info.textContent}.`)
      if (pg.disabled) (pg.dataset.page === '1' ? prev : next).focus()
    }
  })
  let t = 0
  input.addEventListener('input', () => {
    clearTimeout(t)
    t = setTimeout(() => { st.q = input.value.trim().toLowerCase(); apply(); announce(`${info.textContent}.`) }, 160)
  })
  draw()
}

function problemsPanel(id, res, rowsByPath) {
  const r = res.report
  const probs = r.problems
  if (!probs.length) {
    return `<section class="panel" aria-labelledby="${id}-prob-h"><h2 id="${id}-prob-h">Problems</h2><p class="none">${ic('check')}<span>None: every signature, link${r.filesChecked ? ' and file' : ''} checks out.</span></p></section>`
  }
  const MAX = 50
  const li = probs.slice(0, MAX).map((p) => {
    if (p.code === 'changed' || p.code === 'missing') {
      const f = rowsByPath.get(p.path)
      if (!f) return `<li><p>${esc(p.message)}</p></li>`
      const s = f.sealed
      if (p.code === 'missing') {
        return `<li><div class="pr-h">${tag('missing')}<code>${esc(nameOf(f.path))}</code></div><p>Sealed in record ${esc(f.latest.n)}${s ? ` (${esc(when(s.observedAt))})` : ''}. It is not in the folder, and no removal was recorded.</p>${s ? `<dl class="cmp"><div><dt>Sealed</dt><dd>${hashHTML(s.sha256, 'hash-sealed')}</dd></div><div><dt>Size</dt><dd class="finding">${esc(fmtN(Number(s.bytes)))} bytes</dd></div></dl>` : ''}</li>`
      }
      const sb = Number(s.bytes), nb = Number(f.present.bytes)
      const size = sb === nb ? `${fmtN(nb)} bytes, the same size as sealed: only the content differs.` : `${fmtN(nb)} bytes instead of ${fmtN(sb)}.`
      return `<li><div class="pr-h">${tag('changed')}<code>${esc(nameOf(f.path))}</code></div><p>Different bytes from the version sealed in record ${esc(s.n)} (${esc(when(s.observedAt))}).${f.matchesN ? ` They match the version sealed in record ${esc(f.matchesN)}, not the latest one: an older copy is back, as after a restored backup.` : ''}</p><dl class="cmp"><div><dt>Sealed</dt><dd>${hashHTML(s.sha256, 'hash-sealed')}</dd></div><div><dt>Now</dt><dd>${hashHTML(f.present.sha256, 'hash-changed')}</dd></div><div><dt>Size</dt><dd class="finding">${esc(size)}</dd></div></dl></li>`
    }
    if (p.code === 'expect-head' || p.code === 'expect-key') {
      return `<li><div class="pr-h"><span class="tag tag-fail">${ic('x')}${p.code === 'expect-head' ? 'Pinned head' : 'Key id'}</span></div><p>${esc(p.message)}</p></li>`
    }
    const m = /^Line (\d+)(?: \((header|record \d+)\))?: (.*)$/.exec(p.message)
    return `<li><div class="pr-h"><span class="tag tag-fail">${ic('x')}Ledger</span><span class="pr-what">${m ? `Line ${esc(m[1])}${m[2] ? ` (${esc(m[2])})` : ''}` : 'The ledger'}</span></div><p>${esc(m ? cap(m[3]) : p.message)}</p></li>`
  }).join('')
  const broken = r.ledger.firstProblemLine
  return `<section class="panel" aria-labelledby="${id}-prob-h"><h2 id="${id}-prob-h">Problems <span class="label">${esc(fmtN(probs.length))} · each one fails the audit</span></h2>
${broken ? `<p class="finding">The ledger breaks at line ${esc(broken)}: files are checked against the ${esc(plural(r.ledger.goodRecords, 'record', 'records'))} before it, and nothing after it is trusted.</p>` : ''}
<ul class="probs">${li}</ul>${probs.length > MAX ? `<p class="more-note">And ${esc(fmtN(probs.length - MAX))} more: every problem is in the file list (Problems) and in the report.</p>` : ''}</section>`
}

function noteItems(n) {
  const items = n.items || []
  if (!items.length) return ''
  const first = items.slice(0, 3), rest = items.slice(3, 200)
  return `<ul class="note-items">${first.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${rest.length ? `<details class="note-more"><summary>${esc(`${fmtN(items.length - 3)} more`)}</summary><ul class="note-items">${rest.map((x) => `<li>${esc(x)}</li>`).join('')}${items.length > 200 ? `<li>${esc(`and ${fmtN(items.length - 200)} more, in the report`)}</li>` : ''}</ul></details>` : ''}`
}
function notesList(notes) {
  return `<ul class="notes">${notes.map((n) => `<li><span class="tag tag-note">${ic('note')}Note</span><div><p>${esc(n.message)}</p>${noteItems(n)}</div></li>`).join('')}</ul>`
}
function notesPanel(id, r) {
  const notes = r.notes
  if (r.verdict === 'fail' && notes.length) {
    const short = notes.map((n) => (NOTE_SHORT[n.code] ? NOTE_SHORT[n.code](n.count) : n.message)).join(', ')
    return `<div class="notes-line">${ic('note')}<span><b>${esc(plural(notes.length, 'note', 'notes'))} (not failures):</b> ${esc(short)}.</span></div>
<details class="fold notes-fold"><summary>Show the notes</summary><div class="fold-body">${notesList(notes)}</div></details>`
  }
  return `<section class="panel" aria-labelledby="${id}-notes-h"><h2 id="${id}-notes-h">Notes <span class="label">${notes.length ? `${esc(fmtN(notes.length))} · not failures` : 'not failures'}</span></h2>${notes.length ? notesList(notes) : `<p class="none">${ic('check')}<span>None.</span></p>`}</section>`
}

function timelinePanel(id, res) {
  const ss = res.verified.sessions || []
  const head = `<section class="panel" aria-labelledby="${id}-tl-h"><h2 id="${id}-tl-h">Watch sessions <span class="label">${esc(fmtN(ss.filter((s) => !s.stray).length))}</span></h2>`
  if (!ss.length) return `${head}<p class="finding">No watch session or scan is recorded in this ledger.</p></section>`
  const t = (s) => Date.parse(s)
  let t0 = Infinity, t1 = -Infinity
  for (const s of ss) {
    for (const x of [s.start, s.stop, s.lastAt]) if (x && Number.isFinite(t(x))) { t0 = Math.min(t0, t(x)); t1 = Math.max(t1, t(x)) }
  }
  const span = Math.max(1, t1 - t0)
  const kinds = new Set()
  const segs = ss.map((s, i) => {
    const a = t(s.start || s.lastAt), b = t(s.type === 'watch' && s.stop ? s.stop : s.lastAt)
    const kind = s.type === 'scan' ? 'scan' : s.open ? 'open' : s.clean ? 'clean' : 'unclean'
    kinds.add(kind)
    return { i, kind, x: ((a - t0) / span) * 100, w: Math.max(0, ((b - a) / span) * 100) }
  })
  const gaps = res.verified.gaps || []
  const label = { clean: 'Watch, stopped cleanly', unclean: 'Watch, no clean stop', open: 'Watch, still running or stopped without a record', scan: 'One scan (a seal)' }
  const legend = ['clean', 'unclean', 'open', 'scan'].filter((k) => kinds.has(k)).map((k) => `<li><span class="key k-${k}"></span>${esc(label[k])}</li>`)
  if (gaps.length) legend.push(`<li><span class="key k-gap"></span>${esc(`Gap: nothing watching (${fmtN(gaps.length)})`)}</li>`)
  const describe = (s) => {
    if (s.type === 'scan') return `Scan · ${dayTime(s.start)} UTC · ${plural(s.files, 'file', 'files')} sealed`
    const end = s.stop ? `${dayTime(s.stop)} UTC` : s.open ? 'no stop recorded yet' : `no stop record (next start: record ${s.endedByN})`
    const how = s.open ? 'still running, or stopped without a record' : s.clean ? 'stopped cleanly' : 'did not stop cleanly'
    return `Watch · ${s.start ? `${dayTime(s.start)} UTC` : 'no start record'} to ${end} · ${how} · ${plural(s.files, 'file', 'files')} sealed`
  }
  const MAX = 8
  const track = span >= 60000 ? `<div class="tl" aria-hidden="true"><div class="tl-track">${segs.map((g) => `<span class="tl-seg tl-${g.kind}" data-x="${g.x.toFixed(3)}" data-w="${g.w.toFixed(3)}"></span>`).join('')}</div>
<div class="tl-axis"><span>${esc(day(new Date(t0).toISOString()))}</span><span>${esc(day(new Date(t1).toISOString()))}</span></div></div><ul class="tl-legend" aria-hidden="true">${legend.join('')}</ul>` : ''
  return `${head}${track}
<ul class="sessions">${ss.slice(0, MAX).map((s, i) => `<li><span class="key k-${segs[i].kind}" aria-hidden="true"></span><span>${esc(describe(s))}</span></li>`).join('')}${ss.length > MAX ? `<li><span></span><span class="faint">${esc(`and ${fmtN(ss.length - MAX)} more sessions, in the report`)}</span></li>` : ''}</ul>
${gaps.length ? `<p class="kv-note">${esc(`${plural(gaps.length, 'gap', 'gaps')} between sessions: changes made then are sealed later, as -unwatched, with an unknown time.`)}</p>` : ''}</section>`
}

function ledgerPanel(id, res, { seal = false } = {}) {
  const r = res.report, L = r.ledger
  const sigBad = r.problems.filter((p) => /^(?:sig|sig-error|header-sig|sig-high-s|sig-form)$/.test(p.code)).length
  const ex = r.expectations || {}
  const agent = L.ctx && typeof L.ctx.agent === 'string' ? L.ctx.agent : null
  const row = (k, v, cls = '') => `<div><dt>${esc(k)}</dt><dd${cls ? ` class="${cls}"` : ''}>${v}</dd></div>`
  const copyBtn = (text, what) => `<button class="icon-btn" type="button" data-copy="${esc(text)}">${ic('copy')}<span class="vh">Copy the ${esc(what)}</span></button>`
  const rows = []
  rows.push(row('Station', esc(L.station || 'unknown')))
  if (!seal) rows.push(row('State', L.intact ? `<span class="tag tag-pass">${ic('check')}Intact</span>` : `<span class="tag tag-fail">${ic('x')}Breaks at line ${esc(L.firstProblemLine)}</span>`))
  if (L.keyId) rows.push(row('Key id', `${hashHTML(L.keyId)}${copyBtn(L.keyId, 'key id')}`, 'kv-copy'))
  rows.push(row('Records', esc(`${fmtN(L.records)}${L.firstProblemLine ? ` (${fmtN(L.goodRecords)} before the first problem)` : ''}`)))
  if (L.head) rows.push(row(L.intact ? 'Head' : 'Head (last good record)', `${headHTML(L.head)}${copyBtn(headText(L.head), 'head')}`, 'kv-copy'))
  if (L.createdAt) rows.push(row('Created', esc(when(L.createdAt))))
  rows.push(row('Signatures', esc(`ECDSA P-256 with SHA-256 · ${sigBad ? `${fmtN(sigBad)} could not be verified` : 'every one verified'}`)))
  if (L.ledgerId) rows.push(row('Ledger id', hashHTML(L.ledgerId)))
  if (agent) rows.push(row('Agent', `${esc(agent)} <span class="faint">(not sealed)</span>`))
  if (!seal) {
    rows.push(row('Pinned head', ex.head ? `<span class="tag ${ex.head.ok ? 'tag-pass' : 'tag-fail'}">${ic(ex.head.ok ? 'check' : 'x')}${ex.head.ok ? 'Matches' : 'Does not match'}</span> <span class="kv-note">${esc(ex.head.message)}</span>` : '<span class="kv-note">None given. Pin one with <code>iqc head</code> to catch a rewrite by the key holder.</span>'))
    if (ex.keyId) rows.push(row('Expected key id', `<span class="tag ${ex.keyId.ok ? 'tag-pass' : 'tag-fail'}">${ic(ex.keyId.ok ? 'check' : 'x')}${ex.keyId.ok ? 'Matches' : 'Does not match'}</span>`))
  } else if (res.key) {
    rows.push(row('Key', `<span class="kv-note">${res.key.demo ? 'Made for this demo, in memory; it is gone when the tab closes.' : res.key.stored ? 'Kept in this browser (IndexedDB), and it cannot be exported.' : 'Kept in this tab only: this browser could not store it.'}</span>`))
  }
  return `<section class="panel" aria-labelledby="${id}-led-h"><h2 id="${id}-led-h">Ledger</h2><dl class="kv">${rows.join('')}</dl></section>`
}

function rerunPanel(id, res, exp) {
  const r = res.report, L = r.ledger
  const folder = res.located && res.located.root ? `"${res.located.root}"` : '"<data folder>"'
  let cmd = `node iqc.mjs audit ${folder}`
  if (exp && exp.expectHead) cmd += ` --expect-head ${exp.expectHead}`
  else if (L.intact && L.head && L.head.n > 0) cmd += ` --expect-head ${headText(L.head)}`
  if (exp && exp.expectKeyId) cmd += ` --expect-key ${exp.expectKeyId}`
  cmd += ' --json audit.json'
  return `<section class="panel rerun" aria-labelledby="${id}-rr-h"><h2 id="${id}-rr-h">Re-run on the command line</h2>
<div class="cmd"><div class="cmd-h"><span class="label">With the agent</span><button class="copy" type="button" data-copy="${esc(cmd)}">${ic('copy')}Copy<span class="vh"> the command</span></button></div><pre tabindex="0" aria-label="Command"><code>${esc(cmd)}</code></pre></div>
<p class="hint">Exit 0 pass, 1 fail, 2 usage or read error. The same checks, with the same code (<a href="../core/immutableqc.mjs">core/immutableqc.mjs</a>).</p>
<p class="side-links"><a href="../sealed.html">What a seal covers</a><a href="../index.html#install">Get the agent</a></p></section>`
}

function statsHTML(r, rows) {
  const c = r.counts
  const notes = rows.filter((x) => x.note).length
  const tile = (n, label, kind, icon) => `<li class="stat stat-${kind}">${ic(icon)}<b class="stat-n">${esc(fmtN(n))}</b><span class="stat-l">${esc(label)}</span></li>`
  const t = []
  if (r.filesChecked) t.push(tile(c.match, 'Match', c.match ? 'ok' : 'zero', 'check'))
  else t.push(tile(c.notChecked, 'Not checked', 'zero', 'unchecked'))
  t.push(tile(c.changed, 'Changed', c.changed ? 'bad' : 'zero', c.changed ? 'x' : 'removed'))
  t.push(tile(c.missing, 'Missing', c.missing ? 'bad' : 'zero', c.missing ? 'missing' : 'removed'))
  if (c.ledgerProblems) t.push(tile(c.ledgerProblems, c.ledgerProblems === 1 ? 'Ledger problem' : 'Ledger problems', 'bad', 'x'))
  t.push(tile(notes, notes === 1 ? 'File with notes' : 'Files with notes', notes ? 'note' : 'zero', 'note'))
  return `<ul class="stats" aria-label="Counts">${t.join('')}</ul>`
}

function placeTimeline(box) {
  for (const s of $$('.tl-seg', box)) { s.style.setProperty('--x', s.dataset.x); s.style.setProperty('--w', s.dataset.w) }
}

let uid = 0
function renderResult(box, res, { mode, level = 'h1', demo = false, exp = null } = {}) {
  const r = res.report, pass = r.verdict === 'pass', review = r.verdict === 'review'
  const id = `r${++uid}`
  const rows = rowsOf(res)
  const byPath = new Map(r.files.map((f) => [f.path, f]))
  const H = level
  const L = r.ledger
  const metaLedger = pass ? '' : L.intact ? 'The ledger itself is intact: every signature and link checks out.' : `The ledger has ${plural(r.counts.ledgerProblems, 'problem', 'problems')}, from line ${L.firstProblemLine}.`
  const where = `${res.located && res.located.root ? `${res.located.root} · ` : ''}Audited in this browser · ${when(r.method.auditedAt)}${r.filesChecked ? ` · ${fmtB(res.bytes)} re-read in ${dur(res.ms)}` : ''}`
  const primary = pass && !demo
  const notices = []
  if (res.located && res.located.kind === 'ledger-only') notices.push(`<p class="callout callout-note">${ic('note')}<span>${res.located.why === 'ledger-folder' ? 'This is the ledger’s own ImmutableQC folder, so only the ledger was checked. Drop the data folder that holds it to re-read every file too.' : 'Only the ledger was checked. Drop the data folder that holds it to re-read every file too.'}</span></p>`)
  if (res.located && res.located.parent) notices.push(`<p class="callout">${ic('folder')}<span>${esc(`The ledger was found one folder down: ${res.located.root}/ImmutableQC/ledger.jsonl, so ${res.located.root} was audited.`)}</span></p>`)
  if (res.unreadable && res.unreadable.length) notices.push(`<div class="callout callout-note">${ic('note')}<div><p>${esc(`${plural(res.unreadable.length, 'file', 'files')} could not be read, so ${res.unreadable.length === 1 ? 'it was' : 'they were'} not checked:`)}</p><ul class="note-items">${res.unreadable.slice(0, 5).map((u) => `<li>${esc(`${nameOf(u.path)}: ${readError(u.error)}`)}</li>`).join('')}${res.unreadable.length > 5 ? `<li>${esc(`and ${fmtN(res.unreadable.length - 5)} more (Notes, in the file list)`)}</li>` : ''}</ul></div></div>`)
  if (res.skipped && res.skipped.length) notices.push(`<div class="callout callout-note">${ic('note')}<div><p>${esc(`${plural(res.skipped.length, 'file was', 'files were')} left out:`)}</p><ul class="note-items">${res.skipped.slice(0, 5).map((u) => `<li>${esc(`${u.raw}: ${u.why}`)}</li>`).join('')}</ul></div></div>`)
  const head = L.head && L.head.n > 0 ? L.head : null
  box.innerHTML = `<div class="result" data-verdict="${r.verdict}">
<div class="verdict ${pass ? 'verdict-pass' : review ? 'verdict-review' : 'verdict-fail'}" tabindex="-1" role="group" aria-labelledby="${id}-vh">
<div class="verdict-ic" aria-hidden="true"><svg viewBox="0 0 64 64" focusable="false"><circle class="v-ring" cx="32" cy="32" r="28"/>${pass ? '<path class="v-mark" d="M20 33l8 8 16-17"/>' : review ? '<path class="v-mark" d="M32 19v17M32 44v1"/>' : '<path class="v-mark" d="M23 23l18 18M41 23L23 41"/>'}</svg></div>
<div class="verdict-text">
<span class="tag tag-l ${pass ? 'tag-pass' : review ? 'tag-note' : 'tag-fail'}">${ic(pass ? 'check' : review ? 'note' : 'x')}${pass ? 'Pass' : review ? 'Review' : 'Fail'}</span>
<${H} id="${id}-vh">${esc(headline(r))}</${H}>
${metaLedger ? `<p class="verdict-meta">${esc(metaLedger)}</p>` : ''}<p class="verdict-meta">${esc(where)}</p>
${pass && r.filesChecked ? '<p class="v-why">Each file is byte for byte the one that was sealed, and the ledger was not edited, reordered or cut since it was signed. It does not show a file was right when it was written. <a href="../sealed.html">What a seal covers</a></p>' : ''}
</div>
<div class="verdict-actions">
${demo && pass ? `<button class="btn btn-primary btn-s" type="button" data-act="demo-edit">${ic('edit')}Change one value</button>` : ''}
<button class="btn ${primary ? 'btn-primary' : 'btn-ghost'} btn-s" type="button" data-act="report-html">${ic('down')}Download report (HTML)</button>
<button class="btn btn-ghost btn-s" type="button" data-act="report-json">${ic('down')}Download report (JSON)</button>
</div>
</div>
${statsHTML(r, rows)}
${pass || review ? '' : `<p class="callout callout-fail fail-note">${ic('note')}<span>A fail is a finding, not a verdict on anyone: compare the changed files with your backups, and keep the report with the run.</span></p>`}
${notices.join('\n')}
<div class="cols">
<div class="col-main">
${problemsPanel(id, res, byPath)}
${reviewPanel(id, r)}
${notesPanel(id, r)}
${timelinePanel(id, res)}
${demo ? '' : rerunPanel(id, res, exp)}
</div>
<div class="col-side">
${ledgerPanel(id, res)}
</div>
</div>
${filesPanel(id, rows)}
<div class="end-row">
${demo ? `<button class="btn btn-ghost" type="button" data-act="demo-restart">${ic('redo')}Start over</button>` : `<button class="btn btn-ghost" type="button" data-act="reset">${ic('folder')}Audit another folder</button>`}
${head ? `<button class="chip-copy" type="button" data-copy="${esc(headText(head))}">${ic('copy')}<span><span class="vh">Copy the </span>Head ${esc(head.n)}:${esc(head.h.slice(0, 8))}…</span></button>` : ''}
${L.keyId ? `<button class="chip-copy" type="button" data-copy="${esc(L.keyId)}">${ic('copy')}<span><span class="vh">Copy the </span>Key id ${esc(L.keyId)}</span></button>` : ''}
</div>
</div>`
  placeTimeline(box)
  bindFiles($('[data-files]', box), rows)
  box.dataset.mode = mode
  box._res = res
}

// ------------------------------------------------------------------------------------------------- downloads, copy
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.hidden = true
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
function reportName(res, ext) {
  const r = res.report
  const date = (r.method.auditedAt || new Date().toISOString()).slice(0, 10)
  return `immutableqc-audit-${slug((res.located && res.located.root) || r.ledger.station)}-${date}-${r.verdict}.${ext}`
}
async function copyText(btn) {
  const text = btn.dataset.copy
  let ok = false
  try { await navigator.clipboard.writeText(text); ok = true } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.className = 'vh'
    document.body.append(ta)
    ta.select()
    try { ok = document.execCommand('copy') } catch { ok = false }
    ta.remove()
  }
  if (ok) {
    btn.setAttribute('data-copied', '')
    announce('Copied.')
    setTimeout(() => btn.removeAttribute('data-copied'), 1600)
  } else announce(`Copying is blocked here. Select it by hand: ${text}`)
}

// --------------------------------------------------------------------------------------------------------- the seal
async function startSeal(source) {
  const Z = S.seal
  if (Z.run) { announce('A seal is running. Cancel it first.'); return }
  const si = $('#seal-station')
  const station = si.value.trim() || 'Browser'
  fieldError(si, null)
  if (!IQC.isSealedText(station) || [...station].length > 64) {
    $('#seal-opts').open = true
    fieldError(si, 'Use 1 to 64 characters, with no "|".')
    si.focus()
    return
  }
  if (S.mode !== 'seal') { history.replaceState(null, '', '#seal'); setMode('seal') }
  const ctl = new AbortController()
  Z.run = { ctl, pool: null }
  const box = show('seal', 'run')
  const prog = progressView(box, { verb: 'Sealing', root: source.name || '', steps: SEAL_STEPS, onCancel: () => cancel('seal') })
  Z.run.prog = prog
  prog.update({ stage: 'list', listed: 0 })
  focusEl(prog.heading)
  announce('Seal started: reading the folder.')
  const pool = new Pool(POOL())
  Z.run.pool = pool
  try {
    const listing = await listingOf(source, { signal: ctl.signal, prog, modified: true })
    const located = locate(listing)
    prog.setRoot(rootLabel(located))
    prog.text('list', plural(listing.items.length, 'file', 'files'))
    const res = await runSeal(located, {
      station, pool, keys: S.keys, signal: ctl.signal,
      onProgress: (p) => {
        if (p.stage === 'hash' && located.kind !== 'folder') { delete p.ledgerProblems; prog.text('ledger', 'a new one, signed with this browser’s key') }
        prog.update(p)
      },
    })
    finishRun('seal')
    res.located = located
    Z.last = res
    const out = show('seal', 'result')
    renderSeal(out, res)
    focusEl($('.verdict', out))
    announce(`Seal finished: ${$('.verdict h1', out).textContent}`)
  } catch (e) {
    finishRun('seal')
    if (e instanceof Canceled) return
    S.seal.failedSource = source
    showError('seal', e)
  } finally {
    pool.terminate()
  }
}

function renderSeal(box, res) {
  const id = `s${++uid}`
  const c = res.counts, n = c.new + c.changed + c.removed
  const root = res.located.root || 'your data folder'
  const files = res.report.counts.match
  let h
  if (!res.appended) h = `${plural(files, 'file', 'files')} sealed. Your ledger is ready.`
  else if (n) h = `${plural(n, 'change', 'changes')} sealed and added to the ledger.`
  else h = `Nothing new to seal: ${plural(files, 'file', 'files')} unchanged.`
  const head = res.verified.head
  const keyNote = res.key.created && res.key.stored ? `<p class="callout callout-pass">${ic('lock')}<span>This browser made a new key for you, key id <code>${esc(res.key.keyId)}</code>, and keeps it (IndexedDB). It cannot be exported: to add to this ledger later, seal again from this browser. Clearing the site’s data deletes it; the ledger still verifies, since it holds the public key.</span></p>`
    : !res.key.stored ? `<p class="callout callout-note">${ic('note')}<span>This browser could not store the key (${esc(res.key.why || 'storage is off')}), so it lives in this tab only: once the tab closes, nothing more can be added to this ledger from a browser. The ledger still verifies anywhere.</span></p>` : ''
  const dest = `${root}/ImmutableQC/ledger.jsonl`
  const steps = res.appended
    ? `<li><span><b>Download</b> the new <code>ledger.jsonl</code>. It keeps every earlier line and adds ${esc(plural(res.records.length, 'record', 'records'))}.</span></li><li><span><b>Replace</b> <code>${esc(dest)}</code> with it.</span></li><li><span><b>Audit</b> the folder on <a href="#audit">Audit</a>, now or any time later.</span></li>`
    : `<li><span><b>Download</b> <code>ledger.jsonl</code>.</span></li><li><span><b>Put it in the data folder</b> as <code>${esc(dest)}</code>: make the <code>ImmutableQC</code> folder inside <code>${esc(root)}</code> if it is not there.</span></li><li><span><b>Audit</b> the folder on <a href="#audit">Audit</a>, now or any time later. To catch a rewrite, copy the head and keep it somewhere else too (an email, a lab notebook entry).</span></li>`
  const check = res.report.verdict !== 'fail'
    ? `<p class="callout callout-pass">${ic('check')}<span>${esc(`Checked in this tab: the new ledger verifies, and ${res.report.counts.match === 1 ? 'the file matches it' : `all ${fmtN(res.report.counts.match)} files match it`}.`)}</span></p>`
    : `<p class="callout callout-fail">${ic('x')}<span>${esc(`The check of the new ledger did not pass: ${res.report.summary} Do not use it; seal again.`)}</span></p>`
  const rows = rowsOf({ ...res, unreadable: res.unreadable || [] })
  const unread = res.unreadable.length ? `<div class="callout callout-note">${ic('note')}<div><p>${esc(`${plural(res.unreadable.length, 'file', 'files')} could not be read, so ${res.unreadable.length === 1 ? 'it was' : 'they were'} not sealed. Seal again once ${res.unreadable.length === 1 ? 'it is' : 'they are'} readable:`)}</p><ul class="note-items">${res.unreadable.slice(0, 5).map((u) => `<li>${esc(`${nameOf(u.path)}: ${readError(u.error)}`)}</li>`).join('')}</ul></div></div>` : ''
  box.innerHTML = `<div class="result">
<div class="verdict verdict-pass verdict-sealed" tabindex="-1" role="group" aria-labelledby="${id}-vh">
<div class="verdict-ic" aria-hidden="true"><svg viewBox="0 0 64 64" focusable="false"><circle class="v-ring" cx="32" cy="32" r="28"/><circle class="v-ring" cx="32" cy="32" r="17" stroke-width="4"/><circle cx="32" cy="32" r="6.5" fill="currentColor"/></svg></div>
<div class="verdict-text">
<span class="tag tag-l tag-sealed">${ic('check')}Sealed</span>
<h1 id="${id}-vh">${esc(h)}</h1>
<p class="verdict-meta">${esc(`${root} · signed in this browser · ${when(res.records[0].f.at)} · ${fmtB(res.bytes)} read in ${dur(res.ms)}`)}</p>
<p class="verdict-meta">${esc(`Key id ${res.key.keyId} · ${plural(res.verified.recordCount, 'record', 'records')} · head ${head.n}:${head.h.slice(0, 8)}…`)}</p>
</div>
<div class="verdict-actions">
<button class="btn ${res.appended && !n ? 'btn-ghost' : 'btn-primary'}" type="button" data-act="download-ledger">${ic('down')}Download ledger.jsonl</button>
</div>
</div>
${check}
${keyNote}
${unread}
<div class="cols">
<div class="col-main">
<section class="panel" aria-labelledby="${id}-put-h"><h2 id="${id}-put-h">${res.appended ? 'Replace the ledger' : 'Put it in the folder'}</h2><ol class="seal-steps">${steps}</ol>
${res.appended && !n ? '<p class="hint">The download adds only a scan record, which shows this check was made. You can skip it.</p>' : ''}</section>
<p class="callout agent-note">${ic('note')}<span>For an instrument PC, the agent is the real tool: it seals each new or changed file as soon as it is written, and keeps watching. A browser seals only when you drop the folder. <a href="../index.html#install">Get the agent</a></span></p>
</div>
<div class="col-side">${ledgerPanel(id, res, { seal: true })}</div>
</div>
${filesPanel(id, rows, { title: 'Files sealed', sub: `${plural(rows.length, 'path', 'paths')} in the ledger` })}
<div class="end-row">
<button class="btn btn-ghost" type="button" data-act="reset">${ic('folder')}Seal another folder</button>
<button class="chip-copy" type="button" data-copy="${esc(headText(head))}">${ic('copy')}<span><span class="vh">Copy the </span>Head ${esc(head.n)}:${esc(head.h.slice(0, 8))}…</span></button>
<button class="chip-copy" type="button" data-copy="${esc(res.key.keyId)}">${ic('copy')}<span><span class="vh">Copy the </span>Key id ${esc(res.key.keyId)}</span></button>
</div>
</div>`
  bindFiles($('[data-files]', box), rows)
  box._seal = res
}

// ---------------------------------------------------------------------------------------------------------- the demo
const D = () => S.demo
function demoSteps(states) {
  for (const li of $$('.steps li', section('demo'))) {
    const s = states[li.dataset.step]
    if (s) li.className = s
  }
}
function demoText(slot, text) { $(`[data-slot="${slot}"]`, section('demo')).textContent = text }
function demoButtons({ edit = false, restart = false, start = false }) {
  const sec = section('demo')
  $('[data-act="demo-edit"]', sec).hidden = !edit
  $('[data-act="demo-restart"]', sec).hidden = !restart
  $('[data-act="demo-start"]', sec).hidden = !start
}
function demoTree({ hashes = null, edited = false, ledger = false } = {}) {
  const files = demoListing({ edited }).items
  const ul = $('[data-slot="tree"]', section('demo'))
  ul.innerHTML = files.map((it) => {
    const isEdit = edited && it.raw === DEMO.edit.path
    return `<li class="${isEdit ? 'is-edited' : ''}"><span class="t-path">${esc(it.raw)}${isEdit ? ` <span class="tag tag-changed">${ic('x')}Edited copy</span>` : ''}</span><span class="t-size">${esc(fmtB(it.file.size))}</span>${hashes && hashes.get(it.raw) ? shortHash(hashes.get(it.raw)) : '<span></span>'}</li>`
  }).join('') + (ledger ? `<li class="is-ledger"><span class="t-path">${esc(IQC.LEDGER_PATH)}</span><span class="t-size">${esc(fmtB(new Blob([ledger]).size))}</span><span class="tag tag-sealed">${ic('check')}Ledger</span></li>` : '')
}
function demoInside(show) {
  const box = $('[data-slot="inside"]', section('demo'))
  box.hidden = !show
  if (!show) { box.innerHTML = ''; return }
  const e = DEMO.edit
  box.innerHTML = `<p class="label">Inside ${esc(e.name)}, in the copy</p>
<pre><span class="ln">1  </span>well,abs_450
<span class="ln">2  </span>${esc(e.well)},<del>${esc(e.before)}</del><ins>${esc(e.after)}</ins>
<span class="ln">3  </span>A02,0.517</pre>
<p>${esc(`Same name, same size (${fmtN(e.size)} bytes); one value differs. The audit compares bytes, not values: it shows that the file changed, and the cell is highlighted here only to show what the copy holds.`)}</p>`
}

async function startDemo({ focus = true } = {}) {
  const d = D()
  if (d.run) return
  const ctl = new AbortController()
  d.run = { ctl }
  d.phase = 'sealing'
  d.ledgerText = null
  show('demo', 'none')
  demoButtons({})
  demoInside(false)
  demoTree({})
  demoSteps({ seal: 'run', pass: 'wait', edit: 'wait', fail: 'wait' })
  demoText('s-seal', 'the sample folder, with a key made for this demo')
  demoText('s-pass', 'every file re-read and checked')
  demoText('s-edit', 'as a sync conflict on a shared drive would')
  demoText('s-fail', 'the change is caught')
  announce('Demo started: sealing the sample folder.')
  const pool = new Pool(POOL())
  try {
    const keys = new DemoKeys()
    const sealed = await runSeal(locate(demoListing()), { station: DEMO.station, pool, keys, signal: ctl.signal })
    d.ledgerText = sealed.text
    d.seal = sealed
    const hashes = new Map([...sealed.verified.files.values()].map((e) => [IQC.decodePath(e.path), e.latest.sha256]))
    d.hashes = hashes
    demoTree({ hashes, ledger: sealed.text })
    demoText('s-seal', `${plural(sealed.plan.length, 'file', 'files')} of ${DEMO.folder}, key id ${sealed.key.keyId}, head ${sealed.verified.head.n}:${sealed.verified.head.h.slice(0, 8)}…`)
    demoSteps({ seal: 'done', pass: 'run' })
    const res = await runAudit(locate(demoListing({ ledgerText: sealed.text })), { pool, signal: ctl.signal })
    d.phase = 'pass'
    demoSteps({ pass: res.report.verdict === 'pass' ? 'done' : 'bad' })
    demoText('s-pass', res.report.verdict === 'pass' ? `pass: all ${fmtN(res.report.counts.match)} files match their seals` : `unexpected: ${res.report.summary}`)
    demoButtons({ edit: true, restart: true })
    const box = show('demo', 'result')
    renderResult(box, res, { mode: 'demo', level: 'h2', demo: true })
    if (focus) focusEl($('.verdict', box))
    announce(`Demo audit finished. Pass: ${headline(res.report)} Next: change one value.`)
  } catch (e) {
    if (e instanceof Canceled) return
    d.phase = 'error'
    demoButtons({ start: true })
    demoSteps({ seal: 'wait', pass: 'wait' })
    showError('demo', e, [`<button class="btn btn-primary" type="button" data-act="demo-restart">${ic('redo')}Start over</button>`])
  } finally {
    pool.terminate()
    d.run = null
  }
}

async function demoEdit() {
  const d = D()
  if (d.run || !d.ledgerText) return
  d.run = { ctl: new AbortController() }
  d.phase = 'editing'
  demoButtons({})
  const e = DEMO.edit
  demoSteps({ edit: 'done', fail: 'run' })
  demoText('s-edit', `${e.name}, well ${e.well}: ${e.before} became ${e.after}`)
  demoTree({ hashes: d.hashes, edited: true, ledger: d.ledgerText })
  demoInside(true)
  const pool = new Pool(POOL())
  try {
    const res = await runAudit(locate(demoListing({ edited: true, ledgerText: d.ledgerText })), { pool, signal: d.run.ctl.signal })
    const now = res.report.files.find((f) => f.path === e.path)
    if (now && now.present) {
      const hashes = new Map(d.hashes)
      hashes.set(e.path, now.present.sha256)
      demoTree({ hashes, edited: true, ledger: d.ledgerText })
    }
    d.phase = 'fail'
    const caught = res.report.verdict === 'fail' && res.report.counts.changed === 1
    demoSteps({ fail: caught ? 'bad' : 'wait' })
    demoText('s-fail', caught ? `fail: ${e.name} changed since it was sealed` : `unexpected: ${res.report.summary}`)
    demoButtons({ restart: true })
    const box = show('demo', 'result')
    renderResult(box, res, { mode: 'demo', level: 'h2', demo: true })
    focusEl($('.verdict', box))
    announce(`Demo audit finished. Fail: ${headline(res.report)}`)
  } catch (err) {
    if (err instanceof Canceled) return
    d.phase = 'error'
    demoButtons({ start: true })
    showError('demo', err, [`<button class="btn btn-primary" type="button" data-act="demo-restart">${ic('redo')}Start over</button>`])
  } finally {
    pool.terminate()
    d.run = null
  }
}

// ---------------------------------------------------------------------------------------------- events and boot
function onClick(e) {
  const copy = e.target.closest('[data-copy]')
  if (copy) { copyText(copy); return }
  const b = e.target.closest('[data-act]')
  if (!b) return
  const act = b.dataset.act
  const mode = (b.closest('.mode') || {}).dataset ? b.closest('.mode').dataset.mode : S.mode
  if (act === 'choose-folder') { const input = document.getElementById(b.dataset.for); input.value = ''; input.click() }
  else if (act === 'choose-ledger') { const input = $('#audit-ledger'); input.value = ''; input.click() }
  else if (act === 'reset') resetMode(mode)
  else if (act === 'report-html' || act === 'report-json') {
    const res = b.closest('[data-view="result"]')._res
    if (!res) return
    if (act === 'report-html') download(reportName(res, 'html'), IQC.renderReportHTML(res.report), 'text/html')
    else download(reportName(res, 'json'), JSON.stringify(res.report, null, 2) + '\n', 'application/json')
    announce('Report downloaded.')
  } else if (act === 'download-ledger') {
    const res = b.closest('[data-view="result"]')._seal
    if (res) { download('ledger.jsonl', res.text, 'application/x-ndjson'); announce('ledger.jsonl downloaded.') }
  } else if (act === 'audit-this') {
    const src = S.seal.failedSource
    if (src) { history.replaceState(null, '', '#audit'); setMode('audit'); startAudit(src) }
  } else if (act === 'demo-edit') demoEdit()
  else if (act === 'demo-restart' || act === 'demo-start') startDemo()
}

function initDrop() {
  let depth = 0
  const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')
  const target = () => (S.mode === 'seal' ? 'seal' : 'audit')
  const zone = () => $(`#${target()}-drop`)
  const busy = () => !!S[target()].run
  const hi = (on) => { for (const z of $$('.drop')) z.classList.toggle('is-over', on && z === zone()) }
  document.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; depth++; e.preventDefault(); if (!busy()) hi(true) })
  document.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = busy() ? 'none' : 'copy' })
  document.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) hi(false) })
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    depth = 0
    hi(false)
    if (busy()) { announce('A run is in progress. Cancel it first.'); return }
    const drop = entriesOfDrop(e.dataTransfer)
    if (!drop.entries.length && !drop.loose.length) { showError(target(), new AppError('Nothing to read in that drop', 'Drop a folder from your computer (or its files). Links and text cannot be audited.')); return }
    const name = drop.entries.length === 1 ? drop.entries[0].name : ''
    if (target() === 'seal') startSeal({ drop, name }); else startAudit({ drop, name })
  })
}

function boot() {
  const fail = (msg) => { const p = $('#boot-error'); p.hidden = false; p.className = 'wrap boot-error'; p.innerHTML = `<span class="callout callout-fail">${ic('x')}<span>${esc(msg)}</span></span>` }
  if (!globalThis.crypto || !crypto.subtle) fail('This page can check signatures only over a secure connection (https). Open it at https://immutableqc.com/app/.')
  else if (typeof Worker !== 'function') fail('This browser cannot run background workers, which the app needs to read files. Use a current Chrome, Edge, Firefox or Safari.')
  document.addEventListener('click', onClick)
  // each pick is read at once and the input cleared, so the same folder can be chosen again
  const picked = (input) => { const f = [...(input.files || [])]; input.value = ''; return f }
  $('#audit-folder').addEventListener('change', (e) => { const f = picked(e.target); if (f.length) startAudit({ input: f, name: '' }); else showError('audit', new AppError('The folder is empty', 'There is no file in it to check.')) })
  $('#seal-folder').addEventListener('change', (e) => { const f = picked(e.target); if (f.length) startSeal({ input: f, name: '' }); else showError('seal', new AppError('The folder is empty', 'There is no file in it to seal.')) })
  $('#audit-ledger').addEventListener('change', (e) => { const f = picked(e.target)[0]; if (f) chosenLedger(f) })
  for (const id of ['audit-head', 'audit-key', 'seal-station']) $(`#${id}`).addEventListener('input', (e) => fieldError(e.target, null))
  initDrop()
  addEventListener('hashchange', () => { const m = modeOf(location.hash); if (m) setMode(m, { focus: true }) })
  addEventListener('error', (e) => { if (e.error || e.message) showFatal(e.error || new Error(e.message)) })
  addEventListener('unhandledrejection', (e) => { if (!(e.reason instanceof Canceled)) showFatal(e.reason) })
  setMode(modeOf(location.hash) || 'audit')
  document.documentElement.dataset.app = 'ready' // boot.js: the app has started
}
function showFatal(err) {
  const mode = S.mode
  for (const m of ['audit', 'seal']) if (S[m].run) { try { S[m].run.ctl.abort(); if (S[m].run.pool) S[m].run.pool.terminate() } catch { /* stopped */ } finishRun(m) }
  showError(mode, err instanceof AppError ? err : new AppError('Something went wrong', `The app stopped with this message: ${(err && err.message) || String(err)} Nothing was uploaded or changed. Try again, or reload the page.`))
}

// a test hook (only with ?test in the address): hash Blobs in the worker pool, with the slice limits given
if (TEST) {
  globalThis.__iqc = {
    TOOL,
    async hash(blobs, { whole, slice } = {}) {
      const pool = new Pool(POOL())
      try { return (await pool.hash(blobs.map((b) => ({ file: b, size: b.size })), { whole, slice })).map((r) => r.sha256 || r.error) } finally { pool.terminate() }
    },
  }
}

boot()
