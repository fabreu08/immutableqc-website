// End to end, across the two implementations people run (docs/product-v1.md, section 8): a data folder sealed by the
// one-file agent (download/iqc.mjs, the file the landing page offers) is audited twice, in Chromium through the app as
// GitHub Pages will publish it (site/tools/serve.mjs serveDeploy: the deploy allowlist, nothing else) and on the command
// line (iqc audit --json). Verdict, head, ledger id, key id, summary, counts, problems, notes and every file's state and
// fingerprints must agree, and agree with node:crypto. Then one file is changed and another removed: both must say fail,
// with the same states.
//
// The folder holds text, an empty file, a binary file of an odd size (past SHA-256 block edges), a nested folder, a name
// with a space, an accent and a % (stored percent-encoded in the ledger) and a .DS_Store (ignored by both). The agent's
// key goes to a temporary home (HOME and USERPROFILE), never the real one. Skipped when Playwright is not installed, or
// with IQC_SKIP_BROWSER=1. Every hook and test has a timeout, and the browser, server and temporary folders are closed
// or removed even when a step fails.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { encodePath, ignoreMatcher } from '../core/immutableqc.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const AGENT = join(ROOT, 'download', 'iqc.mjs')
const require = createRequire(import.meta.url)
function load(name) {
  for (const p of [`/opt/node22/lib/node_modules/${name}`, join(ROOT, 'site', 'node_modules', name), name]) { try { return require(p) } catch { /* next */ } }
  return null
}
const pw = process.env.IQC_SKIP_BROWSER ? null : load('playwright')
const SKIP = !pw && 'Playwright is not installed'

let server = null, base = '', browser = null, tmp = ''
const issues = []

before(async () => {
  if (!pw) return
  tmp = mkdtempSync(join(tmpdir(), 'iqc-e2e-'))
  const S = await import(join(ROOT, 'site', 'tools', 'serve.mjs'))
  server = await S.serveDeploy(0) // as deployed: if the allowlist does not assemble, the site would not publish either
  base = `http://127.0.0.1:${server.port}`
  // a UTF-8 locale, so that Chromium opens a file name with an accent (it cannot under LANG=C)
  browser = await pw.chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } })
}, { timeout: 120000 })
after(async () => {
  const quietly = (p) => Promise.race([Promise.resolve(p).catch(() => {}), new Promise((r) => setTimeout(r, 15000).unref())])
  if (browser) await quietly(browser.close())
  if (server) await quietly(server.close())
  if (tmp) rmSync(tmp, { recursive: true, force: true })
}, { timeout: 60000 })

const sha = (b) => createHash('sha256').update(b).digest('hex')
// deterministic bytes that are not text: every byte value, zeros and 0xff runs included
function binary(n) {
  const out = Buffer.alloc(n)
  let block = Buffer.alloc(0), i = 0
  for (let k = 0; i < n; k++) {
    block = createHash('sha256').update(block).update(String(k)).digest()
    for (const b of block) if (i < n) out[i++] = b
  }
  out.fill(0, 1000, 1300); out.fill(0xff, 5000, 5100)
  return out
}
const FILES = {
  'results/plate-01.csv': Buffer.from('well,abs_450,abs_600\nA01,0.482,0.051\nA02,0.477,0.049\nB01,0.910,0.052\n'),
  'results/run-0914/raw/scan-01.bin': binary(70001),
  'results/run-0914/summary.json': Buffer.from(JSON.stringify({ run: 'run-0914', plates: 1, operator: 'robot-arm-2' }, null, 2) + '\n'),
  'QC méthode 50%.txt': Buffer.from('Method notes: blank-corrected, 3 replicates.\n'),
  'empty.log': Buffer.alloc(0),
  '.DS_Store': Buffer.from([0, 0, 0, 1, 66, 117, 100, 49]),
}
const CHANGED = 'results/run-0914/raw/scan-01.bin', REMOVED = 'results/run-0914/summary.json'

// the agent, as people run it: node iqc.mjs <command>, with its key in a temporary home
function iqc(home, ...args) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1' }
  delete env.NODE_TEST_CONTEXT
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [AGENT, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    c.stdout.on('data', (d) => { stdout += d }); c.stderr.on('data', (d) => { stderr += d })
    const timer = setTimeout(() => { c.kill('SIGKILL'); reject(new Error(`iqc ${args[0]} took over 60 s\n${stdout}${stderr}`)) }, 60000)
    c.on('error', (e) => { clearTimeout(timer); reject(e) })
    c.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }) })
  })
}
async function cliAudit(home, dir, out, expect, exit) {
  const a = await iqc(home, 'audit', dir, '--json', out, '--expect-head', `${expect.head.n}:${expect.head.h}`, '--expect-key', expect.keyId)
  assert.equal(a.status, exit, `iqc audit exits ${exit}\n${a.stdout}${a.stderr}`)
  return JSON.parse(readFileSync(out, 'utf8'))
}

// the app, as a person uses it: the pinned head and key id typed in, the folder chosen, the JSON report downloaded
async function appAudit(dir, expect) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
  try {
    await context.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)) })
    const page = await context.newPage()
    page.on('console', (m) => { if (m.type() === 'error') issues.push(`console error: ${m.text()}`) })
    page.on('pageerror', (e) => issues.push(`uncaught error: ${e}`))
    page.on('request', (r) => { const u = r.url(); if (!u.startsWith(base + '/') && !/^(?:blob|data):/.test(u)) issues.push(`request off the origin: ${u}`) })
    await page.goto(`${base}/app/`)
    await page.click('#audit-opts summary')
    await page.fill('#audit-head', `${expect.head.n}:${expect.head.h}`)
    await page.fill('#audit-key', expect.keyId)
    await page.setInputFiles('#audit-folder', dir)
    const result = '#audit [data-view="result"]:not([hidden])'
    await page.waitForSelector(`${result} .verdict, #audit [data-view="error"]:not([hidden]), #audit [data-view="ledger"]:not([hidden])`, { timeout: 60000 })
    assert.equal(await page.isVisible(`${result} .verdict`), true, 'the app shows a verdict (not an error, not a request for the ledger)')
    const shown = { tag: (await page.textContent(`${result} .verdict .tag`)).trim(), h1: (await page.textContent(`${result} .verdict h1`)).trim() }
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`${result} [data-act="report-json"]`)])
    const report = JSON.parse(readFileSync(await dl.path(), 'utf8'))
    for (const v of await page.evaluate(() => window.__csp)) issues.push(`CSP violation: ${v}`)
    return { report, shown }
  } finally { await context.close() }
}

const byPath = (r) => Object.fromEntries(r.files.map((f) => [f.path, f]))
const statesOf = (r) => Object.fromEntries(r.files.map((f) => [f.path, f.state]))
function agree(app, cli, verdict) {
  assert.equal(cli.format, 'immutableqc-audit'); assert.equal(app.format, 'immutableqc-audit')
  assert.equal(cli.verdict, verdict, 'iqc audit verdict'); assert.equal(app.verdict, verdict, 'app verdict')
  assert.equal(app.summary, cli.summary)
  for (const k of ['ledgerId', 'station', 'keyId', 'publicKey', 'records', 'goodRecords', 'intact']) assert.deepEqual(app.ledger[k], cli.ledger[k], `ledger.${k}`)
  assert.deepEqual(app.ledger.head, cli.ledger.head, 'ledger head')
  assert.deepEqual(app.counts, cli.counts, 'counts')
  assert.deepEqual(statesOf(app), statesOf(cli), 'every file state')
  const A = byPath(app), C = byPath(cli)
  for (const p of Object.keys(C)) {
    for (const k of ['sealed', 'present', 'versions', 'records', 'matchesN']) assert.deepEqual(A[p][k], C[p][k], `${p}: ${k}`)
  }
  assert.deepEqual(app.problems.map((p) => [p.code, p.path || null]), cli.problems.map((p) => [p.code, p.path || null]), 'problems')
  assert.deepEqual(app.notes.map((n) => n.code), cli.notes.map((n) => n.code), 'notes')
  assert.equal(app.expectations.head.ok, true); assert.equal(cli.expectations.head.ok, true)
  assert.equal(app.expectations.keyId.ok, true); assert.equal(cli.expectations.keyId.ok, true)
  assert.equal(app.method.where, 'in a browser'); assert.notEqual(cli.method.where, 'in a browser')
}

test('a folder sealed by download/iqc.mjs gets the same audit in the browser (the app, as deployed) and from iqc audit, before and after a change and a removal', { skip: SKIP, timeout: 240000 }, async () => {
  const home = join(tmp, 'home'), dir = join(tmp, 'lab', 'plate-reader-3')
  mkdirSync(home, { recursive: true })
  for (const [p, b] of Object.entries(FILES)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), b) }

  // seal once with the agent (a short settle: the files are already written)
  const sealed = await iqc(home, 'seal', dir, '--settle', '0.5', '--station', 'plate-reader-3')
  assert.equal(sealed.status, 0, sealed.stdout + sealed.stderr)
  assert.ok(existsSync(join(dir, 'ImmutableQC', 'ledger.jsonl')), 'the ledger is in <folder>/ImmutableQC/')
  const headLine = await iqc(home, 'head', dir)
  assert.equal(headLine.status, 0, headLine.stderr)
  const [n, h] = headLine.stdout.trim().split(':')
  const keys = readdirSync(join(home, '.immutableqc', 'keys'))
  assert.equal(keys.length, 1, 'one key, in the temporary home')
  const expect = { head: { n: Number(n), h }, keyId: keys[0].replace(/\.jwk$/, '') }

  // what both must find, from node:crypto: every file but the ignored .DS_Store, sealed with its own fingerprint
  const ig = ignoreMatcher([])
  const want = Object.fromEntries(Object.entries(FILES).filter(([p]) => !ig(encodePath(p))).map(([p, b]) => [encodePath(p), { sha256: sha(b), bytes: String(b.length) }]))
  assert.equal(Object.keys(want).length, 5)
  assert.equal(encodePath('QC méthode 50%.txt'), 'QC méthode 50%25.txt', 'the ledger stores % encoded, and nothing else')

  // 1. as sealed: pass, from both, with the same everything
  const cli1 = await cliAudit(home, dir, join(tmp, 'cli-pass.json'), expect, 0)
  const app1 = await appAudit(dir, expect)
  agree(app1.report, cli1, 'pass')
  assert.deepEqual(cli1.ledger.head, expect.head, 'the head iqc head prints is the head of the audit')
  assert.equal(cli1.ledger.keyId, expect.keyId)
  assert.deepEqual(statesOf(cli1), Object.fromEntries(Object.keys(want).map((p) => [p, 'match'])))
  for (const [p, w] of Object.entries(want)) {
    assert.deepEqual({ sha256: byPath(cli1)[p].sealed.sha256, bytes: byPath(cli1)[p].sealed.bytes }, w, `${p}: sealed as node:crypto hashes it`)
    assert.deepEqual(byPath(app1.report)[p].present, w, `${p}: the browser read the same bytes`)
  }
  assert.match(app1.shown.tag, /Pass/)
  assert.equal(app1.shown.h1, 'All 5 files match their seals. Ledger intact.')

  // 2. one file changed (one byte, same size) and another removed, with no agent watching: fail, from both, the same way
  const bin = Buffer.from(FILES[CHANGED]); bin[35000] ^= 0x01
  writeFileSync(join(dir, CHANGED), bin)
  rmSync(join(dir, REMOVED))
  assert.equal(statSync(join(dir, CHANGED)).size, FILES[CHANGED].length)
  const cli2 = await cliAudit(home, dir, join(tmp, 'cli-fail.json'), expect, 1)
  const app2 = await appAudit(dir, expect)
  agree(app2.report, cli2, 'fail')
  assert.deepEqual(statesOf(cli2), { ...Object.fromEntries(Object.keys(want).map((p) => [p, 'match'])), [CHANGED]: 'changed', [REMOVED]: 'missing' })
  assert.deepEqual(cli2.problems.map((p) => [p.code, p.path]).sort(), [['changed', CHANGED], ['missing', REMOVED]].sort())
  assert.equal(byPath(app2.report)[CHANGED].present.sha256, sha(bin))
  assert.equal(byPath(app2.report)[CHANGED].sealed.sha256, want[CHANGED].sha256)
  assert.equal(byPath(app2.report)[REMOVED].present ?? null, null, 'the removed file is not present')
  assert.match(app2.shown.tag, /Fail/)
  assert.deepEqual(app2.report.ledger.head, expect.head, 'the ledger did not change: the files did')

  assert.deepEqual(issues, [], 'no console error, uncaught error, CSP violation or request off the origin')
})
