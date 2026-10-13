// app/engine.mjs on Node (no browser): reading a dropped folder (fake FileSystemEntry trees, readEntries in batches),
// <input webkitdirectory> lists, finding the ledger, the paths an audit reads, and the whole seal and audit pipeline
// with a pool that hashes with node:crypto and checks signatures with core's verifyLinks (the worker's own code path).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import * as IQC from '../../core/immutableqc.mjs'
import { SHA256, SHA256_EDITED, EDIT, FILES, FOLDER } from '../../ui/sample-data.mjs'
import { locate, listInput, listEntries, entriesOfDrop, prepareFiles, ledgerHeaderProblem, runAudit, runSeal, demoListing, DemoKeys, AppError, Canceled, TOOL, MAX_FILES, yieldNow } from '../engine.mjs'

const T = { timeout: 30000 } // every test is bounded: a hang fails the test instead of the run
const file = (name, text = name, extra = {}) => Object.assign(new File([text], name.split('/').pop()), extra)
const sha = async (f) => createHash('sha256').update(Buffer.from(await f.arrayBuffer())).digest('hex')

// a pool with the worker's behavior, on Node
const nodePool = () => ({
  size: 2, failure: null, calls: { hash: 0, verify: 0 },
  async verify(pub, items) { this.calls.verify++; return IQC.verifyLinks(pub, items) },
  async hash(list, { onTick } = {}) {
    this.calls.hash++
    const out = []
    let bytes = 0
    for (const x of list) {
      try { out.push({ sha256: await sha(x.file), at: Date.now() }) } catch (e) { out.push({ error: String(e) }) }
      bytes += x.size
      if (onTick) onTick({ files: out.length, bytes, cur: null })
    }
    return out
  },
})

// fake FileSystemEntry trees: a folder's reader returns at most 100 entries per readEntries call, as Chrome does
function dirEntry(name, children) {
  return {
    name, isDirectory: true, isFile: false,
    createReader() { let at = 0; return { readEntries(ok) { const b = children.slice(at, at + 100); at += b.length; setTimeout(() => ok(b), 0) } } },
  }
}
function fileEntry(name, text, { fail = false } = {}) {
  return { name, isDirectory: false, isFile: true, file(ok, ko) { setTimeout(() => (fail ? ko(Object.assign(new Error('gone'), { name: 'NotFoundError' })) : ok(new File([text], name))), 0) } }
}

test('constants: the tool name and the limits', T, () => {
  assert.equal(TOOL, `immutableqc-app/${IQC.VERSION}`)
  assert.equal(MAX_FILES, 1000000)
})

// The stall of `node --test app/test` (2026-10-13): yieldNow listened on a MessageChannel, and on Node a port with a
// listener holds the event loop open, so every process that had yielded once never exited. A process that imports the
// engine and yields must end by itself.
test('yieldNow: lets the page draw, and leaves nothing behind that keeps a Node process running', T, async () => {
  let n = 0
  await Promise.all([yieldNow().then(() => n++), yieldNow().then(() => n++)])
  assert.equal(n, 2)
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const code = `const m = await import(${JSON.stringify(new URL('../engine.mjs', import.meta.url).href)}); await m.yieldNow(); await m.yieldNow(); console.log('yielded')`
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8', timeout: 20000 })
  assert.equal(r.error && r.error.code, undefined, 'the process did not exit by itself within 20 s')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout.trim(), 'yielded')
})

test('listEntries: a dropped folder is walked whole, every batch of readEntries, folders inside folders', T, async () => {
  const many = Array.from({ length: 250 }, (_, i) => fileEntry(`f${String(i).padStart(3, '0')}.csv`, `v${i}`))
  const root = dirEntry('bio-line-2', [dirEntry('run-1', many), dirEntry('ImmutableQC', [fileEntry('ledger.jsonl', '{}\n')]), fileEntry('top.txt', 't'), dirEntry('empty', []), dirEntry('a', [dirEntry('b', [fileEntry('deep.bin', 'd')])])])
  const seen = []
  const l = await listEntries({ entries: [root], loose: [] }, { onProgress: (x) => seen.push(x.listed) })
  assert.equal(l.root, 'bio-line-2')
  assert.equal(l.items.length, 253)
  assert.ok(l.items.some((x) => x.raw === 'run-1/f249.csv') && l.items.some((x) => x.raw === 'a/b/deep.bin') && l.items.some((x) => x.raw === 'ImmutableQC/ledger.jsonl'))
  assert.deepEqual(l.items.map((x) => x.raw), [...l.items.map((x) => x.raw)].sort())
  assert.equal(await l.items.find((x) => x.raw === 'run-1/f007.csv').file.text(), 'v7')
  assert.deepEqual(l.errors, [])
})

test('listEntries: several dropped items have no root; a file that cannot be opened is kept as unreadable', T, async () => {
  const l = await listEntries({ entries: [dirEntry('ImmutableQC', [fileEntry('ledger.jsonl', 'x')]), fileEntry('a.csv', 'a'), fileEntry('b.csv', 'b', { fail: true })], loose: [] })
  assert.equal(l.root, null)
  assert.deepEqual(l.items.map((x) => x.raw), ['ImmutableQC/ledger.jsonl', 'a.csv', 'b.csv'])
  const b = l.items.find((x) => x.raw === 'b.csv')
  assert.equal(b.file, null)
  assert.match(b.error, /gone/)
})

test('listEntries: a folder too large for a tab, and a canceled listing, stop with a reason', T, async () => {
  const root = dirEntry('big', Array.from({ length: 30 }, (_, i) => fileEntry(`${i}.txt`, 'x')))
  await assert.rejects(listEntries({ entries: [root] }, { max: 10 }), (e) => e instanceof AppError && e.code === 'too-many' && /too large for a browser tab/.test(e.title) && /node iqc\.mjs audit/.test(e.message))
  const ctl = new AbortController()
  ctl.abort()
  await assert.rejects(listEntries({ entries: [root] }, { signal: ctl.signal }), (e) => e instanceof Canceled)
})

test('entriesOfDrop: entries from webkitGetAsEntry, plain files when there is no entry', T, () => {
  const e = { name: 'x', isDirectory: true }
  const f = file('loose.csv')
  const got = entriesOfDrop({ items: [{ kind: 'file', webkitGetAsEntry: () => e }, { kind: 'file', webkitGetAsEntry: () => null, getAsFile: () => f }, { kind: 'string' }] })
  assert.deepEqual(got.entries, [e])
  assert.deepEqual(got.loose, [f])
  assert.deepEqual(entriesOfDrop({ items: [], files: [f] }).loose, [f])
})

test('listInput: the chosen folder is the root; paths are relative to it', T, () => {
  const l = listInput([file('x', 'a', { webkitRelativePath: 'bio-line-2/run-1007/b.csv' }), file('y', 'b', { webkitRelativePath: 'bio-line-2/ImmutableQC/ledger.jsonl' })])
  assert.equal(l.root, 'bio-line-2')
  assert.deepEqual(l.items.map((x) => x.raw), ['ImmutableQC/ledger.jsonl', 'run-1007/b.csv'])
  const flat = listInput([file('a.jsonl')])
  assert.equal(flat.root, null)
  assert.equal(flat.items[0].raw, 'a.jsonl')
  assert.throws(() => listInput([file('a'), file('b'), file('c')], { max: 2 }), (e) => e.code === 'too-many')
})

test('locate: the ledger at the top, one folder down, alone, in its own folder, missing, or in several folders', T, () => {
  const L = (raws, root = 'top') => ({ root, items: raws.map((raw) => ({ raw, file: file(raw) })), errors: [] })
  let r = locate(L(['ImmutableQC/ledger.jsonl', 'a.csv', 'ImmutableQC/README.txt']))
  assert.equal(r.kind, 'folder')
  assert.equal(r.ledger.raw, 'ImmutableQC/ledger.jsonl')
  assert.deepEqual(r.files.map((x) => x.raw), ['a.csv', 'ImmutableQC/README.txt'])
  r = locate(L(['bio-line-2/ImmutableQC/ledger.jsonl', 'bio-line-2/run/a.csv', 'notes.txt'], 'parent'))
  assert.equal(r.kind, 'folder')
  assert.equal(r.root, 'bio-line-2')
  assert.equal(r.parent, 'parent')
  assert.deepEqual(r.files.map((x) => x.raw), ['run/a.csv'])
  assert.equal(locate(L(['ledger.jsonl'], null)).kind, 'ledger-only')
  r = locate(L(['ledger.jsonl', 'README.txt'], 'ImmutableQC'))
  assert.equal(r.kind, 'ledger-only')
  assert.equal(r.why, 'ledger-folder')
  assert.equal(locate(L(['a.csv', 'b/c.csv'])).kind, 'no-ledger')
  assert.equal(locate(L(['a/ImmutableQC/ledger.jsonl', 'a/ImmutableQC/x/ledger.jsonl'])).kind, 'folder')
  assert.throws(() => locate(L(['a/ImmutableQC/ledger.jsonl', 'b/ImmutableQC/ledger.jsonl'])), (e) => e.code === 'several' && /Drop one data folder/.test(e.message))
  assert.throws(() => locate({ root: 'x', items: [], errors: [] }), (e) => e.code === 'empty' && e.title === 'The folder is empty')
})

test('prepareFiles: encoded paths, without the ledger folder and system files (unless sealed), each path once', T, () => {
  const items = ['a 50%.csv', 'ImmutableQC/agent.lock', 'run/.DS_Store', 'run/x.tmp', 'Thumbs.db', 'caf\u00e9.txt', 'cafe\u0301.txt', 'sub/ImmutableQC/kept.txt'].map((raw) => ({ raw, file: file(raw) }))
  const { list, skipped } = prepareFiles(items, new Map([['run/x.tmp', {}]]))
  assert.deepEqual(list.map((x) => x.path), ['a 50%25.csv', 'run/x.tmp', 'café.txt', 'sub/ImmutableQC/kept.txt'])
  assert.equal(skipped.length, 1)
  assert.match(skipped[0].why, /same name/)
  const un = prepareFiles([{ raw: 'gone.csv', file: null, error: 'NotFoundError: gone' }]).list[0]
  assert.equal(un.file, null)
  assert.match(un.error, /gone/)
})

test('ledgerHeaderProblem: a ledger header passes; anything else says why', T, () => {
  assert.equal(ledgerHeaderProblem(new TextEncoder().encode('{"format":"immutableqc-ledger","version":1}\n{"n":1}\n')), null)
  assert.match(ledgerHeaderProblem(new Uint8Array()), /empty/)
  assert.match(ledgerHeaderProblem(new TextEncoder().encode('well,abs_450\nA01,0.482\n')), /not a JSON object/)
  assert.match(ledgerHeaderProblem(new TextEncoder().encode('{"run":"run-1007"}\n')), /not an Immutable QC ledger header/)
  assert.match(ledgerHeaderProblem(new Uint8Array([0xff, 0xfe, 0x00, 0x0a])), /not text/)
})

test('demoListing: the sample folder, and the copy with one value changed, hash to the published fingerprints', T, async () => {
  const a = demoListing()
  assert.equal(a.root, FOLDER)
  assert.deepEqual(a.items.map((x) => x.raw), FILES.map((f) => f.path))
  for (const it of a.items) assert.equal(await sha(it.file), SHA256[it.raw], it.raw)
  const b = demoListing({ edited: true, ledgerText: 'x\n' })
  for (const it of b.items) if (it.raw !== IQC.LEDGER_PATH) assert.equal(await sha(it.file), SHA256_EDITED[it.raw], it.raw)
  const p07 = await b.items.find((x) => x.raw === EDIT.path).file.text()
  assert.equal(p07.split('\n')[1], `${EDIT.well},${EDIT.after}`)
  assert.ok(b.items.some((x) => x.raw === IQC.LEDGER_PATH))
})

test('seal and audit: the demo pipeline end to end (seal, pass, change one value, fail on plate-07.csv)', T, async () => {
  const pool = nodePool(), keys = new DemoKeys()
  const steps = []
  const sealed = await runSeal(locate(demoListing()), { station: 'bio-line-2', pool, keys, onProgress: (p) => steps.push(p.stage) })
  assert.equal(sealed.appended, false)
  assert.equal(sealed.mode, 'first')
  assert.equal(sealed.report.verdict, 'pass')
  assert.deepEqual(sealed.records.map((r) => r.f.event), ['scan', 'existing', 'existing', 'existing', 'existing', 'existing'])
  assert.equal(sealed.header.ctx.agent, TOOL)
  assert.equal(sealed.records[0].f.agent, TOOL)
  assert.ok(steps.includes('hash') && steps.includes('sign'))
  const v = await IQC.verifyLedger(sealed.text)
  assert.equal(v.ok, true)
  assert.equal(v.keyId, keys.k.keyId)
  for (const r of sealed.records.slice(1)) assert.equal(r.f.sha256, SHA256[r.f.path])
  assert.equal(keys.k.privateKey.extractable, false)

  const pass = await runAudit(locate(demoListing({ ledgerText: sealed.text })), { pool })
  assert.equal(pass.report.verdict, 'pass')
  assert.equal(pass.report.counts.match, 5)
  assert.equal(pass.report.method.where, 'in a browser')
  assert.equal(pass.report.method.tool, TOOL)
  assert.deepEqual(pass.report.ledger.head, v.head)

  const fail = await runAudit(locate(demoListing({ edited: true, ledgerText: sealed.text })), { pool })
  assert.equal(fail.report.verdict, 'fail')
  assert.deepEqual(fail.report.problems.map((p) => [p.code, p.path]), [['changed', EDIT.path]])
  const row = fail.report.files.find((f) => f.path === EDIT.path)
  assert.equal(row.present.sha256, EDIT.sha256After)
  assert.equal(row.sealed.sha256, EDIT.sha256Before)

  // expectations: the head pinned now passes; another head or key fails
  const head = IQC.formatHead(v.head)
  assert.equal((await runAudit(locate(demoListing({ ledgerText: sealed.text })), { pool, expectHead: head, expectKeyId: v.keyId })).report.verdict, 'pass')
  const other = await runAudit(locate(demoListing({ ledgerText: sealed.text })), { pool, expectHead: `${v.head.n}:${'0'.repeat(64)}`, expectKeyId: '0123456789abcdef' })
  assert.deepEqual(other.report.problems.map((p) => p.code).sort(), ['expect-head', 'expect-key'])
})

test('seal: appending to a ledger whose key the browser holds, refusing one it does not, never extending a broken one', T, async () => {
  const pool = nodePool(), keys = new DemoKeys()
  const first = await runSeal(locate(demoListing()), { station: 'Browser', pool, keys })
  // the copy with one value changed, sealed again with the same key: a scan and the change
  const again = await runSeal(locate(demoListing({ edited: true, ledgerText: first.text })), { station: 'Browser', pool, keys })
  assert.equal(again.appended, true)
  assert.equal(again.mode, 'unwatched')
  assert.ok(again.text.startsWith(first.text))
  assert.deepEqual(again.records.map((r) => [r.n, r.f.event, r.f.path || null]), [[7, 'scan', null], [8, 'changed-unwatched', EDIT.path]])
  assert.deepEqual(again.counts, { new: 0, changed: 1, removed: 0 })
  assert.equal(again.report.verdict, 'pass')
  assert.equal((await IQC.verifyLedger(again.text)).ok, true)
  // nothing changed: only a scan record
  const same = await runSeal(locate(demoListing({ edited: true, ledgerText: again.text })), { station: 'Browser', pool, keys })
  assert.deepEqual(same.records.map((r) => r.f.event), ['scan'])
  // a key this browser does not hold
  await assert.rejects(runSeal(locate(demoListing({ ledgerText: first.text })), { pool, keys: new DemoKeys() }), (e) => e.code === 'seal-foreign' && e.action === 'audit' && e.message.includes(first.key.keyId))
  // a broken ledger
  const broken = first.text.replace('"existing"}', '"existing"} ')
  await assert.rejects(runSeal(locate(demoListing({ ledgerText: broken })), { pool, keys }), (e) => e.code === 'seal-broken')
  // a ledger alone cannot be sealed; nor can a bad station name
  await assert.rejects(runSeal({ kind: 'ledger-only', root: null, ledger: { raw: 'ledger.jsonl', file: file('ledger.jsonl', first.text) } }, { pool, keys }), (e) => e.code === 'seal-ledger-only')
  await assert.rejects(runSeal(locate(demoListing()), { pool, keys, station: 'a|b' }), (e) => e.code === 'station')
})

test('audit: a chosen file that is not a ledger, an unreadable ledger, a file that cannot be opened, a ledger alone', T, async () => {
  const pool = nodePool()
  const items = demoListing().items
  await assert.rejects(runAudit({ kind: 'folder', root: 'x', ledger: { raw: 'run.json', file: items[3].file }, files: items }, { pool, chosen: true }), (e) => e.code === 'not-ledger' && /run\.json: its first line/.test(e.message))
  await assert.rejects(runAudit({ kind: 'folder', root: 'x', ledger: { raw: IQC.LEDGER_PATH, file: null, error: 'NotReadableError' }, files: [] }, { pool }), (e) => e.code === 'ledger-unreadable')
  const sealed = await runSeal(locate(demoListing()), { pool, keys: new DemoKeys(), station: 'Browser' })
  const listing = demoListing({ ledgerText: sealed.text })
  listing.items = listing.items.map((x) => (x.raw === 'run-1007/run.json' ? { raw: x.raw, file: null, error: 'NotReadableError: busy' } : x))
  const res = await runAudit(locate(listing), { pool })
  assert.equal(res.report.verdict, 'pass')
  assert.equal(res.report.files.find((f) => f.path === 'run-1007/run.json').state, 'not checked')
  assert.deepEqual(res.unreadable.map((u) => u.path), ['run-1007/run.json'])
  assert.ok(res.report.notes.some((n) => n.code === 'not-checked'))
  const only = await runAudit({ kind: 'ledger-only', root: null, ledger: { raw: 'ledger.jsonl', file: file('ledger.jsonl', sealed.text) } }, { pool })
  assert.equal(only.report.verdict, 'pass')
  assert.equal(only.report.filesChecked, false)
})

test('audit: the core fixtures give the expected verdicts through the app pipeline', T, async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs')
  const { join, relative } = await import('node:path')
  const FX = new URL('../../core/test/fixtures/', import.meta.url).pathname
  const expected = JSON.parse(readFileSync(join(FX, 'expected.json'), 'utf8'))
  const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]))
  for (const [name, want] of Object.entries(expected.variants)) {
    const dir = join(FX, want.folder)
    const listing = { root: want.folder, errors: [], items: walk(dir).map((p) => ({ raw: relative(dir, p).split('\\').join('/'), file: new File([readFileSync(p)], p.split('/').pop()) })) }
    const res = await runAudit(locate(listing), { pool: nodePool() })
    assert.equal(res.report.verdict, want.verdict, name)
    assert.deepEqual(res.report.ledger.head, want.head, name)
    assert.equal(res.report.ledger.keyId, want.keyId, name)
    assert.deepEqual(Object.fromEntries(res.report.files.map((f) => [f.path, f.state])), Object.fromEntries(Object.entries(want.files).map(([p, f]) => [p, f.state])), name)
    assert.deepEqual(res.report.problems.filter((p) => p.line).map((p) => ({ line: p.line, code: p.code })), want.problems, name)
  }
})
