// Immutable QC · ui/landing.mjs: the landing page's script (index.html). No library, no request, nothing stored.
//
// 1. The hero (#viz): the sealing ring tells one story in four steps, the same as the app's demo (ui/sample-data.mjs):
//    the plate reader writes plate-07.csv, the agent seals it, weeks later a sync conflict rewrites A01 (0.482 -> 0.428)
//    in a shared copy, and one click audits the copy and catches it. Every fingerprint shown is the real SHA-256 of the
//    sample's bytes, imported from ui/sample-data.mjs (the HTML carries the same values, so the page reads the same
//    without this script: it rests on the last step, Caught; ui/test/landing.test.mjs checks that they agree).
//    - The four step buttons jump to a step and pause; Play/Pause is always there once this script runs.
//    - It opens on Caught (what the page shows without the script), then plays the story from step 1, twice, and
//      rests on Caught again. It stops whenever the hero is off-screen or the tab is hidden, so nothing animates out of
//      sight, and with prefers-reduced-motion it does not start at all: it waits on Caught, and Play steps through the
//      four steps without the streaming and the sweep.
//    - Screen readers get the whole story from the figure's description; the visible caption of the step the
//      visitor picked is announced (aria-live, only after a click, never during play).
// 2. Copy buttons ([data-copy] names the element whose text is copied, without prompts and # comments): shown only
//    where the clipboard is available.
import { EDIT, FILES, SHA256, SHA256_EDITED, hexGroups } from './sample-data.mjs'

const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel))

copyButtons()
const viz = document.getElementById('viz')
if (viz) hero(viz)

function copyButtons() {
  if (!navigator.clipboard || !window.isSecureContext) return
  const live = document.getElementById('copy-status') || { textContent: '' }
  for (const b of $$('[data-copy]')) {
    const src = document.getElementById(b.dataset.copy)
    if (!src) continue
    b.hidden = false
    let timer = 0
    b.addEventListener('click', async () => {
      const copy = src.cloneNode(true)
      for (const x of copy.querySelectorAll('.pr, .cm')) x.remove()
      const text = copy.textContent.split('\n').map((l) => l.trim()).filter(Boolean).join('\n')
      try { await navigator.clipboard.writeText(text) } catch { return }
      const label = b.querySelector('span')
      b.dataset.copied = ''
      if (label) label.textContent = 'Copied'
      live.textContent = 'Copied to the clipboard'
      clearTimeout(timer)
      timer = setTimeout(() => { delete b.dataset.copied; if (label) label.textContent = 'Copy'; live.textContent = '' }, 1800)
    })
  }
}

function hero(viz) {
  const A = SHA256[EDIT.path]          // plate-07.csv as sealed
  const B = SHA256_EDITED[EDIT.path]   // plate-07.csv in the edited copy
  const HEX = '0123456789abcdef'
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')

  // ------------------------------------------------------------------ the sample's values, from ui/sample-data.mjs
  const chars = (code, hex) => {
    code.textContent = ''
    const out = []
    for (const g of hexGroups(hex)) {
      const span = document.createElement('span')
      for (const ch of g) { const i = document.createElement('i'); i.textContent = ch; span.appendChild(i); out.push(i) }
      code.appendChild(span)
    }
    return out
  }
  const fs = chars(viz.querySelector('[data-fp="sealed"]'), A)
  const fn = chars(viz.querySelector('[data-fp="now"]'), B)
  for (const el of $$('[data-sha]')) el.textContent = SHA256[el.dataset.sha].slice(0, 8) + '…'
  for (const el of $$('[data-sha-now]', viz)) el.textContent = SHA256_EDITED[el.dataset.shaNow].slice(0, 8) + '…'
  const before = viz.querySelector('[data-v="before"]'), after = viz.querySelector('[data-v="after"]')
  if (before) before.textContent = EDIT.before
  if (after) after.textContent = EDIT.after
  const name = viz.querySelector('[data-name]')
  if (name) name.textContent = EDIT.name
  const size = Object.fromEntries(FILES.map((f) => [f.path, f.size]))
  for (const el of $$('[data-size]', viz)) el.textContent = size[el.dataset.size] + ' B'

  const ticks = $$('.tk', viz)
  const rows = $$('.file .r:not(.r-h)', viz)
  const files = $$('.fr', viz)
  const sweep = viz.querySelector('.r-sweep')
  const buttons = $$('[data-go]', viz)
  const caps = viz.querySelector('.caps')
  const play = viz.querySelector('.viz-play')
  const playLabel = play.querySelector('.viz-play-t')
  const playIcon = play.querySelector('use')

  // ------------------------------------------------------------------ the story, in ms
  const PH = [['written', 0], ['sealed', 2600], ['edited', 6000], ['caught', 9000]]
  const SEAL = [2800, 4700]        // the sealed fingerprint streams in, then locks
  const COPY = 6000 + 900          // the value changes in the copy this long after the copy appears
  const AUDIT = [9000, 10900]      // the audit recomputes the fingerprint, and checks the other files on the way
  const FADE = 14600, LOOP = 15100
  const SETTLED = { written: 2500, sealed: 5900, edited: 8900, caught: 14000 }
  const FILE_DONE = [AUDIT[1], 9500, 9850, 10200, 10550] // plate-07.csv (row 1) is the last one checked
  const RUNS = 2                   // full runs before it rests on Caught

  let t = 11800                    // where the story is: on Caught, as the page shows it without this script
  let playing = !reduce.matches, onScreen = false, runs = 0, raf = 0, last = 0, lastFlux = 0, stepTimer = 0
  const cache = {}

  const phaseAt = (ms) => { let p = PH[0][0]; for (const [n, s] of PH) if (ms >= s) p = n; return p }
  const rnd = () => HEX[(Math.random() * 16) | 0]
  const set = (el, txt, cls) => { if (el.textContent !== txt) el.textContent = txt; if (el.className !== cls) el.className = cls }
  const flag = (key, on) => { if (cache[key] !== on) { viz.classList.toggle(key, on); cache[key] = on } }

  function render(ms, flux) {
    const ph = phaseAt(ms)
    if (cache.phase !== ph) {
      viz.dataset.phase = ph
      const at = PH.findIndex((x) => x[0] === ph)
      buttons.forEach((b, i) => {
        if (i === at) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current')
        b.classList.toggle('done', i < at)
      })
      cache.phase = ph
    }
    flag('is-writing', ph === 'written')
    flag('is-sealing', ms >= PH[1][1] && ms < SEAL[1])
    flag('is-copying', ms >= PH[2][1] && ms < COPY)
    flag('is-auditing', ms >= AUDIT[0] && ms < AUDIT[1])
    flag('is-fading', ms >= FADE)
    for (let r = 0; r < rows.length; r++) rows[r].classList.toggle('in', ph !== 'written' || ms > 300 + r * 320)
    for (let r = 0; r < files.length; r++) files[r].classList.toggle('done', ms >= FILE_DONE[r])

    // the sealed fingerprint: streams, then locks left to right
    const k = ms < SEAL[0] ? -1 : ms >= SEAL[1] ? 64 : Math.floor(((ms - SEAL[0]) / (SEAL[1] - SEAL[0])) * 64)
    for (let i = 0; i < 64; i++) {
      if (k < 0 || i > k + 6) set(fs[i], '·', 'd')
      else if (i < k) set(fs[i], A[i], '')
      else if (flux) set(fs[i], rnd(), 'f')
    }
    // the audit's fingerprint: recomputed from the copy's bytes, compared character by character
    const a = ms < AUDIT[0] ? -1 : ms >= AUDIT[1] ? 64 : Math.floor(((ms - AUDIT[0]) / (AUDIT[1] - AUDIT[0])) * 64)
    for (let i = 0; i < 64; i++) {
      if (a < 0 || i > a + 6) set(fn[i], '·', 'd')
      else if (i < a) set(fn[i], B[i], B[i] === A[i] ? 'm' : '')
      else if (flux) set(fn[i], rnd(), 'f')
    }
    // the ring: one tick per hex character
    for (let i = 0; i < 64; i++) {
      let c = 'tk'
      if (a >= 0 && i < a) c = B[i] === A[i] ? 'tk on' : 'tk bad'
      else if (k > 0 && i < k) c = 'tk on'
      if (ticks[i].getAttribute('class') !== c) ticks[i].setAttribute('class', c)
    }
    if (ms >= AUDIT[0] && ms < AUDIT[1]) sweep.setAttribute('transform', `rotate(${(((ms - AUDIT[0]) / (AUDIT[1] - AUDIT[0])) * 360 - 106).toFixed(1)} 200 200)`)
  }

  // ------------------------------------------------------------------ playing
  const running = () => playing && onScreen && !document.hidden
  function frame(now) {
    raf = 0
    if (!running() || reduce.matches) return
    const dt = Math.min(64, now - (last || now))
    last = now
    t += dt
    if (t >= LOOP) { t -= LOOP; runs++ }
    if (runs >= RUNS && t >= SETTLED.caught - 1000) { t = SETTLED.caught; render(t, false); pause(); return }
    const flux = now - lastFlux > 60
    if (flux) lastFlux = now
    render(t, flux)
    raf = requestAnimationFrame(frame)
  }
  function stepNext() {
    // reduced motion: one step at a time, no streaming, no sweep
    stepTimer = 0
    if (!running()) return
    const order = PH.map((p) => p[0]), now = order.indexOf(phaseAt(t))
    if (now === order.length - 1) { pause(); return }
    t = SETTLED[order[now + 1]]
    render(t, false)
    stepTimer = setTimeout(stepNext, 3200)
  }
  function sync() {
    if (running()) {
      if (reduce.matches) { if (!stepTimer) stepTimer = setTimeout(stepNext, 1600) }
      else if (!raf) { last = 0; raf = requestAnimationFrame(frame) }
    } else halt()
    playLabel.textContent = playing ? 'Pause' : 'Play'
    playIcon.setAttribute('href', playing ? '#i-pause' : '#i-play')
  }
  function halt() {
    if (raf) cancelAnimationFrame(raf)
    if (stepTimer) clearTimeout(stepTimer)
    raf = 0; stepTimer = 0
  }
  function pause() { playing = false; sync() }
  function resume() {
    // play on from where it is (after a step button, that is the end of that step); from Caught, from the start
    playing = true
    runs = 0
    caps.setAttribute('aria-live', 'off')
    if (phaseAt(t) === 'caught' && t >= AUDIT[1]) { t = reduce.matches ? SETTLED.written : 0; render(t, false) }
    sync()
  }

  // ------------------------------------------------------------------ controls
  play.hidden = false
  play.addEventListener('click', () => (playing ? pause() : resume()))
  for (const b of buttons) {
    b.disabled = false
    b.addEventListener('click', () => {
      playing = false
      halt()
      caps.setAttribute('aria-live', 'polite')
      t = SETTLED[b.dataset.go]
      render(t, false)
      sync()
    })
  }
  document.addEventListener('visibilitychange', sync)
  if (reduce.addEventListener) reduce.addEventListener('change', () => { if (reduce.matches) { playing = false; t = SETTLED.caught; render(t, false) } sync() })
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => { onScreen = es[es.length - 1].intersectionRatio >= 0.2; sync() }, { threshold: [0, 0.2, 0.5] }).observe(viz)
  } else onScreen = true
  render(t, false)
  sync()
}
