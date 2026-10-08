#!/usr/bin/env node
// check.mjs · browser checks for every page of immutableqc.com and the alpha console (dashboard/), with Playwright
// (Chromium) and axe-core. Serves, gzip on as GitHub Pages does, exactly what the Pages workflow publishes: the
// allowlist in site/tools/deploy.mjs, assembled into a temporary folder (--repo serves the whole repo root instead).
//   node site/tools/check.mjs              links (every href/src after JS, the 404 at nested paths), overflow 320–1920,
//                                          tap targets, smallest text, axe at 375 and 1280, frames at rest (3 s traces),
//                                          reduced motion and hidden tab, the Overview story (stage steps, fast scroll,
//                                          keyboard, phone figures, axe and overflow per state, URL bar, print), no-JS
//                                          text, first-load budgets
//   node site/tools/check.mjs --perf       also CLS / TBT / LCP at 320×568, 390×844 and 412×915 with DevTools' Slow 4G
//                                          (562.5 ms, 1.44 Mbps) and CPU 4× (median of --runs=3, and of at least 5
//                                          for the Overview's gate at 390×844), every layout shift
//                                          counted (no input is sent); the same at 320×568 with the Arial-, Liberation-
//                                          and Courier-based fallback faces unmatched (as on Android); and the URL-bar
//                                          resize test (390×664 ↔ 390×745); reported, except the Overview at 390×844,
//                                          which fails over CLS 0.02, TBT 200 ms or Draft 4's LCP + 100 ms
//   --only=index.html,check.html           a subset of pages       --json=path   write every result as JSON
//   --repo                                 serve the repo root as it is on disk, not the deploy allowlist
// In CI: npm ci in site/, then npx playwright install --with-deps chromium. Locally the preinstalled Chromium is used.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { serve, serveDeploy } from './serve.mjs'

const req = createRequire(import.meta.url)
const load = (name, fallback) => { try { return req(name) } catch { if (fallback) return req(fallback); throw new Error(`${name} is missing: run npm ci in site/`) } }
const { chromium } = load('playwright', '/opt/node22/lib/node_modules/playwright')
const AXE = readFileSync(req.resolve('axe-core/axe.min.js'), 'utf8')

const ARGS = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([\w-]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true] }))
const ALL = ['index.html', 'sealed.html', 'check.html', 'regulatory.html', 'roadmap.html', 'about.html', '404.html', 'dashboard/']
const PAGES = ARGS.only ? String(ARGS.only).split(',') : ALL
const WIDTHS = [320, 360, 375, 390, 412, 480, 600, 768, 1024, 1280, 1440, 1920]
const STATUS = 'Independent project · Open alpha · Synthetic demo data · No customers yet'
const CONSOLE_STATUS = 'Independent project · Open alpha · Synthetic demo data · No customers yet · Runs only in your browser'
const BUDGET = { site: { requests: 8, total: 160 * 1024, js: 22 * 1024, fonts: 100 * 1024 }, console: { requests: 10, total: 160 * 1024, fonts: 100 * 1024 } }
// the Overview's own budget since the story (Draft 5), against Draft 4 as measured here (main 4e793fb): LCP 1592 ms at
// 390×844 with Slow 4G and CPU 4× (median of 3), 13685 bytes of JS as served
const OVERVIEW = { total: 130 * 1024, js0: 13685, lcp0: 1592, cls: 0.02, tbt: 200 }
const isConsole = (pg) => pg.startsWith('dashboard')
const fails = [], R = { overflow: [], taps: {}, minFont: {}, axe: [], rest: [], motion: [], nojs: [], budgets: [], perf: [], urlbar: [] }
const fail = (msg) => { fails.push(msg); console.log('  FAIL', msg) }

const served = ARGS.repo ? await serve(0) : await serveDeploy(0)
const { port, close } = served
const BASE = `http://127.0.0.1:${port}/`
console.log(ARGS.repo ? 'serving the repo root (--repo)' : `serving the deploy allowlist: ${served.files.length} files, as GitHub Pages will publish them`)
const browser = await chromium.launch()
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
// Every context runs the pages under their own Content-Security-Policy and records any violation; only the axe step
// bypasses it, to inject axe-core as an inline script.
const CSP_WATCH = () => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI || ''} ${e.sourceFile || ''}:${e.lineNumber || ''}`.trim())) }
const ctxFor = async (w, h, o = {}) => {
  const m = w < 900
  const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: o.dpr || (m ? 2 : 1), isMobile: m, hasTouch: m, userAgent: m ? UA : undefined, javaScriptEnabled: o.js !== false, reducedMotion: o.reduced ? 'reduce' : 'no-preference', bypassCSP: !!o.bypassCSP })
  if (!o.bypassCSP) await c.addInitScript(CSP_WATCH)
  return c
}
const cspCheck = async (p, where) => { const v = await p.evaluate(() => window.__csp || []).catch(() => []); for (const x of v) fail(`CSP: ${where} blocked ${x}`) }
// a pasted fingerprint as a correction reason: one 64-character word the layout must wrap, not widen the page for
const HEX_REASON = 'Superseded, see e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 in the review log'

// ---------------------------------------------------------------------------------------------- page states
async function settle(p) { // scroll through the page so view-triggered checks run and one-shot motion plays, then rest
  const H = await p.evaluate(() => document.documentElement.scrollHeight)
  for (let y = 0; y < H; y += 500) { await p.evaluate((y) => scrollTo(0, y), y); await p.waitForTimeout(60) }
  await p.waitForTimeout(1800)
  await p.evaluate(() => scrollTo(0, 0))
  await p.waitForTimeout(200)
}
const STATES = {
  'check.html': {
    edited: async (p) => { await p.fill('#f-value', '15088119999999'); await p.waitForTimeout(250) },
    rewritten: async (p) => { await p.fill('#f-value', '1588811'); await p.waitForTimeout(150); await p.click('[data-act=rewrite]'); await p.waitForTimeout(300) },
    corrected: async (p) => { await p.fill('#f-value', '1588811'); await p.fill('#reason', 'Dilution factor entered as 10, should be 20 (notebook p. 14)'); await p.click('[data-act=correct]'); await p.waitForTimeout(400) },
    hexreason: async (p) => { await p.fill('#f-value', '1588811'); await p.fill('#reason', HEX_REASON); await p.click('[data-act=correct]'); await p.waitForTimeout(400) },
  },
  'index.html': { menu: async (p) => { if (await p.locator('.menu-btn').isVisible()) { await p.click('.menu-btn'); await p.waitForTimeout(100) } } },
  // the console's states (from the console builder's measure.js): every view and every action, each waited for in words
  'dashboard/': {
    edited: async (p) => { await p.click('#rec-6'); await p.click('#b-edit'); await p.waitForFunction(() => /changed/.test(document.querySelector('[data-sum-st]').textContent)) },
    rewritten: async (p) => { await STATES['dashboard/'].edited(p); await p.click('#b-rewrite'); await p.waitForFunction(() => /does not match/.test(document.querySelector('[data-sum-st]').textContent) && !/changed/.test(document.querySelector('[data-sum-st]').textContent)) },
    corrected: async (p) => { await p.click('#rec-6'); await p.fill('#fix-val', '1508911'); await p.fill('#fix-why', 'Wrong export imported; corrected to the CDS result (simulated)'); await p.click('#b-fix'); await p.waitForFunction(() => /9 of 9/.test(document.querySelector('[data-sum-st]').textContent)) },
    errors: async (p) => { await p.fill('#add-val', 'abc'); await p.click('#b-add'); await p.click('#rec-6'); await p.fill('#fix-val', ''); await p.click('#b-fix'); await p.waitForSelector('#fix-val[aria-invalid=true]') },
    recipe: async (p) => { await p.click('#rec-6'); await p.click('#rc-sum'); await p.waitForSelector('#rc[open]') },
    anchor: async (p) => { await STATES['dashboard/'].corrected(p); await p.click('.tabs a[href="#anchor"]'); await p.click('#b-anchor'); await p.waitForFunction(() => /records 1 to 9\)/.test(document.querySelector('[data-sum-st]').textContent)) },
    instruments: async (p) => { await p.click('.tabs a[href="#instruments"]'); await p.click('#b-sim-TEMP-01'); await p.waitForFunction(() => /9 of 9/.test(document.querySelector('[data-sum-st]').textContent)) },
    method: async (p) => { await p.click('.tabs a[href="#method"]'); await p.waitForSelector('#method.on') },
    hexreason: async (p) => { await p.click('#rec-6'); await p.fill('#fix-val', '1508911'); await p.fill('#fix-why', HEX_REASON); await p.click('#b-fix'); await p.waitForFunction(() => /9 of 9/.test(document.querySelector('[data-sum-st]').textContent)) },
    simulated: async (p) => { await p.click('#rec-6'); await p.click('#b-edit'); await p.waitForSelector('.sim-r') },
    // a deleted record, the rest relinked with no key: every record passes, and only the anchor taken earlier disagrees
    deleted: async (p) => { await p.click('#rec-6'); await p.click('#b-delete'); await p.waitForFunction(() => { const t = document.querySelector('[data-sum-st]').textContent; return /7 of 7 records pass/.test(t) && /simulated anchor does not match/.test(t) && !!document.querySelector('.sim-r') }) },
  },
}
const runsFor = (pg) => [[pg, null], ...Object.keys(STATES[pg] || {}).map((s) => [pg, s])]

// ---------------------------------------------------------------------------------------------- probes
const overflowProbe = () => {
  const vw = document.documentElement.clientWidth, sw = document.documentElement.scrollWidth, offenders = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (!r.width || el.closest('.sr-only,.skip')) continue
    if (r.right > vw + 0.5 || r.left < -0.5) {
      let a = el.parentElement, clipped = false
      while (a && a !== document.body) { const cs = getComputedStyle(a); if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) { const ar = a.getBoundingClientRect(); if (ar.right <= vw + 0.5 && ar.left >= -0.5) { clipped = true; break } } a = a.parentElement }
      if (!clipped) offenders.push(`${el.tagName.toLowerCase()}.${typeof el.className === 'string' ? el.className : ''} L${Math.round(r.left)} R${Math.round(r.right)}`)
    }
  }
  return { vw, sw, over: sw > vw, offenders: offenders.slice(0, 5) }
}
const tapProbe = () => {
  const out = []
  for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [tabindex]:not([tabindex="-1"])')) {
    if (el.closest('[hidden],.skip')) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const t = el.matches('input[type=radio],input[type=checkbox]') && el.closest('label') ? el.closest('label') : el
    const r = t.getBoundingClientRect()
    if (!r.width && !r.height) continue
    if (r.width < 43.5 || r.height < 43.5) {
      // WCAG 2.5.8 exempts links inline in a sentence; they are reported, not failed
      const inline = el.tagName === 'A' && cs.display === 'inline' && /\S/.test((el.parentElement.textContent || '').replace(el.textContent, ''))
      out.push({ el: `${el.tagName.toLowerCase()}.${String(el.className || '').replace(/\s+/g, '.')} "${(el.textContent || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`, w: Math.round(r.width), h: Math.round(r.height), inline })
    }
  }
  return out
}
const minFontProbe = (sel) => {
  let min = 99, where = ''
  const tw = document.createTreeWalker((sel && document.querySelector(sel)) || document.body, NodeFilter.SHOW_TEXT)
  for (let n; (n = tw.nextNode());) {
    if (!n.textContent.trim()) continue
    const el = n.parentElement
    if (el.closest('.sr-only,[hidden],template,script,style')) continue
    if (!el.getClientRects().length) continue
    let a = el, hid = false
    while (a) { if (getComputedStyle(a).display === 'none') { hid = true; break } a = a.parentElement }
    if (hid) continue
    // computed font-size ignores CSS zoom: the size as rendered is that times every zoom around it
    let fs = parseFloat(getComputedStyle(el).fontSize)
    for (let z = el.closest('[style*="zoom"]'); z; z = z.parentElement && z.parentElement.closest('[style*="zoom"]')) fs *= parseFloat(getComputedStyle(z).zoom) || 1
    if (fs < min) { min = fs; where = `${el.tagName.toLowerCase()}.${el.className} "${n.textContent.trim().slice(0, 24)}"` }
  }
  return { min, where }
}
async function traceIdle(cdp, ms) {
  const ev = [], on = (e) => { for (const x of e.value) ev.push(x) }
  cdp.on('Tracing.dataCollected', on)
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame', transferMode: 'ReportEvents' })
  await new Promise((r) => setTimeout(r, ms))
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r))
  await cdp.send('Tracing.end'); await done
  cdp.off('Tracing.dataCollected', on)
  const n = (name) => ev.filter((e) => e.name === name && e.ph !== 'E').length
  return { drawFrame: n('DrawFrame'), paint: n('Paint'), raf: n('FireAnimationFrame'), timers: n('TimerFire') }
}
const COUNT_ANIM = () => {
  window.__anim = 0; window.__fig = {}; window.__bursts = []; window.__vis = {}
  const a = Element.prototype.animate
  let cur = null
  // also counted per Overview story figure ("1" to "7", or "stage"), so a figure's own play can be told apart; the
  // animations one change of state starts together form one burst (its figure, its state, how many, when the last ends);
  // for a static figure, how many of its animated parts were inside the viewport when its play started
  Element.prototype.animate = function (...x) {
    window.__anim++
    const sc = this.closest && this.closest('[data-sc]')
    if (sc) {
      const f = sc.closest('[data-fig]'), k = f ? f.dataset.fig : 'stage', o = x[1] || {}
      window.__fig[k] = (window.__fig[k] || 0) + 1
      if (!cur || cur.k !== k) { cur = { k, s: sc.dataset.s, n: 0, end: 0 }; if (f && !window.__vis[k]) cur.vis = window.__vis[k] = [0, 0]; window.__bursts.push(cur); queueMicrotask(() => { cur = null }) }
      cur.n++; cur.end = Math.max(cur.end, (o.delay || 0) + (o.duration || 0))
      if (cur.vis) { const r = this.getBoundingClientRect(); if (r.width || r.height) { cur.vis[1]++; if (r.top >= 0 && r.bottom <= innerHeight) cur.vis[0]++ } }
    }
    return a.apply(this, x)
  }
}
const text = (p, sel) => p.evaluate((s) => (document.querySelector(s) || document.body).innerText.replace(/\s+/g, ' ').trim(), sel)

// ---------------------------------------------------------------------------------------------- 0. links
// Every href and src in the rendered DOM (after the scripts ran, so console views count too), resolved as the browser
// resolves it (the 404 page's <base> included), fetched from the server: each must answer 200, and each #fragment must
// name an element in its target. Subresources that fail (a font in CSS, say) fail too. The 404 page is also opened at
// nested missing paths, as GitHub Pages serves it there.
console.log(`checking ${PAGES.join(' ')} at ${BASE}`)
{
  const ctx = await ctxFor(390, 844), p = await ctx.newPage(), seen = new Map()
  const fetchOnce = async (u) => {
    if (!seen.has(u)) { const r = await ctx.request.get(u); seen.set(u, { status: r.status(), body: /html/.test(r.headers()['content-type'] || '') ? await r.text() : '' }) }
    return seen.get(u)
  }
  const extra = (PAGES.includes('404.html') ? ['missing/deep/page', 'dashboard/missing'] : []).concat(PAGES.includes('dashboard/') ? ['dashboard'] : [])
  let refs = 0
  for (const pg of PAGES.concat(extra)) {
    const bad = []
    const onResp = (r) => { if (r.status() >= 400 && r.url() !== BASE + pg) bad.push(`${r.status()} ${r.url().replace(BASE, '')}`) }
    p.on('response', onResp)
    await p.goto(BASE + pg, { waitUntil: 'networkidle' })
    await p.evaluate(() => document.fonts.ready)
    p.off('response', onResp)
    const found = await p.evaluate(() => ({
      refs: [...document.querySelectorAll('[href],[src]')].filter((e) => e.tagName.toLowerCase() !== 'use').map((e) => { const raw = e.getAttribute('href') ?? e.getAttribute('src'); return { raw, abs: new URL(raw, document.baseURI).href } }),
      sprite: [...document.querySelectorAll('use')].map((u) => u.getAttribute('href')).filter((h) => !h.startsWith('#') || !document.getElementById(h.slice(1))),
      self: [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href')).filter((h) => h.length > 1 && !document.getElementById(h.slice(1))),
    }))
    for (const { raw, abs } of found.refs) {
      if (!abs.startsWith(BASE)) continue
      refs++
      const [u, frag] = abs.split('#')
      const r = await fetchOnce(u)
      if (r.status !== 200) fail(`link: ${pg} ${raw} → ${u.replace(BASE, '')} answers ${r.status}`)
      else if (frag && r.body && !r.body.includes(`id="${frag}"`) && u !== p.url().split('#')[0]) fail(`link: ${pg} ${raw} → no id="${frag}" in ${u.replace(BASE, '')}`)
    }
    await cspCheck(p, pg)
    for (const h of found.sprite) fail(`link: ${pg} <use href="${h}"> has no symbol on the page`)
    for (const h of found.self) fail(`link: ${pg} ${h} has no target on the page`)
    for (const x of bad) fail(`link: ${pg} subresource ${x}`)
  }
  // what must never be published answers 404 from the deploy view (the page itself, the 404 page, is the body)
  if (!ARGS.repo) for (const u of ['site/build.mjs', 'site/HANDOFF.md', 'site/data/site.json', 'contracts/README.md', 'contracts/RootRegistry.sol', 'dashboard/registry-abi.js', 'dashboard/registry-artifact.js', '.github/workflows/pages.yml', '.nojekyll', 'README.md']) {
    const r = await ctx.request.get(BASE + u)
    if (r.status() !== 404) fail(`deploy: ${u} answers ${r.status()}; it must not be published`)
  }
  R.links = { pages: PAGES.length + extra.length, refs, targets: seen.size, deploy: ARGS.repo ? null : served.files }
  console.log(`links: ${refs} same-origin references on ${PAGES.length + extra.length} pages, ${seen.size} distinct targets`)
  await ctx.close()
}

// ---------------------------------------------------------------------------------------------- 1. overflow, taps, smallest text
for (const w of WIDTHS) {
  const ctx = await ctxFor(w, 800), p = await ctx.newPage()
  const runs = PAGES.flatMap(runsFor).concat(w === 320 || w === 1280 ? [['missing/page', null]] : [])
  for (const [pg, s] of runs) {
    await p.goto(BASE + pg, { waitUntil: 'load' })
    await p.evaluate(() => document.fonts.ready)
    await p.waitForTimeout(80)
    if (s) await STATES[pg][s](p)
    const o = await p.evaluate(overflowProbe)
    await cspCheck(p, `${pg} ${s || ''} at ${w}`)
    if (w === 390 && pg === 'check.html' && s === 'corrected') {
      // the appended record's chip is named for what it is, never for the chip it was cloned from
      const names = await p.evaluate(() => [...document.querySelectorAll('[data-chips] .chip')].map((c) => c.querySelector('.sr-only:not([data-cs])').textContent))
      R.chipNames = names
      if (names[8] !== 'Record 9, correction of record 6: ' || names.slice(0, 8).some((n, i) => !n.startsWith(`Record ${i + 1}, injection 0${i + 1},`))) fail(`chips: accessible names after a correction: ${JSON.stringify(names)}`)
    }
    R.overflow.push({ w, pg, s, ...o })
    if (o.over || o.offenders.length) fail(`overflow at ${w}: ${pg} ${s || ''} scrollWidth ${o.sw} > ${o.vw} ${o.offenders.join(' | ')}`)
    if ([320, 390, 1280].includes(w)) {
      const t = await p.evaluate(tapProbe)
      R.taps[`${w} ${pg} ${s || ''}`] = t
      for (const x of t.filter((x) => !x.inline)) fail(`tap target under 44 px at ${w}: ${pg} ${s || ''} ${x.el} ${x.w}×${x.h}`)
    }
    if (w === 320) { const m = await p.evaluate(minFontProbe); R.minFont[`${pg} ${s || ''}`] = m; if (m.min < 12) fail(`text under 12 px at 320: ${pg} ${s || ''} ${m.min}px ${m.where}`) }
  }
  await ctx.close()
}
console.log(`overflow: ${R.overflow.length} runs, ${R.overflow.filter((o) => o.over || o.offenders.length).length} with overflow`)

// ---------------------------------------------------------------------------------------------- 1b. the flow figures (Overview, Figs. 4 and 5)
// Immutable QC is drawn where it takes a result: Fig. 4's upcoming seal at the orchestrator or driver (node 2) and today's
// HPLC CSV export at the data pipeline (node 3); Fig. 5's export at the CDS (node 2). Below 900 px the figure is one
// column and the Immutable QC branch hangs between node 2 and node 3, never under the last node; from 900 px each
// connector drops from its own node's column. Each lane stays a list of four items in the accessibility tree.
if (PAGES.includes('index.html')) {
  R.flow = []
  for (const w of [320, 390, 768, 1024, 1440]) {
    const ctx = await ctxFor(w, 800), p = await ctx.newPage(), cdp = await ctx.newCDPSession(p)
    await p.goto(BASE + 'index.html', { waitUntil: 'load' }); await p.evaluate(() => document.fonts.ready)
    const m = await p.evaluate(() => [...document.querySelectorAll('#fits figure.flow')].map((f) => {
      const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { t: Math.round(b.top + scrollY), b: Math.round(b.bottom + scrollY), l: Math.round(b.left), r: Math.round(b.right) } }
      const n = [...f.querySelectorAll('.lane > .node')].map(r)
      return { id: f.getAttribute('aria-labelledby'), n, up: r(f.querySelector('.iqc-in--up')), today: r(f.querySelector('.iqc-in--today')), into: r(f.querySelector('.iqc-in:not(.iqc-in--up):not(.iqc-in--today)')), box: r(f.querySelector('.iqc-box')), out: r(f.querySelector('.iqc-out')) }
    }))
    const bad = []
    for (const f of m) {
      const [, n2, n3, n4] = f.n, ins = [f.up, f.today, f.into].filter(Boolean)
      if (f.n.length !== 4 || !ins.length) { bad.push(`${f.id}: ${f.n.length} nodes, ${ins.length} connectors`); continue }
      if (w < 900) {
        const between = (e) => e.t >= n2.b - 1 && e.b <= n3.t + 1
        for (const e of [...ins, f.box]) if (!between(e)) bad.push(`${f.id}: a part of the Immutable QC branch (${e.t}–${e.b}) is not between node 2 (bottom ${n2.b}) and node 3 (top ${n3.t})`)
        if (f.up && !(f.up.b <= f.box.t + 1)) bad.push(`${f.id}: the upcoming seal does not enter the box from node 2's side`)
        if (f.today && !(f.today.t >= f.box.b - 1 && Math.abs(f.today.b - n3.t) <= 1)) bad.push(`${f.id}: today's export does not run from node 3 into the box`)
        if (f.out && !(f.out.t >= n4.b)) bad.push(`${f.id}: the upcoming check sits above the last node`)
      } else {
        const under = (e, nd) => e.l >= nd.l - 1 && e.l < nd.r && e.t >= nd.b - 1
        if (f.up && !under(f.up, n2)) bad.push(`${f.id}: the upcoming seal does not drop from node 2's column`)
        if (f.today && !under(f.today, n3)) bad.push(`${f.id}: today's export does not drop from node 3's column`)
        if (f.into && !under(f.into, n2)) bad.push(`${f.id}: the export does not drop from node 2's column`)
      }
    }
    if (m.length !== 2 || !m[0].up || !m[0].today || m[0].into || !m[1].into || m[1].up || m[1].today) bad.push(`figures: ${JSON.stringify(m.map((f) => [f.id, !!f.up, !!f.today, !!f.into]))}`)
    // each lane as Chrome's accessibility tree has it: a list, not ignored, with its four list items
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '#fits figure.flow ol.lane' })
    for (const id of nodeIds) {
      const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId: id, fetchRelatives: false })
      const li = await cdp.send('DOM.querySelectorAll', { nodeId: id, selector: ':scope > li' })
      const items = []
      for (const lid of li.nodeIds) { const { nodes: ln } = await cdp.send('Accessibility.getPartialAXTree', { nodeId: lid, fetchRelatives: false }); items.push(ln[0] && !ln[0].ignored && ln[0].role && ln[0].role.value) }
      if (!(nodes[0] && !nodes[0].ignored && nodes[0].role && nodes[0].role.value === 'list' && items.length === 4 && items.every((r) => r === 'listitem'))) bad.push(`a lane is not a list of four items in the accessibility tree: ${JSON.stringify([nodes[0] && nodes[0].role, items])}`)
    }
    R.flow.push({ w, m, bad })
    for (const x of bad) fail(`flow figures at ${w}: ${x}`)
    await ctx.close()
  }
  console.log(`flow figures: ${R.flow.length} widths, ${R.flow.reduce((a, x) => a + x.bad.length, 0)} problems`)
}

// ---------------------------------------------------------------------------------------------- 2. axe at 375 and 1280
for (const w of [375, 1280]) {
  const ctx = await ctxFor(w, 800, { bypassCSP: true }), p = await ctx.newPage()
  for (const [pg, s] of PAGES.flatMap(runsFor)) {
    await p.goto(BASE + pg, { waitUntil: 'networkidle' })
    await settle(p)
    if (s) await STATES[pg][s](p)
    await p.addScriptTag({ content: AXE })
    const r = await p.evaluate(async () => { const x = await axe.run(document, { resultTypes: ['violations'] }); return x.violations.map((v) => ({ id: v.id, n: v.nodes.length, t: v.nodes.slice(0, 2).map((n) => n.target.join(' ')) })) })
    R.axe.push({ w, pg, s, violations: r })
    for (const v of r) fail(`axe at ${w}: ${pg} ${s || ''} ${v.id} ×${v.n} ${v.t.join(' ; ')}`)
  }
  await ctx.close()
}
console.log(`axe: ${R.axe.length} runs, ${R.axe.reduce((a, x) => a + x.violations.length, 0)} violations`)

// ---------------------------------------------------------------------------------------------- 3. frames at rest, motion
for (const [w, h] of [[390, 844], [1440, 900]]) {
  const ctx = await ctxFor(w, h), p = await ctx.newPage(), cdp = await ctx.newCDPSession(p)
  for (const pg of PAGES) {
    await p.goto(BASE + pg, { waitUntil: 'networkidle' })
    await p.waitForTimeout(1200)
    const steps = [['top, after load', async () => {}], ['after scrolling through (one-shot motion played)', async () => settle(p)]]
    if (pg === 'dashboard/') steps.push(['after an edit (blurred)', async () => { await STATES[pg].edited(p); await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(800) }], ['after Rewrite', async () => { await p.click('#b-rewrite'); await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(800) }], ['after a correction and an anchor', async () => { await p.click('#b-reset'); await p.waitForTimeout(300); await STATES[pg].anchor(p); await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(800) }])
    if (pg === 'check.html') steps.push(['after an edit (blurred)', async () => { await p.fill('#f-value', '1508911'); await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(800) }], ['after Rewrite', async () => { await p.click('[data-act=rewrite]'); await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(800) }])
    for (const [label, act] of steps) {
      await act()
      const t = await traceIdle(cdp, 3000)
      const anims = await p.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)
      R.rest.push({ w, pg, label, ...t, anims })
      if (t.drawFrame || t.raf || anims) fail(`frames at rest at ${w}: ${pg} ${label}: DrawFrame ${t.drawFrame}, rAF ${t.raf}, running animations ${anims}`)
    }
  }
  await ctx.close()
}
{
  // reduced motion: no WAAPI motion at all; hidden tab (emulated): the record history settles without motion
  const ctx = await ctxFor(390, 844, { reduced: true }), p = await ctx.newPage()
  await p.addInitScript(COUNT_ANIM)
  for (const pg of PAGES) {
    await p.goto(BASE + pg, { waitUntil: 'networkidle' }); await settle(p)
    if (pg === 'check.html' || isConsole(pg)) await STATES[pg].edited(p)
    const n = await p.evaluate(() => window.__anim)
    R.motion.push({ mode: 'reduced motion', pg, animations: n })
    if (n) fail(`reduced motion: ${pg} started ${n} animations`)
  }
  await ctx.close()
  if (PAGES.includes('index.html')) {
    const c2 = await ctxFor(390, 844), q = await c2.newPage()
    await q.addInitScript(() => { Object.defineProperty(Document.prototype, 'hidden', { get: () => true }); Object.defineProperty(Document.prototype, 'visibilityState', { get: () => 'hidden' }) })
    await q.addInitScript(COUNT_ANIM)
    await q.goto(BASE + 'index.html', { waitUntil: 'networkidle' }); await settle(q)
    const r = await q.evaluate(() => ({ n: window.__anim, st: document.querySelector('[data-hist-st]').textContent, sealed: document.querySelectorAll('.hist tr.ok').length }))
    R.motion.push({ mode: 'hidden tab (emulated)', pg: 'index.html', animations: r.n, status: r.st, sealedRows: r.sealed })
    if (r.n || r.sealed !== 8 || !/8 of 8 records pass/.test(r.st)) fail(`hidden tab: index.html animations ${r.n}, sealed rows ${r.sealed}, status "${r.st}"`)
    await c2.close()
  }
  {
    const c3 = await ctxFor(1440, 900), q = await c3.newPage()
    await q.addInitScript(COUNT_ANIM)
    await q.goto(BASE + 'index.html', { waitUntil: 'networkidle' })
    const before = await q.evaluate(() => ({ n: window.__anim, sealed: document.querySelectorAll('.hist tr.ok').length }))
    await q.evaluate(() => document.querySelector('.hist').scrollIntoView({ block: 'center' })); await q.waitForTimeout(2500)
    const after = await q.evaluate(() => ({ n: window.__anim, sealed: document.querySelectorAll('.hist tr.ok').length, running: document.getAnimations().length }))
    R.motion.push({ mode: 'Fig. 3 seal-in', pg: 'index.html', before, after })
    if (after.sealed !== 8 || after.running) fail(`Fig. 3 seal-in: ${JSON.stringify({ before, after })}`)
    await c3.close()
  }
}
console.log(`rest: ${R.rest.length} idle windows, ${R.rest.filter((r) => r.drawFrame || r.anims).length} with frames`)

// ---------------------------------------------------------------------------------------------- 3b. the Overview story
// Section 2 of the Overview: seven steps, one static figure each; on wide screens one sticky stage. Checked: the stage
// plays each step in under a second and then holds (0 frames), a fast scroll is at most two morphs and never queues,
// phones play each figure once, with most of it in view, reduced motion and a hidden tab animate nothing, the keyboard
// reaches and plays the steps, nothing sticky covers a phone, every figure has a name and a caption in the
// accessibility tree (the stage is hidden from it), axe and overflow in several states, the stage fits at its smallest
// sizes, a window resized in height renews it, and a URL bar (phone or tablet) never moves the layout or the step.
const ST_TITLES = ['Captured', 'Fingerprinted', 'Signed', 'Linked', 'A change shows', 'A correction is appended', 'What comes next']
// scroll the step's heading into the band at mid-viewport in a few small moves, as a reader would
const toBand = async (p, k, moves = 6) => {
  const y = await p.evaluate((k) => { const h = document.querySelector(`#st-${k} h3`).getBoundingClientRect(); return scrollY + h.top + h.height / 2 - innerHeight * 0.49 }, k)
  const y0 = await p.evaluate(() => scrollY)
  for (let i = 1; i <= moves; i++) { await p.evaluate((v) => scrollTo(0, v), y0 + ((y - y0) * i) / moves); await p.waitForTimeout(30) }
}
const stageNow = (p) => p.evaluate(() => ({ s: document.querySelector('[data-stage] [data-sc]').dataset.s, cur: (document.querySelector('.step-a[aria-current="step"]') || {}).textContent || '', n: window.__anim || 0, b: (window.__bursts || []).length, running: document.getAnimations().filter((a) => a.playState === 'running').length }))
// each story figure as the accessibility tree has it (Chrome's own, through DevTools): role, name, ignored
const figTree = async (cdp) => {
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 })
  const out = []
  for (const [sel, stage] of [['#story figure.sf:not(.sf--stage)', false], ['#story figure.sf--stage', true]]) {
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: sel })
    for (const id of nodeIds) { const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId: id, fetchRelatives: false }); const n = nodes[0] || {}; out.push({ stage, role: n.role && n.role.value, name: ((n.name && n.name.value) || '').slice(0, 40), ignored: !!n.ignored }) }
  }
  return out
}
const figTreeOk = (t) => t.filter((x) => !x.stage).length === 7 && t.filter((x) => !x.stage).every((x, i) => !x.ignored && x.role === 'figure' && x.name.startsWith(`Fig. 2.${i + 1} · `)) && t.filter((x) => x.stage).every((x) => x.ignored)
if (PAGES.includes('index.html')) {
  const S = (R.story = { desk: [], fast: [], keys: [], phone: [], reduced: [], hidden: null, sticky: [], axe: [], overflow: [], urlbar: [], names: [], fit: [], resize: [], estimates: [], cost: null })
  const title = (k) => ST_TITLES[k - 1]
  // 1. wide screens: every step plays in under a second, then nothing moves
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const ctx = await ctxFor(w, h), p = await ctx.newPage(), cdp = await ctx.newCDPSession(p)
    await p.addInitScript(COUNT_ANIM)
    await p.goto(BASE + 'index.html', { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready)
    const wide = await p.evaluate(() => document.documentElement.classList.contains('stage') && getComputedStyle(document.querySelector('.step-stage')).position === 'sticky' && [...document.querySelectorAll('.step .sf .sc')].every((f) => getComputedStyle(f).display === 'none'))
    if (!wide) fail(`story at ${w}×${h}: the sticky stage is not shown (or the step plates are not hidden)`)
    // the stage is aria-hidden; each step's figure stays in the tree, named by its caption
    const names = await figTree(cdp)
    S.names.push({ w, h, names })
    if (!figTreeOk(names)) fail(`story at ${w}×${h}: figures in the accessibility tree: ${JSON.stringify(names)}`)
    for (let k = 1; k <= 7; k++) {
      const before = await stageNow(p)
      await toBand(p, k); await p.waitForTimeout(1600)
      const a = await stageNow(p), t = await traceIdle(cdp, 1200), b = await stageNow(p)
      const bursts = await p.evaluate((n) => window.__bursts.slice(n).filter((x) => x.k === 'stage'), before.b)
      const r = { w, h, k, state: a.s, current: a.cur.trim(), played: a.n - before.n, span: Math.max(0, ...bursts.map((x) => x.end)), ...t, running: b.running }
      S.desk.push(r)
      if (a.s !== String(k) || !r.current.startsWith(title(k))) fail(`story at ${w}×${h}, step ${k}: stage in state ${a.s}, current step "${r.current}"`)
      if (!r.played) fail(`story at ${w}×${h}, step ${k}: no animation played`)
      if (r.span > 1000) fail(`story at ${w}×${h}, step ${k}: the step plays for ${r.span} ms (at most 1000)`)
      if (t.drawFrame || t.raf || b.running) fail(`story at ${w}×${h}, step ${k}: frames at rest: DrawFrame ${t.drawFrame}, rAF ${t.raf}, running ${b.running}`)
    }
    // a fast scroll through every step, up and then down: at most two morphs (the first step, then one crossfade to
    // where it ends), never a queue, and the stage ends on the step in the band
    for (const dir of ['up', 'down']) {
      const ks = dir === 'up' ? [7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7]
      let most = 0
      const b0 = (await stageNow(p)).b
      for (const k of ks) { await toBand(p, k, 1); await p.waitForTimeout(25); most = Math.max(most, (await stageNow(p)).running) }
      await p.waitForTimeout(1600)
      const a = await stageNow(p), t = await traceIdle(cdp, 1200), end = ks[ks.length - 1]
      const morphs = await p.evaluate((n) => window.__bursts.slice(n).filter((x) => x.k === 'stage').length, b0)
      S.fast.push({ w, h, dir, state: a.s, mostRunning: most, morphs, ...t })
      if (a.s !== String(end)) fail(`story at ${w}×${h}, fast scroll ${dir}: stage ends in state ${a.s}, not ${end}`)
      if (morphs > 2) fail(`story at ${w}×${h}, fast scroll ${dir}: ${morphs} stage morphs (at most 2: a fast scroll is one crossfade)`)
      if (t.drawFrame || t.raf || a.running) fail(`story at ${w}×${h}, fast scroll ${dir}: frames at rest: DrawFrame ${t.drawFrame}, rAF ${t.raf}, running ${a.running}`)
      // never more running at once than the largest single step change plus the rail: one morph at a time, no queue
      const one = Math.max(...S.desk.filter((x) => x.w === w).map((x) => x.played)) + 14
      if (most > one) fail(`story at ${w}×${h}, fast scroll ${dir}: ${most} animations running at once, more than one step change (${one}): a queue`)
    }
    // the keyboard: every step heading is reachable with Tab, and Enter makes it current and plays it, and only it (the
    // stage never flips back to an earlier step on the way)
    if (w === 1440) {
      await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(300)
      await p.focus('#st-1 .step-a')
      for (let k = 2; k <= 7; k++) {
        let found = false
        // focusing a heading may already scroll its step into the band; Enter then plays it if focus did not
        const before = await stageNow(p)
        for (let i = 0; i < 12 && !found; i++) { await p.keyboard.press('Tab'); found = await p.evaluate((k) => document.activeElement && document.activeElement.matches(`#st-${k} .step-a`), k) }
        if (!found) { fail(`story keyboard: Tab does not reach step ${k}`); continue }
        const mid = await stageNow(p)
        await p.keyboard.press('Enter'); await p.waitForTimeout(1500)
        const a = await stageNow(p)
        const states = await p.evaluate((n) => window.__bursts.slice(n).filter((x) => x.k === 'stage').map((x) => x.s), mid.b)
        const vis = await p.evaluate(() => { const r = document.activeElement.getBoundingClientRect(), s = document.querySelector('.step-stage').getBoundingClientRect(); return { inView: r.top >= 0 && r.bottom <= innerHeight, underStage: r.right > s.left && r.left < s.right && r.bottom > s.top && r.top < s.bottom, ring: getComputedStyle(document.activeElement).outlineStyle } })
        S.keys.push({ k, state: a.s, current: a.cur.trim(), played: a.n - before.n, states, ...vis })
        if (a.s !== String(k) || !a.cur.trim().startsWith(title(k)) || a.n === before.n) fail(`story keyboard: Enter on step ${k} gives state ${a.s}, current "${a.cur.trim()}", ${a.n - before.n} animations`)
        if (states.some((s) => s !== String(k))) fail(`story keyboard: Enter on step ${k} passed through states ${states.join(',')}`)
        if (!vis.inView || vis.underStage) fail(`story keyboard: the focused step ${k} heading is ${vis.inView ? 'under the stage' : 'out of view'}`)
      }
    }
    // axe and overflow with the stage in several states
    if (w === 1440) for (const k of [1, 3, 5, 6, 7]) {
      await toBand(p, k); await p.waitForTimeout(1500)
      const o = await p.evaluate(overflowProbe)
      S.overflow.push({ w, k, ...o })
      if (o.over || o.offenders.length) fail(`story overflow at ${w}, step ${k}: ${o.offenders.join(' | ')}`)
    }
    await ctx.close()
  }
  {
    // axe needs its script inline, so this context bypasses the CSP
    const ctx = await ctxFor(1440, 900, { bypassCSP: true }), p = await ctx.newPage()
    await p.goto(BASE + 'index.html', { waitUntil: 'networkidle' }); await p.addScriptTag({ content: AXE })
    for (const k of [1, 2, 4, 5, 6, 7]) {
      await toBand(p, k); await p.waitForTimeout(1500)
      const r = await p.evaluate(async () => (await axe.run(document.querySelector('#story'), { resultTypes: ['violations'] })).violations.map((v) => ({ id: v.id, n: v.nodes.length, t: v.nodes.slice(0, 2).map((n) => n.target.join(' ')) })))
      S.axe.push({ w: 1440, k, violations: r })
      for (const v of r) fail(`story axe at 1440, step ${k}: ${v.id} ×${v.n} ${v.t.join(' ; ')}`)
    }
    await ctx.close()
  }
  // the stage at its smallest sizes: shown, at full size (no zoom), whole in the window while it is pinned, its text at
  // least 12 px as rendered
  for (const [w, h] of [[1180, 600], [1440, 600], [960, 700], [1024, 700]]) {
    const ctx = await ctxFor(w, h), p = await ctx.newPage()
    await p.goto(BASE + 'index.html', { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready)
    await toBand(p, 5); await p.waitForTimeout(1300)
    const r = await p.evaluate(() => { const st = document.querySelector('[data-stage]'), b = st.getBoundingClientRect(); return { stage: document.documentElement.classList.contains('stage'), top: Math.round(b.top), bottom: Math.round(b.bottom), zoom: getComputedStyle(st.querySelector('[data-sc]')).zoom } })
    const m = await p.evaluate(minFontProbe, '[data-stage]')
    S.fit.push({ w, h, ...r, minFont: m })
    if (!r.stage || r.top < 0 || r.bottom > h || (r.zoom && r.zoom !== '1')) fail(`story stage at ${w}×${h}: ${JSON.stringify(r)}`)
    if (m.min < 12) fail(`story stage at ${w}×${h}: text under 12 px: ${m.min}px ${m.where}`)
    await ctx.close()
  }
  // what a step change costs the main thread on a slow machine (CPU 4×): each observer or timer callback that starts a
  // morph reads only the parts it changes, so the median stays under 50 ms (a long task, and a delay to any input then)
  {
    const ctx = await ctxFor(1280, 800), p = await ctx.newPage(), cdp = await ctx.newCDPSession(p)
    await p.addInitScript(() => {
      window.__cost = []
      const time = (f) => function (...a) { const t = performance.now(); const r = f.apply(this, a); const d = performance.now() - t; if (d > 1) window.__cost.push(+d.toFixed(1)); return r }
      const IO = window.IntersectionObserver, st = window.setTimeout
      window.IntersectionObserver = class extends IO { constructor(cb, o) { super(time(cb), o) } }
      window.setTimeout = (f, ms, ...a) => st(time(() => f(...a)), ms)
    })
    await p.goto(BASE + 'index.html', { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    for (const k of [1, 2, 3, 4, 5, 6, 7, 6, 5]) { await toBand(p, k, 3); await p.waitForTimeout(1600) }
    const c = await p.evaluate(() => window.__cost.sort((a, b) => a - b))
    const med = c.length ? c[c.length >> 1] : 0
    S.cost = { callbacks: c, median: med, max: c.length ? c[c.length - 1] : 0 }
    if (c.length < 9 || med >= 50) fail(`story at 1280×800, CPU 4×: a step change costs ${med} ms (median of ${c.length}; at most 50)`)
    await ctx.close()
  }
  // a desktop window made shorter: --svh follows, and the pinned stage stays whole in the window
  {
    const ctx = await ctxFor(1440, 900), p = await ctx.newPage()
    await p.goto(BASE + 'index.html', { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready)
    await toBand(p, 5); await p.waitForTimeout(1300)
    await p.setViewportSize({ width: 1440, height: 640 }); await p.waitForTimeout(400)
    await toBand(p, 5); await p.waitForTimeout(1300)
    const r = await p.evaluate(() => { const b = document.querySelector('[data-stage]').getBoundingClientRect(); return { svh: document.documentElement.style.getPropertyValue('--svh'), stage: document.documentElement.classList.contains('stage'), top: Math.round(b.top), bottom: Math.round(b.bottom), h: innerHeight, s: document.querySelector('[data-stage] [data-sc]').dataset.s } })
    S.resize.push(r)
    if (r.svh !== '640px' || !r.stage || r.top < 0 || r.bottom > r.h || r.s !== '5') fail(`story, desktop resized to 1440×640: ${JSON.stringify(r)}`)
    await ctx.close()
  }
  // overflow at every width in a few states: the stage on each step from 960 up, the played figures below
  for (const w of WIDTHS) {
    const ctx = await ctxFor(w, 900), p = await ctx.newPage()
    await p.goto(BASE + 'index.html', { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready)
    for (const k of [2, 5, 6, 7]) {
      await (w >= 960 ? toBand(p, k) : p.evaluate((k) => document.querySelector(`#st-${k} .sf`).scrollIntoView({ block: 'center' }), k)); await p.waitForTimeout(1300)
      const o = await p.evaluate(overflowProbe)
      S.overflow.push({ w, k, ...o })
      if (o.over || o.offenders.length) fail(`story overflow at ${w}, step ${k}: scrollWidth ${o.sw} > ${o.vw} ${o.offenders.join(' | ')}`)
    }
    await ctx.close()
  }
  // the narrowest phone: every figure's text stays inside its plate's content box, in both of its states
  {
    const ctx = await ctxFor(320, 700), p = await ctx.newPage()
    await p.goto(BASE + 'index.html', { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready)
    const out = await p.evaluate(() => {
      const bad = []
      for (const sc of document.querySelectorAll('.step .sf .sc')) {
        sc.style.contentVisibility = 'visible'
        const s0 = sc.dataset.s
        for (const s of [sc.dataset.from, s0]) {
          sc.dataset.s = s
          const cs = getComputedStyle(sc), b = sc.getBoundingClientRect(), l = b.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth) - 1.5, r = b.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth) + 1.5
          for (const el of sc.querySelectorAll('*')) { const e = el.getBoundingClientRect(); if (e.width && getComputedStyle(el).visibility !== 'hidden' && (e.left < l || e.right > r) && !el.closest('svg')) bad.push(`fig ${sc.closest('[data-fig]').dataset.fig} state ${s}: ${el.tagName.toLowerCase()}.${el.getAttribute('class') || ''} ${Math.round(e.left)}–${Math.round(e.right)} outside ${Math.round(l)}–${Math.round(r)}`) }
          // labels in one row may not overlap each other
          const row = [...sc.querySelectorAll('.ch-top > *')].filter((x) => getComputedStyle(x).visibility !== 'hidden').map((x) => [x, x.getBoundingClientRect()])
          for (const [x, a] of row) for (const [y, c] of row) if (x !== y && a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom) bad.push(`fig ${sc.closest('[data-fig]').dataset.fig} state ${s}: "${x.textContent.trim()}" overlaps "${y.textContent.trim()}"`)
        }
        sc.dataset.s = s0
      }
      return [...new Set(bad)]
    })
    S.overflow.push({ w: 320, inside: out })
    for (const x of out.slice(0, 8)) fail(`story at 320: ${x}`)
    await ctx.close()
  }
  // 2. phones: no stage, nothing sticky; each figure waits, plays once when it comes into view (with most of its
  // animated parts inside the window, scrolled into view as a reader scrolls), then holds
  for (const [w, h] of [[320, 568], [390, 844], [390, 664]]) {
    const ctx = await ctxFor(w, h), p = await ctx.newPage(), cdp = await ctx.newCDPSession(p)
    await p.addInitScript(COUNT_ANIM)
    await p.goto(BASE + 'index.html', { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready)
    const sticky = await p.evaluate(() => [...document.querySelectorAll('#story *')].filter((e) => /sticky|fixed/.test(getComputedStyle(e).position) && e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return { el: e.className, cover: +(r.height / innerHeight).toFixed(2) } }))
    S.sticky.push({ w, h, sticky })
    for (const x of sticky) if (x.cover > 0.3) fail(`story at ${w}: a sticky element covers ${Math.round(x.cover * 100)}% of the viewport`)
    const stageShown = await p.evaluate(() => getComputedStyle(document.querySelector('.step-stage')).display !== 'none')
    if (stageShown) fail(`story at ${w}: the stage shows on a phone`)
    // named by their captions even before they are first rendered (content-visibility skips the plates off screen)
    if (h === 844) {
      const names = await figTree(cdp)
      S.names.push({ w, h, names })
      if (!figTreeOk(names)) fail(`story at ${w}×${h}: figures in the accessibility tree before they are rendered: ${JSON.stringify(names)}`)
    }
    const waiting = await p.evaluate(() => [...document.querySelectorAll('.step .sf [data-sc]')].map((sc) => sc.dataset.s === sc.dataset.from))
    for (let k = 1; k <= 7; k++) {
      // scroll down 40 px at a time from where the figure's top meets the bottom of the window until it plays (by the
      // time its bottom reaches the top of the window at the latest)
      const [top, fh] = await p.evaluate((k) => { const r = document.querySelector(`#st-${k} .sf [data-sc]`).getBoundingClientRect(); return [r.top + scrollY, r.height] }, k)
      let y = Math.max(0, top - h), at = null
      while (y <= top + fh) {
        await p.evaluate((v) => scrollTo(0, v), y); await p.waitForTimeout(40)
        if (await p.evaluate((k) => !!(window.__vis || {})[String(k)], k)) { at = await p.evaluate((k) => Math.round(document.querySelector(`#st-${k} .sf [data-sc]`).getBoundingClientRect().top), k); break }
        y += 40
      }
      if (at === null) { await p.evaluate((v) => scrollTo(0, v), top - 24); await p.waitForTimeout(200) }
      await p.waitForTimeout(1500)
      const a = await p.evaluate((k) => ({ s: document.querySelector(`#st-${k} [data-sc]`).dataset.s, played: window.__fig[String(k)] || 0, vis: window.__vis[String(k)] || null, running: document.getAnimations().filter((x) => x.playState === 'running').length }), k)
      const t = await traceIdle(cdp, 1000)
      S.phone.push({ w, h, k, waited: waiting[k - 1], playedAtTop: at, state: a.s, played: a.played, inView: a.vis, ...t, running: a.running })
      if (a.s !== String(k)) fail(`story at ${w}×${h}, figure ${k}: in state ${a.s} after it came into view`)
      if (waiting[k - 1] && !a.played) fail(`story at ${w}×${h}, figure ${k}: it waited but did not play`)
      if (waiting[k - 1] && a.vis && a.vis[0] < 0.8 * a.vis[1]) fail(`story at ${w}×${h}, figure ${k}: only ${a.vis[0]} of its ${a.vis[1]} animated parts were in view when it played`)
      if (t.drawFrame || t.raf || a.running) fail(`story at ${w}×${h}, figure ${k}: frames at rest: DrawFrame ${t.drawFrame}, rAF ${t.raf}, running ${a.running}`)
    }
    if (!waiting.slice(1).every(Boolean)) fail(`story at ${w}: figures below the fold should wait in the state before theirs (${waiting.join(',')})`)
    // the smallest text in the figures, rendered (off screen they are skipped by the page-wide probe)
    if (w === 320) {
      await p.evaluate(() => document.querySelectorAll('.step .sf .sc').forEach((sc) => { sc.style.contentVisibility = 'visible' }))
      const m = await p.evaluate(minFontProbe)
      S.phone.push({ w, minFont: m })
      if (m.min < 12) fail(`story at 320: text under 12 px in a figure: ${m.min}px ${m.where}`)
    }
    // once: back up and down again, nothing plays
    const n0 = (await stageNow(p)).n
    for (let k = 7; k >= 1; k--) { await p.evaluate((k) => document.querySelector(`#st-${k} .sf`).scrollIntoView({ block: 'center' }), k); await p.waitForTimeout(120) }
    for (let k = 1; k <= 7; k++) { await p.evaluate((k) => document.querySelector(`#st-${k} .sf`).scrollIntoView({ block: 'center' }), k); await p.waitForTimeout(120) }
    const again = (await stageNow(p)).n - n0
    S.phone.push({ w, h, replay: again })
    if (again) fail(`story at ${w}: ${again} animations on a second pass (each figure plays once)`)
    if (await p.evaluate(() => window.__fig.stage)) fail(`story at ${w}: the hidden stage animated`)
    await ctx.close()
  }
  // each figure's height before it is first rendered (contain-intrinsic-size, one estimate per band of widths) is within
  // 25% of its rendered height, at the widths a phone or tablet shows the figures
  for (const w of [320, 390, 412, 600, 768]) {
    const ctx = await ctxFor(w, 800), p = await ctx.newPage()
    await p.goto(BASE + 'index.html', { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready)
    const est = await p.evaluate(() => [...document.querySelectorAll('.step .sf .sc')].map((sc) => { const e = parseFloat(getComputedStyle(sc).containIntrinsicHeight.replace(/^auto\s*/, '')); sc.style.contentVisibility = 'visible'; const cs = getComputedStyle(sc), box = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((a, k) => a + parseFloat(cs[k]), 0); return [e, Math.round(sc.getBoundingClientRect().height - box)] }))
    S.estimates.push({ w, est })
    for (const [i, [e, hh]] of est.entries()) if (!(Math.abs(e - hh) <= 0.25 * hh)) fail(`story at ${w}, figure ${i + 1}: estimated height ${e} px is more than 25% off its rendered ${hh} px (site/build.mjs STP.est)`)
    await ctx.close()
  }
  {
    // axe at 320 on every figure as rendered (forced: off screen the plates are not rendered and axe would read nothing)
    const ctx = await ctxFor(320, 568, { bypassCSP: true }), p = await ctx.newPage()
    await p.goto(BASE + 'index.html', { waitUntil: 'networkidle' }); await p.addScriptTag({ content: AXE })
    await p.evaluate(() => document.querySelectorAll('.step .sf .sc').forEach((sc) => { sc.style.contentVisibility = 'visible' }))
    const r = await p.evaluate(async () => (await axe.run(document.querySelector('#story'), { resultTypes: ['violations'] })).violations.map((v) => ({ id: v.id, n: v.nodes.length, t: v.nodes.slice(0, 2).map((n) => n.target.join(' ')) })))
    S.axe.push({ w: 320, violations: r })
    for (const v of r) fail(`story axe at 320: ${v.id} ×${v.n} ${v.t.join(' ; ')}`)
    await ctx.close()
  }
  // 3. reduced motion (desktop and phone) and a hidden tab: no animation at all, every state still reached
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const ctx = await ctxFor(w, h, { reduced: true }), p = await ctx.newPage()
    await p.addInitScript(COUNT_ANIM)
    await p.goto(BASE + 'index.html', { waitUntil: 'networkidle' })
    const states = []
    for (let k = 1; k <= 7; k++) {
      if (w >= 960) { await toBand(p, k); await p.waitForTimeout(400); states.push((await stageNow(p)).s) } else { await p.evaluate((k) => document.querySelector(`#st-${k} .sf`).scrollIntoView({ block: 'center' }), k); await p.waitForTimeout(200); states.push(await p.evaluate((k) => document.querySelector(`#st-${k} [data-sc]`).dataset.s, k)) }
    }
    const n = await p.evaluate(() => window.__anim)
    S.reduced.push({ w, animations: n, states: states.join('') })
    if (n || states.join('') !== '1234567') fail(`story, reduced motion at ${w}: ${n} animations, states ${states.join('')}`)
    await ctx.close()
  }
  {
    const ctx = await ctxFor(1440, 900), p = await ctx.newPage()
    await p.addInitScript(() => { Object.defineProperty(Document.prototype, 'hidden', { get: () => true }); Object.defineProperty(Document.prototype, 'visibilityState', { get: () => 'hidden' }) })
    await p.addInitScript(COUNT_ANIM)
    await p.goto(BASE + 'index.html', { waitUntil: 'networkidle' })
    const states = []
    for (let k = 1; k <= 7; k++) { await toBand(p, k); await p.waitForTimeout(400); states.push((await stageNow(p)).s) }
    const n = await p.evaluate(() => window.__anim)
    S.hidden = { animations: n, states: states.join('') }
    if (n || states.join('') !== '1234567') fail(`story, hidden tab: ${n} animations, states ${states.join('')}`)
    await ctx.close()
  }
  // 4. the URL bar: on a phone, scrolled into the story, a height-only resize moves nothing and leaves --svh as it was
  for (const [h1, h2] of [[664, 745], [745, 664]]) {
    const ctx = await ctxFor(390, h1), p = await ctx.newPage()
    await p.addInitScript(() => { window.__sh = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__sh++ }).observe({ type: 'layout-shift', buffered: true }) } catch {} })
    await p.goto(BASE + 'index.html', { waitUntil: 'networkidle' })
    await p.evaluate(() => document.querySelector('#st-4 .sf').scrollIntoView({ block: 'start' })); await p.waitForTimeout(1500)
    const snap = () => p.evaluate(() => ({ y: Math.round(scrollY), doc: document.documentElement.scrollHeight, fig: +(document.querySelector('#st-5 .sf').getBoundingClientRect().top + scrollY).toFixed(2), svh: document.documentElement.style.getPropertyValue('--svh'), stage: document.documentElement.classList.contains('stage'), sh: window.__sh }))
    const a = await snap()
    await p.setViewportSize({ width: 390, height: h2 }); await p.waitForTimeout(500)
    const z = await snap()
    // a taller viewport may bring an off-screen figure near enough to be rendered for the first time; it then takes its
    // exact height in place of its estimate (a fraction of a pixel), so positions are compared to half a pixel
    const stable = a.y === z.y && a.doc === z.doc && Math.abs(a.fig - z.fig) < 0.5 && a.svh === z.svh && a.stage === z.stage && a.sh === z.sh
    S.urlbar.push({ w: 390, from: h1, to: h2, a, z, stable })
    if (!stable) fail(`story URL bar 390×${h1}→${h2}: ${JSON.stringify(a)} → ${JSON.stringify(z)}`)
    await ctx.close()
  }
  // ... and on a touch tablet with the stage: at every scroll position through the story, the URL bar changes neither the
  // step nor the stage's state (the band is fixed in px from the top), nor --svh
  for (const [w, h1, h2] of [[1024, 768, 700], [1024, 700, 768], [1180, 820, 740], [1180, 740, 820]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h1 }, hasTouch: true }), p = await ctx.newPage()
    await p.goto(BASE + 'index.html', { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready)
    const [y0, y1] = await p.evaluate(() => { const r = document.querySelector('.step-list').getBoundingClientRect(); return [Math.round(r.top + scrollY - innerHeight / 2), Math.round(r.bottom + scrollY - innerHeight / 2)] })
    const snap = () => p.evaluate(() => ({ s: document.querySelector('[data-stage] [data-sc]').dataset.s, cur: (document.querySelector('.step-a[aria-current="step"]') || {}).textContent || '', svh: document.documentElement.style.getPropertyValue('--svh'), stage: document.documentElement.classList.contains('stage') }))
    let flips = 0, n = 0
    for (let y = y0; y <= y1; y += 140) {
      await p.setViewportSize({ width: w, height: h1 }); await p.evaluate((v) => scrollTo(0, v), y); await p.waitForTimeout(450)
      const a = await snap()
      await p.setViewportSize({ width: w, height: h2 }); await p.waitForTimeout(450)
      const z = await snap()
      n++
      // the one change allowed: a stage still waiting empty (state 0) for the story to scroll in plays the current step
      // when the taller window shows more of it, as a scroll would
      const entrance = a.s === '0' && a.cur === z.cur && z.s === String(ST_TITLES.findIndex((t) => a.cur.trim().startsWith(t)) + 1)
      if ((a.s !== z.s && !entrance) || a.cur !== z.cur || a.svh !== z.svh || a.stage !== z.stage) { flips++; S.urlbar.push({ w, from: h1, to: h2, y, a, z }) }
    }
    S.urlbar.push({ w, from: h1, to: h2, positions: n, flips })
    if (flips) fail(`story URL bar ${w}×${h1}→${h2} (touch): ${flips} of ${n} scroll positions changed the step or the stage`)
    await ctx.close()
  }
  // 5. printed from a wide window (html.stage stays set): the stage gives way to the seven static figures, each in its
  // own state with its plate and its caption shown, and every value in full
  {
    const ctx = await ctxFor(1440, 900), p = await ctx.newPage()
    await p.goto(BASE + 'index.html', { waitUntil: 'networkidle' })
    await toBand(p, 5); await p.waitForTimeout(1300)
    await p.evaluate(() => dispatchEvent(new Event('beforeprint')))
    await p.emulateMedia({ media: 'print' })
    const r = await p.evaluate(() => ({ stage: document.documentElement.classList.contains('stage'), shown: getComputedStyle(document.querySelector('.step-stage')).display, figs: [...document.querySelectorAll('#story .step .sf')].map((f) => { const sc = f.querySelector('.sc'), c = f.querySelector('.figcap'); return sc.dataset.s === f.dataset.fig && getComputedStyle(sc).display !== 'none' && sc.getBoundingClientRect().height > 100 && c.getBoundingClientRect().width > 100 }), vals: [...document.querySelectorAll('#story details.vals')].every((d) => d.open) }))
    S.print = r
    if (!r.stage || r.shown !== 'none' || r.figs.length !== 7 || !r.figs.every(Boolean) || !r.vals) fail(`story printed at 1440×900 with the stage: ${JSON.stringify(r)}`)
    await ctx.close()
  }
  console.log(`story: ${S.desk.length} stage steps, ${S.fast.length} fast scrolls, ${S.keys.length} keyboard steps, ${S.phone.length} phone figures, axe ${S.axe.length} states, overflow ${S.overflow.length} runs, ${S.fit.length} smallest stages, ${S.estimates.length} estimate widths`)
}

// ---------------------------------------------------------------------------------------------- 4. no-JS text
{
  const on = await ctxFor(390, 844), off = await ctxFor(390, 844, { js: false })
  const po = await on.newPage(), pf = await off.newPage()
  const words = (t) => new Set((t.toLowerCase().match(/[a-z0-9][a-z0-9'’.-]{2,}/g) || []).map((w) => w.replace(/[.]+$/, '')))
  for (const pg of PAGES) {
    await po.goto(BASE + pg, { waitUntil: 'networkidle' }); await settle(po)
    await pf.goto(BASE + pg, { waitUntil: 'networkidle' })
    const a = await text(po, 'body'), b = await text(pf, 'body')
    if (isConsole(pg)) {
      const need = [CONSOLE_STATUS, 'independent project']
      const miss = need.filter((x) => !b.toLowerCase().includes(x.toLowerCase()))
      R.nojs.push({ pg, prerendered: miss.length === 0, missing: miss })
      if (miss.length) fail(`no-JS: ${pg} lacks ${miss.join(' / ')}`)
      continue
    }
    const wa = words(a), wb = words(b), missing = [...wa].filter((x) => !wb.has(x))
    const cover = 1 - missing.length / wa.size
    R.nojs.push({ pg, words: wa.size, coverage: +cover.toFixed(3), missing: missing.slice(0, 40) })
    if (cover < 0.95) fail(`no-JS: ${pg} shows only ${(cover * 100).toFixed(1)}% of its words without JavaScript (missing ${missing.slice(0, 12).join(' ')})`)
    if (!b.includes(STATUS)) fail(`no-JS: ${pg} lacks the status line`)
    if (pg === 'index.html') {
      // the story without JavaScript: every step's text and its static figure, shown, in that step's state
      const st = await pf.evaluate(() => [...document.querySelectorAll('#story [data-step]')].map((li) => { const f = li.querySelector('.sf'), sc = f && f.querySelector('[data-sc]'); return { k: li.dataset.step, text: li.querySelector('.step-t').innerText.trim().length, fig: !!f && getComputedStyle(f).display !== 'none' && f.getBoundingClientRect().height > 100, s: sc && sc.dataset.s, cap: f ? f.querySelector('figcaption').innerText : '' } }))
      const stage = await pf.evaluate(() => getComputedStyle(document.querySelector('.step-stage')).display)
      R.nojs.push({ pg: 'index.html #story', steps: st, stage })
      if (st.length !== 7 || !st.every((x, i) => x.text > 60 && x.fig && x.s === String(i + 1) && x.cap.startsWith(`Fig. 2.${i + 1}`))) fail(`no-JS: the story's steps and static figures: ${JSON.stringify(st)}`)
      if (stage !== 'none') fail('no-JS: the story stage shows without JavaScript')
    }
  }
  await on.close(); await off.close()
}

// ---------------------------------------------------------------------------------------------- 5. first-load budgets
// DevTools' "Slow 4G" preset: 562.5 ms latency, 1.6 Mbps × 0.9 down, 750 kbps × 0.9 up
const SLOW4G = { offline: false, latency: 562.5, downloadThroughput: (1.6e6 * 0.9) / 8, uploadThroughput: (750e3 * 0.9) / 8, connectionType: 'cellular4g' }
// a device without Arial, Liberation or Courier New (Android): the fallback faces matched on them do not load
const noLocalFallbacks = async (p) => p.route(/\.css(\?|$)/, async (route) => {
  const r = await route.fetch()
  const body = (await r.text()).replace(/local\('(?:Arial|Liberation Sans|Courier New|Liberation Mono)'\)/g, "local('IQC-no-such-font')")
  await route.fulfill({ response: r, body })
})
async function firstLoad(pg, { slow = false, w = 390, h = 844, android = false } = {}) {
  const ctx = await ctxFor(w, h, { dpr: 3 }), p = await ctx.newPage(), cdp = await ctx.newCDPSession(p)
  if (android) await noLocalFallbacks(p)
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  if (slow) { await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); await cdp.send('Network.emulateNetworkConditions', SLOW4G) }
  const reqs = new Map()
  cdp.on('Network.requestWillBeSent', (e) => reqs.set(e.requestId, { url: e.request.url, type: e.type, bytes: 0 }))
  cdp.on('Network.responseReceived', (e) => { const r = reqs.get(e.requestId); if (r) r.type = e.type })
  cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) r.bytes = e.encodedDataLength })
  await p.addInitScript(() => {
    const W = (window.__m = { lcp: 0, fcp: 0, cls: 0, lt: [] })
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) W.lcp = e.startTime }).observe({ type: 'largest-contentful-paint', buffered: true })
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') W.fcp = e.startTime }).observe({ type: 'paint', buffered: true })
      // every shift counts: no input is sent, and mobile emulation's first-paint resize would otherwise flag the font swaps as input
      new PerformanceObserver((l) => { for (const e of l.getEntries()) W.cls += e.value }).observe({ type: 'layout-shift', buffered: true })
      new PerformanceObserver((l) => { for (const e of l.getEntries()) W.lt.push([e.startTime, e.duration]) }).observe({ type: 'longtask', buffered: true })
    } catch {}
  })
  await p.goto(BASE + pg, { waitUntil: 'load', timeout: 60000 })
  await p.waitForTimeout(slow ? 6000 : 1200)
  const m = await p.evaluate(() => window.__m)
  await ctx.close()
  const by = { html: 0, css: 0, js: 0, font: 0, other: 0 }
  let n = 0, third = 0
  for (const r of reqs.values()) {
    if (r.url.startsWith('data:')) continue
    n++
    if (!r.url.startsWith(BASE)) third++
    by[r.type === 'Document' ? 'html' : r.type === 'Stylesheet' ? 'css' : r.type === 'Script' ? 'js' : r.type === 'Font' ? 'font' : 'other'] += r.bytes
  }
  const tbt = m.lt.filter(([s, d]) => s + d > m.fcp).reduce((a, [, d]) => a + Math.max(0, d - 50), 0)
  return { pg, requests: n, third, by, total: Object.values(by).reduce((a, b) => a + b, 0), fcp: Math.round(m.fcp), lcp: Math.round(m.lcp), cls: +m.cls.toFixed(4), tbt: Math.round(tbt), urls: [...reqs.values()].map((r) => r.url.replace(BASE, '')) }
}
for (const pg of PAGES) {
  const r = await firstLoad(pg), B = BUDGET[isConsole(pg) ? 'console' : 'site']
  R.budgets.push(r)
  const kb = (b) => (b / 1024).toFixed(1)
  console.log(`  ${pg.padEnd(16)} ${r.requests} requests · ${kb(r.total)} KB (html ${kb(r.by.html)} css ${kb(r.by.css)} js ${kb(r.by.js)} fonts ${kb(r.by.font)} other ${kb(r.by.other)}) · third-party ${r.third}`)
  if (r.requests > B.requests) fail(`budget: ${pg} ${r.requests} requests > ${B.requests} (${r.urls.join(' ')})`)
  if (r.total > B.total) fail(`budget: ${pg} ${kb(r.total)} KB > ${kb(B.total)} KB`)
  if (r.by.font > B.fonts) fail(`budget: ${pg} fonts ${kb(r.by.font)} KB > ${kb(B.fonts)} KB`)
  if (B.js && r.by.js > B.js) fail(`budget: ${pg} JS ${kb(r.by.js)} KB > ${kb(B.js)} KB`)
  if (r.third) fail(`budget: ${pg} makes ${r.third} third-party requests`)
  // the Overview with its story (Draft 5): at most 130 KB, and at most 8 KB more eager JS than Draft 4 (13685 bytes as
  // served, main 4e793fb)
  if (pg === 'index.html' && r.total > OVERVIEW.total) fail(`budget: index.html ${kb(r.total)} KB > ${kb(OVERVIEW.total)} KB`)
  if (pg === 'index.html' && r.by.js - OVERVIEW.js0 > 8 * 1024) fail(`budget: index.html eager JS grew by ${kb(r.by.js - OVERVIEW.js0)} KB (> 8 KB)`)
}

// ---------------------------------------------------------------------------------------------- 6. --perf: CLS / TBT / LCP, late fonts, URL bar
if (ARGS.perf) {
  const med = (a) => [...a].sort((x, y) => x - y)[(a.length - 1) >> 1]
  const RUNS = +(ARGS.runs || 3)
  for (const [w, h, android] of [[320, 568], [390, 844], [412, 915], [320, 568, true]]) for (const pg of PAGES) {
    // the Overview's own gate at 390×844 takes the median of at least 5 runs, so one slow run cannot decide it
    const runs = [], gate = pg === 'index.html' && w === 390 && !android
    for (let i = 0; i < (gate ? Math.max(RUNS, 5) : RUNS); i++) runs.push(await firstLoad(pg, { slow: true, w, h, android }))
    const r = { pg, size: `${w}×${h}`, fonts: android ? 'no Arial/Liberation/Courier' : 'shipped', lcp: med(runs.map((x) => x.lcp)), tbt: med(runs.map((x) => x.tbt)), cls: Math.max(...runs.map((x) => x.cls)), fcp: med(runs.map((x) => x.fcp)), runs: runs.map((x) => [x.lcp, x.tbt, x.cls]) }
    R.perf.push(r)
    console.log(`  slow ${r.size}${android ? ' android-fonts' : ''} ${pg.padEnd(16)} LCP ${r.lcp} ms · FCP ${r.fcp} ms · TBT ${r.tbt} ms · CLS max ${r.cls}`)
    if (pg === 'index.html' && w === 390 && !android) {
      if (r.cls > OVERVIEW.cls) fail(`perf: index.html at 390×844 CLS ${r.cls} > ${OVERVIEW.cls}`)
      if (r.tbt >= OVERVIEW.tbt) fail(`perf: index.html at 390×844 TBT ${r.tbt} ms >= ${OVERVIEW.tbt} ms`)
      if (r.lcp > OVERVIEW.lcp0 + 100) fail(`perf: index.html at 390×844 LCP ${r.lcp} ms, more than 100 ms over Draft 4's ${OVERVIEW.lcp0} ms`)
    }
  }
  for (const pg of PAGES) for (const [h1, h2] of [[664, 745], [745, 664]]) {
    const ctx = await ctxFor(390, h1), p = await ctx.newPage()
    await p.addInitScript(() => { window.__sh = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__sh++ }).observe({ type: 'layout-shift', buffered: true }) } catch {} })
    await p.goto(BASE + pg, { waitUntil: 'networkidle' }); await settle(p)
    // mid-page, but never so far down that the taller viewport would have to clamp the scroll position
    await p.evaluate(() => scrollTo(0, Math.min(1400, Math.max(0, document.documentElement.scrollHeight - 760)))); await p.waitForTimeout(400)
    const snap = () => p.evaluate(() => ({ y: Math.round(scrollY), doc: document.documentElement.scrollHeight, h1: Math.round(document.querySelector('h1').getBoundingClientRect().top + scrollY), sh: window.__sh, anims: document.getAnimations().length }))
    const a = await snap()
    await p.setViewportSize({ width: 390, height: h2 }); await p.waitForTimeout(500)
    const z = await snap()
    const stable = a.y === z.y && a.doc === z.doc && a.h1 === z.h1 && a.sh === z.sh && !z.anims
    R.urlbar.push({ pg, from: h1, to: h2, a, z, stable })
    if (!stable) console.log(`  URL bar ${pg} 390×${h1}→${h2}: ${JSON.stringify(a)} → ${JSON.stringify(z)}`)
    await ctx.close()
  }
  console.log(`  URL bar: ${R.urlbar.filter((x) => x.stable).length} of ${R.urlbar.length} stable`)
}

await browser.close(); await close()
if (ARGS.json) writeFileSync(String(ARGS.json), JSON.stringify(R, null, 1))
console.log(fails.length ? `\n${fails.length} check(s) failed` : '\nall browser checks pass')
process.exit(fails.length ? 1 : 0)
