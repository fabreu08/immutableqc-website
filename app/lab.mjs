// Immutable QC app: a lab's result (docs/build-notes/spec-addendum-agents.md, section E), loaded only when a result needs
// it (a lab folder, a ledger with agent steps, the demo, a sign-off). Draws core's auditMany report: one verdict (pass
// cyan, review amber, fail coral; notes neutral), the problems, the items for review, the notes, the Agent activity (each
// step: actor, tool, action, time, review state, its inputs measured / derived / untraced, its outputs match / changed /
// missing, and the trace back to sealed measurements), the Ledgers (one row per ledger), and the file list with the
// "Agent steps" and "Needs review" chips. Review mode: a person picks steps or files, a decision and a note; the
// browser's key (IndexedDB, not extractable) signs core's planReview records on a reviewer ledger; the audit runs again
// with it (from the files as read, without reading them again); "Download your review ledger". Core decides every result;
// nothing here reads the format itself.
import * as IQC from '../core/immutableqc.mjs'
import { H } from './app.mjs'
import { signReview } from './many.mjs'
import { listing as demoListing, AGENT_DIR, reviewFile } from './demo-agent.mjs'
import * as DemoAgent from './demo-agent.mjs'

const { POOL, Pool, Canceled, section, showError, show, S } = H
const { $, $$, esc, fmtN, fmtB, plural, ic, cap, when, dayTime, shortHash, nameOf, tag, announce, focusEl, download, readError, reviewPanel, notesPanel, filesPanel, bindFiles, headline, fieldError } = H
const NAME_KEY = 'immutableqc-reviewer'
const VERDICT = { pass: ['verdict-pass', 'tag-pass', 'check', 'Pass'], review: ['verdict-review', 'tag-note', 'note', 'Review'], fail: ['verdict-fail', 'tag-fail', 'x', 'Fail'] }
const INPUT = { measured: ['tag-sealed', 'check', 'Measured'], derived: ['tag-removed', 'arrow', 'Derived'], untraced: ['tag-unsealed', 'unsealed', 'Untraced'] }
const DECIDE = { approved: ['tag-pass', 'check', 'Approved'], question: ['tag-note', 'note', 'Question'], rejected: ['tag-fail', 'x', 'Rejected'], 'awaiting review': ['tag-unchecked', 'unchecked', 'Awaiting review'] }
const ROLE = { measured: 'measurements', agent: 'agent steps', reviewer: 'reviews', mixed: 'mixed', empty: 'empty' }
const chip = ([c, i, w]) => `<span class="tag ${c}">${ic(i)}${esc(w)}</span>`
const ledgerOf = (r, li) => r.ledgers[li] || { label: `ledger ${li + 1}`, root: null }
const under = (r, li, path) => { const L = ledgerOf(r, li); return L.root ? `${L.root}/${nameOf(path)}` : nameOf(path) }
const stepName = (r, s) => `step ${s.n} of ${ledgerOf(r, s.ledger).label}`

// ---------------------------------------------------------------------------------------------------- rows
function rowsOf(res) {
  const r = res.report, out = []
  const unread = new Map((res.unreadable || []).map((u) => [u.path, readError(u.error)]))
  const forReview = new Set()
  for (const g of r.forReview) for (const x of g.records || []) forReview.add(`${x.ledgerId}:${x.n}`)
  r.files.forEach((f0, i) => {
    const li = f0.ledger || 0, L = ledgerOf(r, li)
    const f = { ...f0, path: L.root ? `${L.root}/${f0.path}` : f0.path }
    const problem = f.state === 'changed' || f.state === 'missing'
    const note = !problem && (f.state === 'not sealed' || f.state === 'back after removal' || f.state === 'not checked' || f.versions > 1)
    const review = (f0.records || []).some((n) => forReview.has(`${L.ledgerId}:${n}`))
    out.push({ f, i, group: problem ? 0 : review ? 1 : note ? 2 : 3, problem, note, review, unread: unread.get(f.path), hay: `${nameOf(f.path)} ${f.path} ${f.sealed ? f.sealed.sha256 : ''} ${f.present ? f.present.sha256 : ''}`.toLowerCase() })
  })
  r.steps.forEach((s, k) => {
    const needs = s.review.state !== 'approved' || s.inputs.some((x) => x.state === 'untraced' || x.changedAfter)
    for (const o of s.outputs) {
      const problem = o.state === 'changed' || o.state === 'missing'
      const path = under(r, s.ledger, o.path), sha = o.present ? o.present.sha256 : o.sha256
      const row = { step: true, problem, note: o.state === 'not checked', review: needs || problem, group: problem ? 0 : needs ? 1 : 3, i: r.files.length + k, hay: `${path} ${o.sha256} ${sha} ${s.actor} ${s.action}`.toLowerCase() }
      row.html = () => `<tr class="${problem ? 'is-problem' : row.review ? 'is-note' : ''}"><td class="c-state" data-label="State">${tag(o.state)}</td><td class="c-path" data-label="Path"><code>${esc(path)}</code><span class="why${problem ? ' bad' : ''}">${esc(`written by ${stepName(r, s)} (${s.actor}) · ${s.review.state}`)}</span></td><td class="num" data-label="Size">${esc(fmtB(Number(o.present ? o.present.bytes : o.bytes)))}</td><td class="c-sha" data-label="SHA-256"><span class="lbl" aria-hidden="true">SHA-256</span>${shortHash(sha, problem ? 'hash-changed' : '')}</td><td class="num" data-label="Versions"><span class="lbl" aria-hidden="true">Versions</span><span class="faint">step</span></td></tr>`
      out.push(row)
    }
  })
  return out.sort((a, b) => a.group - b.group || a.i - b.i)
}

// ---------------------------------------------------------------------------------------------------- panels
const CODE = { 'output-changed': 'Agent output', 'output-missing': 'Agent output', 'review-subject-changed': 'Review', 'expect-head': 'Pinned head', pin: 'Pin', 'pin-unreadable': 'Pin file', 'expect-key': 'Key id' }
function problemsPanel(id, r) {
  if (!r.problems.length) return `<section class="panel" aria-labelledby="${id}-prob-h"><h2 id="${id}-prob-h">Problems</h2><p class="none">${ic('check')}<span>None: every signature, link, file and agent output checks out.</span></p></section>`
  const li = r.problems.slice(0, 50).map((p) => {
    const head = p.code === 'changed' || p.code === 'missing' ? `${tag(p.code)}${p.path ? `<code>${esc(under(r, p.ledger || 0, p.path))}</code>` : ''}` : `<span class="tag tag-fail">${ic('x')}${esc(CODE[p.code] || 'Ledger')}</span>`
    return `<li><div class="pr-h">${head}</div><p>${esc(p.message)}</p></li>`
  }).join('')
  return `<section class="panel" aria-labelledby="${id}-prob-h"><h2 id="${id}-prob-h">Problems <span class="label">${esc(fmtN(r.problems.length))} · each one fails the audit</span></h2><ul class="probs">${li}</ul>${r.problems.length > 50 ? `<p class="more-note">And ${esc(fmtN(r.problems.length - 50))} more, in the report.</p>` : ''}</section>`
}

function treeHTML(r, t) {
  if (!t) return ''
  if (t.stop === 'size') return `<li class="faint">${esc(`and ${fmtN(t.more || 0)} more, in the report`)}</li>`
  const m = t.measured
  const where = m ? `sealed by ${m.station || ledgerOf(r, m.ledger).label}, record ${m.n}${m.observedAt ? `, ${dayTime(m.observedAt)} UTC` : ''}` : t.step ? `written by step ${t.step.n} of ${ledgerOf(r, t.step.ledger).label}` : t.state === 'untraced' ? 'matches nothing sealed and no recorded step output' : ''
  const stop = t.stop === 'cycle' ? ' · a cycle of steps: it stops here' : t.stop === 'shown above' ? ' · shown above' : t.stop === 'depth' ? ' · the tree stops here (the summary counts every step)' : ''
  return `<li><span class="tn">${chip(INPUT[t.state] || INPUT.derived)}<code>${esc(nameOf(t.path))}</code></span> <span class="faint">${esc(where + stop)}</span>${t.inputs && t.inputs.length ? `<ul>${t.inputs.map((x) => treeHTML(r, x)).join('')}</ul>` : ''}</li>`
}

function activityPanel(id, r) {
  const ss = r.steps
  if (!ss.length) return ''
  const items = ss.slice(0, 200).map((s) => {
    const ins = s.inputs.map((x) => {
      const m = x.measured && x.measured[0]
      const d = x.state === 'measured' ? `sealed by ${m.station || ledgerOf(r, m.ledger).label} as ${nameOf(m.path)}, record ${m.n}` : x.state === 'derived' ? `written by step ${x.step.n}` : 'matches nothing sealed'
      const later = x.changedAfter ? ` · sealed again later, in record ${x.changedAfter.n}` : ''
      return `<li>${chip(INPUT[x.state])}<code>${esc(nameOf(x.path))}</code><span class="faint">${esc(d + later)}</span></li>`
    }).join('')
    const outs = s.outputs.map((o) => `<li>${tag(o.state)}<code>${esc(nameOf(o.path))}</code></li>`).join('')
    const trees = r.lineage.outputs.filter((o) => o.ledger === s.ledger && o.n === s.n && o.tree)
    const decided = s.review.decisions.filter((x) => x.latest).map((x) => `<li>${chip(DECIDE[x.decision])}<span>${esc(`${x.reviewer}, ${dayTime(x.at)} UTC${x.note && x.note !== '-' ? `: “${x.note}”` : ''}`)}</span></li>`).join('')
    return `<li class="act" data-review="${esc(s.review.state)}">
<div class="act-h">${chip(DECIDE[s.review.state] || DECIDE['awaiting review'])}<h3>${esc(s.action)}</h3></div>
<p class="act-meta">${esc(`${s.actor} · ${s.tool} · ${when(s.at)} · ${stepName(r, s)}`)}</p>
<div class="act-io"><p class="label">Inputs</p><ul class="io">${ins || '<li class="faint">None recorded</li>'}</ul></div>
<div class="act-io"><p class="label">Outputs</p><ul class="io">${outs || '<li class="faint">None recorded</li>'}</ul></div>
${decided ? `<ul class="io act-rev">${decided}</ul>` : ''}
<details class="fold trace"><summary>Trace back to sealed measurements <span class="faint">· ${esc(s.lineage.sentence)}</span></summary><div class="fold-body">${trees.length ? `<ul class="ttree">${trees.map((o) => treeHTML(r, o.tree)).join('')}</ul>` : `<p class="finding">${esc(cap(s.lineage.sentence))}.</p>`}</div></details>
</li>`
  }).join('')
  const c = r.counts
  return `<section class="panel activity" aria-labelledby="${id}-act-h"><h2 id="${id}-act-h">Agent activity <span class="label">${esc(`${plural(ss.length, 'step', 'steps')} · ${fmtN(c.measuredInputs)} measured, ${fmtN(c.derivedInputs)} derived, ${fmtN(c.untracedInputs)} untraced inputs`)}</span></h2>
<ol class="acts">${items}</ol>${ss.length > 200 ? `<p class="more-note">${esc(`And ${fmtN(ss.length - 200)} more steps, in the report.`)}</p>` : ''}</section>`
}

function ledgersPanel(id, r) {
  const li = r.ledgers.map((L) => {
    const [, t, i, w] = VERDICT[L.verdict] || VERDICT.fail
    const row = (k, v) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`
    return `<li><div class="lg-h"><span class="tag ${t}">${ic(i)}${esc(w)}</span><b>${esc(L.label)}</b><span class="label">${esc(ROLE[L.role] || L.role || '')}</span></div>
<dl class="kv kv-tight">${row('Station', esc(L.station || 'unknown'))}${L.keyId ? row('Key id', `<code>${esc(L.keyId)}</code>`) : ''}${L.head ? row(L.intact ? 'Head' : 'Head (last good)', `<code>${esc(`${L.head.n}:${L.head.h.slice(0, 12)}…`)}</code>`) : ''}${row('Records', esc(fmtN(L.records)))}${L.ledgerPath ? row('File', `<code>${esc(L.ledgerPath)}</code>`) : ''}</dl></li>`
  }).join('')
  return `<section class="panel" aria-labelledby="${id}-lg-h"><h2 id="${id}-lg-h">Ledgers <span class="label">${esc(fmtN(r.ledgers.length))}</span></h2><ul class="ledgers">${li}</ul></section>`
}

function reviewsPanel(id, r) {
  if (!r.reviews.length) return ''
  const li = r.reviews.slice(0, 50).map((v) => `<li>${chip(DECIDE[v.decision])}<div><p>${esc(`${v.reviewer}, ${dayTime(v.at)} UTC · ${plural(v.subjects.length, 'record', 'records')}${v.subjects.some((x) => x.state !== 'matches') ? ` (${v.subjects.filter((x) => x.state !== 'matches').length} no longer ${v.subjects.length === 1 ? 'matches' : 'match'})` : ''}`)}</p>${v.note && v.note !== '-' ? `<p class="faint">${esc(`“${v.note}”`)}</p>` : ''}</div></li>`).join('')
  return `<section class="panel" aria-labelledby="${id}-rv-h"><h2 id="${id}-rv-h">Sign-offs <span class="label">${esc(fmtN(r.reviews.length))}</span></h2><ul class="notes">${li}</ul></section>`
}

// ---------------------------------------------------------------------------------------------------- the result
export function renderMany(box, res, opts = {}) {
  const { mode = 'audit', level = 'h1', demo = false } = opts
  const r = res.report, id = `m${H.uid()}`, Hl = level
  const [vc, tc, vi, vw] = VERDICT[r.verdict] || VERDICT.fail
  const rows = rowsOf(res), c = r.counts
  const needs = rows.filter((x) => x.review).length
  const where = `${res.located && res.located.root ? `${res.located.root} · ` : ''}${plural(c.ledgers, 'ledger', 'ledgers')} · audited in this browser · ${when(r.method.auditedAt)}${res.bytes ? ` · ${fmtB(res.bytes)} re-read${res.ms ? ` in ${(res.ms / 1000).toFixed(1)} s` : ''}` : ''}`
  const tile = (n, label, kind, icon) => `<li class="stat stat-${kind}">${ic(icon)}<b class="stat-n">${esc(fmtN(n))}</b><span class="stat-l">${esc(label)}</span></li>`
  const stats = [tile(c.match, 'Match', c.match ? 'ok' : 'zero', 'check'), tile(c.changed + (c.outputsChanged || 0), 'Changed', c.changed + (c.outputsChanged || 0) ? 'bad' : 'zero', 'x'), tile(c.missing + (c.outputsMissing || 0), 'Missing', c.missing + (c.outputsMissing || 0) ? 'bad' : 'zero', 'missing')]
  if (c.ledgerProblems) stats.push(tile(c.ledgerProblems, c.ledgerProblems === 1 ? 'Ledger problem' : 'Ledger problems', 'bad', 'x'))
  stats.push(tile(c.steps, c.steps === 1 ? 'Agent step' : 'Agent steps', c.steps ? 'ok' : 'zero', 'arrow'), tile(needs, 'Need review', needs ? 'note' : 'zero', 'note'))
  const acts = demo ? `<button class="btn btn-ghost btn-s" type="button" data-act="demo-cite">${ic('unsealed')}An agent cites a file nothing measured</button><button class="btn ${r.verdict === 'pass' ? 'btn-primary' : 'btn-ghost'} btn-s" type="button" data-act="demo-edit">${ic('edit')}Change one value in a copy</button><button class="btn btn-ghost btn-s" type="button" data-act="demo-signoff">${ic('check')}Sign off as a reviewer</button>` : ''
  box.innerHTML = `<div class="result" data-verdict="${r.verdict}" data-kind="many">
<div class="verdict ${vc}" tabindex="-1" role="group" aria-labelledby="${id}-vh">
<div class="verdict-ic" aria-hidden="true"><svg viewBox="0 0 64 64" focusable="false"><circle class="v-ring" cx="32" cy="32" r="28"/>${r.verdict === 'pass' ? '<path class="v-mark" d="M20 33l8 8 16-17"/>' : r.verdict === 'review' ? '<path class="v-mark" d="M32 19v17M32 44v1"/>' : '<path class="v-mark" d="M23 23l18 18M41 23L23 41"/>'}</svg></div>
<div class="verdict-text">
<span class="tag tag-l ${tc}">${ic(vi)}${vw}</span>
<${Hl} id="${id}-vh">${esc(headline(r))}</${Hl}>
<p class="verdict-meta">${esc(where)}</p>
${r.verdict === 'pass' ? '<p class="v-why">Each file is byte for byte the one that was sealed, each ledger is as it was signed, and each agent output is the file its step recorded, traced back to sealed measurements. It does not show a result was right. <a href="../sealed.html">What a seal covers</a></p>' : ''}
</div>
<div class="verdict-actions">${acts}
<button class="btn ${r.verdict === 'pass' && !demo ? 'btn-primary' : 'btn-ghost'} btn-s" type="button" data-act="report-html">${ic('down')}Download report (HTML)</button>
<button class="btn btn-ghost btn-s" type="button" data-act="report-json">${ic('down')}Download report (JSON)</button>
</div>
</div>
<ul class="stats" aria-label="Counts">${stats.join('')}</ul>
${r.verdict === 'fail' ? `<p class="callout callout-fail fail-note">${ic('note')}<span>A fail is a finding, not a verdict on anyone: compare the changed files with your backups, and keep the report with the run.</span></p>` : ''}
<div data-review-slot></div>
<div class="cols">
<div class="col-main">
${problemsPanel(id, r)}
${reviewPanel(id, r)}
${notesPanel(id, r)}
${activityPanel(id, r)}
</div>
<div class="col-side">
${ledgersPanel(id, r)}
${reviewsPanel(id, r)}
</div>
</div>
${filesPanel(id, rows, { title: 'Files and agent outputs', sub: `${plural(rows.length, 'path', 'paths')} · problems first`, extra: [['steps', 'Agent steps'], ['review', 'Needs review']] })}
<div class="end-row">
${demo ? `<button class="btn btn-ghost" type="button" data-act="demo-restart">${ic('redo')}Start over</button>` : `<button class="btn btn-ghost" type="button" data-act="reset">${ic('folder')}Audit another folder</button><button class="btn btn-ghost" type="button" data-act="review-open">${ic('edit')}Review and sign off</button>`}
</div>
</div>`
  bindFiles($('[data-files]', box), rows)
  box.dataset.mode = mode
  box._res = res
  box._opts = opts
  if (opts.reviewOpen) openReview(box, res)
}

// ---------------------------------------------------------------------------------------------------- the demo's folder
export function demoTree(lab, res, flags) {
  const r = res.report, sha = new Map()
  for (const f of r.files) if (f.present) sha.set(under(r, f.ledger, f.path), f.present.sha256)
  for (const s of r.steps) for (const o of s.outputs) sha.set(under(r, s.ledger, o.path), o.present ? o.present.sha256 : o.sha256)
  const items = demoListing(lab, flags).items
  const ul = $('[data-slot="tree"]', document.getElementById('demo'))
  ul.innerHTML = items.map((it) => {
    const ledger = /(?:^|\/)ImmutableQC\/ledger\.jsonl$|\.ledger\.jsonl$/.test(it.raw)
    const edited = flags.edited && it.raw.endsWith('run-1007/plate-07.csv')
    const copy = it.raw.startsWith(`${AGENT_DIR}/inputs/`) && it.raw.includes('shared-copy')
    const extra = ledger ? `<span class="tag tag-sealed">${ic('check')}Ledger</span>` : sha.get(it.raw) ? shortHash(sha.get(it.raw)) : '<span></span>'
    return `<li class="${edited ? 'is-edited' : ledger ? 'is-ledger' : ''}"><span class="t-path">${esc(it.raw)}${edited ? ` <span class="tag tag-changed">${ic('x')}Edited copy</span>` : copy ? ` <span class="tag tag-unsealed">${ic('unsealed')}Not sealed</span>` : ''}</span><span class="t-size">${esc(fmtB(it.file.size))}</span>${extra}</li>`
  }).join('')
}

// ---------------------------------------------------------------------------------------------------- review mode
function savedName() { try { return localStorage.getItem(NAME_KEY) || '' } catch { return '' } }
function saveName(n) { try { localStorage.setItem(NAME_KEY, n) } catch { /* storage off: asked again next time */ } }

// what can be signed: every agent step, and the latest record of each sealed file (first 200)
function subjectsOf(res) {
  const r = res.report, base = res.baseEntries || res.entries || []
  const steps = (r.steps || []).map((s) => ({ key: `${s.ledgerId}:${s.n}:${s.h}`, label: `${s.action} (${stepName(r, s)})`, state: s.review.state }))
  const files = []
  for (const f of r.files) {
    if (files.length >= 200) break
    const li = f.ledger || 0, e = base[li]
    if (!e || !f.latest || f.latest.kind !== 'file') continue
    const rec = e.verified.records.find((x) => x && x.n === f.latest.n)
    const ledgerId = e.verified.header && e.verified.header.ledgerId
    if (rec && ledgerId) files.push({ key: `${ledgerId}:${rec.n}:${rec.h}`, label: `${r.kind === 'many' ? under(r, li, f.path) : nameOf(f.path)} (record ${rec.n})`, state: f.state })
  }
  return { steps, files }
}

function openReview(box, res) {
  let slot = $('[data-review-slot]', box)
  if (!slot) { slot = document.createElement('div'); slot.setAttribute('data-review-slot', ''); $('.cols', box).before(slot) }
  const id = `rv${H.uid()}`, { steps, files } = subjectsOf(res)
  const pick = (x, i, k) => `<li><label><input type="checkbox" name="${id}-s" value="${esc(x.key)}"${k === 's' && x.state !== 'approved' ? ' checked' : ''}><span>${esc(x.label)}</span></label></li>`
  const signed = res.review
  slot.innerHTML = `<section class="panel review-mode" aria-labelledby="${id}-h">
<h2 id="${id}-h" tabindex="-1">Review and sign off <span class="label">signed with this browser’s key</span></h2>
<p class="callout callout-note">${ic('note')}<span>A browser key identifies this browser, not a person: anyone who uses this browser profile signs with the same key. Per-person keys are upcoming. The key stays in this browser (IndexedDB) and cannot be exported.</span></p>
<form class="rv-form" data-review-form novalidate>
<div class="field"><label for="${id}-name">Your name</label><input type="text" id="${id}-name" maxlength="64" autocomplete="name" spellcheck="false" value="${esc(res.reviewer || savedName())}" aria-describedby="${id}-name-hint"><p class="hint" id="${id}-name-hint">Kept in this browser for next time, and written into each review record.</p></div>
${steps.length ? `<fieldset class="rv-pick"><legend>Agent steps <span class="label">${esc(fmtN(steps.length))}</span></legend><ul>${steps.map((x, i) => pick(x, i, 's')).join('')}</ul></fieldset>` : ''}
${files.length ? `<details class="fold"${steps.length ? '' : ' open'}><summary>Files <span class="label">${esc(fmtN(files.length))}</span></summary><div class="fold-body"><fieldset class="rv-pick"><legend class="vh">Files</legend><ul>${files.map((x, i) => pick(x, i, 'f')).join('')}</ul></fieldset></div></details>` : ''}
<fieldset class="rv-decision"><legend>Decision</legend><div class="seg-choice">${[['approved', 'Approve'], ['question', 'Question'], ['rejected', 'Reject']].map(([v, w], i) => `<label><input type="radio" name="${id}-d" value="${v}"${i ? '' : ' checked'}><span>${w}</span></label>`).join('')}</div></fieldset>
<div class="field"><label for="${id}-note">Note <span class="label">Optional</span></label><textarea id="${id}-note" rows="2" maxlength="1000" aria-describedby="${id}-note-hint"></textarea><p class="hint" id="${id}-note-hint">Signed with the decision.</p></div>
<div class="btn-row"><button class="btn btn-primary" type="submit">${ic('lock')}Sign with this browser’s key</button><button class="btn btn-ghost" type="button" data-act="review-close">Close</button></div>
<p class="rv-error" data-rv-error role="alert"></p>
</form>
${signed ? `<div class="callout callout-pass rv-done">${ic('check')}<div><p>${esc(`Your review ledger holds ${plural(signed.verified.recordCount, 'review record', 'review records')}, key id ${signed.key.keyId}. The audit above includes it. Keep it with the lab folder: later audits include it too.`)}</p><button class="btn btn-primary btn-s" type="button" data-act="review-download">${ic('down')}Download your review ledger</button> <code>${esc(reviewFile(res.reviewer))}</code></div></div>` : ''}
</section>`
  $('[data-review-form]', slot).addEventListener('submit', (e) => { e.preventDefault(); sign(box, slot, id) })
  return slot
}

async function sign(box, slot, id) {
  const res = box._res, err = $('[data-rv-error]', slot), nameIn = $(`#${id}-name`, slot)
  const name = nameIn.value.trim()
  err.textContent = ''
  fieldError(nameIn, null)
  if (!name || [...name].length > 64 || !IQC.isSealedText(name)) { fieldError(nameIn, 'Use 1 to 64 characters, with no "|".'); nameIn.focus(); return }
  const subjects = $$(`input[name="${id}-s"]:checked`, slot).map((x) => IQC.parseSubject(x.value))
  if (!subjects.length) { err.textContent = 'Pick at least one step or file to sign off on.'; announce(err.textContent); return }
  const decision = ($(`input[name="${id}-d"]:checked`, slot) || {}).value || 'approved'
  const note = $(`#${id}-note`, slot).value.trim()
  const btn = $('button[type="submit"]', slot)
  btn.disabled = true
  try {
    saveName(name)
    const key = res.review && res.reviewer === name ? res.review.key : await H.S.keys.current()
    const prior = res.review && res.reviewer === name ? res.review : null
    const review = await signReview({ key, prior, reviewer: name, subjects, decision, note })
    const base = res.baseEntries || res.entries
    const entries = [...base, { verified: review.verified, root: null, files: null, ledgerPath: reviewFile(name) }]
    const report = IQC.auditMany(entries, { ...(res.opts || {}), where: 'browser', tool: H.TOOL })
    const next = { ...res, report, entries, baseEntries: base, review, reviewer: name }
    renderMany(box, next, { ...(box._opts || { mode: 'audit', level: 'h1' }), reviewOpen: true })
    focusEl($('.verdict', box))
    announce(`Signed: ${plural(subjects.length, 'record', 'records')} ${decision}. The audit ran again with your review ledger. ${cap(report.verdict)}: ${headline(report)}`)
  } catch (e) {
    btn.disabled = false
    err.textContent = `Nothing was signed: ${e && e.message ? e.message : e}`
    announce(err.textContent)
  }
}

export function reviewAct(act, box) {
  const res = box._res
  if (act === 'review-open') { const slot = openReview(box, res); focusEl($('h2', slot)); announce('Review mode: pick steps or files, a decision and a note.') }
  else if (act === 'review-close') { const slot = $('[data-review-slot]', box); if (slot) slot.innerHTML = ''; const b = $('[data-act="review-open"]', box); if (b) b.focus() }
  else if (act === 'review-download' && res.review) { download(reviewFile(res.reviewer), res.review.text, 'application/x-ndjson'); announce(`${reviewFile(res.reviewer)} downloaded.`) }
}

// ---------------------------------------------------------------------------------------------------- the demo
// The lab folder of demo-agent.mjs: built once (instrument folder sealed, the agent run), then audited whole with
// auditMany for each change.
const D = () => S.demo
const demoLab = async () => DemoAgent
function demoSteps(states) {
  for (const li of $$('.steps li', section('demo'))) {
    const s = states[li.dataset.step]
    if (s) li.className = s
  }
}
function demoText(slot, text) { $(`[data-slot="${slot}"]`, section('demo')).textContent = text }
const DEMO_ACTS = ['demo-cite', 'demo-edit', 'demo-signoff', 'demo-restart', 'demo-start']
function demoButtons(on = []) {
  for (const a of DEMO_ACTS) $(`.demo-actions [data-act="${a}"]`, section('demo')).hidden = !on.includes(a)
}
function demoInside(e) {
  const box = $('[data-slot="inside"]', section('demo'))
  box.hidden = !e
  if (!e) { box.innerHTML = ''; return }
  box.innerHTML = `<p class="label">Inside ${esc(e.name)}, in the copy</p>
<pre><span class="ln">1  </span>well,abs_450
<span class="ln">2  </span>${esc(e.well)},<del>${esc(e.before)}</del><ins>${esc(e.after)}</ins>
<span class="ln">3  </span>A02,0.517</pre>
<p>${esc(`Same name, same size (${fmtN(e.size)} bytes); one value differs. The audit compares bytes, not values: it shows that the file changed, and the cell is highlighted here only to show what the copy holds.`)}</p>`
}
const AFTER = ['demo-cite', 'demo-edit', 'demo-signoff', 'demo-restart']

// one audit of the demo lab, as it stands (flags: cite, edited), drawn as a lab result
async function demoRun(label, work, { focus = true } = {}) {
  const d = D()
  if (d.run) return
  const ctl = new AbortController()
  d.run = { ctl }
  demoButtons([])
  const pool = new Pool(POOL())
  try {
    const M = await demoLab()
    const out = await work(M, pool, ctl.signal)
    if (!out) return
    const res = await M.audit(d.lab, { pool, signal: ctl.signal, ...d.flags })
    res.lab = d.lab
    d.last = res
    demoTree(d.lab, res, d.flags)
    out(res.report)
    demoButtons(AFTER)
    const box = show('demo', 'result')
    renderMany(box, res, { mode: 'demo', level: 'h2', demo: true })
    if (focus) focusEl($('.verdict', box))
    announce(`${label} ${cap(res.report.verdict)}: ${headline(res.report)}`)
  } catch (e) {
    if (e instanceof Canceled) return
    d.phase = 'error'
    demoButtons(['demo-start'])
    showError('demo', e, [`<button class="btn btn-primary" type="button" data-act="demo-restart">${ic('redo')}Start over</button>`])
  } finally {
    pool.terminate()
    d.run = null
  }
}

export function startDemo({ focus = true } = {}) {
  const d = D()
  if (d.run) return
  d.phase = 'building'
  d.lab = null
  d.flags = { cite: false, edited: false }
  show('demo', 'none')
  demoInside(null)
  demoSteps({ seal: 'run', agent: 'wait', pass: 'wait', edit: 'wait', fail: 'wait' })
  demoText('s-seal', 'the instrument folder, with an instrument key made for this demo')
  demoText('s-agent', 'in this tab: plate-07 scaled, an IC50 estimated, each step signed with an agent key')
  demoText('s-pass', 'the whole lab folder: every file re-read, every step traced')
  demoText('s-edit', 'a step that cites a file nothing measured, one value changed in a copy, or a sign-off')
  demoText('s-fail', 'each change is audited again')
  $('[data-slot="tree"]', section('demo')).innerHTML = ''
  announce('Demo started: sealing the sample folder and running the analysis agent.')
  return demoRun('Demo audit finished.', async (M, pool, signal) => {
    d.lab = await M.build({ pool, signal })
    const L = d.lab, sh = (k) => `${k.keyId}`
    demoText('s-seal', `${plural(L.sealed.plan.length, 'file', 'files')} of ${M.DEMO.folder}, instrument key ${sh(L.keys.instrument)}, head ${L.sealed.verified.head.n}:${L.sealed.verified.head.h.slice(0, 8)}…`)
    demoText('s-agent', `2 steps signed with agent key ${sh(L.keys.agent)}: ${M.OUT.normalized} and ${M.OUT.ic50} written`)
    demoSteps({ seal: 'done', agent: 'done', pass: 'run' })
    return (r) => {
      d.phase = 'pass'
      demoSteps({ pass: r.verdict === 'pass' ? 'done' : 'bad' })
      demoText('s-pass', r.verdict === 'pass' ? `pass: all ${fmtN(r.counts.match)} files match their seals, ${plural(r.counts.steps, 'step', 'steps')} traced to measured files` : `unexpected: ${r.summary}`)
    }
  }, { focus })
}

// the three changes; each is audited again from the lab as built (the sign-off stays until Start over)
export async function demoChange(act) {
  const d = D()
  if (d.run || !d.lab) return
  const e = (await demoLab()).DEMO.edit
  demoInside(act === 'demo-edit' ? e : null)
  demoSteps({ edit: 'done', fail: 'run' })
  if (act === 'demo-edit') { d.flags = { cite: false, edited: true }; demoText('s-edit', `${e.name}, well ${e.well}: ${e.before} became ${e.after}`) }
  if (act === 'demo-cite') { d.flags = { cite: true, edited: false }; demoText('s-edit', 'the agent adds a step that cites inputs/plate-07-shared-copy.csv, which nothing sealed') }
  return demoRun('Demo audit finished.', async (M) => {
    if (act === 'demo-signoff') {
      const signed = await M.signOff(d.lab, d.last.report)
      demoText('s-edit', `${M.REVIEWER} approved every step, signed with a reviewer key${signed ? ` (${signed.key.keyId})` : ''}`)
    }
    return (r) => {
      d.phase = r.verdict
      const ok = act === 'demo-edit' ? r.verdict === 'fail' && r.counts.changed === 1 : act === 'demo-cite' ? r.verdict === 'review' : r.counts.stepsApproved === r.counts.steps
      demoSteps({ fail: !ok ? 'wait' : r.verdict === 'pass' ? 'done' : 'bad' })
      demoText('s-fail', !ok ? `unexpected: ${r.summary}`
        : act === 'demo-edit' ? `fail: ${e.name} changed since it was sealed`
          : act === 'demo-cite' ? 'review: 1 agent step used inputs nothing measured'
            : `${plural(r.counts.stepsApproved, 'step', 'steps')} approved by a reviewer; the verdict: ${r.verdict}`)
    }
  })
}
