// agent-discovery.test.mjs · the automated re-test of docs/agent-discovery.md, section 6, part 1: what an AI agent finds
// on immutableqc.com when it reads the site as text, with no JavaScript, served exactly as GitHub Pages will publish it
// (the deploy allowlist, site/tools/serve.mjs serveDeploy). It makes no request off this computer: every fetch goes to
// the local server.
//   - robots.txt opens everything and names the sitemap; every sitemap URL is a published page; sitemap.xml is XML.
//   - llms.txt is in the llms.txt format, under 6 KB, and every link resolves to a published file.
//   - For each of the five situations in which a lab agent looks for a tool (section 2), every fact it must find is on
//     agents.html (as text) and in llms-full.txt.
//   - No published page calls agent steps, tracing back to sealed measurements, reviewer sign-off or the MCP server
//     Upcoming, and none says "no API yet" or "Not an API".
//   - The MCP server entry printed in llms.txt, run as printed (with the download as served, temporary folders and a
//     temporary home folder), finds a sealed instrument file: check_inputs on a byte-identical copy says measured.
// The landing page (index.html) belongs to its own owner: the brief's items for it (docs/build-notes/landing-agent-brief.md)
// are marked todo here until that rewrite lands; the Lead turns them into plain tests then.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { serveDeploy } from '../site/tools/serve.mjs'

const ORIGIN = 'https://immutableqc.com/'
let S, BASE
const got = {}
const get = async (p) => {
  if (!(p in got)) { const r = await fetch(BASE + p); got[p] = { status: r.status, type: r.headers.get('content-type') || '', body: Buffer.from(await r.arrayBuffer()) } }
  return got[p]
}
const text = async (p) => (await get(p)).body.toString('utf8')
// a page as an agent without JavaScript reads it: no scripts, no styles, tags gone, entities decoded, one apostrophe
const asText = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<template[\s\S]*?<\/template>/g, ' ')
  .replace(/<\/?(?:p|li|h[1-6]|div|section|dt|dd|tr|td|th|pre|figcaption|caption|br|ul|ol|table|blockquote|summary|header|footer|nav|main)\b[^>]*>/g, '\n')
  .replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&shy;/g, '')
  .replace(/’/g, "'").replace(/[ \t]+/g, ' ')
const local = (u) => { const p = u.slice(ORIGIN.length).replace(/#.*$/, ''); return p === '' || p.endsWith('/') ? `${p}index.html` : p }

before(async () => { S = await serveDeploy(0); BASE = `http://127.0.0.1:${S.port}/` })
after(async () => { if (S) await S.close() })

test('robots.txt opens every page to every crawler and names the sitemap; every sitemap URL is a published page; sitemap.xml is served as XML', async () => {
  const r = await text('robots.txt')
  assert.match(r, /^User-agent: \*$/m)
  assert.match(r, /^Allow: \/$/m)
  assert.doesNotMatch(r, /^Disallow:/m)
  assert.match(r, /^Sitemap: https:\/\/immutableqc\.com\/sitemap\.xml$/m)
  const sm = await get('sitemap.xml')
  assert.equal(sm.status, 200)
  assert.match(sm.type, /^application\/xml/)
  const locs = [...sm.body.toString().matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  assert.ok(locs.length >= 9, locs.join(' '))
  for (const u of ['', 'app/', 'agents.html', 'overview.html', 'sealed.html', 'check.html', 'regulatory.html', 'roadmap.html', 'about.html']) assert.ok(locs.includes(ORIGIN + u), `sitemap lists ${ORIGIN + u}`)
  for (const u of locs) {
    assert.ok(u.startsWith(ORIGIN), u)
    assert.ok(S.files.includes(local(u)), `${u} is published`)
    const p = await get(local(u))
    assert.equal(p.status, 200, u)
    assert.doesNotMatch(p.body.toString(), /<meta name="robots" content="noindex">/, `${u} is not marked noindex`)
  }
})

test('llms.txt: an H1, the one-sentence blockquote, paragraphs and lists, then H2 lists of links; under 6 KB; every link resolves to a published file', async () => {
  const l = await get('llms.txt')
  assert.equal(l.status, 200)
  assert.match(l.type, /^text\/plain/)
  assert.ok(l.body.length < 6 * 1024, `${l.body.length} bytes`)
  const t = l.body.toString()
  assert.match(t, /^# Immutable QC\n\n> Tamper-evident records for automated research labs\. /)
  const first = t.indexOf('\n## ')
  assert.ok(first > 0)
  assert.doesNotMatch(t.slice(0, first), /^#{2,} /m, 'no heading before the first H2')
  const links = [...t.slice(first).matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((m) => m[1])
  assert.ok(links.length >= 10)
  for (const u of links) {
    if (u.startsWith(ORIGIN)) { assert.ok(S.files.includes(local(u)), `${u} is published`); assert.equal((await get(local(u))).status, 200, u) } else assert.equal(u, 'https://joseqc.com')
  }
  // the download it names is the one served, with the SHA-256 it prints
  const dl = (await get('download/iqc.mjs')).body
  assert.ok(t.includes(createHash('sha256').update(dl).digest('hex')), 'llms.txt prints the SHA-256 of the served download/iqc.mjs')
})

// docs/agent-discovery.md, section 2: what each situation's agent must find, in static text
const SITUATIONS = {
  '1. checking an instrument export before analysis': [/check_inputs/, /\bmeasured\b/, /\bderived\b/, /\buntraced\b/, /changed after it was sealed/, /iqc watch or iqc seal/, /must be inside it/, /[Rr]eads only/, /never uses the network/],
  '2. governing an agent\'s outputs': [/record_step/, /SHA-256 and size/, /tool cannot remove (?:it|the record); a person reviews it/, /recorded even when an input is untraced/i, /iqc review/, /review mode/, /no review tool over MCP/, /records only the files it names/, /identifies a computer or a browser, not a person/, /per-person (?:keys and )?signatures (?:are )?upcoming|per-person keys and signatures/i],
  '3. where a number came from': [/\btrace\b/, /tracesToMeasured/, /nothing (?:is )?uploaded/i, /audits a (?:whole )?lab folder/i, /values (?:read from )?inside files/i],
  '4. building a self-driving lab or an instrument agent': [/seal every file in a folder by its bytes/i, /any instrument software/, /settle/, /10 s\b|10 by default/, /--ledger/, /one file/i, /Node\.js 22/, /no dependencies/i, /SHA-256/, /"--search", "\/lab"/, /No license is published yet/],
  '5. auditing before submission or handoff': [/audit_summary/, /iqc audit/, /exit 0 pass, 3 review, 1 fail, 2 usage or read error/, /right when it was written/, /settle window/, /[Ww]hoever holds a ledger's key/, /--expect-head/, /--pin-file/, /--expect-key/],
  'static facts every listing needs': [/2026-07-28, 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05/, /JSON Lines/, /ECDSA P-256/, /Windows, macOS (?:and|or) Linux/, /joseqc\.com/, /any MCP client that starts local servers over standard input and output/i, /Upcoming: an npm package|Upcoming An npm package/i],
}

test('the five situations: every fact an agent must find is on agents.html, read as text with no JavaScript, and in llms-full.txt', async () => {
  const page = asText(await text('agents.html')), full = (await text('llms-full.txt')).replace(/’/g, "'")
  const missing = []
  for (const [sit, facts] of Object.entries(SITUATIONS)) for (const re of facts) for (const [name, t] of [['agents.html', page], ['llms-full.txt', full]]) if (!re.test(t)) missing.push(`${name}, ${sit}: ${re}`)
  assert.deepEqual(missing, [])
  assert.ok(page.includes('{"command": "node", "args": ["/path/to/iqc.mjs", "mcp", "--root", "/lab/agent-workspace", "--search", "/lab"]}'))
})

test('no published page calls agent steps, tracing back to sealed measurements, reviewer sign-off or the MCP server Upcoming, and none says "no API yet" or "Not an API"', async () => {
  const bad = []
  for (const f of S.files.filter((x) => /\.html$/.test(x) && x !== 'index.html')) {
    const html = (await text(f)).replace(/<section class="sec sec--side" id="history"[\s\S]*?<\/section>/, ' ') // About's revision history records past drafts
    const sents = asText(html).split('\n').flatMap((l) => l.split(/(?<=[.!?])\s+/)).map((x) => x.trim()).filter(Boolean)
    for (const s of sents) {
      if (/\bno API yet\b|\bnot an API\b/i.test(s)) bad.push(`${f}: ${s}`)
      if (/\bagent steps?\b|\btrace[sd]? (?:\w+ ){0,4}back to sealed measurements\b|\breviewer sign-off\b|\bMCP server\b|\bagentic workflows\b/i.test(s) && /\bupcoming\b/i.test(s) && !/per-(?:analyst|person)|values|capture/i.test(s)) bad.push(`${f}: ${s.slice(0, 160)}`)
    }
  }
  assert.deepEqual(bad, [])
})

test('the MCP server entry in llms.txt, run as printed, finds a sealed instrument file: check_inputs on a byte-identical copy says measured', { timeout: 60000 }, async () => {
  const entry = JSON.parse((await text('llms.txt')).match(/^\{"command": "node".*\}$/m)[0])
  assert.equal(entry.command, 'node')
  const dir = mkdtempSync(join(tmpdir(), 'iqc-discovery-'))
  try {
    const home = join(dir, 'home'), lab = join(dir, 'lab'), station = join(lab, 'hplc-3'), ws = join(lab, 'agent-workspace')
    for (const d of [home, station, join(ws, 'inputs')]) mkdirSync(d, { recursive: true })
    const iqc = join(dir, 'iqc.mjs')
    writeFileSync(iqc, (await get('download/iqc.mjs')).body) // the download as served
    const env = { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1' }
    writeFileSync(join(station, 'run-07.csv'), 'injection,area\n1,1523602\n2,1519874\n')
    const sealed = spawnSync(process.execPath, [iqc, 'seal', station, '--settle', '0', '--quiet'], { env, encoding: 'utf8' })
    assert.equal(sealed.status, 0, sealed.stderr)
    writeFileSync(join(ws, 'inputs', 'run-07.csv'), readFileSync(join(station, 'run-07.csv')))
    // the printed entry, with its example folders mapped onto these
    const args = entry.args.map((a) => (a === '/path/to/iqc.mjs' ? iqc : a === '/lab/agent-workspace' ? ws : a === '/lab' ? lab : a))
    assert.deepEqual(entry.args.filter((a) => a.startsWith('--')), ['--root', '--search'])
    const p = spawn(process.execPath, args, { env, cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] })
    let buf = '', err = ''
    const waiting = new Map()
    p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (waiting.has(m.id)) waiting.get(m.id)(m) } })
    p.stderr.on('data', (d) => { err += d })
    let n = 0
    const send = (method, params) => new Promise((resolve, reject) => { const id = ++n; const t = setTimeout(() => reject(new Error(`no answer to ${method}: ${err}`)), 20000); waiting.set(id, (m) => { clearTimeout(t); resolve(m) }); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') })
    try {
      const init = (await send('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'discovery-test', version: '1' } })).result
      assert.match(init.instructions, /^Immutable QC: tamper-evident records for lab instrument files and AI agent steps/)
      p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
      const r = (await send('tools/call', { name: 'check_inputs', arguments: { paths: ['inputs/run-07.csv'] } })).result
      assert.equal(r.isError, undefined, JSON.stringify(r))
      assert.equal(r.structuredContent.files[0].state, 'measured', r.content[0].text)
      assert.equal(r.structuredContent.files[0].measured.station.length > 0, true)
      assert.deepEqual(r.structuredContent.searched.folders, [lab])
    } finally {
      p.stdin.end()
      await new Promise((resolve) => { p.on('close', resolve); setTimeout(() => { p.kill('SIGKILL'); resolve() }, 10000) })
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// the landing page's items (docs/build-notes/landing-agent-brief.md): todo until its owner's rewrite lands
const LANDING = 'the landing page brief (docs/build-notes/landing-agent-brief.md) is not applied yet'
test('index.html: the meta description leads with the category', { todo: LANDING }, async () => {
  assert.match(await text('index.html'), /<meta name="description" content="Tamper-evident records for automated research labs: seal every instrument file, record what AI agents read and wrote, audit a folder in one click\.">/)
})
test('index.html: names llms.txt in its head, and has a SoftwareApplication JSON-LD block', { todo: LANDING }, async () => {
  const h = await text('index.html')
  assert.ok(h.includes('<link rel="describedby" href="llms.txt">'))
  assert.match(h, /<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"SoftwareApplication"/)
})
test('index.html: a visible "For AI agents" section with the server entry, links to agents.html and llms.txt, Node.js 22, and no "Lineage" under Upcoming', { todo: LANDING }, async () => {
  const h = await text('index.html'), t = asText(h)
  assert.ok(t.includes('{"command": "node", "args": ["/path/to/iqc.mjs", "mcp", "--root", "/lab/agent-workspace", "--search", "/lab"]}'))
  assert.ok(h.includes('href="agents.html"') && h.includes('href="llms.txt"'))
  assert.match(t, /Node\.js 22 or later/)
  assert.doesNotMatch(t, /Node\.js 20 or later/)
  assert.doesNotMatch(t, /Upcoming: Lineage/)
})
