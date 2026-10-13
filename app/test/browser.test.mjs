// The app in Chromium (Playwright, the preinstalled browser), served as GitHub Pages will publish it (the deploy
// allowlist, site/tools/serve.mjs serveDeploy; the repo root if that cannot be assembled). Skipped when Playwright is not
// installed, or with IQC_SKIP_BROWSER=1. IQC_LARGE=<n> sets the size of the many-files test: 2,000 files by default (a
// few seconds, so it runs in CI), IQC_LARGE=100000 for the full-scale check (minutes: the browser lists a chosen folder of
// that size on its own thread before the page gets it), 0 to skip it.
//
// Every test and hook has a timeout, and every page, context, browser and server it opens is closed, so a run always ends.
// `node --test app/test` runs this file and engine.test.mjs in one process (index.mjs), one test at a time: one Chromium.
//
// Folders are given to the app with setInputFiles on its folder input (<input webkitdirectory>), as a person choosing a
// folder would; results are read from the JSON report the app downloads, so the downloads are tested too. Every page
// records console errors, uncaught errors, CSP violations and any request that leaves the origin; the last test checks
// that none happened in the whole run.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, cpSync, readdirSync, statSync, renameSync, openSync, ftruncateSync, closeSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import * as IQC from '../../core/immutableqc.mjs'
import { FILES, EDIT, SHA256, SHA256_EDITED } from '../../ui/sample-data.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FX = join(ROOT, 'core', 'test', 'fixtures')
const EXPECTED = JSON.parse(readFileSync(join(FX, 'expected.json'), 'utf8'))
const require = createRequire(import.meta.url)
function load(name) {
  for (const p of [`/opt/node22/lib/node_modules/${name}`, join(ROOT, 'site', 'node_modules', name), name]) { try { return require(p) } catch { /* next */ } }
  return null
}
const pw = process.env.IQC_SKIP_BROWSER ? null : load('playwright')
const SKIP = !pw && 'Playwright is not installed'
let AXE = null
try { AXE = readFileSync(require.resolve(join(ROOT, 'site', 'node_modules', 'axe-core', 'axe.min.js')), 'utf8') } catch { AXE = null }
const LARGE = process.env.IQC_LARGE === undefined || process.env.IQC_LARGE === '' ? 2000 : Math.max(0, Math.floor(Number(process.env.IQC_LARGE)) || 0)

let server = null, base = '', browser = null, tmp = ''
const issues = []
const statesSeen = new Set()

const contexts = new Set() // every context a test opens, closed at the end even when the test failed half way
before(async () => {
  if (!pw) return
  const S = await import(join(ROOT, 'site', 'tools', 'serve.mjs'))
  try { server = await S.serveDeploy(0) } catch (e) {
    console.error(`(serving the repo root: the deploy allowlist could not be assembled: ${e.message})`)
    server = await S.serve(0)
  }
  base = `http://127.0.0.1:${server.port}`
  // a UTF-8 locale, so that Chromium opens file names such as "méthode 50%.txt" (it cannot under LANG=C)
  browser = await pw.chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } })
  tmp = mkdtempSync(join(tmpdir(), 'iqc-app-test-'))
}, { timeout: 120000 })
after(async () => {
  const quietly = (p) => Promise.race([Promise.resolve(p).catch(() => {}), new Promise((r) => setTimeout(r, 15000).unref())])
  for (const c of contexts) await quietly(c.close())
  if (browser) await quietly(browser.close())
  if (server) await quietly(server.close())
  if (tmp) rmSync(tmp, { recursive: true, force: true })
}, { timeout: 60000 })

async function open(path, { width = 1440, height = 900, ctx = null } = {}) {
  const context = ctx || (await browser.newContext({ viewport: { width, height }, acceptDownloads: true }))
  contexts.add(context)
  context.on('close', () => contexts.delete(context))
  await context.addInitScript(() => {
    window.__csp = []
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`))
  })
  const page = await context.newPage()
  page.on('console', (m) => { if (m.type() === 'error') issues.push(`console error on ${path}: ${m.text()}`) })
  page.on('pageerror', (e) => issues.push(`uncaught error on ${path}: ${e}`))
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(base + '/') && !/^(?:blob|data):/.test(u)) issues.push(`request off the origin from ${path}: ${u}`) })
  page.on('close', () => {})
  await page.goto(base + path)
  page.checkCSP = async () => { const v = await page.evaluate(() => window.__csp); if (v.length) issues.push(`CSP violations on ${path}: ${v.join(', ')}`) }
  page.done = async () => { await page.checkCSP(); if (!ctx) await context.close(); else await page.close() }
  return page
}

const RESULT = (mode) => `#${mode} [data-view="result"]:not([hidden]) .verdict`
async function auditFolder(page, dir) {
  await page.setInputFiles('#audit-folder', dir)
  await page.waitForSelector(`${RESULT('audit')}, #audit [data-view="error"]:not([hidden]) .err, #audit [data-view="ledger"]:not([hidden])`, { timeout: 60000 })
}
async function jsonReport(page, mode) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`#${mode} [data-view="result"]:not([hidden]) [data-act="report-json"]`)])
  const r = JSON.parse(readFileSync(await dl.path(), 'utf8'))
  assert.match(dl.suggestedFilename(), /^immutableqc-audit-[\w.-]+-\d{4}-\d{2}-\d{2}-(?:pass|fail)\.json$/)
  return r
}
async function htmlReport(page, mode) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`#${mode} [data-view="result"]:not([hidden]) [data-act="report-html"]`)])
  return readFileSync(await dl.path(), 'utf8')
}
const states = (r) => Object.fromEntries(r.files.map((f) => [f.path, f.state]))
const wantStates = (v) => Object.fromEntries(Object.entries(v.files).map(([p, f]) => [p, f.state]))
const sha = (b) => createHash('sha256').update(b).digest('hex')
function writeSample(dir, { edited = false } = {}) {
  for (const f of edited ? FILES.map((x) => (x.path === EDIT.path ? { ...x, bytes: Buffer.from(Buffer.from(x.bytes).toString().replace(`A01,${EDIT.before}`, `A01,${EDIT.after}`)) } : x)) : FILES) {
    mkdirSync(dirname(join(dir, f.path)), { recursive: true })
    writeFileSync(join(dir, f.path), f.bytes)
  }
}
function nodeFiles(dir) {
  const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? (d === dir && n === 'ImmutableQC' ? [] : walk(join(d, n))) : [join(d, n)]))
  return new Map(walk(dir).map((p) => { const b = readFileSync(p); return [IQC.encodePath(relative(dir, p).split('\\').join('/')), { sha256: sha(b), bytes: b.length }] }))
}
async function axeCheck(page, what) {
  if (!AXE) return
  await page.evaluate(AXE)
  const v = await page.evaluate(async () => (await axe.run(document, { resultTypes: ['violations'] })).violations.map((x) => `${x.id} (${x.nodes.length}): ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`))
  assert.deepEqual(v, [], `axe, ${what}`)
  statesSeen.add(what)
}
async function noOverflow(page, what, widths = [320, 375, 390, 768, 1024, 1280, 1440, 1920]) {
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.waitForTimeout(60)
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
    assert.ok(o.sw <= o.cw, `${what}: horizontal overflow at ${w} px (${o.sw} > ${o.cw})`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

// ---------------------------------------------------------------------------------------------- the audit
test('audit: the sample folder passes, with the same head and key id as the agent’s fixtures', { skip: SKIP, timeout: 120000 }, async () => {
  const want = EXPECTED.variants.sample
  const page = await open('/app/')
  await axeCheck(page, 'audit ready')
  await auditFolder(page, join(FX, 'sample'))
  // focus moves to the verdict; the verdict says pass in words, with an icon
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('verdict')), true)
  assert.match(await page.textContent(`${RESULT('audit')} .tag`), /Pass/)
  assert.equal(await page.textContent(`${RESULT('audit')} h1`), 'All 6 files match their seals. Ledger intact.')
  const r = await jsonReport(page, 'audit')
  assert.equal(r.format, 'immutableqc-audit')
  assert.equal(r.verdict, 'pass')
  assert.equal(r.summary, want.summary)
  assert.deepEqual(r.ledger.head, want.head)
  assert.equal(r.ledger.keyId, want.keyId)
  assert.deepEqual(states(r), wantStates(want))
  assert.equal(r.method.where, 'in a browser')
  assert.equal(r.method.tool, `immutableqc-app/${IQC.VERSION}`)
  for (const [p, f] of Object.entries(want.files)) if (f.sha256) assert.equal(r.files.find((x) => x.path === p).present.sha256, f.sha256, p)
  const html = await htmlReport(page, 'audit')
  assert.ok(html.startsWith('<!doctype html>') && !/<script/i.test(html) && html.includes(want.head.h))
  // the stat tiles and the filter chips count the same things
  const tiles = await page.$$eval(`#audit [data-view="result"] .stat`, (els) => els.map((e) => `${e.querySelector('.stat-n').textContent} ${e.querySelector('.stat-l').textContent}`))
  const chips = await page.$$eval(`#audit [data-view="result"] .filter`, (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()))
  // notes: instrument.log was sealed twice, run-0915/injection-01.csv was found by a later scan
  assert.deepEqual(tiles, ['6 Match', '0 Changed', '0 Missing', '2 Files with notes'])
  assert.deepEqual(chips, ['All 7', 'Problems 0', 'Notes 2'])
  // the ledger panel: copy buttons, the agent (not sealed), the pinned-head advice, the command line
  const side = await page.textContent('#audit [data-view="result"] .col-side')
  assert.ok(side.includes('immutableqc-cli/0.1.0') && side.includes('(not sealed)') && /None given\. Pin one with iqc head/.test(side.replace(/\s+/g, ' ')))
  assert.ok((await page.textContent('#audit [data-view="result"] .rerun pre')).includes(`node iqc.mjs audit "sample" --expect-head ${want.headString} --json audit.json`))
  await axeCheck(page, 'audit pass')
  await noOverflow(page, 'audit pass')
  // keyboard: the Notes filter and the search work from the keyboard
  await page.focus('#audit [data-view="result"] [data-filter="notes"]')
  await page.keyboard.press('Enter')
  assert.equal(await page.$$eval('#audit [data-view="result"] tbody tr', (r) => r.length), 2)
  await page.fill('#audit [data-view="result"] [data-search]', want.files['run-0914/injection-02.csv'].sha256.slice(10, 30))
  await page.click('#audit [data-view="result"] [data-filter="all"]')
  await page.waitForFunction(() => document.querySelectorAll('#audit [data-view="result"] tbody tr').length === 1)
  assert.match(await page.textContent('#audit [data-view="result"] tbody tr'), /run-0914\/injection-02\.csv/)
  // "Audit another folder" goes back to the drop target
  await page.click('#audit [data-view="result"] [data-act="reset"]')
  assert.equal(await page.isVisible('#audit-drop'), true)
  await page.done()
})

test('audit: the tampered folder fails, with the expected state for every file', { skip: SKIP, timeout: 120000 }, async () => {
  const want = EXPECTED.variants['tampered-file']
  const page = await open('/app/')
  await auditFolder(page, join(FX, 'tampered-file'))
  assert.match(await page.textContent(`${RESULT('audit')} .tag`), /Fail/)
  assert.equal(await page.textContent(`${RESULT('audit')} h1`), '2 files changed since they were sealed and 1 file is missing.')
  // the fail state: ghost downloads (the cyan primary only on a pass), the finding sentence, the notes on one line
  assert.equal(await page.$$eval(`${RESULT('audit')} .btn-primary`, (e) => e.length), 0)
  const body = (await page.textContent('#audit [data-view="result"]')).replace(/\s+/g, ' ')
  assert.ok(body.includes('A fail is a finding, not a verdict on anyone: compare the changed files with your backups, and keep the report with the run.'))
  assert.ok(body.includes('Problems 3 · each one fails the audit'))
  assert.ok(/4 notes \(not failures\): 1 file sealed more than once, 1 change found by a later scan, 1 file never sealed, 1 gap between sessions\./.test(body), body.slice(0, 2000))
  assert.ok(body.includes('76 bytes instead of 115.') && body.includes('60 bytes, the same size as sealed: only the content differs.'))
  assert.ok(body.includes('They match the version sealed in record 2, not the latest one'))
  const r = await jsonReport(page, 'audit')
  assert.equal(r.verdict, 'fail')
  assert.equal(r.summary, want.summary)
  assert.deepEqual(r.ledger.head, want.head)
  assert.deepEqual(states(r), wantStates(want))
  assert.equal(r.files.find((f) => f.path === 'instrument.log').matchesN, 2)
  const enc = r.files.map((f) => f.path).find((p) => p.includes('%25'))
  assert.ok(enc, 'the fixture has a path with an encoded %')
  const paths = await page.$$eval('#audit [data-view="result"] tbody .c-path code', (e) => e.map((x) => x.textContent))
  assert.ok(paths.includes(IQC.decodePath(enc)) && !paths.includes(enc), paths.join(', '))
  // problems first in the file list
  const first = await page.$$eval('#audit [data-view="result"] tbody tr', (rows) => rows.slice(0, 3).map((x) => x.className))
  assert.deepEqual(first, ['is-problem', 'is-problem', 'is-problem'])
  await axeCheck(page, 'audit fail')
  await noOverflow(page, 'audit fail')
  await page.done()
})

test('audit: the tampered ledger fails at the expected line, and the files are checked against the records before it', { skip: SKIP, timeout: 120000 }, async () => {
  const want = EXPECTED.variants['tampered-ledger']
  const page = await open('/app/')
  await auditFolder(page, join(FX, 'tampered-ledger'))
  const r = await jsonReport(page, 'audit')
  assert.equal(r.verdict, 'fail')
  assert.equal(r.summary, want.summary)
  assert.deepEqual(r.problems.filter((p) => p.line).map((p) => ({ line: p.line, code: p.code })), want.problems)
  assert.deepEqual(r.ledger.head, want.head)
  assert.deepEqual(states(r), wantStates(want))
  const text = (await page.textContent('#audit [data-view="result"]')).replace(/\s+/g, ' ')
  assert.ok(text.includes('The ledger breaks at line 8: files are checked against the 6 records before it'))
  assert.ok(text.includes('Line 8 (record 7)'))
  await axeCheck(page, 'audit fail, ledger')
  await page.done()
})

test('audit: no ledger in the folder, the app asks for the ledger file; a file that is not a ledger is refused', { skip: SKIP, timeout: 120000 }, async () => {
  const dir = join(tmp, 'fallback', 'sample')
  cpSync(join(FX, 'sample'), dir, { recursive: true })
  const ledger = join(tmp, 'fallback', 'elsewhere.jsonl')
  renameSync(join(dir, 'ImmutableQC', 'ledger.jsonl'), ledger)
  rmSync(join(dir, 'ImmutableQC'), { recursive: true })
  const page = await open('/app/')
  await auditFolder(page, dir)
  assert.equal(await page.isVisible('#audit [data-view="ledger"]'), true)
  assert.match(await page.textContent('#audit [data-view="ledger"] h1'), /Where is the ledger\?/)
  await axeCheck(page, 'ask for the ledger')
  // the wrong file: a readable reason, and the question stays
  await page.setInputFiles('#audit-ledger', join(dir, 'instrument.log'))
  await page.waitForSelector('#audit [data-slot="ask-error"] .callout')
  assert.match(await page.textContent('#audit [data-slot="ask-error"]'), /This file is not a ledger\. instrument\.log: its first line is not a JSON object/)
  await axeCheck(page, 'ask, wrong file')
  // the right one: the audit runs with the folder's files
  await page.setInputFiles('#audit-ledger', ledger)
  await page.waitForSelector(RESULT('audit'))
  const r = await jsonReport(page, 'audit')
  assert.equal(r.verdict, 'pass')
  assert.deepEqual(r.ledger.head, EXPECTED.variants.sample.head)
  assert.deepEqual(states(r), wantStates(EXPECTED.variants.sample))
  await page.done()
})

test('audit: a pinned head and an expected key id pass when they match, fail when they do not; a typo stops before the audit', { skip: SKIP, timeout: 120000 }, async () => {
  const want = EXPECTED.variants.sample
  const page = await open('/app/')
  await page.click('#audit-opts summary')
  await page.fill('#audit-head', want.headString)
  await page.fill('#audit-key', want.keyId)
  await auditFolder(page, join(FX, 'sample'))
  let r = await jsonReport(page, 'audit')
  assert.equal(r.verdict, 'pass')
  assert.equal(r.expectations.head.ok, true)
  assert.equal(r.expectations.keyId.ok, true)
  assert.ok((await page.textContent('#audit [data-view="result"] .col-side')).includes('Matches'))
  // a head of the same record number with another link: the ledger was rewritten
  await page.click('#audit [data-view="result"] [data-act="reset"]')
  await page.fill('#audit-head', `${want.head.n}:${'0'.repeat(64)}`)
  await auditFolder(page, join(FX, 'sample'))
  r = await jsonReport(page, 'audit')
  assert.equal(r.verdict, 'fail')
  assert.deepEqual(r.problems.map((p) => p.code), ['expect-head'])
  assert.match(await page.textContent(`${RESULT('audit')} h1`), /The pinned head does not match/)
  // another key id
  await page.click('#audit [data-view="result"] [data-act="reset"]')
  await page.fill('#audit-head', '')
  await page.fill('#audit-key', 'ffffffffffffffff')
  await auditFolder(page, join(FX, 'sample'))
  r = await jsonReport(page, 'audit')
  assert.deepEqual(r.problems.map((p) => p.code), ['expect-key'])
  // a typo: the field says why, and nothing runs
  await page.click('#audit [data-view="result"] [data-act="reset"]')
  await page.fill('#audit-key', '')
  await page.fill('#audit-head', '12-9a0e')
  await page.setInputFiles('#audit-folder', join(FX, 'sample'))
  await page.waitForSelector('#audit-head[aria-invalid="true"]')
  assert.match(await page.textContent('#audit-head-err'), /record number, a colon and the 64-character link/)
  assert.equal(await page.isVisible('#audit-drop'), true)
  assert.equal(await page.evaluate(() => document.activeElement.id), 'audit-head')
  await axeCheck(page, 'field error')
  await page.done()
})

test('audit: readable errors for a worker that cannot run, a folder too large for a tab, and several data folders', { skip: SKIP, timeout: 120000 }, async () => {
  let page = await open('/app/?test&worker=no-such-worker.mjs')
  await auditFolder(page, join(FX, 'sample'))
  assert.match(await page.textContent('#audit [data-view="error"] h1'), /A background worker stopped/)
  assert.match(await page.textContent('#audit [data-view="error"]'), /Nothing was changed/)
  await axeCheck(page, 'error')
  await page.click('#audit [data-view="error"] [data-act="reset"]')
  assert.equal(await page.isVisible('#audit-drop'), true)
  issues.splice(0, issues.length, ...issues.filter((x) => !/no-such-worker/.test(x))) // the 404 of the missing worker is the point of this test
  await page.done()
  page = await open('/app/?test&max=3')
  await auditFolder(page, join(FX, 'sample'))
  assert.match(await page.textContent('#audit [data-view="error"] h1'), /This folder is too large for a browser tab/)
  assert.match(await page.textContent('#audit [data-view="error"]'), /node iqc\.mjs audit/)
  await page.done()
  page = await open('/app/')
  await auditFolder(page, FX)
  assert.match(await page.textContent('#audit [data-view="error"] h1'), /This folder holds several data folders/)
  await page.done()
})

test('audit: a canceled audit goes back to the drop target, and the next one runs', { skip: SKIP, timeout: 120000 }, async () => {
  const dir = join(tmp, 'cancel', 'folder')
  mkdirSync(join(dir, 'raw'), { recursive: true })
  // a sparse 3 GiB file: no disk space, written at once, and seconds of hashing (in a worker, which CPU throttling does
  // not slow), so the audit is still running when Cancel is pressed
  const fd = openSync(join(dir, 'raw', 'big.bin'), 'w')
  ftruncateSync(fd, 3 * 2 ** 30)
  closeSync(fd)
  // and enough small files that reading their sizes, on the throttled page, reports progress while the folder is read
  mkdirSync(join(dir, 'wells'))
  for (let i = 0; i < 600; i++) writeFileSync(join(dir, 'wells', `w${String(i).padStart(3, '0')}.csv`), `well,abs_450\nA01,0.${i}\n`)
  cpSync(join(FX, 'sample', 'ImmutableQC'), join(dir, 'ImmutableQC'), { recursive: true })
  const page = await open('/app/')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 8 })
  await page.setInputFiles('#audit-folder', dir)
  await page.waitForSelector('#audit [data-view="run"]:not([hidden]) .checks')
  await axeCheck(page, 'audit running')
  // once the folder step is done, it shows the folder's final count (not a listing frame drawn after it)
  await page.waitForSelector('#audit [data-view="run"] li[data-s="list"].done', { timeout: 30000 })
  assert.match(await page.textContent('#audit [data-view="run"] li[data-s="list"] [data-t]'), /^60\d files, 3\.2 GB$/)
  await page.click('#audit [data-view="run"] [data-p="cancel"]')
  await page.waitForSelector('#audit-drop', { state: 'visible' })
  assert.match(await page.textContent('#live'), /Audit canceled/)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await auditFolder(page, join(FX, 'sample'))
  assert.equal((await jsonReport(page, 'audit')).verdict, 'pass')
  await page.done()
})

// docs/product-v1.md, section 8: a folder sealed by the agent, audited in the browser, gets the same verdict and head as
// `iqc audit`. The one-file download is the agent people run; its key goes to a temporary home.
test('audit: a folder sealed by the agent (download/iqc.mjs) gets the same verdict, head and file states in the browser as from iqc audit', { skip: SKIP, timeout: 120000 }, async () => {
  const home = join(tmp, 'cli-home'), dir = join(tmp, 'cli', 'bio-line-2')
  mkdirSync(home, { recursive: true })
  writeSample(dir)
  const env = { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1' }
  delete env.NODE_TEST_CONTEXT
  const iqc = (...args) => spawnSync(process.execPath, [join(ROOT, 'download', 'iqc.mjs'), ...args], { env, encoding: 'utf8', timeout: 60000 })
  const sealed = iqc('seal', dir, '--settle', '0', '--station', 'bio-line-2')
  assert.equal(sealed.status, 0, sealed.stdout + sealed.stderr)
  const same = async (verdict, exit) => {
    const out = join(tmp, `cli-audit-${verdict}.json`)
    const a = iqc('audit', dir, '--json', out)
    assert.equal(a.status, exit, a.stdout + a.stderr)
    const cli = JSON.parse(readFileSync(out, 'utf8'))
    const page = await open('/app/')
    await auditFolder(page, dir)
    const app = await jsonReport(page, 'audit')
    await page.done()
    assert.equal(cli.verdict, verdict)
    assert.equal(app.verdict, verdict)
    assert.equal(app.summary, cli.summary)
    assert.deepEqual(app.ledger.head, cli.ledger.head)
    assert.equal(app.ledger.keyId, cli.ledger.keyId)
    assert.deepEqual(states(app), states(cli))
    assert.deepEqual(app.problems.map((p) => [p.code, p.path || null]), cli.problems.map((p) => [p.code, p.path || null]))
    assert.deepEqual(app.notes.map((n) => n.code), cli.notes.map((n) => n.code))
    assert.equal(app.method.where, 'in a browser')
    assert.notEqual(cli.method.where, app.method.where)
    return app
  }
  await same('pass', 0)
  // one value changed later, in the folder, with no agent watching: the same fail on the same file, from both
  writeFileSync(join(dir, EDIT.path), Buffer.from(readFileSync(join(dir, EDIT.path), 'utf8').replace(`A01,${EDIT.before}`, `A01,${EDIT.after}`)))
  const fail = await same('fail', 1)
  assert.deepEqual(fail.problems.map((p) => [p.code, p.path]), [['changed', EDIT.path]])
})

// --------------------------------------------------------------------------------------------------- the demo
test('demo: #demo starts at once; a pass, one value changed in a copy, a fail on plate-07.csv, and start over', { skip: SKIP, timeout: 120000 }, async () => {
  const page = await open('/app/#demo')
  await page.waitForSelector('#demo [data-verdict="pass"]', { timeout: 30000 })
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('verdict')), true)
  let r = await jsonReport(page, 'demo')
  assert.equal(r.verdict, 'pass')
  assert.equal(r.counts.match, 5)
  assert.equal(r.ledger.station, 'bio-line-2')
  for (const f of r.files) assert.equal(f.present.sha256, SHA256[f.path], f.path)
  const head1 = r.ledger.head
  // focus lands on the verdict, so the next step is there too; the sample folder is in memory: no command line to re-run
  assert.equal(await page.isVisible('#demo [data-view="result"] .verdict [data-act="demo-edit"]'), true)
  assert.equal(await page.$$eval('#demo [data-view="result"] .rerun', (e) => e.length), 0)
  await axeCheck(page, 'demo pass')
  await noOverflow(page, 'demo pass')
  await page.click('#demo [data-view="result"] .verdict [data-act="demo-edit"]')
  await page.waitForSelector('#demo [data-verdict="fail"]', { timeout: 30000 })
  r = await jsonReport(page, 'demo')
  assert.equal(r.verdict, 'fail')
  assert.deepEqual(r.problems.map((p) => [p.code, p.path]), [['changed', EDIT.path]])
  const row = r.files.find((f) => f.path === EDIT.path)
  assert.equal(row.present.sha256, SHA256_EDITED[EDIT.path])
  assert.equal(row.sealed.sha256, SHA256[EDIT.path])
  assert.deepEqual(r.ledger.head, head1)
  const panel = (await page.textContent('#demo .demo')).replace(/\s+/g, ' ')
  assert.ok(panel.includes(`${EDIT.name}, well ${EDIT.well}: ${EDIT.before} became ${EDIT.after}`))
  assert.ok(panel.includes(`fail: ${EDIT.name} changed since it was sealed`))
  assert.ok(panel.includes('not on the watched instrument PC'))
  assert.equal(await page.textContent('#demo [data-view="result"] .verdict h2'), '1 file changed since it was sealed.')
  await axeCheck(page, 'demo fail')
  await noOverflow(page, 'demo fail')
  assert.equal(await page.isVisible('#demo [data-view="result"] .end-row [data-act="demo-restart"]'), true)
  await page.click('#demo [data-view="result"] .end-row [data-act="demo-restart"]')
  await page.waitForSelector('#demo [data-verdict="pass"]', { timeout: 30000 })
  r = await jsonReport(page, 'demo')
  assert.equal(r.verdict, 'pass')
  assert.notDeepEqual(r.ledger.head, head1) // a fresh key and ledger
  // the header's switch, by keyboard: Audit, then Demo again keeps the demo where it was
  await page.click('.modes a[data-mode="audit"]')
  await page.waitForSelector('#audit:not([hidden])')
  assert.equal(await page.getAttribute('.modes a[data-mode="audit"]', 'aria-current'), 'page')
  await page.click('.modes a[data-mode="demo"]')
  await page.waitForSelector('#demo [data-verdict="pass"]')
  await page.done()
})

// ---------------------------------------------------------------------------------------------------- the seal
test('seal: the browser seals a folder; the ledger it downloads verifies in Node, an audit of the folder passes, and a later seal appends', { skip: SKIP, timeout: 180000 }, async () => {
  const dir = join(tmp, 'seal', 'bio-line-2')
  writeSample(dir)
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const page = await open('/app/#seal', { ctx }) // (open() adds ctx to the contexts closed at the end)
  await axeCheck(page, 'seal ready')
  await page.click('#seal-opts summary')
  await page.fill('#seal-station', 'bench-browser')
  await page.setInputFiles('#seal-folder', dir)
  await page.waitForSelector(RESULT('seal'), { timeout: 60000 })
  assert.match(await page.textContent(`${RESULT('seal')} h1`), /5 files sealed\. Your ledger is ready\./)
  const text = (await page.textContent('#seal [data-view="result"]')).replace(/\s+/g, ' ')
  assert.ok(text.includes('bio-line-2/ImmutableQC/ledger.jsonl') && text.includes('the agent is the real tool') && text.includes('This browser made a new key'))
  await axeCheck(page, 'seal result')
  await noOverflow(page, 'seal result', [320, 390, 1024, 1440])
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#seal [data-act="download-ledger"]')])
  assert.equal(dl.suggestedFilename(), 'ledger.jsonl')
  const ledger1 = readFileSync(await dl.path(), 'utf8')
  // in Node, with core: it verifies, it seals every file as it is, and the key stays in the browser
  const v = await IQC.verifyLedger(ledger1)
  assert.equal(v.ok, true, JSON.stringify(v.problems))
  assert.equal(v.header.station, 'bench-browser')
  assert.equal(v.header.ctx.agent, `immutableqc-app/${IQC.VERSION}`)
  assert.deepEqual(v.records.map((x) => x.f.event), ['scan', 'existing', 'existing', 'existing', 'existing', 'existing'])
  assert.equal(IQC.audit(v, nodeFiles(dir)).verdict, 'pass')
  const stored = await page.evaluate(() => new Promise((res, rej) => { const q = indexedDB.open('immutableqc-app', 1); q.onsuccess = () => { const g = q.result.transaction('keys').objectStore('keys').getAll(); g.onsuccess = () => res(g.result.map((k) => ({ keyId: k.keyId, extractable: k.privateKey.extractable, type: k.privateKey.type }))); g.onerror = rej }; q.onerror = rej }))
  assert.deepEqual(stored, [{ keyId: v.keyId, extractable: false, type: 'private' }])
  // put it in the folder, as the page says, and audit the folder in the browser: a pass with the same head
  mkdirSync(join(dir, 'ImmutableQC'))
  writeFileSync(join(dir, 'ImmutableQC', 'ledger.jsonl'), ledger1)
  await page.click('.modes a[data-mode="audit"]')
  await auditFolder(page, dir)
  let r = await jsonReport(page, 'audit')
  assert.equal(r.verdict, 'pass')
  assert.deepEqual(r.ledger.head, v.head)
  // change a file in the folder, seal again: this browser holds the key, so a scan and the change are appended
  writeFileSync(join(dir, EDIT.path), Buffer.from(readFileSync(join(dir, EDIT.path), 'utf8').replace(`A01,${EDIT.before}`, `A01,${EDIT.after}`)))
  await page.click('.modes a[data-mode="seal"]')
  await page.setInputFiles('#seal-folder', dir)
  await page.waitForSelector(RESULT('seal'), { timeout: 60000 })
  assert.match(await page.textContent(`${RESULT('seal')} h1`), /1 change sealed and added to the ledger\./)
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#seal [data-view="result"]:not([hidden]) [data-act="download-ledger"]')])
  const ledger2 = readFileSync(await dl2.path(), 'utf8')
  assert.ok(ledger2.startsWith(ledger1))
  const v2 = await IQC.verifyLedger(ledger2)
  assert.equal(v2.ok, true)
  assert.deepEqual(v2.records.slice(6).map((x) => [x.f.event, x.f.path || null, x.f.sha256 || null]), [['scan', null, null], ['changed-unwatched', EDIT.path, SHA256_EDITED[EDIT.path]]])
  writeFileSync(join(dir, 'ImmutableQC', 'ledger.jsonl'), ledger2)
  await page.click('.modes a[data-mode="audit"]')
  await page.click('#audit [data-view="result"]:not([hidden]) [data-act="reset"]')
  await auditFolder(page, dir)
  r = await jsonReport(page, 'audit')
  assert.equal(r.verdict, 'pass')
  assert.ok(r.notes.some((n) => n.code === 'sealed-more-than-once'))
  await page.done()
  await ctx.close()
})

test('seal: a folder whose ledger this browser cannot sign is refused, with a way to audit it instead', { skip: SKIP, timeout: 120000 }, async () => {
  const page = await open('/app/#seal')
  await page.setInputFiles('#seal-folder', join(FX, 'sample'))
  await page.waitForSelector('#seal [data-view="error"]:not([hidden]) .err')
  assert.match(await page.textContent('#seal [data-view="error"] h1'), /This browser does not hold the ledger’s key/)
  assert.match(await page.textContent('#seal [data-view="error"]'), new RegExp(EXPECTED.variants.sample.keyId))
  await page.click('#seal [data-act="audit-this"]')
  await page.waitForSelector(RESULT('audit'))
  assert.equal((await jsonReport(page, 'audit')).verdict, 'pass')
  await page.done()
})

// ---------------------------------------------------------------------------------------------------- hashing
test('hashing: the worker pool agrees with node:crypto, read at once and in slices, across slice edges and past 256 MiB', { skip: SKIP, timeout: 240000 }, async () => {
  const page = await open('/app/?test')
  await page.waitForFunction(() => !!globalThis.__iqc)
  // deterministic bytes, made the same way here and in the page
  const gen = (n, seed) => { const b = new Uint8Array(n); let x = seed >>> 0; for (let i = 0; i < n; i++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; b[i] = x >>> 24 } return b }
  const sizes = [0, 1, 55, 56, 63, 64, 65, 1048575, 1048576, 1048577, 5 * 1048576 + 17]
  const want = sizes.map((n, i) => sha(gen(n, i + 1)))
  const got = await page.evaluate(async ({ sizes, src }) => {
    const gen = new Function(`return ${src}`)()
    const blobs = sizes.map((n, i) => new Blob([gen(n, i + 1)]))
    return { whole: await __iqc.hash(blobs), sliced: await __iqc.hash(blobs, { whole: 0, slice: 1048576 }), odd: await __iqc.hash(blobs, { whole: 0, slice: 4096 + 64 }) }
  }, { sizes, src: gen.toString() })
  assert.deepEqual(got.whole, want)
  assert.deepEqual(got.sliced, want)
  assert.deepEqual(got.odd, want)
  // a Blob past the 256 MiB limit takes the 8 MiB slice path with the real settings
  const chunk = gen(1 << 20, 99), n = 257
  const h = createHash('sha256')
  for (let i = 0; i < n; i++) h.update(chunk)
  h.update(chunk.subarray(0, 12345))
  const big = await page.evaluate(async ({ src, n }) => {
    const chunk = new Function(`return ${src}`)()(1 << 20, 99)
    const parts = Array.from({ length: n }, () => chunk)
    parts.push(chunk.subarray(0, 12345))
    const blob = new Blob(parts)
    return { size: blob.size, sha: (await __iqc.hash([blob]))[0] }
  }, { src: gen.toString(), n })
  assert.equal(big.size, 257 * 1048576 + 12345)
  assert.ok(big.size > 256 * 1048576)
  assert.equal(big.sha, h.digest('hex'))
  await page.done()
})

// ---------------------------------------------------------------------------------------------------- scale
test(`scale: a folder of ${IQC.formatCount(LARGE)} files is audited with the page responsive, and its list pages and searches quickly`, { skip: SKIP || (!LARGE && 'IQC_LARGE=0'), timeout: 60000 + LARGE * 10 }, async () => {
  const dir = join(tmp, 'many', 'bio-line-9')
  const files = new Map()
  for (let i = 0; i < LARGE; i++) {
    const d = `run-${String(Math.floor(i / 1000)).padStart(3, '0')}`, p = `${d}/well-${String(i).padStart(6, '0')}.csv`
    if (i % 1000 === 0) mkdirSync(join(dir, d), { recursive: true })
    const b = Buffer.from(`well,abs_450\nA01,${(i % 997) / 1000}\n`)
    writeFileSync(join(dir, p), b)
    files.set(p, { sha256: sha(b), bytes: b.length })
  }
  // sealed in Node with core, as the agent would; the last file is changed afterwards
  const kp = await IQC.generateKeyPair()
  const header = await IQC.createHeader({ station: 'bio-line-9', privateKey: kp.privateKey, publicKey: kp.publicKey, agent: 'immutableqc-cli/0.1.0' })
  const v0 = await IQC.verifyLedger(IQC.serializeLine(header))
  const at = new Date().toISOString()
  const items = [{ kind: 'session', f: { station: 'bio-line-9', event: 'scan', at, agent: 'immutableqc-cli/0.1.0' } }, ...IQC.planSeal(v0, files, { mode: 'first', station: 'bio-line-9', observedAt: at })]
  const recs = await IQC.createRecords({ head: v0.head, items, privateKey: kp.privateKey })
  mkdirSync(join(dir, 'ImmutableQC'))
  writeFileSync(join(dir, 'ImmutableQC', 'ledger.jsonl'), IQC.serializeLine(header) + recs.map((x) => IQC.serializeLine(x)).join(''))
  const last = [...files.keys()].pop()
  writeFileSync(join(dir, last), 'changed\n')
  const page = await open('/app/')
  const t0 = Date.now()
  // (the browser builds the list of a chosen folder's files before the page gets it: for a hundred thousand files that
  // takes seconds, on the page's thread, as it would after a person picks the folder; it is not the app's work)
  await page.setInputFiles('#audit-folder', dir, { timeout: 30000 + LARGE * 5 })
  await page.waitForSelector('#audit [data-view="run"]:not([hidden])', { timeout: 30000 + LARGE * 5 })
  // from the moment the app has the files: the longest gap between timer ticks on the page's thread, to the verdict
  await page.evaluate(() => { window.__gap = 0; let t = performance.now(); window.__tick = setInterval(() => { const n = performance.now(); window.__gap = Math.max(window.__gap, n - t); t = n }, 50) })
  const tStart = Date.now()
  await page.waitForSelector(RESULT('audit'), { timeout: 30000 + LARGE * 8 })
  const tAudit = Date.now() - tStart
  const gap = await page.evaluate(() => window.__gap)
  assert.equal(await page.textContent(`${RESULT('audit')} h1`), '1 file changed since it was sealed.')
  const first = Math.min(100, LARGE)
  assert.equal(await page.$$eval('#audit [data-view="result"] tbody tr', (r) => r.length), first)
  assert.match(await page.textContent('#audit [data-view="result"] [data-pageinfo]'), new RegExp(`1–${first} of ${IQC.formatCount(LARGE)} paths?`))
  const t1 = Date.now()
  await page.fill('#audit [data-view="result"] [data-search]', `well-${String(Math.min(777, LARGE - 2 >= 0 ? LARGE - 2 : 0)).padStart(6, '0')}`)
  await page.waitForFunction(() => document.querySelectorAll('#audit [data-view="result"] tbody tr').length === 1)
  const tSearch = Date.now() - t1
  await page.click('#audit [data-view="result"] [data-filter="all"]')
  await page.fill('#audit [data-view="result"] [data-search]', '')
  await page.waitForFunction((n) => document.querySelectorAll('#audit [data-view="result"] tbody tr').length === n, first)
  if (LARGE > 100) {
    await page.click('#audit [data-view="result"] [data-page="1"]')
    assert.match(await page.textContent('#audit [data-view="result"] [data-pageinfo]'), /^101–/)
  }
  console.log(`# scale: ${LARGE} files, setInputFiles + audit ${((Date.now() - t0) / 1000).toFixed(1)} s (audit ${(tAudit / 1000).toFixed(1)} s), longest main-thread gap ${gap.toFixed(0)} ms, search ${tSearch} ms`)
  assert.ok(gap < 1000, `the page's thread was blocked for ${gap.toFixed(0)} ms`)
  assert.ok(tSearch < 3000, `a search took ${tSearch} ms`)
  await page.done()
})

// ------------------------------------------------------------------------------------------ the start check
test('the page: when the app cannot start (one of its files did not load), it says so in words', { skip: SKIP, timeout: 60000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } })
  contexts.add(context)
  await context.route('**/app/engine.mjs', (r) => r.abort())
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(base + '/app/')
  await page.waitForSelector('#boot-error:not([hidden]) .callout', { timeout: 10000 })
  assert.match(await page.textContent('#boot-error'), /The app could not start in this browser, so nothing can be checked here yet\. Nothing was uploaded\./)
  assert.equal(await page.getAttribute('#boot-error', 'role'), 'alert')
  assert.equal(await page.evaluate(() => document.documentElement.dataset.app || null), null)
  await axeCheck(page, 'start failure')
  await context.close()
  // and when it starts, the message stays hidden
  const ok = await open('/app/')
  await ok.waitForFunction(() => document.documentElement.dataset.app === 'ready')
  await ok.waitForLoadState('load')
  assert.equal(await ok.isHidden('#boot-error'), true)
  await ok.done()
})

// --------------------------------------------------------------------------------------------- the whole run
test('the page: one CSP with connect-src none, no request off the origin, no CSP violation, no console error, axe clean in every state', { skip: SKIP, timeout: 60000 }, async () => {
  const page = await open('/app/')
  const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content')
  assert.equal(csp, "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob:; worker-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'")
  // the CSP really blocks a connection from the page
  const blocked = await page.evaluate(async () => { try { await window['fe' + 'tch']('/app/index.html'); return false } catch { return true } })
  assert.equal(blocked, true)
  issues.splice(0, issues.length, ...issues.filter((x) => !/connect-src/.test(x) && !/Refused to connect/.test(x)))
  await page.context().close()
  for (const s of ['audit ready', 'audit running', 'audit pass', 'audit fail', 'audit fail, ledger', 'ask for the ledger', 'ask, wrong file', 'field error', 'error', 'demo pass', 'demo fail', 'seal ready', 'seal result', 'start failure']) assert.ok(statesSeen.has(s), `axe ran on: ${s}`)
  assert.deepEqual(issues, [])
})
