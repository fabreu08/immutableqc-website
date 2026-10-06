#!/usr/bin/env node
// check.mjs · browser checks for every page of immutableqc.com and the alpha console (dashboard/), with Playwright
// (Chromium) and axe-core. Serves the repo root itself, gzip on, as GitHub Pages does.
//   node site/tools/check.mjs              links (every href/src after JS, the 404 at nested paths), overflow 320–1920,
//                                          tap targets, smallest text, axe at 375 and 1280, frames at rest (3 s traces),
//                                          reduced motion and hidden tab, no-JS text, first-load budgets
//   node site/tools/check.mjs --perf       also CLS / TBT / LCP at 390×844 with Slow 4G and CPU 4× (median of --runs=3),
//                                          late-font CLS and the URL-bar resize test (390×664 ↔ 390×745); reported only
//   --only=index.html,check.html           a subset of pages       --json=path   write every result as JSON
// In CI: npm ci in site/, then npx playwright install --with-deps chromium. Locally the preinstalled Chromium is used.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { serve } from './serve.mjs'

const req = createRequire(import.meta.url)
const load = (name, fallback) => { try { return req(name) } catch { if (fallback) return req(fallback); throw new Error(`${name} is missing: run npm ci in site/`) } }
const { chromium } = load('playwright', '/opt/node22/lib/node_modules/playwright')
const AXE = readFileSync(req.resolve('axe-core/axe.min.js'), 'utf8')

const ARGS = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([\w-]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true] }))
const ALL = ['index.html', 'sealed.html', 'check.html', 'regulatory.html', 'roadmap.html', 'about.html', '404.html', 'dashboard/']
const PAGES = ARGS.only ? String(ARGS.only).split(',') : ALL
const WIDTHS = [320, 360, 375, 390, 412, 480, 600, 768, 1024, 1280, 1440, 1920]
const STATUS = 'Independent project · Open alpha · Public test network · Synthetic demo data · No customers yet'
const CONSOLE_STATUS = 'Independent project · Open alpha · Synthetic demo data · No customers yet · Runs only in your browser'
const BUDGET = { site: { requests: 8, total: 160 * 1024, js: 22 * 1024, fonts: 100 * 1024 }, console: { requests: 10, total: 160 * 1024, fonts: 100 * 1024 } }
const isConsole = (pg) => pg.startsWith('dashboard')
const fails = [], R = { overflow: [], taps: {}, minFont: {}, axe: [], rest: [], motion: [], nojs: [], budgets: [], perf: [], urlbar: [] }
const fail = (msg) => { fails.push(msg); console.log('  FAIL', msg) }

const { port, close } = await serve(0)
const BASE = `http://127.0.0.1:${port}/`
const browser = await chromium.launch()
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
const ctxFor = (w, h, o = {}) => { const m = w < 900; return browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: o.dpr || (m ? 2 : 1), isMobile: m, hasTouch: m, userAgent: m ? UA : undefined, javaScriptEnabled: o.js !== false, reducedMotion: o.reduced ? 'reduce' : 'no-preference' }) }

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
    corrected: async (p) => { await p.fill('#f-value', '1588811'); await p.fill('#reason', 'Peak reintegrated after second-person review, see note 14'); await p.click('[data-act=correct]'); await p.waitForTimeout(400) },
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
const minFontProbe = () => {
  let min = 99, where = ''
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n; (n = tw.nextNode());) {
    if (!n.textContent.trim()) continue
    const el = n.parentElement
    if (el.closest('.sr-only,[hidden],template,script,style')) continue
    if (!el.getClientRects().length) continue
    let a = el, hid = false
    while (a) { if (getComputedStyle(a).display === 'none') { hid = true; break } a = a.parentElement }
    if (hid) continue
    const fs = parseFloat(getComputedStyle(el).fontSize)
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
const COUNT_ANIM = () => { window.__anim = 0; const a = Element.prototype.animate; Element.prototype.animate = function (...x) { window.__anim++; return a.apply(this, x) } }
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
    for (const h of found.sprite) fail(`link: ${pg} <use href="${h}"> has no symbol on the page`)
    for (const h of found.self) fail(`link: ${pg} ${h} has no target on the page`)
    for (const x of bad) fail(`link: ${pg} subresource ${x}`)
  }
  R.links = { pages: PAGES.length + extra.length, refs, targets: seen.size }
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

// ---------------------------------------------------------------------------------------------- 2. axe at 375 and 1280
for (const w of [375, 1280]) {
  const ctx = await ctxFor(w, 800), p = await ctx.newPage()
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
    R.motion.push({ mode: 'Fig. 2 seal-in', pg: 'index.html', before, after })
    if (after.sealed !== 8 || after.running) fail(`Fig. 2 seal-in: ${JSON.stringify({ before, after })}`)
    await c3.close()
  }
}
console.log(`rest: ${R.rest.length} idle windows, ${R.rest.filter((r) => r.drawFrame || r.anims).length} with frames`)

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
  }
  await on.close(); await off.close()
}

// ---------------------------------------------------------------------------------------------- 5. first-load budgets
async function firstLoad(pg, { slow = false, w = 390, h = 844 } = {}) {
  const ctx = await ctxFor(w, h, { dpr: 3 }), p = await ctx.newPage(), cdp = await ctx.newCDPSession(p)
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  if (slow) { await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8, connectionType: 'cellular4g' }) }
  const reqs = new Map()
  cdp.on('Network.requestWillBeSent', (e) => reqs.set(e.requestId, { url: e.request.url, type: e.type, bytes: 0 }))
  cdp.on('Network.responseReceived', (e) => { const r = reqs.get(e.requestId); if (r) r.type = e.type })
  cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) r.bytes = e.encodedDataLength })
  await p.addInitScript(() => {
    const W = (window.__m = { lcp: 0, fcp: 0, cls: 0, lt: [] })
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) W.lcp = e.startTime }).observe({ type: 'largest-contentful-paint', buffered: true })
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') W.fcp = e.startTime }).observe({ type: 'paint', buffered: true })
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) W.cls += e.value }).observe({ type: 'layout-shift', buffered: true })
      new PerformanceObserver((l) => { for (const e of l.getEntries()) W.lt.push([e.startTime, e.duration]) }).observe({ type: 'longtask', buffered: true })
    } catch {}
  })
  await p.goto(BASE + pg, { waitUntil: 'load', timeout: 60000 })
  await p.waitForTimeout(slow ? 4000 : 1200)
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
}

// ---------------------------------------------------------------------------------------------- 6. --perf: CLS / TBT / LCP, late fonts, URL bar
if (ARGS.perf) {
  const med = (a) => [...a].sort((x, y) => x - y)[(a.length - 1) >> 1]
  const RUNS = +(ARGS.runs || 3)
  for (const pg of PAGES) {
    const runs = []
    for (let i = 0; i < RUNS; i++) runs.push(await firstLoad(pg, { slow: true }))
    const r = { pg, lcp: med(runs.map((x) => x.lcp)), tbt: med(runs.map((x) => x.tbt)), cls: Math.max(...runs.map((x) => x.cls)), fcp: med(runs.map((x) => x.fcp)), runs: runs.map((x) => [x.lcp, x.tbt, x.cls]) }
    R.perf.push(r)
    console.log(`  slow 390×844 ${pg.padEnd(16)} LCP ${r.lcp} ms · FCP ${r.fcp} ms · TBT ${r.tbt} ms · CLS max ${r.cls}`)
  }
  for (const pg of PAGES) for (const [h1, h2] of [[664, 745], [745, 664]]) {
    const ctx = await ctxFor(390, h1), p = await ctx.newPage()
    await p.addInitScript(() => { window.__sh = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__sh++ }).observe({ type: 'layout-shift', buffered: true }) } catch {} })
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
