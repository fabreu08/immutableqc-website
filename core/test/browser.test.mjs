// The same module in Chromium (Playwright, the preinstalled browser): it loads as an ES module over http://127.0.0.1
// (a secure context, so WebCrypto is there), and gives the same answers as on Node, on the committed fixtures and on a
// ledger made in the page. Skipped when Playwright is not installed (or with IQC_SKIP_BROWSER=1).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { labFiles as labFileList } from './make-fixtures.mjs'

const CORE = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
function loadPlaywright() {
  for (const p of ['/opt/node22/lib/node_modules/playwright', join(CORE, '..', 'site', 'node_modules', 'playwright'), 'playwright']) {
    try { return require(p) } catch { /* next */ }
  }
  return null
}
const pw = process.env.IQC_SKIP_BROWSER ? null : loadPlaywright()

const TYPES = { '.mjs': 'text/javascript', '.json': 'application/json', '.html': 'text/html' }
const PAGE = '<!doctype html><meta charset="utf-8"><title>core</title><body>core test</body>'
// the worker side of verifyLedger's verifyBatch, as a page would run it
const WORKER = `import { verifyLinks } from '/immutableqc.mjs'
onmessage = async (e) => { const { id, pub, items } = e.data; try { postMessage({ id, res: await verifyLinks(pub, items) }) } catch (err) { postMessage({ id, error: String(err) }) } }`

test('browser: core runs in Chromium and agrees with Node on the fixtures', { skip: !pw && 'Playwright is not installed', timeout: 120000 }, async () => {
  const server = createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE) }
    if (url === '/verify-worker.mjs') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(WORKER) }
    const file = normalize(join(CORE, url))
    if (!file.startsWith(CORE) || !existsSync(file)) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'content-type': TYPES[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream' })
    res.end(readFileSync(file))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const browser = await pw.chromium.launch()
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(base + '/')
    const expected = JSON.parse(readFileSync(join(CORE, 'test', 'fixtures', 'expected.json'), 'utf8'))
    const expectedLab = JSON.parse(readFileSync(join(CORE, 'test', 'fixtures', 'expected-lab.json'), 'utf8'))
    const labLedgers = expectedLab.discovered.map((d) => d.ledgerPath)
    const labFiles = Object.keys(labFileList())
    const out = await page.evaluate(async ({ expected, labLedgers, labFiles }) => {
      const IQC = await import('/immutableqc.mjs')
      const r = { secure: isSecureContext, sha: IQC.sha256Hex('abc'), variants: {} }
      for (const [name, want] of Object.entries(expected.variants)) {
        const ledger = new Uint8Array(await (await fetch(`/test/fixtures/${want.ledger}`)).arrayBuffer())
        const v = await IQC.verifyLedger(ledger)
        // hash every file the way the app does: WebCrypto digest, and the incremental hasher in small slices
        const files = new Map()
        for (const [p, f] of Object.entries(want.files)) {
          if (!f.sha256) continue
          const res = await fetch(`/test/fixtures/${want.folder}/${encodeURIComponent(IQC.decodePath(p)).replace(/%2F/g, '/')}`)
          const b = new Uint8Array(await res.arrayBuffer())
          const d = IQC.toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', b)))
          const h = new IQC.Sha256()
          for (let i = 0; i < b.length; i += 7) h.update(b.subarray(i, i + 7))
          if (h.hex() !== d) throw new Error(`incremental SHA-256 differs for ${p}`)
          files.set(p, { sha256: d, bytes: b.length })
        }
        const a = IQC.audit(v, files, { where: 'browser', tool: 'immutableqc-app/0.1.0' })
        const html = IQC.renderReportHTML(a)
        r.variants[name] = { verdict: a.verdict, head: v.head, keyId: v.keyId, problems: v.problems.map((p) => ({ line: p.line, code: p.code })), files: Object.fromEntries(a.files.map((f) => [f.path, f.state])), html: html.length > 1000 && !html.includes('<script') }
      }
      // the same, with the signature checks spread over Web Workers (verifyBatch)
      const pool = Array.from({ length: 3 }, () => new Worker('/verify-worker.mjs', { type: 'module' }))
      const waiting = new Map()
      let next = 0
      for (const w of pool) w.onmessage = (e) => { const p = waiting.get(e.data.id); waiting.delete(e.data.id); e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.res) }
      const verifyBatch = (pub, items) => new Promise((resolve, reject) => { const id = next++; waiting.set(id, { resolve, reject }); pool[id % pool.length].postMessage({ id, pub, items }) })
      r.workers = {}
      for (const [name, want] of Object.entries(expected.variants)) {
        const ledger = new Uint8Array(await (await fetch(`/test/fixtures/${want.ledger}`)).arrayBuffer())
        const v = await IQC.verifyLedger(ledger, { verifyBatch, batchSize: 4 })
        r.workers[name] = { head: v.head, problems: v.problems.map((p) => ({ line: p.line, code: p.code })) }
      }
      pool.forEach((w) => w.terminate())
      // a ledger made in the page, with a key the page cannot export, verifies and audits as a pass
      const kp = await IQC.generateKeyPair()
      const header = await IQC.createHeader({ station: 'Browser', privateKey: kp.privateKey, publicKey: kp.publicKey, agent: 'immutableqc-app/0.1.0' })
      const v0 = await IQC.verifyLedger(IQC.serializeLine(header))
      const files = new Map([['a.csv', { sha256: IQC.sha256Hex('a'), bytes: 1 }]])
      const items = [{ kind: 'session', f: { station: 'Browser', event: 'scan', at: new Date().toISOString(), agent: 'immutableqc-app/0.1.0' } }, ...IQC.planSeal(v0, files, { mode: 'first', station: 'Browser', observedAt: new Date().toISOString() })]
      const recs = await IQC.createRecords({ head: v0.head, items, privateKey: kp.privateKey })
      const v1 = await IQC.verifyLedger(IQC.serializeLine(header) + recs.map((x) => IQC.serializeLine(x)).join(''))
      r.made = { ok: v1.ok, verdict: IQC.audit(v1, files).verdict, extractable: kp.privateKey.extractable, events: items.map((x) => x.f.event) }
      // the lab fixture: every ledger discoverLedgers finds, audited together (files are the published hashes)
      const lab = []
      for (const d of IQC.discoverLedgers(labLedgers)) {
        const v = await IQC.verifyLedger(new Uint8Array(await (await fetch(`/test/fixtures/lab/${d.ledgerPath}`)).arrayBuffer()))
        let fm = null
        if (d.root !== null) {
          fm = new Map()
          for (const p of labFiles.filter((x) => x.startsWith(d.root + '/') && !x.startsWith(d.root + '/ImmutableQC/'))) {
            const b = new Uint8Array(await (await fetch(`/test/fixtures/lab/${p.split('/').map(encodeURIComponent).join('/')}`)).arrayBuffer())
            fm.set(IQC.encodePath(p.slice(d.root.length + 1)), { sha256: IQC.toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', b))), bytes: b.length })
          }
        }
        lab.push({ verified: v, root: d.root, files: fm, ledgerPath: d.ledgerPath })
      }
      const m = IQC.auditMany(lab, { where: 'browser' })
      r.lab = { verdict: m.verdict, summary: m.summary, steps: m.steps.map((x) => x.review.state), html: !IQC.renderReportHTML(m).includes('<script') }
      return r
    }, { expected, labLedgers, labFiles })
    assert.deepEqual(errors, [])
    assert.equal(out.secure, true)
    assert.equal(out.sha, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    for (const [name, want] of Object.entries(expected.variants)) {
      const got = out.variants[name]
      assert.equal(got.verdict, want.verdict, name)
      assert.deepEqual(got.head, want.head, name)
      assert.equal(got.keyId, want.keyId, name)
      assert.deepEqual(got.problems, want.problems, name)
      assert.deepEqual(got.files, Object.fromEntries(Object.entries(want.files).map(([p, f]) => [p, f.state])), name)
      assert.equal(got.html, true, name)
      assert.deepEqual(out.workers[name], { head: want.head, problems: want.problems }, `${name}, signatures checked in Web Workers`)
    }
    assert.deepEqual(out.made, { ok: true, verdict: 'pass', extractable: false, events: ['scan', 'existing'] })
    assert.deepEqual(out.lab, { verdict: expectedLab.verdict, summary: expectedLab.summary, steps: expectedLab.steps.map((x) => x.review), html: true }, 'auditMany in the browser agrees with expected-lab.json')
  } finally {
    await browser.close()
    server.close()
  }
})
