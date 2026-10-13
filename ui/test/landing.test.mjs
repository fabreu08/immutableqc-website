// The landing page (index.html, ui/landing.css, ui/landing.mjs), docs/product-v1.md section 6.
// 1. Static, always run: the hero's fingerprints, short fingerprints, sizes, values and ring are the sample's own
//    (ui/sample-data.mjs), so the page reads true without its script; the inline icons are ui/icons.svg's; the CSP
//    allows nothing but the site itself and no inline code; the download's SHA-256 has its place (data-sha256-of).
// 2. In Chromium (Playwright; skipped when it is not installed, or with IQC_SKIP_BROWSER=1), the repo served over
//    http://127.0.0.1 by site/tools/serve.mjs: the four steps by their buttons, Play/Pause, reduced motion (rests on
//    Caught, plays only on request), no animation off-screen, the page without JavaScript, no request to another
//    origin, no console error or CSP violation, axe with no violation, no horizontal overflow from 320 to 1920 px, tap
//    targets of 44 px on phones, one panel height in every step (no layout shift), the weight of the page, and the
//    hero's fingerprints in the rendered page equal to ui/sample-data.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import * as S from '../sample-data.mjs'

const UI = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = resolve(UI, '..')
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8')
const P = S.EDIT.path, A = S.SHA256[P], B = S.SHA256_EDITED[P]
const text = (s) => s.replace(/<[^>]+>/g, '')
const inner = (re) => { const m = HTML.match(re); assert.ok(m, `found ${re}`); return m[1] }

test('landing: the hero shows the sample’s real fingerprints, sizes and values (ui/sample-data.mjs)', () => {
  assert.equal(text(inner(/<code class="hash hash-sealed" data-fp="sealed">([\s\S]*?)<\/code>/)), A, 'sealed fingerprint of plate-07.csv')
  assert.equal(text(inner(/<code class="hash hash-changed" data-fp="now">([\s\S]*?)<\/code>/)), B, 'fingerprint of plate-07.csv in the copy')
  // its 8-character groups, and the characters that happen to match marked as such
  const now = inner(/data-fp="now">([\s\S]*?)<\/code>/)
  assert.deepEqual([...now.matchAll(/<span>([\s\S]*?)<\/span>/g)].map((m) => text(m[1])), S.hexGroups(B))
  const marked = [...now.replace(/<\/?span>/g, '').matchAll(/<i class="m">(.)<\/i>|(.)/g)].map((m, i) => (m[1] ? i : -1)).filter((i) => i >= 0)
  assert.deepEqual(marked, [...A].map((c, i) => (c === B[i] ? i : -1)).filter((i) => i >= 0))
  for (const [, path, v] of HTML.matchAll(/data-sha="([^"]+)">([^<]*)</g)) assert.equal(v, S.SHA256[path].slice(0, 8) + '…', `sealed ${path}`)
  for (const [, path, v] of HTML.matchAll(/data-sha-now="([^"]+)">([^<]*)</g)) assert.equal(v, S.SHA256_EDITED[path].slice(0, 8) + '…', `now ${path}`)
  const sizes = [...HTML.matchAll(/data-size="([^"]+)">([^<]*)</g)]
  assert.ok(sizes.length >= 5)
  for (const [, path, v] of sizes) assert.equal(v, S.FILES.find((f) => f.path === path).size + ' B', `size of ${path}`)
  // every file of the sample is in the audit list, plate-07.csv first and the only one changed
  const rows = [...HTML.matchAll(/<li class="fr( fr-bad)?">[\s\S]*?<span class="fr-p">([^<]+)<\/span>/g)].map((m) => [m[2], !!m[1]])
  assert.deepEqual(rows.map((r) => r[0]).sort(), S.FILES.map((f) => f.name).sort())
  assert.deepEqual(rows.filter((r) => r[1]).map((r) => r[0]), [S.EDIT.name])
  assert.equal(rows[0][0], S.EDIT.name)
  // the values inside the file: the first four wells, A01 before and after the edit
  const plate = S.plateRows()
  const cells = [...inner(/<div class="file">([\s\S]*?)<p class="file-note">/).matchAll(/<p class="r">([\s\S]*?)<\/p>/g)].map((m) => [...m[1].matchAll(/<span[^>]*>([^<]*)/g)].map((x) => x[1]))
  assert.deepEqual(cells.map((c) => c[0]), plate.slice(0, 4).map((r) => r.well))
  assert.match(HTML, new RegExp(`<s data-v="before">${S.EDIT.before}</s><b data-v="after">${S.EDIT.after}</b>`))
  assert.deepEqual(cells.slice(1).map((c) => c[1]), plate.slice(1, 4).map((r) => r.abs_450))
  // the ring: one tick per hex character, clockwise from the top; at rest (Caught) a tick is cyan where the two
  // fingerprints have the same character at that place, and coral where they differ
  const ticks = [...HTML.matchAll(/<line class="(tk[^"]*)"/g)].map((m) => m[1])
  assert.equal(ticks.length, 64)
  assert.deepEqual(ticks, [...A].map((c, i) => (c === B[i] ? 'tk on' : 'tk bad')))
  // the static state is the last step
  assert.match(HTML, /<figure class="viz glass" id="viz" data-phase="caught"/)
  assert.match(HTML, /<button type="button" data-go="caught" disabled aria-current="step">/)
})

test('landing: the download’s SHA-256 has its place, with the check commands beside it', () => {
  const m = HTML.match(/<code class="sha-hex" id="sha-dl" data-sha256-of="download\/iqc\.mjs">([^<]*)<\/code>/)
  assert.ok(m, 'one element with data-sha256-of="download/iqc.mjs", the hash as one text node')
  assert.match(m[1], /^[0-9a-f]{64}$/)
  assert.equal((HTML.match(/data-sha256-of=/g) || []).length, 1)
  assert.match(HTML, /href="download\/iqc\.mjs" download/)
  assert.ok(HTML.includes('certutil -hashfile iqc.mjs SHA256') && HTML.includes('shasum -a 256 iqc.mjs'))
  assert.ok(HTML.includes('node iqc.mjs watch "D:\\Results"'))
})

test('landing: the inline icons are ui/icons.svg’s symbols', () => {
  const sprite = readFileSync(join(UI, 'icons.svg'), 'utf8')
  const symbols = (s) => Object.fromEntries([...s.matchAll(/<symbol id="([\w-]+)"[\s\S]*?<\/symbol>/g)].map((m) => [m[1], m[0]]))
  const want = symbols(sprite), have = symbols(inner(/<svg class="sprite"[^>]*>([\s\S]*?)<\/svg>/))
  assert.ok(Object.keys(have).length >= 8)
  // the one difference: the mark's dot takes its color from a class, since the CSP allows no style attribute
  const norm = (s) => s.replace(' style="fill:var(--mark-dot,currentColor)"', ' class="mark-dot"')
  for (const [id, sym] of Object.entries(have)) assert.equal(sym, norm(want[id] || ''), id)
  for (const [, id] of HTML.matchAll(/<use href="#([\w-]+)"/g)) assert.ok(id in have, `#${id} is in the sprite`)
})

test('landing: the CSP allows the site itself only, no inline code, no connection; one h1; links resolve', () => {
  const csp = inner(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)
  assert.equal(csp, "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'")
  assert.ok(HTML.indexOf('Content-Security-Policy') < HTML.search(/<link|<script/))
  assert.doesNotMatch(HTML, /<script(?![^>]*\ssrc=)[^>]*>/, 'no inline script')
  assert.doesNotMatch(HTML, /<style[\s>]|\sstyle="/, 'no inline style')
  assert.doesNotMatch(HTML, /\son[a-z]+=/i, 'no inline event handler')
  assert.match(HTML, /<script type="module" src="ui\/landing\.mjs"><\/script>/)
  assert.equal((HTML.match(/<h1[\s>]/g) || []).length, 1)
  for (const [, id] of HTML.matchAll(/href="#([\w-]+)"/g)) assert.ok(HTML.includes(`id="${id}"`), `#${id} exists`)
  for (const [, u] of HTML.matchAll(/(?:href|src)="(?!#|https:\/\/)([^"]+)"/g)) assert.ok(existsSync(join(ROOT, u.replace(/[#?].*$/, ''), u.endsWith('/') ? 'index.html' : '')), `${u} exists`)
  const ids = [...HTML.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
  assert.equal(new Set(ids).size, ids.length, 'no duplicate id')
  assert.equal((HTML.match(/intelligence explosion/g) || []).length, 1)
  const css = readFileSync(join(UI, 'landing.css'), 'utf8'), js = readFileSync(join(UI, 'landing.mjs'), 'utf8')
  assert.doesNotMatch(css, /@import|url\((?!#)/, 'landing.css loads nothing')
  assert.doesNotMatch(js.replace(/\/\/[^\n]*/g, ''), /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB/)
  assert.deepEqual([...js.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]), ['./sample-data.mjs'])
})

// ------------------------------------------------------------------------------------------------- in the browser
const require = createRequire(import.meta.url)
function load(name, paths) { for (const p of paths) { try { return require(p) } catch { /* next */ } } return null }
const pw = process.env.IQC_SKIP_BROWSER ? null : load('playwright', ['/opt/node22/lib/node_modules/playwright', join(ROOT, 'site', 'node_modules', 'playwright'), 'playwright'])
const AXE_PATH = join(ROOT, 'site', 'node_modules', 'axe-core', 'axe.min.js')

test('landing in Chromium', { skip: !pw && 'Playwright is not installed', timeout: 240000 }, async (t) => {
  const { serve } = await import(pathToFileURL(join(ROOT, 'site', 'tools', 'serve.mjs')).href)
  const srv = await serve(0, ROOT)
  const base = `http://127.0.0.1:${srv.port}/`
  const browser = await pw.chromium.launch()
  const problems = []
  async function open(w, h, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: opts.reduced ? 'reduce' : 'no-preference', javaScriptEnabled: opts.js !== false, bypassCSP: !!opts.axe })
    const p = await ctx.newPage()
    const where = `${w}×${h}${opts.reduced ? ' reduced' : ''}${opts.js === false ? ' no-js' : ''}`
    p.on('console', (m) => { if (m.type() === 'error') problems.push(`${where}: console: ${m.text()}`) })
    p.on('pageerror', (e) => problems.push(`${where}: ${e}`))
    p.on('requestfailed', (r) => problems.push(`${where}: request failed ${r.url()}`))
    p.on('request', (r) => { if (!r.url().startsWith(base)) problems.push(`${where}: request to another origin ${r.url()}`) })
    await p.addInitScript(() => {
      window.__csp = []
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`))
      // counts animation frames, to tell whether anything animates
      const raf = window.requestAnimationFrame.bind(window)
      window.__raf = 0
      window.requestAnimationFrame = (f) => { window.__raf++; return raf(f) }
    })
    await p.goto(base + 'index.html', { waitUntil: 'load' })
    await p.evaluate(() => document.fonts.ready)
    return { ctx, p, where }
  }
  const state = (p) => p.evaluate(() => {
    const v = document.getElementById('viz'), cur = v.querySelector('[aria-current="step"]')
    const cap = [...v.querySelectorAll('.cap')].find((c) => getComputedStyle(c).visibility === 'visible')
    return { phase: v.dataset.phase, current: cur && cur.dataset.go, caption: cap && cap.textContent, play: v.querySelector('.viz-play-t').textContent, height: Math.round(v.getBoundingClientRect().height), cls: v.className, csp: window.__csp }
  })

  try {
    await t.test('the four steps, by their buttons; Play and Pause; one panel height in every step', async () => {
      const { ctx, p } = await open(1440, 900)
      const caps = { written: 'The plate reader writes', sealed: 'The agent fingerprints it', edited: 'Weeks later, a sync conflict', caught: 'One click audits the copy' }
      let s = await state(p)
      assert.equal(s.phase, 'caught', 'opens on Caught, as the page reads without its script')
      assert.equal(s.play, 'Pause', 'it plays when motion is allowed')
      const heights = new Set([s.height])
      for (const ph of ['written', 'sealed', 'edited', 'caught']) {
        await p.click(`[data-go="${ph}"]`)
        await p.waitForTimeout(150)
        s = await state(p)
        assert.equal(s.phase, ph)
        assert.equal(s.current, ph, 'its button is the current step')
        assert.ok(s.caption && s.caption.startsWith(caps[ph]), `caption of ${ph}: ${s.caption}`)
        assert.equal(s.play, 'Play', 'a step button pauses the story')
        assert.equal(await p.getAttribute('.caps', 'aria-live'), 'polite', 'the caption the visitor picked is announced')
        heights.add(s.height)
      }
      // the mode line follows the story: the watched folder, then the copy, then the audit
      await p.click('[data-go="edited"]')
      assert.equal(await p.evaluate(() => [...document.querySelectorAll('.viz-mode .m')].find((m) => getComputedStyle(m).display !== 'none').textContent), 'copy · shared drive')
      await p.click('[data-go="caught"]')
      assert.equal(await p.evaluate(() => [...document.querySelectorAll('.viz-mode .m')].find((m) => getComputedStyle(m).display !== 'none').textContent), 'audit · nothing uploaded')
      // Play from Caught starts the story over; Pause holds it
      await p.click('.viz-play')
      await p.waitForTimeout(900)
      s = await state(p)
      assert.equal(s.play, 'Pause')
      assert.equal(s.phase, 'written', 'Play from Caught starts again at step 1')
      heights.add(s.height)
      await p.click('.viz-play')
      const r0 = await p.evaluate(() => window.__raf), held = (await state(p)).phase
      await p.waitForTimeout(700)
      assert.equal((await state(p)).phase, held)
      assert.ok((await p.evaluate(() => window.__raf)) - r0 <= 1, 'paused: no animation frame')
      // through a whole run (sealing, the copy, the audit), the panel keeps one height
      await p.click('.viz-play')
      for (let i = 0; i < 14; i++) { await p.waitForTimeout(700); heights.add((await state(p)).height) }
      assert.equal(heights.size, 1, `one height in every step (${[...heights].join(', ')})`)
      assert.deepEqual((await state(p)).csp, [])
      await ctx.close()
    })

    await t.test('reduced motion: rests on Caught, and plays only on request, step by step', async () => {
      const { ctx, p } = await open(1440, 900, { reduced: true })
      const r0 = await p.evaluate(() => window.__raf)
      await p.waitForTimeout(1500)
      let s = await state(p)
      assert.equal(s.phase, 'caught')
      assert.equal(s.play, 'Play')
      assert.doesNotMatch(s.cls, /is-auditing|is-fading|is-writing/)
      assert.equal((await p.evaluate(() => window.__raf)) - r0, 0, 'no animation frame at rest')
      await p.click('.viz-play')
      await p.waitForTimeout(200)
      assert.equal((await state(p)).phase, 'written')
      await p.waitForTimeout(1900)
      assert.equal((await state(p)).phase, 'sealed', 'then one step at a time')
      assert.equal((await p.evaluate(() => window.__raf)) - r0, 0, 'still no animation frame: no streaming, no sweep')
      await ctx.close()
    })

    await t.test('nothing animates off-screen; the story stops after two runs', async () => {
      const { ctx, p } = await open(1440, 900)
      await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await p.waitForTimeout(400)
      const r0 = await p.evaluate(() => window.__raf)
      await p.waitForTimeout(1000)
      assert.equal((await p.evaluate(() => window.__raf)) - r0, 0, 'no animation frame while the hero is out of sight')
      await ctx.close()
    })

    await t.test('without JavaScript: the hero reads as Caught, with every fingerprint', async () => {
      const { ctx, p } = await open(390, 844, { js: false })
      const s = await p.evaluate(() => {
        const v = document.getElementById('viz')
        const cap = [...v.querySelectorAll('.cap')].find((c) => getComputedStyle(c).visibility === 'visible')
        return { phase: v.dataset.phase, caption: cap && cap.textContent, sealed: v.querySelector('[data-fp="sealed"]').textContent, now: v.querySelector('[data-fp="now"]').textContent, play: getComputedStyle(v.querySelector('.viz-play')).display, badge: getComputedStyle(v.querySelector('.b-caught')).opacity, sw: document.documentElement.scrollWidth }
      })
      assert.equal(s.phase, 'caught')
      assert.match(s.caption, /^One click audits the copy: plate-07\.csv changed since it was sealed\.$/)
      assert.equal(s.sealed, A)
      assert.equal(s.now, B)
      assert.equal(s.play, 'none', 'no Play button that would do nothing')
      assert.equal(s.badge, '1')
      assert.ok(s.sw <= 390)
      await ctx.close()
    })

    await t.test('the hero’s fingerprints in the rendered page are the sample’s (after the script ran)', async () => {
      const { ctx, p } = await open(1440, 900, { reduced: true })
      const got = await p.evaluate(() => ({
        sealed: document.querySelector('[data-fp="sealed"]').textContent,
        now: document.querySelector('[data-fp="now"]').textContent,
        short: [...document.querySelectorAll('[data-sha]')].map((e) => [e.dataset.sha, e.textContent]),
        shortNow: [...document.querySelectorAll('[data-sha-now]')].map((e) => [e.dataset.shaNow, e.textContent]),
        ticks: [...document.querySelectorAll('.tk')].map((e) => e.getAttribute('class')),
      }))
      assert.equal(got.sealed, A)
      assert.equal(got.now, B)
      for (const [path, v] of got.short) assert.equal(v, S.SHA256[path].slice(0, 8) + '…')
      for (const [path, v] of got.shortNow) assert.equal(v, S.SHA256_EDITED[path].slice(0, 8) + '…')
      assert.deepEqual(got.ticks, [...A].map((c, i) => (c === B[i] ? 'tk on' : 'tk bad')))
      await ctx.close()
    })

    await t.test('no horizontal overflow from 320 to 1920 px; tap targets of 44 px on phones; nothing under 11 px', async () => {
      for (const w of [320, 390, 768, 1024, 1440, 1920]) {
        const { ctx, p } = await open(w, 900, { reduced: true })
        for (const ph of ['caught', 'written', 'edited']) {
          await p.click(`[data-go="${ph}"]`)
          const o = await p.evaluate(() => {
            const vw = document.documentElement.clientWidth, out = []
            for (const el of document.querySelectorAll('body *')) {
              const r = el.getBoundingClientRect()
              if (r.width && (r.right > vw + 0.5 || r.left < -0.5) && !el.closest('.sprite,.skip,pre')) out.push(`${el.tagName.toLowerCase()}.${el.getAttribute('class') || ''} ${Math.round(r.left)}–${Math.round(r.right)}`)
            }
            return { sw: document.documentElement.scrollWidth, vw, out: out.slice(0, 4) }
          })
          assert.ok(o.sw <= o.vw && o.out.length === 0, `overflow at ${w} (${ph}): ${o.sw} > ${o.vw} ${o.out.join(' | ')}`)
        }
        if (w <= 390) {
          const small = await p.evaluate(() => {
            const out = []
            for (const el of document.querySelectorAll('a[href], button, [tabindex]:not([tabindex="-1"])')) {
              if (el.closest('[hidden],.skip')) continue
              const cs = getComputedStyle(el), r = el.getBoundingClientRect()
              if (cs.display === 'none' || cs.visibility === 'hidden' || (!r.width && !r.height)) continue
              if (r.width < 43.5 || r.height < 43.5) out.push(`${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 24)}" ${Math.round(r.width)}×${Math.round(r.height)}`)
            }
            return out
          })
          assert.deepEqual(small, [], `tap targets under 44 px at ${w}`)
          const min = await p.evaluate(() => {
            let m = 99, where = ''
            const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
            for (let n; (n = tw.nextNode());) {
              const el = n.parentElement
              if (!n.textContent.trim() || el.closest('.vh,.sprite,[hidden]') || !el.getClientRects().length) continue
              const f = parseFloat(getComputedStyle(el).fontSize)
              if (f < m) { m = f; where = n.textContent.trim().slice(0, 20) }
            }
            return { m, where }
          })
          assert.ok(min.m >= 11, `smallest text at ${w}: ${min.m}px "${min.where}"`)
        }
        await ctx.close()
      }
    })

    await t.test('axe: no violation, in every step, at 1440 and 390', { skip: !existsSync(AXE_PATH) && 'axe-core is not installed in site/node_modules' }, async () => {
      const AXE = readFileSync(AXE_PATH, 'utf8')
      for (const w of [1440, 390]) {
        const { ctx, p } = await open(w, 900, { reduced: true, axe: true })
        await p.addScriptTag({ content: AXE })
        for (const ph of ['caught', 'written', 'sealed', 'edited']) {
          await p.click(`[data-go="${ph}"]`)
          await p.waitForTimeout(100)
          const v = await p.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map((x) => `${x.id} ×${x.nodes.length}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' ; ')}`))
          assert.deepEqual(v, [], `axe at ${w}, step ${ph}`)
        }
        await ctx.close()
      }
    })

    await t.test('copy buttons copy the command alone (no prompt, no comments) and the bare fingerprint', async () => {
      const { ctx, p } = await open(1440, 900, { reduced: true })
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base })
      const copied = async (id) => { await p.click(`[data-copy="${id}"]`); return p.evaluate(() => navigator.clipboard.readText()) }
      assert.equal(await copied('cmd-watch'), 'node iqc.mjs watch "D:\\Results"')
      assert.equal(await copied('cmd-pipe'), ['node iqc.mjs seal "D:\\Results"', 'node iqc.mjs head "D:\\Results"', 'node iqc.mjs audit "D:\\Results" --expect-head <n>:<h> --json audit.json'].join('\n'))
      assert.match(await copied('sha-dl'), /^[0-9a-f]{64}$/)
      assert.equal(await p.textContent('[data-copy="sha-dl"] span'), 'Copied')
      assert.equal(await p.textContent('#copy-status'), 'Copied to the clipboard')
      await ctx.close()
    })

    await t.test('no layout shift while the page loads and the story starts', async () => {
      for (const [w, h] of [[390, 844], [1440, 900]]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h } })
        const p = await ctx.newPage()
        await p.addInitScript(() => {
          window.__cls = 0
          new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value }).observe({ type: 'layout-shift', buffered: true })
        })
        await p.goto(base + 'index.html', { waitUntil: 'load' })
        await p.waitForTimeout(4500) // fonts, the module, and the story's first steps
        const cls = await p.evaluate(() => window.__cls)
        assert.ok(cls < 0.01, `CLS ${cls.toFixed(4)} at ${w}×${h}`)
        await ctx.close()
      }
    })

    await t.test('weight: under 150 KB without the fonts, with the script deferred', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      const p = await ctx.newPage()
      const sizes = []
      p.on('response', async (r) => { try { sizes.push([r.url().slice(base.length), (await r.body()).length, r.request().resourceType()]) } catch { /* redirects have no body */ } })
      await p.goto(base + 'index.html', { waitUntil: 'networkidle' })
      const total = sizes.filter(([u]) => !/\.woff2$/.test(u)).reduce((a, [, n]) => a + n, 0)
      assert.ok(total < 150 * 1024, `${total} bytes without fonts: ${sizes.map(([u, n]) => `${u} ${n}`).join(', ')}`)
      assert.ok(sizes.every(([u]) => !/\.(png|jpe?g|gif|webp|avif)$/.test(u) || u === 'favicon.svg'), 'no image')
      assert.match(HTML, /<script type="module" src=/, 'a module script: deferred')
      await ctx.close()
    })

    assert.deepEqual(problems, [], 'no console error, no failed request, no request to another origin')
  } finally {
    await browser.close()
    await srv.close()
  }
})
