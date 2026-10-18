// The MCPB bundle and the registry draft (docs/agent-discovery.md, A7): agent/tools/mcpb.mjs packs exactly the manifest
// and the one-file agent, deterministically, as a zip archive another tool can read; the manifest agrees with the agent
// (version, tools, Node.js 22, every ${user_config.x} it uses is declared); server.json fits the registry's schema
// limits and carries the SHA-256 of the bundle the tool writes. Nothing is published from here: C2 to C4 need the founder.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { buildMcpb, readZip, zipStored, crc32, manifest, SERVER, MANIFEST, SERVER_JSON } from '../tools/mcpb.mjs'
import { TOOLS, SUPPORTED_VERSIONS } from '../src/mcp.mjs'
import { AGENT_VERSION } from '../src/util.mjs'
import { AGENT } from './_helpers.mjs'

test('mcpb: the bundle holds exactly manifest.json and server/iqc.mjs (download/iqc.mjs, byte for byte), stored, and is the same bytes every time', () => {
  const a = buildMcpb(), b = buildMcpb()
  assert.ok(a.bytes.equals(b.bytes), 'deterministic')
  assert.equal(a.sha256, createHash('sha256').update(a.bytes).digest('hex'))
  const z = readZip(a.bytes)
  assert.deepEqual(z.map((e) => e.name), ['manifest.json', 'server/iqc.mjs'])
  assert.ok(z.every((e) => e.method === 0 && crc32(e.data) === e.crc))
  assert.ok(z[0].data.equals(readFileSync(MANIFEST)))
  assert.ok(z[1].data.equals(readFileSync(SERVER)))
  assert.match(a.file, new RegExp(`immutableqc-${AGENT_VERSION.replace(/\./g, '\\.')}\\.mcpb$`))
  // crc32 against a known value, and a second archive through the same reader
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
  const t = zipStored([{ name: 'a/é.txt', data: Buffer.from('hello') }])
  assert.deepEqual(readZip(t).map((e) => [e.name, e.data.toString()]), [['a/é.txt', 'hello']])
})

test('mcpb: a zip reader outside this repository reads it (python3 zipfile, when present)', (t) => {
  const py = spawnSync('python3', ['--version'], { encoding: 'utf8' })
  if (py.status !== 0) { t.skip('no python3'); return }
  const dir = mkdtempSync(join(tmpdir(), 'iqc-mcpb-'))
  try {
    const f = join(dir, 'b.mcpb')
    writeFileSync(f, buildMcpb().bytes)
    const r = spawnSync('python3', ['-I', '-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print(",".join(z.namelist()))', f], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, 'None\nmanifest.json,server/iqc.mjs\n')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('mcpb: the manifest agrees with the agent: version, tools in order, Node.js 22, platforms, and every ${user_config.x} it uses is declared', () => {
  const m = manifest()
  assert.equal(m.manifest_version, '0.3')
  assert.equal(m.version, AGENT_VERSION)
  for (const k of ['name', 'version', 'description', 'author', 'server']) assert.ok(m[k], k)
  assert.ok(m.description.length <= 100, `${m.description.length} characters`)
  assert.deepEqual(m.tools.map((x) => x.name), TOOLS.map((x) => x.name))
  assert.equal(m.compatibility.runtimes.node, '>=22.0.0')
  assert.deepEqual(m.compatibility.platforms, ['darwin', 'win32', 'linux'])
  assert.equal(m.server.type, 'node')
  assert.equal(m.server.entry_point, 'server/iqc.mjs')
  assert.equal(m.server.mcp_config.command, 'node')
  const args = m.server.mcp_config.args
  assert.equal(args[0], '${__dirname}/server/iqc.mjs')
  assert.deepEqual(args.filter((x) => x.startsWith('--')), ['--root', '--search'])
  const used = [...JSON.stringify(m.server).matchAll(/\$\{user_config\.(\w+)\}/g)].map((x) => x[1])
  assert.deepEqual(used.sort(), Object.keys(m.user_config).sort())
  for (const u of Object.values(m.user_config)) { assert.equal(u.type, 'directory'); assert.equal(u.required, true); assert.ok(u.title && u.description) }
  assert.ok(!('license' in m), 'no license until the founder picks one (decision D1)')
  assert.equal(m.documentation, 'https://immutableqc.com/agents.html')
})

test('server.json: the registry schema limits, the name pattern, this version, an MCPB identifier that names "mcp", and the SHA-256 of the bundle', () => {
  const s = JSON.parse(readFileSync(SERVER_JSON, 'utf8'))
  assert.equal(s.$schema, 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json')
  assert.match(s.name, /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/)
  assert.ok(s.name.length >= 3 && s.name.length <= 200)
  assert.ok(s.description.length >= 1 && s.description.length <= 100, `${s.description.length}`)
  assert.ok(s.title.length >= 1 && s.title.length <= 100, `${s.title.length}`)
  assert.equal(s.version, AGENT_VERSION)
  assert.equal(s.packages.length, 1)
  const p = s.packages[0]
  assert.equal(p.registryType, 'mcpb')
  assert.match(p.identifier, /mcp/)
  assert.ok(p.identifier.endsWith(`/v${AGENT_VERSION}/immutableqc-${AGENT_VERSION}.mcpb`), p.identifier)
  assert.deepEqual(p.transport, { type: 'stdio' })
  assert.match(p.fileSha256, /^[a-f0-9]{64}$/)
  assert.equal(p.fileSha256, buildMcpb().sha256, 'server.json is out of date: run node agent/tools/mcpb.mjs --server-json')
  const c = spawnSync(process.execPath, [join(AGENT, 'tools', 'mcpb.mjs'), '--check'], { encoding: 'utf8' })
  assert.equal(c.status, 0, c.stdout + c.stderr)
  assert.ok(SUPPORTED_VERSIONS.length >= 1)
})
