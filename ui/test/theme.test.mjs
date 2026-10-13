// ui/theme.css and ui/icons.svg: no external request (url() only to the site's own ../fonts/, which exist; no @import),
// and the color tokens meet WCAG AA (text 4.5:1 on every surface and on its own tint, control outlines 3:1).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const UI = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CSS = readFileSync(join(UI, 'theme.css'), 'utf8')
const SVG = readFileSync(join(UI, 'icons.svg'), 'utf8')
const code = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

test('theme.css: every url() is a font file in ../fonts/ that exists', () => {
  const urls = [...code.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)].map((m) => m[2])
  assert.ok(urls.length >= 4, 'the four @font-face sources')
  for (const u of urls) {
    assert.match(u, /^\.\.\/fonts\/[\w.-]+\.woff2$/, `url(${u}) is in ../fonts/`)
    assert.ok(existsSync(join(UI, u)), `${u} exists`)
  }
  // nothing else that loads: no @import at all, no image-set(), no remote address anywhere
  assert.doesNotMatch(code, /@import\b/i)
  assert.doesNotMatch(code, /image-set\(|src\(\s*['"]/i)
  assert.doesNotMatch(CSS, /(?:https?:)?\/\/[a-z0-9-]+\.[a-z]/i, 'no address on another site, not even in a comment')
})

test('theme.css: well formed (braces balance) and the documented components exist', () => {
  assert.equal((code.match(/{/g) || []).length, (code.match(/}/g) || []).length)
  for (const c of ['.wrap', '.vh', '.skip', '.strip', '.status-line', '.site-header', '.brand', '.site-nav', '.site-footer',
    '.btn', '.btn-primary', '.btn-ghost', '.btn-s', '.icon-btn', '.copy', '.seg', '.filter', '.tag', '.tag-match',
    '.tag-changed', '.tag-missing', '.tag-removed', '.tag-note', '.tag-unsealed', '.tag-upcoming', '.chip', '.glass',
    '.panel', '.card', '.callout', '.verdict', '.verdict-pass', '.verdict-fail', '.stat', '.hash', '.kv', '.table', '.cmd',
    '.meter', '.fold', '.input', '.search', '.text-grad', '.eyebrow', '.label', '.sky', '.list-check']) {
    assert.ok(new RegExp(`\\${c}(?![\\w-])`).test(code), `${c} is defined`)
  }
  assert.match(code, /@media \(prefers-reduced-motion:reduce\)/)
  assert.match(code, /@media \(forced-colors:active\)/)
  assert.match(code, /@media print/)
  assert.match(code, /:focus-visible\{outline:2px solid var\(--focus\)/)
  // a status-line segment never breaks inside; a hash group never breaks inside
  assert.match(code, /\.status-line>span\{white-space:nowrap\}/)
  assert.match(code, /\.hash>span\{display:inline-block;white-space:nowrap/)
  assert.match(code, /\.cmd pre\{[^}]*white-space:pre;overflow-x:auto/)
})

test('icons.svg: symbols only, drawn in currentColor, no external reference', () => {
  const body = SVG.replace(/<!--[\s\S]*?-->/g, '')
  assert.doesNotMatch(body, /\b(?:href|src)\s*=\s*["'](?!#)/i, 'no external href inside the sprite (its comment shows how to use it)')
  assert.doesNotMatch(body, /<script|<foreignObject|<style|\son[a-z]+\s*=/i)
  assert.doesNotMatch(body.replace('xmlns="http://www.w3.org/2000/svg"', ''), /\/\//, 'no address')
  const ids = [...SVG.matchAll(/<symbol id="([\w-]+)"/g)].map((m) => m[1])
  for (const id of ['i-mark', 'i-check', 'i-x', 'i-missing', 'i-removed', 'i-note', 'i-unsealed', 'i-back', 'i-unchecked', 'i-upcoming', 'i-copy', 'i-play', 'i-pause', 'i-arrow', 'i-down', 'i-search', 'i-folder', 'i-file', 'i-lock']) assert.ok(ids.includes(id), id)
  assert.doesNotMatch(SVG, /#[0-9a-f]{3,6}\b/i, 'no hard-coded color')
  assert.doesNotMatch(SVG.replace(/<!--[\s\S]*?-->/, ''), /<!--/, 'one comment')
  assert.doesNotMatch(SVG.match(/<!--([\s\S]*?)-->/)[1], /--/, 'the comment is valid XML')
})

// ------------------------------------------------------------------------------------------------- contrast
const root = (block) => Object.fromEntries([...block.matchAll(/(--[\w-]+):([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
const T = root(code.match(/:root\{([\s\S]*?)\n\}/)[1])
const P = root(code.match(/@media print\{\s*:root\{([\s\S]*?)\}/)[1])
const rgb = (v, tokens = T) => {
  v = v.trim()
  const ref = v.match(/^var\((--[\w-]+)\)$/)
  if (ref) return rgb(tokens[ref[1]], tokens)
  let m = v.match(/^#([0-9a-f]{6})$/i)
  if (m) return { c: [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)), a: 1 }
  m = v.match(/^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/)
  if (m) return { c: [+m[1], +m[2], +m[3]], a: +m[4] }
  throw new Error(`not a color: ${v}`)
}
const over = (fg, bg) => ({ c: fg.c.map((x, i) => x * fg.a + bg.c[i] * (1 - fg.a)), a: 1 })
const lum = ({ c }) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const SURFACES = ['--bg', '--bg-1', '--bg-2', '--panel', '--panel-2', '--well']
// the lightest surfaces a text sits on: glass-flat over the lightest panel, and a hover tint
const surfaces = () => {
  const s = Object.fromEntries(SURFACES.map((k) => [k, rgb(T[k])]))
  s['glass-flat on --panel-2'] = over(rgb(T['--glass-flat']), s['--panel-2'])
  s['hover tint on --panel-2'] = over({ c: [150, 190, 255], a: 0.09 }, s['--panel-2'])
  return s
}

test('contrast: text tokens and state colors are AA (4.5:1) on every surface', () => {
  const low = []
  for (const t of ['--ink', '--ink-2', '--ink-3', '--signal', '--alert', '--note']) {
    for (const [name, s] of Object.entries(surfaces())) { const r = ratio(rgb(T[t]), s); if (r < 4.5) low.push(`${t} on ${name}: ${r.toFixed(2)}`) }
  }
  assert.deepEqual(low, [])
})

test('contrast: each state color on its own soft tint (tags, stat tiles), on every surface', () => {
  const low = []
  for (const [fg, tint] of [['--signal', '--signal-soft'], ['--alert', '--alert-soft'], ['--note', '--note-soft']]) {
    for (const [name, s] of Object.entries(surfaces())) { const r = ratio(rgb(T[fg]), over(rgb(T[tint]), s)); if (r < 4.5) low.push(`${fg} on ${tint} over ${name}: ${r.toFixed(2)}`) }
  }
  assert.deepEqual(low, [])
})

test('contrast: the primary button text on every stop of its gradient; placeholder text; control outlines 3:1', () => {
  const stops = code.match(/\.btn-primary\{[^}]*background:linear-gradient\(([^)]*\([^)]*\)[^)]*|[^)]*)\)/)[1].match(/#[0-9a-f]{6}|var\(--[\w-]+\)/gi)
  assert.ok(stops.length >= 3)
  for (const s of stops) assert.ok(ratio(rgb(T['--ink-on-signal']), rgb(s)) >= 4.5, `--ink-on-signal on ${s}`)
  const inputBg = rgb(code.match(/input\[type=search\]\{[^}]*background:(#[0-9a-f]{6})/i)[1])
  const ph = rgb(code.match(/::placeholder\{color:(#[0-9a-f]{6})/i)[1])
  assert.ok(ratio(ph, inputBg) >= 4.5, `placeholder ${ratio(ph, inputBg).toFixed(2)}`)
  for (const [name, s] of Object.entries(surfaces())) assert.ok(ratio(rgb(T['--line-ui']), s) >= 3, `--line-ui on ${name}: ${ratio(rgb(T['--line-ui']), s).toFixed(2)}`)
  assert.ok(ratio(rgb(T['--focus']), rgb(T['--bg'])) >= 3, 'focus ring')
})

test('contrast: the print palette is AA on white', () => {
  const white = rgb('#FFFFFF')
  for (const t of ['--ink', '--ink-2', '--ink-3', '--signal', '--alert', '--note']) assert.ok(ratio(rgb(P[t], P), white) >= 4.5, `print ${t}`)
})
