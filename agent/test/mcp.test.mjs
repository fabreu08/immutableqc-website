// iqc mcp, end to end against both entries: a scripted MCP client spawns the server on a copy of core's lab fixture
// and speaks JSON-RPC over its standard input and output. The handshake versions (initialize,
// notifications/initialized, ping), the stateless version (server/discover, _meta on every request), each tool, a
// path that leaves the root, unknown methods and tools, malformed and batch messages; standard output carries only
// protocol messages; the ledger brackets the session with mcp-started and mcp-stopped.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, cpSync, mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { ENTRIES, REPO, workspace, envFor, run } from './_helpers.mjs'
import { verifyLedger } from '../../core/immutableqc.mjs'

const LAB = join(REPO, 'core', 'test', 'fixtures', 'lab')
const MODERN = '2026-07-28'
const meta = (extra = {}) => ({ _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN, 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '1' }, ...extra } })

function lab() {
  const W = workspace()
  const L = join(W.dir, 'lab')
  cpSync(LAB, L, { recursive: true })
  const root = join(L, 'agent-2')
  mkdirSync(root)
  writeFileSync(join(root, 'in.csv'), readFileSync(join(L, 'bio-line-2', 'plate-07.csv')))
  writeFileSync(join(root, 'out.csv'), 'mean,1\n')
  writeFileSync(join(root, 'scratch.txt'), 'not measured\n')
  writeFileSync(join(W.dir, 'outside.txt'), 'outside\n')
  return { ...W, lab: L, root }
}

// a client: send(obj) -> the response with its id; raw(line) writes a line as it is; next() the next message
const live = new Set()
function client(entry, args, { home, cwd }) {
  const p = spawn(process.execPath, [entry, 'mcp', ...args], { cwd, env: envFor(home), stdio: ['pipe', 'pipe', 'pipe'] })
  let out = '', err = ''
  const msgs = [], waiting = []
  p.stdout.setEncoding('utf8')
  p.stdout.on('data', (d) => {
    out += d
    let i
    while ((i = out.indexOf('\n')) >= 0) {
      const line = out.slice(0, i)
      out = out.slice(i + 1)
      const m = JSON.parse(line) // every line of standard output is one JSON message
      msgs.push(m)
      for (const w of [...waiting]) if (w.test(m)) { waiting.splice(waiting.indexOf(w), 1); w.resolve(m) }
    }
  })
  p.stderr.on('data', (d) => { err += d })
  live.add(p)
  const closed = new Promise((resolve) => p.on('close', (code, signal) => { live.delete(p); resolve({ code, signal }) }))
  let n = 0
  const wait = (test) => new Promise((resolve, reject) => {
    const hit = msgs.find((m) => test(m) && !m._seen)
    if (hit) { hit._seen = true; resolve(hit); return }
    const t = setTimeout(() => reject(new Error(`no response; stderr:\n${err}`)), 20000)
    waiting.push({ test, resolve: (m) => { clearTimeout(t); m._seen = true; resolve(m) } })
  })
  return {
    proc: p, msgs, closed, stderr: () => err, leftover: () => out,
    send(method, params, id = ++n) { p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }) + '\n'); return wait((m) => m.id === id) },
    notify(method, params) { p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }) + '\n') },
    raw(line) { p.stdin.write(line + '\n') },
    nextNull() { return wait((m) => m.id === null) },
    end() { p.stdin.end(); return closed },
  }
}

const call = (c, name, args, params = {}) => c.send('tools/call', { name, arguments: args, ...params })
const records = (root) => readFileSync(join(root, 'ImmutableQC', 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).slice(1).map((l) => JSON.parse(l))

for (const [name, entry] of ENTRIES) {
  describe(`iqc mcp (${name})`, { concurrency: false }, () => {
    test('handshake 2025-11-25: initialize, initialized, ping, tools/list, each tool, escapes, errors; mcp-started and mcp-stopped', async () => {
      const W = lab()
      try {
        const c = client(entry, ['--root', W.root, '--search', W.lab, '--actor', 'analyst-bot', '--tool', 'model-x'], { home: W.home, cwd: W.dir })
        const pre = await c.send('tools/list', {})
        assert.equal(pre.error.code, -32602) // neither initialize nor _meta yet
        const init = await c.send('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test-client', version: '1' } })
        assert.equal(init.result.protocolVersion, '2025-11-25')
        assert.equal(init.result.serverInfo.name, 'iqc')
        assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } })
        assert.equal(typeof init.result.instructions, 'string')
        c.notify('notifications/initialized')
        assert.deepEqual((await c.send('ping')).result, {})
        const again = await c.send('initialize', { protocolVersion: '2025-11-25', capabilities: {} })
        assert.equal(again.error.code, -32600)
        const list = (await c.send('tools/list', {})).result
        assert.equal(list.resultType, undefined)
        assert.deepEqual(list.tools.map((t) => t.name), ['check_inputs', 'record_step', 'trace', 'audit_summary'])
        for (const t of list.tools) {
          assert.equal(t.inputSchema.type, 'object')
          assert.equal(t.outputSchema.type, 'object')
          assert.ok(t.description.length > 40 && t.title)
          assert.equal(t.annotations.readOnlyHint, t.name !== 'record_step')
        }

        // check_inputs: measured and untraced, as text, JSON text and structured content
        const ci = (await call(c, 'check_inputs', { paths: ['in.csv', 'scratch.txt'] })).result
        assert.equal(ci.isError, undefined)
        assert.deepEqual(ci.structuredContent.files.map((f) => f.state), ['measured', 'untraced'])
        assert.equal(ci.structuredContent.measured, 1)
        assert.match(ci.content[0].text, /^2 files: 1 measured, 0 derived, 1 untraced/)
        assert.deepEqual(JSON.parse(ci.content[1].text), ci.structuredContent)

        // record_step
        const rs = (await call(c, 'record_step', { action: 'Averaged plate 07', inputs: ['in.csv'], outputs: ['out.csv'] })).result
        assert.equal(rs.isError, undefined, JSON.stringify(rs))
        const s = rs.structuredContent
        assert.equal(s.record, 2) // record 1 is mcp-started
        assert.equal(s.actor, 'analyst-bot')
        assert.equal(s.tool, 'model-x')
        assert.equal(s.reference, `${s.ledger.ledgerId}:2:${s.link}`)
        assert.equal(s.inputs[0].state, 'measured')
        assert.equal(s.untracedInputs, 0)
        const rs2 = (await call(c, 'record_step', { action: 'Copied a note', inputs: ['scratch.txt'], outputs: ['scratch.txt'], actor: 'other-bot' })).result
        assert.equal(rs2.structuredContent.actor, 'other-bot')
        assert.match(rs2.structuredContent.warning, /no sealed measurement/)

        // trace: out.csv derives from a measured file
        const tr = (await call(c, 'trace', { path: 'out.csv' })).result
        assert.equal(tr.structuredContent.state, 'derived')
        assert.equal(tr.structuredContent.tracesToMeasured, true)
        assert.match(tr.content[0].text, /^Derived: it traces to 1 measured file\./)
        assert.equal((await call(c, 'check_inputs', { paths: ['out.csv'] })).result.structuredContent.files[0].state, 'derived')

        // audit_summary: the whole lab, with the new agent ledger
        const au = (await call(c, 'audit_summary', {})).result
        assert.equal(au.isError, undefined, JSON.stringify(au))
        assert.ok(['pass', 'review'].includes(au.structuredContent.verdict))
        assert.ok(au.structuredContent.ledgers.some((L) => L.ledgerPath === 'agent-2/ImmutableQC/ledger.jsonl'))
        assert.equal(au.structuredContent.counts.steps, 5)

        // refused, as tool errors: paths that leave the root, a symlink, the ledger, bad arguments
        const escapes = ['../bio-line-2/plate-07.csv', join(W.dir, 'outside.txt'), 'ImmutableQC/ledger.jsonl', 'nope.csv']
        try { symlinkSync(join(W.dir, 'outside.txt'), join(W.root, 'link.txt')); escapes.push('link.txt') } catch { /* no symlinks */ }
        try { symlinkSync(W.dir, join(W.root, 'up')); escapes.push('up/outside.txt') } catch { /* no symlinks */ }
        for (const p of escapes) {
          const e = (await call(c, 'check_inputs', { paths: [p] })).result
          assert.equal(e.isError, true, p)
          assert.equal(e.structuredContent, undefined)
          assert.ok(e.content[0].text.length > 10)
        }
        const esc = (await call(c, 'record_step', { action: 'x', outputs: ['../hplc-3/run-0914/injection-01.csv'] })).result
        assert.equal(esc.isError, true)
        assert.match(esc.content[0].text, /outside the root/)
        for (const [tool, args] of [['check_inputs', {}], ['check_inputs', { paths: 'in.csv' }], ['trace', { path: 'in.csv', extra: 1 }], ['record_step', { action: 'a|b', outputs: ['out.csv'] }], ['record_step', { action: 'x', outputs: [] }], ['audit_summary', { strict: 'yes' }]]) {
          const e = (await call(c, tool, args)).result
          assert.equal(e.isError, true, `${tool} ${JSON.stringify(args)}`)
        }

        // protocol errors
        assert.equal((await call(c, 'no_such_tool', {})).error.code, -32602)
        assert.equal((await c.send('resources/list', {})).error.code, -32601)
        c.raw('{"jsonrpc": "2.0", "id": 99, "method": ')
        assert.equal((await c.nextNull()).error.code, -32700)
        c.raw('[{"jsonrpc":"2.0","id":100,"method":"ping"}]')
        assert.equal((await c.nextNull()).error.code, -32600)
        c.raw('{"jsonrpc":"1.0","id":101,"method":"ping"}')
        assert.equal((await c.send('ping', undefined, 102)).result !== undefined, true)
        assert.ok(c.msgs.some((m) => m.id === 101 && m.error && m.error.code === -32600))
        c.notify('notifications/cancelled', { requestId: 5 })
        assert.deepEqual((await c.send('ping')).result, {})

        // while the server runs, it holds the ledger: another writer is refused
        const busy = await run(entry, ['record', '--root', W.root, '--actor', 'a', '--action', 'b', '--out', 'out.csv'], { home: W.home, cwd: W.root })
        assert.equal(busy.code, 1, busy.out)

        const end = await c.end()
        assert.equal(end.code, 0, c.stderr())
        assert.equal(c.leftover(), '')
        assert.ok(c.msgs.every((m) => m.jsonrpc === '2.0' && ('result' in m || 'error' in m)))
        assert.match(c.stderr(), /iqc mcp: serving on standard input and output/)
        const recs = records(W.root)
        assert.deepEqual(recs.map((r) => (r.kind === 'session' ? r.f.event : r.kind)), ['mcp-started', 'step', 'step', 'mcp-stopped'])
        const v = await verifyLedger(readFileSync(join(W.root, 'ImmutableQC', 'ledger.jsonl')))
        assert.equal(v.ok, true)
        assert.equal(v.mcpSessions.length, 1)
        // the audit of the lab afterwards
        const a = await run(entry, ['audit', W.lab], { home: W.home })
        assert.ok([0, 3].includes(a.code), a.out)
      } finally { for (const p of live) p.kill('SIGKILL'); W.cleanup() }
    })

    test('older handshake versions: 2024-11-05 has no structured results; an unknown version gets the latest', async () => {
      const W = lab()
      try {
        const c = client(entry, ['--root', W.root, '--search', W.lab], { home: W.home, cwd: W.dir })
        const init = await c.send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'old', version: '0' } })
        assert.equal(init.result.protocolVersion, '2024-11-05')
        c.notify('notifications/initialized')
        const list = (await c.send('tools/list', {})).result
        for (const t of list.tools) { assert.equal(t.outputSchema, undefined); assert.equal(t.title, undefined); assert.equal(t.annotations, undefined) }
        const ci = (await call(c, 'check_inputs', { paths: ['in.csv'] })).result
        assert.equal(ci.structuredContent, undefined)
        assert.equal(JSON.parse(ci.content[1].text).files[0].state, 'measured')
        assert.equal((await c.end()).code, 0)

        const c2 = client(entry, ['--root', W.root, '--search', W.lab], { home: W.home, cwd: W.dir })
        assert.equal((await c2.send('initialize', { protocolVersion: '1999-01-01', capabilities: {} })).result.protocolVersion, '2025-11-25')
        const l2 = (await c2.send('tools/list', {})).result
        assert.ok(l2.tools.every((t) => t.outputSchema && t.annotations))
        assert.equal((await c2.end()).code, 0)
        assert.deepEqual(records(W.root).map((r) => r.f.event), ['mcp-started', 'mcp-stopped', 'mcp-started', 'mcp-stopped'])
      } finally { for (const p of live) p.kill('SIGKILL'); W.cleanup() }
    })

    test('2026-07-28: server/discover and requests carrying _meta, no handshake; version and capability errors', async () => {
      const W = lab()
      try {
        const c = client(entry, ['--root', W.root, '--search', W.lab], { home: W.home, cwd: W.dir })
        const d = (await c.send('server/discover', meta())).result
        assert.equal(d.resultType, 'complete')
        assert.deepEqual(d.supportedVersions, ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'])
        assert.deepEqual(d.capabilities, { tools: { listChanged: false } })
        assert.equal(d._meta['io.modelcontextprotocol/serverInfo'].name, 'iqc')
        assert.ok(d.ttlMs >= 0 && ['public', 'private'].includes(d.cacheScope))
        const list = (await c.send('tools/list', meta())).result
        assert.equal(list.resultType, 'complete')
        assert.ok(list.ttlMs >= 0 && list.cacheScope === 'public')
        assert.equal(list._meta['io.modelcontextprotocol/serverInfo'].name, 'iqc')
        assert.equal(list.tools.length, 4)
        const ci = (await c.send('tools/call', { name: 'check_inputs', arguments: { paths: ['in.csv'] }, ...meta() })).result
        assert.equal(ci.resultType, 'complete')
        assert.equal(ci.structuredContent.files[0].state, 'measured')
        const rs = (await c.send('tools/call', { name: 'record_step', arguments: { action: 'Averaged plate 07', inputs: ['in.csv'], outputs: ['out.csv'] }, ...meta() })).result
        assert.equal(rs.structuredContent.record, 2)
        const bad = (await c.send('tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': '1900-01-01', 'io.modelcontextprotocol/clientCapabilities': {} } })).error
        assert.equal(bad.code, -32022)
        assert.equal(bad.message, 'Unsupported protocol version')
        assert.equal(bad.data.requested, '1900-01-01')
        assert.ok(bad.data.supported.includes(MODERN))
        assert.equal((await c.send('tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } })).error.code, -32602)
        assert.equal((await c.send('ping', meta())).error.code, -32601)
        assert.equal((await c.send('tools/list', {})).error.code, -32602) // no _meta and no initialize
        assert.equal((await c.send('resources/list', meta())).error.code, -32601)
        assert.equal((await c.end()).code, 0)
        assert.deepEqual(records(W.root).map((r) => (r.kind === 'session' ? r.f.event : r.kind)), ['mcp-started', 'step', 'mcp-stopped'])
        // usage errors before serving: a folder argument, a missing root
        assert.equal((await run(entry, ['mcp', W.root], { home: W.home })).code, 2)
        assert.equal((await run(entry, ['mcp', '--root', join(W.dir, 'nope')], { home: W.home })).code, 2)
      } finally { for (const p of live) p.kill('SIGKILL'); W.cleanup() }
    })
  })
}
