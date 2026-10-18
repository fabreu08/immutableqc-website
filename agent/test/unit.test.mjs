// Unit tests of the agent's pieces that do not need a child process.
import test from 'node:test'
import assert from 'node:assert/strict'
import { win32, posix } from 'node:path'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hostname } from 'node:os'
import { VERSION } from '../../core/immutableqc.mjs'
import { parseArgs, cleanPathArg } from '../src/args.mjs'
import { relPathOf, relPathOrNull, displayPath, locate } from '../src/paths.mjs'
import { lockState } from '../src/lock.mjs'
import { Out, colorWanted } from '../src/out.mjs'
import { README_TEXT, readLedgerSettled } from '../src/ledger.mjs'
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { generateKeyPair, publicKeyHex, createHeader, createRecords, serializeLine } from '../../core/immutableqc.mjs'
import { AGENT, AGENT_VERSION } from '../src/util.mjs'
import { HELP, COMMAND_HELP } from '../src/cli.mjs'
import { stampHTML } from '../tools/bundle.mjs'
import { AGENT as AGENT_DIR } from './_helpers.mjs'

test('paths: a Windows-style path becomes the stored path ("/" between segments, NFC, %, | and control characters encoded)', () => {
  assert.equal(relPathOf('D:\\Results', 'D:\\Results\\QC\\run-0914\\injection-06.csv', win32), 'QC/run-0914/injection-06.csv')
  assert.equal(relPathOf('D:\\Results\\', 'D:\\Results\\50% done\\a|b.csv', win32), '50%25 done/a%7Cb.csv')
  assert.equal(relPathOf('d:\\results', 'D:\\Results\\Caf\u0065\u0301.csv', win32), 'Caf\u00e9.csv', 'Windows paths compare without case; NFD becomes NFC')
  assert.equal(relPathOf('\\\\lab-nas\\share\\HPLC', '\\\\lab-nas\\share\\HPLC\\x\\y.txt', win32), 'x/y.txt', 'a network share (UNC path)')
  assert.equal(relPathOf('/data', '/data/a\\b.csv', posix), 'a\\b.csv', 'a backslash in a POSIX file name is part of the name')
  assert.throws(() => relPathOf('D:\\Results', 'D:\\Other\\a.csv', win32), /not inside/)
  assert.throws(() => relPathOf('D:\\Results', 'E:\\Results\\a.csv', win32), /not inside/)
  assert.throws(() => relPathOf('D:\\Results', 'D:\\Results', win32), /not inside/)
  assert.equal(relPathOrNull('/data', '/elsewhere/x', posix), null)
  assert.equal(displayPath('50%25 done/a%7Cb%0A.csv'), '50% done/a|b%0A.csv')
  assert.equal(displayPath('x%257C'), 'x%7C')
})

test('paths: the ledger, its lock and README.txt; a ledger kept inside the data folder is one of the agent\'s own files', () => {
  const d = locate('/data', null)
  assert.equal(d.ledgerPath, join('/data', 'ImmutableQC', 'ledger.jsonl'))
  assert.equal(d.lockPath, join('/data', 'ImmutableQC', 'agent.lock'))
  assert.equal(d.readmePath, join('/data', 'ImmutableQC', 'README.txt'))
  assert.equal(d.isDefault, true)
  assert.equal(d.shown, join('ImmutableQC', 'ledger.jsonl'))
  const e = locate('/data', '/ledgers/lab.jsonl')
  assert.equal(e.lockPath, '/ledgers/lab.jsonl.lock')
  assert.equal(e.isDefault, false)
  assert.equal(e.own.size, 0)
  const i = locate('/data', '/data/keep/ledger.jsonl')
  assert.deepEqual([...i.own].sort(), ['keep/agent.lock', 'keep/ledger.jsonl'])
})

test('args: quoted Windows paths ("D:\\Results\\" arrives as D:\\Results") are cleaned up on Windows only', () => {
  assert.equal(cleanPathArg('D:\\Results"', 'win32'), 'D:\\Results')
  assert.equal(cleanPathArg('"D:\\Instrument Data"', 'win32'), 'D:\\Instrument Data')
  assert.equal(cleanPathArg("'D:\\Results'", 'win32'), 'D:\\Results')
  assert.equal(cleanPathArg('D:\\Results', 'win32'), 'D:\\Results')
  assert.equal(cleanPathArg('weird"name', 'linux'), 'weird"name')
  assert.equal(parseArgs(['audit', 'D:\\Results"', '--report', '"C:\\Reports\\a.html"'], { platform: 'win32' }).folder, 'D:\\Results')
  assert.equal(parseArgs(['audit', 'D:\\Results"', '--report', '"C:\\Reports\\a.html"'], { platform: 'win32' }).opts.report, 'C:\\Reports\\a.html')
})

test('args: commands, options in any order, --name=value, repeatable --ignore, defaults and validation', () => {
  const a = parseArgs(['--quiet', 'watch', '--interval=0.5', 'data', '--ignore', '*.bak', '--ignore=cache', '--settle', '10'])
  assert.equal(a.command, 'watch')
  assert.equal(a.folder, 'data')
  assert.deepEqual(a.opts, { ignore: ['*.bak', 'cache'], quiet: true, interval: 0.5, settle: 10 })
  const b = parseArgs(['audit', '--expect-head', `7:${'AB'.repeat(32)}`, '--expect-key', 'C5E3895EADB5EDB4', '--strict', '--json', '-'])
  assert.deepEqual(b.opts['expect-head'], { n: 7, h: 'ab'.repeat(32) })
  assert.equal(b.opts['expect-key'], 'c5e3895eadb5edb4')
  assert.equal(b.opts.json, '-')
  assert.equal(b.folder, null)
  assert.equal(parseArgs(['seal', '--', '--odd-folder']).folder, '--odd-folder')
  assert.equal(parseArgs(['--version']).version, true)
  assert.equal(parseArgs(['-v']).version, true)
  assert.equal(parseArgs(['help', 'audit']).topic, 'audit')
  assert.equal(parseArgs(['seal', '-h']).help, true)
  for (const [argv, re] of [
    [['watch', '--interval', '0'], /--interval takes a number of seconds from 0.05/],
    [['watch', '--settle', '-1'], /--settle takes a number/],
    [['watch', '--settle'], /--settle needs a value/],
    [['watch', '--ledger', 'a', '--ledger', 'b'], /given twice/],
    [['watch', '--quiet=yes'], /takes no value/],
    [['watch', '-x'], /Unknown option -x/],
    [['seal', '--strict'], /--strict is an option of iqc audit/],
    [['head', '--expect-key', 'abc'], /--expect-key is an option of iqc audit/],
    [['watch', '--station', 'x'.repeat(65)], /longer than 64 characters/],
    [['watch', '--station', ''], /it is empty/],
    [['watch', '--ignore', ''], /--ignore needs a pattern/],
    [['watch', 'a', 'b'], /takes one folder, but got 2/],
    [['sael'], /Unknown command "sael"/],
  ]) assert.throws(() => parseArgs(argv), (e) => e.exitCode === 2 && re.test(e.message), argv.join(' '))
  assert.equal(parseArgs(['watch', '--station', 'é'.repeat(64)]).opts.station.length, 64, '64 characters, not 64 bytes')
})

test('lock: live, stale, another computer, being written, unreadable', () => {
  const me = hostname()
  assert.equal(lockState(null), 'none')
  assert.equal(lockState({ info: { pid: process.ppid, host: me }, ageMs: 50000 }), 'live')
  assert.equal(lockState({ info: { pid: 2 ** 22 + 12345, host: me }, ageMs: 50000 }), 'stale')
  assert.equal(lockState({ info: { pid: process.pid, host: me }, ageMs: 50000 }), 'stale', 'its own pid is a leftover')
  assert.equal(lockState({ info: { pid: process.ppid, host: 'another-computer' }, ageMs: 5 }), 'other-host')
  assert.equal(lockState({ info: { pid: process.ppid, host: me.toUpperCase() }, ageMs: 5 }), 'live', 'computer names compare without case')
  assert.equal(lockState({ info: null, ageMs: 100 }), 'young')
  assert.equal(lockState({ info: null, ageMs: 60000 }), 'unreadable')
})

test('output: colors only on a terminal, never with --no-color or NO_COLOR', () => {
  const tty = { isTTY: true, write() {}, on() {} }
  const pipe = { isTTY: false, write() {}, on() {} }
  assert.equal(colorWanted(tty, { env: {} }), true)
  assert.equal(colorWanted(pipe, { env: {} }), false)
  assert.equal(colorWanted(tty, { env: { NO_COLOR: '1' } }), false)
  assert.equal(colorWanted(tty, { env: { NO_COLOR: '' } }), true, 'an empty NO_COLOR does not count (no-color.org)')
  assert.equal(colorWanted(tty, { env: {}, noColor: true }), false)
  const lines = []
  const sink = { isTTY: true, write: (s) => lines.push(s), on() {} }
  const o = new Out({ stdout: sink, stderr: sink, env: {} })
  o.event('sealed', 'green', 'a.csv')
  assert.equal(lines[0], '\x1b[32msealed   \x1b[0ma.csv\n')
  const q = new Out({ stdout: sink, stderr: sink, env: {}, quiet: true, noColor: true })
  q.print('hidden')
  q.warn('shown')
  assert.equal(lines.at(-1), 'warning  shown\n')
  assert.equal(lines.length, 2)
})

test('README.txt and help: plain words, the app address and the audit command; versions agree', () => {
  assert.match(README_TEXT, /Do not edit, rename, move or delete this folder/)
  assert.match(README_TEXT, /https:\/\/immutableqc\.com\/app\//)
  assert.match(README_TEXT, /node iqc\.mjs audit "<the data folder>"/)
  assert.ok(README_TEXT.split('\n').every((l) => l.length <= 80), 'README.txt lines fit 80 columns')
  assert.ok(HELP.split('\n').every((l) => l.length <= 100), 'help lines fit 100 columns')
  for (const [k, t] of Object.entries(COMMAND_HELP)) assert.ok(t.split('\n').every((l) => l.length <= 100), `iqc help ${k}: lines fit 100 columns`)
  const pkg = JSON.parse(readFileSync(join(AGENT_DIR, 'package.json'), 'utf8'))
  assert.equal(pkg.version, VERSION)
  assert.equal(AGENT_VERSION, VERSION)
  assert.equal(AGENT, `immutableqc-cli/${VERSION}`)
  assert.equal(pkg.name, 'immutableqc')
  assert.equal(pkg.type, 'module')
  assert.deepEqual(pkg.bin, { iqc: 'bin/iqc.mjs' })
  assert.equal(pkg.private, true)
  assert.equal(pkg.engines.node, '>=22')
  assert.equal(pkg.dependencies, undefined)
  assert.equal(pkg.devDependencies, undefined)
})

test('bundle --stamp: the SHA-256 goes into every element marked data-sha256-of="download/iqc.mjs", and nothing else', () => {
  const sha = 'ab'.repeat(32)
  const html = '<p>SHA-256: <code data-sha256-of="download/iqc.mjs">pending</code></p>\n<code class="x" data-sha256-of="download/iqc.mjs" title="t"></code>' +
    '<input readonly data-sha256-of="download/iqc.mjs" value="old"><input data-sha256-of="download/iqc.mjs"><code data-sha256-of="core/immutableqc.mjs">keep</code><code>keep</code>'
  const { html: out, count } = stampHTML(html, sha)
  assert.equal(count, 4)
  assert.equal(out, `<p>SHA-256: <code data-sha256-of="download/iqc.mjs">${sha}</code></p>\n<code class="x" data-sha256-of="download/iqc.mjs" title="t">${sha}</code>` +
    `<input readonly data-sha256-of="download/iqc.mjs" value="${sha}"><input data-sha256-of="download/iqc.mjs" value="${sha}"><code data-sha256-of="core/immutableqc.mjs">keep</code><code>keep</code>`)
  assert.equal(stampHTML(out, sha).html, out, 'stamping twice changes nothing')
  assert.equal(stampHTML('<p>none</p>', sha).count, 0)
})

test('readLedgerSettled: a last line caught half written is read again while an agent runs, and reported when none does', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'iqc-unit-'))
  try {
    const key = await generateKeyPair()
    const header = await createHeader({ station: 'S', privateKey: key.privateKey, publicKeyHex: await publicKeyHex(key.publicKey) })
    const [rec] = await createRecords({ head: { n: 0, h: header.g }, items: [{ kind: 'session', f: { station: 'S', event: 'scan', at: new Date().toISOString(), agent: AGENT } }], privateKey: key.privateKey })
    const line = serializeLine(rec)
    const file = join(dir, 'ledger.jsonl')
    writeFileSync(file, serializeLine(header) + line.slice(0, 40))
    const none = await readLedgerSettled(file, { agentRunning: () => false })
    assert.equal(none.verified.ok, false)
    assert.equal(none.verified.problems[0].code, 'truncated')
    setTimeout(() => appendFileSync(file, line.slice(40)), 150)
    const later = await readLedgerSettled(file, { agentRunning: () => true, delayMs: 100, tries: 10 })
    assert.equal(later.verified.ok, true)
    assert.equal(later.verified.recordCount, 1)
    assert.equal(await readLedgerSettled(join(dir, 'none.jsonl'), { missingOk: true }), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
