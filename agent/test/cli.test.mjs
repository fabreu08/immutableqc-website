// The agent end to end, as a person runs it: child processes in temporary folders, HOME and USERPROFILE pointed at a
// temporary home. Every test runs against both entries: agent/bin/iqc.mjs and the one-file download/iqc.mjs.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, appendFileSync, rmSync, statSync, symlinkSync, utimesSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { hostname } from 'node:os'
import { spawnSync } from 'node:child_process'
import { ENTRIES, FAST, SETTLE_MS, workspace, put, run, start, records, brief, verified, ledgerFile, ledgerText, sha, wait } from './_helpers.mjs'

const NFD = 'cafe\u0301 notes.txt' // "café notes.txt" written in NFD (e + combining acute)
const NFC = 'caf\u00e9 notes.txt'
const IGNORE = ['--ignore', '*.log', '--ignore', 'cache']

// a data folder with nested folders, unicode names, a path with % and spaces, files the agent skips, and a symlink
function sampleFolder(data) {
  put(join(data, 'a.csv'), 'sample,area\nS-01,1523.4\n')
  put(join(data, 'nested', 'deep', 'b.bin'), Buffer.from([0, 1, 2, 255, 254, 10, 13]))
  put(join(data, NFD), 'unicode\n')
  put(join(data, '50% done', 'run 1.csv'), 'percent and spaces\n')
  put(join(data, '.DS_Store'), 'x')
  put(join(data, 'nested', 'Thumbs.db'), 'x')
  put(join(data, '~$report.docx'), 'x')
  put(join(data, 'scratch.tmp'), 'x')
  put(join(data, 'instrument.log'), 'log\n')
  put(join(data, 'cache', 'c.dat'), 'cache\n')
  let link = false
  try { symlinkSync(join(data, 'a.csv'), join(data, 'link.csv')); link = true } catch { /* no symlinks here */ }
  return { link }
}
const SAMPLE_PATHS = ['50%25 done/run 1.csv', 'a.csv', NFC, 'nested/deep/b.bin']

for (const [name, entry] of ENTRIES) {
  describe(`iqc (${name})`, { concurrency: false }, () => {
    test('seal: the first seal writes a header, a scan and an existing record per file; keys, README.txt, no lock left; audit passes', async () => {
      const W = workspace()
      try {
        const { link } = sampleFolder(W.data)
        const r = await run(entry, ['seal', W.data, '--settle', '0', ...IGNORE], { home: W.home })
        assert.equal(r.code, 0, r.out)
        const recs = records(W.data)
        assert.deepEqual(brief(recs), [['session', 'scan'], ...SAMPLE_PATHS.map((p) => ['file', p, 'existing'])])
        const a = recs.find((x) => x.f.path === 'a.csv')
        assert.equal(a.f.sha256, sha('sample,area\nS-01,1523.4\n'))
        assert.equal(a.f.bytes, String(Buffer.byteLength('sample,area\nS-01,1523.4\n')))
        assert.equal(a.ctx.modifiedAt, new Date(Math.floor(statSync(join(W.data, 'a.csv')).mtimeMs)).toISOString())
        assert.equal(a.f.station, hostname())
        const v = await verified(W.data)
        assert.equal(v.ok, true)
        assert.equal(v.header.ctx.agent, 'immutableqc-cli/0.1.0')
        assert.equal(recs[0].f.agent, 'immutableqc-cli/0.1.0')
        // the key: <home>/.immutableqc/keys/<keyId>.jwk, the folder 0700 and the file 0600
        const keys = join(W.home, '.immutableqc', 'keys')
        assert.deepEqual(readdirSync(keys), [`${v.keyId}.jwk`])
        const jwk = JSON.parse(readFileSync(join(keys, `${v.keyId}.jwk`), 'utf8'))
        assert.equal(jwk.kty, 'EC')
        assert.equal(jwk.kid, v.keyId)
        if (process.platform !== 'win32') {
          assert.equal(statSync(keys).mode & 0o777, 0o700)
          assert.equal(statSync(join(keys, `${v.keyId}.jwk`)).mode & 0o777, 0o600)
        }
        // README.txt in plain words, no lock left behind
        const readme = readFileSync(join(W.data, 'ImmutableQC', 'README.txt'), 'utf8')
        assert.match(readme, /Do not edit, rename, move or delete this folder/)
        assert.match(readme, /https:\/\/immutableqc\.com\/app\//)
        assert.match(readme, /node iqc\.mjs audit/)
        assert.deepEqual(readdirSync(join(W.data, 'ImmutableQC')).sort(), ['README.txt', 'ledger.jsonl'])
        assert.match(r.stdout, /New signing key [0-9a-f]{16}/)
        assert.match(r.stdout, /sealed {3}50% done\/run 1\.csv {2}19 B {2}[0-9a-f]{8}…/)
        if (link) assert.match(r.stderr, /Skipped link\.csv: it is a symbolic link/)
        // a second seal finds nothing new, and audit passes
        const r2 = await run(entry, ['seal', W.data, '--settle', '0', ...IGNORE], { home: W.home })
        assert.equal(r2.code, 0, r2.out)
        assert.match(r2.stdout, /Nothing new to seal: 4 files unchanged/)
        assert.deepEqual(brief(records(W.data)).slice(-1), [['session', 'scan']])
        const au = await run(entry, ['audit', W.data, ...IGNORE], { home: W.home })
        assert.equal(au.code, 0, au.out)
        assert.match(au.stdout, /^PASS {2}All 4 files match their seals, and the ledger is intact/)
      } finally {
        W.cleanup()
      }
    })

    test('watch: added after settle, changed, touched-but-identical not sealed, a growing file sealed once stable, removed, SIGTERM writes watch-stopped', { timeout: 60000 }, async () => {
      const W = workspace()
      let w
      try {
        sampleFolder(W.data)
        assert.equal((await run(entry, ['seal', W.data, '--settle', '0', ...IGNORE], { home: W.home })).code, 0)
        const n0 = records(W.data).length
        w = start(entry, ['watch', W.data, ...FAST, ...IGNORE], { home: W.home })
        await w.waitFor(/Every file found at the start is sealed \(4 files in the ledger\)\. Watching for changes\./)
        assert.deepEqual(brief(records(W.data).slice(n0)), [['session', 'watch-started']], 'watch-started first, and nothing else changed')
        assert.ok(existsSync(join(W.data, 'ImmutableQC', 'agent.lock')))
        const lock = JSON.parse(readFileSync(join(W.data, 'ImmutableQC', 'agent.lock'), 'utf8'))
        assert.equal(lock.pid, w.proc.pid)
        assert.ok(lock.startedAt)

        // a new file: sealed only after it has stayed unchanged for the settle time
        let m = w.mark()
        const t0 = Date.now()
        put(join(W.data, 'new', 'n.csv'), 'new file\n')
        await w.waitFor(/sealed {3}new\/n\.csv/, 10000, m)
        assert.ok(Date.now() - t0 >= SETTLE_MS, 'not before the settle time')
        // a changed file
        m = w.mark()
        appendFileSync(join(W.data, 'a.csv'), 'S-02,1498.0\n')
        await w.waitFor(/changed {2}a\.csv/, 10000, m)
        // a touched file with the same bytes: read again, not sealed again
        const before = records(W.data).length
        const future = new Date(Date.now() + 60000)
        utimesSync(join(W.data, 'nested', 'deep', 'b.bin'), future, future)
        await wait(SETTLE_MS + 900)
        assert.equal(records(W.data).length, before, 'a touched file with the same bytes is not sealed again')
        // a growing file: not sealed while it grows, sealed once (its final bytes) when it stops
        m = w.mark()
        const grow = join(W.data, 'grow.dat')
        let content = ''
        for (let i = 0; i < 14; i++) {
          content += `chunk ${i} `.repeat(50) + '\n'
          writeFileSync(grow, content)
          await wait(100)
          assert.doesNotMatch(w.text().slice(m), /grow\.dat/, `sealed while it was still growing (step ${i})`)
        }
        await w.waitFor(/sealed {3}grow\.dat/, 10000, m)
        const g = records(W.data).filter((x) => x.f.path === 'grow.dat')
        assert.equal(g.length, 1)
        assert.equal(g[0].f.sha256, sha(content))
        // a removed file
        m = w.mark()
        rmSync(join(W.data, 'new', 'n.csv'))
        await w.waitFor(/removed {2}new\/n\.csv/, 10000, m)
        // SIGTERM: watch-stopped, exit 0, the lock removed, a summary
        const end = await w.stop('SIGTERM')
        assert.equal(end.code, 0, w.text())
        assert.match(w.text(), /Stopped after .*: 2 sealed, 1 changed, 1 removed\. Head \d+:[0-9a-f]{64}/)
        assert.ok(!existsSync(join(W.data, 'ImmutableQC', 'agent.lock')), 'the lock is removed on exit')
        const recs = records(W.data).slice(n0)
        assert.deepEqual(brief(recs), [['session', 'watch-started'], ['file', 'new/n.csv', 'added'], ['file', 'a.csv', 'changed'], ['file', 'grow.dat', 'added'], ['file-removed', 'new/n.csv', 'removed'], ['session', 'watch-stopped']])
        const v = await verified(W.data)
        assert.equal(v.ok, true)
        assert.deepEqual(v.sessions.at(-1).clean, true)
        // a.csv changed and new/n.csv removed while watched: recorded changes, so the audit is review (exit 3)
        const au = await run(entry, ['audit', W.data, ...IGNORE], { home: W.home })
        assert.equal(au.code, 3, au.out)
        assert.match(au.out, /REVIEW {2}1 file was changed after it was first sealed and 1 file was removed\. Each change is recorded\./)
      } finally {
        if (w) await w.stop('SIGKILL')
        W.cleanup()
      }
    })

    test('restart: seal and a later watch find what changed while nothing watched (-unwatched); SIGINT stops a watch cleanly', { timeout: 60000 }, async () => {
      const W = workspace()
      let w
      try {
        sampleFolder(W.data)
        assert.equal((await run(entry, ['seal', W.data, '--settle', '0', ...IGNORE], { home: W.home })).code, 0)
        // while nothing watches: one file added, one changed, one removed
        put(join(W.data, 'late.csv'), 'late\n')
        appendFileSync(join(W.data, 'a.csv'), 'more\n')
        rmSync(join(W.data, '50% done', 'run 1.csv'))
        const n0 = records(W.data).length
        const r = await run(entry, ['seal', W.data, '--settle', '0.2', ...IGNORE], { home: W.home })
        assert.equal(r.code, 0, r.out)
        assert.deepEqual(brief(records(W.data).slice(n0)), [['session', 'scan'], ['file-removed', '50%25 done/run 1.csv', 'removed-unwatched'], ['file', 'a.csv', 'changed-unwatched'], ['file', 'late.csv', 'added-unwatched']])
        assert.match(r.stdout, /Sealed 1 new, 1 changed, 1 removed; 2 unchanged/)
        assert.match(r.stdout, /\(while nothing was watching\)/)
        // and the same at the start of a watch
        put(join(W.data, 'later.csv'), 'later\n')
        rmSync(join(W.data, 'late.csv'))
        const n1 = records(W.data).length
        w = start(entry, ['watch', W.data, ...FAST, ...IGNORE], { home: W.home })
        await w.waitFor(/sealed {3}later\.csv/)
        const end = await w.stop('SIGINT')
        assert.equal(end.code, 0, w.text())
        assert.deepEqual(brief(records(W.data).slice(n1)), [['session', 'watch-started'], ['file-removed', 'late.csv', 'removed-unwatched'], ['file', 'later.csv', 'added-unwatched'], ['session', 'watch-stopped']])
        // status sees nothing changed; audit passes with notes
        const st = await run(entry, ['status', W.data, ...IGNORE], { home: W.home })
        assert.equal(st.code, 0, st.out)
        assert.match(st.stdout, /Nothing changed since the last seal/)
        assert.match(st.stdout, /Agent {4}not running/)
        assert.match(st.stdout, /Last {5}watch started .* stopped/)
      } finally {
        if (w) await w.stop('SIGKILL')
        W.cleanup()
      }
    })

    test('seal waits for a file that is still being written, and seals its final bytes', { timeout: 30000 }, async () => {
      const W = workspace()
      try {
        put(join(W.data, 'a.csv'), 'a\n')
        const grow = join(W.data, 'grow.dat')
        let content = ''
        let writing = true
        const writer = (async () => { for (let i = 0; i < 12 && writing; i++) { content += `${i},`.repeat(100) + '\n'; writeFileSync(grow, content); await wait(100) } })()
        await wait(150)
        const r = await run(entry, ['seal', W.data, '--interval', '0.1', '--settle', '0.5'], { home: W.home })
        writing = false
        await writer
        assert.equal(r.code, 0, r.out)
        const g = records(W.data).filter((x) => x.f.path === 'grow.dat')
        assert.equal(g.length, 1)
        assert.equal(g[0].f.sha256, sha(readFileSync(grow)))
      } finally {
        W.cleanup()
      }
    })

    test('lock: a second agent is refused; a stale lock is taken over with a warning; a lock from another computer is left alone', { timeout: 60000 }, async () => {
      const W = workspace()
      let w
      try {
        put(join(W.data, 'a.csv'), 'a\n')
        w = start(entry, ['watch', W.data, ...FAST], { home: W.home })
        await w.waitFor(/sealed {3}a\.csv/)
        assert.deepEqual(brief(records(W.data)), [['session', 'watch-started'], ['file', 'a.csv', 'existing']], 'a watch on a new ledger: its first scan is existing')
        const before = ledgerText(W.data)
        for (const cmd of ['seal', 'watch']) {
          const r = await run(entry, [cmd, W.data, ...FAST], { home: W.home })
          assert.equal(r.code, 1, r.out)
          assert.match(r.stderr, new RegExp(`Another agent is already sealing this ledger \\(pid ${w.proc.pid} on `))
        }
        assert.equal(ledgerText(W.data), before, 'the refused agent wrote nothing')
        const st = await run(entry, ['status', W.data], { home: W.home })
        assert.match(st.stdout, new RegExp(`Agent {4}running \\(pid ${w.proc.pid}`))
        assert.equal((await w.stop()).code, 0)
        // a stale lock: a process that has ended, on this computer
        const gone = spawnSync(process.execPath, ['-e', '']).pid
        const lockFile = join(W.data, 'ImmutableQC', 'agent.lock')
        writeFileSync(lockFile, JSON.stringify({ pid: gone, host: hostname(), startedAt: '2026-10-01T08:00:00.000Z', command: 'watch' }) + '\n')
        const st2 = await run(entry, ['status', W.data], { home: W.home })
        assert.match(st2.stdout, /Agent {4}not running \(a stale lock is left/)
        const r = await run(entry, ['seal', W.data, '--settle', '0'], { home: W.home })
        assert.equal(r.code, 0, r.out)
        assert.match(r.stderr, new RegExp(`Took over a stale lock: the agent that held it \\(pid ${gone} on `))
        assert.ok(!existsSync(lockFile))
        // a lock from another computer
        writeFileSync(lockFile, JSON.stringify({ pid: 1, host: 'another-computer', startedAt: '2026-10-01T08:00:00.000Z', command: 'watch' }) + '\n')
        const r2 = await run(entry, ['seal', W.data, '--settle', '0'], { home: W.home })
        assert.equal(r2.code, 1, r2.out)
        assert.match(r2.stderr, /An agent on another computer holds this ledger's lock \(pid 1 on another-computer/)
        assert.ok(existsSync(lockFile), 'left alone')
      } finally {
        if (w) await w.stop('SIGKILL')
        W.cleanup()
      }
    })

    test('a broken ledger is refused, never extended or repaired; head and status say so; audit fails; a deleted ledger is not replaced silently', async () => {
      const W = workspace()
      try {
        put(join(W.data, 'a.csv'), 'a\n')
        put(join(W.data, 'b.csv'), 'b\n')
        assert.equal((await run(entry, ['seal', W.data, '--settle', '0'], { home: W.home })).code, 0)
        const lines = ledgerText(W.data).split('\n')
        const o = JSON.parse(lines[2])
        o.f.bytes = '3' // record 2: a.csv's size edited
        lines[2] = JSON.stringify(o)
        const broken = lines.join('\n')
        writeFileSync(ledgerFile(W.data), broken)
        put(join(W.data, 'c.csv'), 'c\n')
        for (const args of [['seal', W.data, '--settle', '0'], ['watch', W.data, ...FAST]]) {
          const r = await run(entry, args, { home: W.home, timeout: 15000 })
          assert.equal(r.code, 1, r.out)
          assert.match(r.stderr, /does not verify: it has \d+ problems?/)
          assert.match(r.stderr, /Line 3 \(record 2\): the file fingerprint does not match its sealed fields/)
          assert.match(r.stderr, /never extended or repaired\. Run iqc audit/)
          assert.equal(ledgerText(W.data), broken, 'not one byte written')
          assert.ok(!existsSync(join(W.data, 'ImmutableQC', 'agent.lock')))
        }
        const h = await run(entry, ['head', W.data], { home: W.home })
        assert.equal(h.code, 1)
        assert.equal(h.stdout, '')
        assert.match(h.stderr, /No head is printed/)
        const st = await run(entry, ['status', W.data], { home: W.home })
        assert.equal(st.code, 1)
        assert.match(st.stdout, /does not verify/)
        const au = await run(entry, ['audit', W.data], { home: W.home })
        assert.equal(au.code, 1)
        assert.match(au.stdout, /^FAIL {2}The ledger has \d+ problems?/)
        // a cut-off last line (no newline) is refused the same way
        writeFileSync(ledgerFile(W.data), lines.slice(0, 3).join('\n'))
        const r = await run(entry, ['seal', W.data, '--settle', '0'], { home: W.home })
        assert.equal(r.code, 1)
        assert.match(r.stderr, /does not end with a newline/)
        // a deleted ledger is not replaced silently: README.txt shows the folder had one
        rmSync(ledgerFile(W.data))
        const gone = await run(entry, ['seal', W.data, '--settle', '0'], { home: W.home })
        assert.equal(gone.code, 1, gone.out)
        assert.match(gone.stderr, /There is no ledger at .*ledger\.jsonl, but its folder was set up before .*moved, renamed or deleted\. Nothing was written\./)
        assert.ok(!existsSync(ledgerFile(W.data)))
        rmSync(join(W.data, 'ImmutableQC', 'README.txt'))
        const fresh = await run(entry, ['seal', W.data, '--settle', '0'], { home: W.home })
        assert.equal(fresh.code, 0, fresh.out)
        assert.match(fresh.stdout, /New ledger/)
        assert.ok(existsSync(join(W.data, 'ImmutableQC', 'README.txt')))
      } finally {
        W.cleanup()
      }
    })

    test('a missing key or another ledger\'s key is refused, and nothing is written', async () => {
      const W = workspace()
      try {
        put(join(W.data, 'a.csv'), 'a\n')
        assert.equal((await run(entry, ['seal', W.data, '--settle', '0'], { home: W.home })).code, 0)
        put(join(W.data, 'b.csv'), 'b\n')
        const before = ledgerText(W.data)
        const keyId = (await verified(W.data)).keyId
        const otherHome = join(W.dir, 'other-home')
        mkdirSync(otherHome)
        const r = await run(entry, ['seal', W.data, '--settle', '0'], { home: otherHome })
        assert.equal(r.code, 1, r.out)
        assert.match(r.stderr, new RegExp(`signing key \\(key id ${keyId}\\) is not on this computer`))
        assert.match(r.stderr, /--key <file>/)
        assert.equal(ledgerText(W.data), before)
        // another ledger's key, given with --key
        const other = join(W.dir, 'other-data')
        put(join(other, 'x.csv'), 'x\n')
        assert.equal((await run(entry, ['seal', other, '--settle', '0'], { home: otherHome })).code, 0)
        const otherKey = join(otherHome, '.immutableqc', 'keys', readdirSync(join(otherHome, '.immutableqc', 'keys'))[0])
        const r2 = await run(entry, ['seal', W.data, '--settle', '0', '--key', otherKey], { home: W.home })
        assert.equal(r2.code, 1, r2.out)
        assert.match(r2.stderr, /is not this ledger's key/)
        assert.equal(ledgerText(W.data), before)
        // the right key given with --key works from anywhere
        const own = join(W.home, '.immutableqc', 'keys', `${keyId}.jwk`)
        const r3 = await run(entry, ['seal', W.data, '--settle', '0', '--key', own], { home: otherHome })
        assert.equal(r3.code, 0, r3.out)
        assert.match(r3.stdout, /sealed {3}b\.csv/)
        // auditing needs no key
        assert.equal((await run(entry, ['audit', W.data], { home: otherHome })).code, 0)
      } finally {
        W.cleanup()
      }
    })

    test('audit: exit codes 0, 1 and 2, --json and --report, --expect-head and --expect-key, --strict', async () => {
      const W = workspace()
      try {
        put(join(W.data, 'run', 'a.csv'), 'a\n')
        put(join(W.data, 'run', 'b.csv'), 'b\n')
        assert.equal((await run(entry, ['seal', W.data, '--settle', '0'], { home: W.home })).code, 0)
        const head = (await run(entry, ['head', W.data], { home: W.home })).stdout.trim()
        const v = await verified(W.data)
        assert.equal(head, `${v.head.n}:${v.head.h}`)
        const keyId = v.keyId
        const json = join(W.dir, 'audit.json'), html = join(W.dir, 'audit.html')
        const pass = await run(entry, ['audit', W.data, '--json', json, '--report', html, '--expect-head', head, '--expect-key', keyId], { home: W.home })
        assert.equal(pass.code, 0, pass.out)
        const rep = JSON.parse(readFileSync(json, 'utf8'))
        assert.equal(rep.format, 'immutableqc-audit')
        assert.equal(rep.version, 1)
        assert.equal(rep.verdict, 'pass')
        assert.equal(rep.counts.match, 2)
        assert.equal(rep.expectations.head.ok, true)
        assert.equal(rep.expectations.keyId.ok, true)
        assert.equal(rep.method.tool, 'immutableqc-cli/0.1.0')
        assert.equal(rep.method.where, 'on the command line')
        const page = readFileSync(html, 'utf8')
        assert.match(page, /^<!doctype html>/)
        assert.match(page, /<span class="word">Pass<\/span>/)
        assert.doesNotMatch(page, /<script/i)
        // --json - writes the JSON alone on the standard output
        const piped = await run(entry, ['audit', W.data, '--json', '-'], { home: W.home })
        assert.equal(piped.code, 0)
        assert.equal(JSON.parse(piped.stdout).verdict, 'pass')
        assert.match(piped.stderr, /^PASS/)
        // a head that has grown since still passes
        put(join(W.data, 'run', 'c.csv'), 'c\n')
        assert.equal((await run(entry, ['seal', W.data, '--settle', '0'], { home: W.home })).code, 0)
        const grown = await run(entry, ['audit', W.data, '--expect-head', head], { home: W.home })
        assert.equal(grown.code, 0, grown.out)
        // a wrong head, a wrong key: fail
        const wrongHead = `${v.head.n}:${'0'.repeat(64)}`
        const f1 = await run(entry, ['audit', W.data, '--expect-head', wrongHead, '--json', json], { home: W.home })
        assert.equal(f1.code, 1, f1.out)
        assert.equal(JSON.parse(readFileSync(json, 'utf8')).expectations.head.ok, false)
        assert.match(f1.stdout, /^FAIL {2}The pinned head does not match\./)
        const f2 = await run(entry, ['audit', W.data, '--expect-key', 'ffffffffffffffff'], { home: W.home })
        assert.equal(f2.code, 1)
        assert.match(f2.stdout, /^FAIL {2}The key id is not the expected one\./)
        // a changed file and a missing file: fail, with the report saying which
        writeFileSync(join(W.data, 'run', 'a.csv'), 'A\n')
        rmSync(join(W.data, 'run', 'b.csv'))
        const f3 = await run(entry, ['audit', W.data, '--report', html, '--json', json], { home: W.home })
        assert.equal(f3.code, 1, f3.out)
        assert.match(f3.stdout, /^FAIL {2}1 file changed since it was sealed and 1 file is missing\./)
        assert.match(f3.stdout, /run\/a\.csv changed since it was sealed in record \d+/)
        assert.match(f3.stdout, /run\/b\.csv is missing/)
        assert.match(readFileSync(html, 'utf8'), /<span class="word">Fail<\/span>/)
        assert.deepEqual(JSON.parse(readFileSync(json, 'utf8')).files.map((f) => [f.path, f.state]), [['run/a.csv', 'changed'], ['run/b.csv', 'missing'], ['run/c.csv', 'match']])
        // --quiet: a fail still prints its verdict; a pass prints nothing
        const q = await run(entry, ['audit', W.data, '--quiet'], { home: W.home })
        assert.equal(q.code, 1)
        assert.match(q.stdout, /^FAIL/)
        // put them back: pass, with a note; --strict turns the note into a failure
        writeFileSync(join(W.data, 'run', 'a.csv'), 'a\n')
        put(join(W.data, 'run', 'b.csv'), 'b\n')
        put(join(W.data, 'run', 'unsealed.csv'), 'u\n')
        const q2 = await run(entry, ['audit', W.data, '--quiet'], { home: W.home })
        assert.equal(q2.code, 0)
        assert.equal(q2.stdout + q2.stderr, '')
        const s = await run(entry, ['audit', W.data, '--strict'], { home: W.home })
        assert.equal(s.code, 1, s.out)
        assert.match(s.stdout, /Notes \(failures in strict mode\)/)
        assert.match(s.stdout, /run\/unsealed\.csv/)
        // usage and read errors: 2
        for (const args of [['audit', join(W.dir, 'nope')], ['audit', W.dir], ['audit', W.data, '--expect-head', 'twelve'], ['audit', W.data, '--expect-key', 'xyz'], ['audit', W.data, '--bogus'], ['audit', W.data, '--report', join(W.dir, 'no-such-folder', 'r.html')], ['audit', W.data, W.dir]]) {
          const r = await run(entry, args, { home: W.home })
          assert.equal(r.code, 2, `${args.join(' ')}: ${r.out}`)
          assert.match(r.stderr, /^error {2}/)
          assert.doesNotMatch(r.stderr, /\n\s+at /, 'no stack trace')
        }
      } finally {
        W.cleanup()
      }
    })

    test('ignore patterns and nested folders: default ignores, --ignore on files and folders, a ledger kept elsewhere with --ledger', async () => {
      const W = workspace()
      try {
        put(join(W.data, 'keep', 'deep', 'deeper', 'x.csv'), 'x\n')
        put(join(W.data, 'keep', 'out.bak'), 'bak\n')
        put(join(W.data, 'skipme', 'y.csv'), 'y\n')
        put(join(W.data, 'Keep', 'desktop.ini'), 'ini\n')
        const ledger = join(W.dir, 'elsewhere', 'lab.jsonl')
        mkdirSync(join(W.dir, 'elsewhere'))
        const r = await run(entry, ['seal', W.data, '--settle', '0', '--ignore', '*.BAK', '--ignore', 'skipme', '--ledger', ledger], { home: W.home })
        assert.equal(r.code, 0, r.out)
        const recs = readFileSync(ledger, 'utf8').split('\n').filter(Boolean).slice(1).map((l) => JSON.parse(l))
        assert.deepEqual(brief(recs), [['session', 'scan'], ['file', 'keep/deep/deeper/x.csv', 'existing']])
        assert.ok(!existsSync(join(W.data, 'ImmutableQC')), 'no ImmutableQC folder when the ledger is elsewhere')
        assert.ok(!existsSync(ledger + '.lock'))
        const au = await run(entry, ['audit', W.data, '--ledger', ledger, '--ignore', '*.bak', '--ignore', 'skipme'], { home: W.home })
        assert.equal(au.code, 0, au.out)
        // a ledger inside the data folder, not in ImmutableQC/: it and its lock are never sealed
        const inside = join(W.data, 'ledgers', 'l.jsonl')
        const r2 = await run(entry, ['seal', W.data, '--settle', '0', '--ledger', inside], { home: W.home })
        assert.equal(r2.code, 0, r2.out)
        const r3 = await run(entry, ['seal', W.data, '--settle', '0', '--ledger', inside], { home: W.home })
        assert.match(r3.stdout, /Nothing new to seal/)
      } finally {
        W.cleanup()
      }
    })

    test('two names that differ only in Unicode form are not sealed (warned); an NFD name alone is sealed as NFC', { skip: process.platform === 'darwin' && 'macOS folders keep one Unicode form' }, async () => {
      const W = workspace()
      try {
        put(join(W.data, NFD), 'nfd\n')
        put(join(W.data, NFC), 'nfc\n')
        put(join(W.data, 'ok.csv'), 'ok\n')
        const twoForms = readdirSync(W.data).length === 3
        const r = await run(entry, ['seal', W.data, '--settle', '0'], { home: W.home })
        assert.equal(r.code, 0, r.out)
        if (twoForms) {
          assert.match(r.stderr, /Not sealed: 2 files are named café notes\.txt, written in different Unicode forms/)
          assert.deepEqual(brief(records(W.data)), [['session', 'scan'], ['file', 'ok.csv', 'existing']])
          const au = await run(entry, ['audit', W.data], { home: W.home })
          assert.equal(au.code, 0, au.out)
          assert.match(au.stderr, /Not checked: more than one file is named café notes\.txt/)
        }
      } finally {
        W.cleanup()
      }
    })

    test('usage: help, --version, unknown command or option, a folder that is a file or the ledger folder itself', async () => {
      const W = workspace()
      try {
        const v = await run(entry, ['--version'], { home: W.home })
        assert.equal(v.code, 0)
        assert.equal(v.stdout, 'iqc 0.1.0\n')
        const h = await run(entry, ['help'], { home: W.home })
        assert.equal(h.code, 0)
        for (const c of ['watch', 'seal', 'audit', 'head', 'status', '--expect-head', '--ignore', 'NO_COLOR']) assert.ok(h.stdout.includes(c), c)
        const hw = await run(entry, ['watch', '--help'], { home: W.home })
        assert.match(hw.stdout, /^iqc watch \[folder\]/)
        assert.equal((await run(entry, [], { home: W.home })).code, 0)
        put(join(W.data, 'a.csv'), 'a\n')
        assert.equal((await run(entry, ['seal', W.data, '--settle', '0'], { home: W.home })).code, 0)
        const cases = [
          [['frobnicate'], /Unknown command "frobnicate"/],
          [['seal', W.data, '--frob'], /Unknown option --frob/],
          [['seal', W.data, '--interval', 'soon'], /--interval takes a number of seconds/],
          [['seal', W.data, '--station', 'a|b'], /--station "a\|b" cannot be used/],
          [['seal', W.data, '--json', 'x.json'], /--json is an option of iqc audit/],
          [['seal', join(W.data, 'a.csv')], /is a file, not a folder/],
          [['seal', join(W.data, 'ImmutableQC')], /is the ledger's own folder/],
          [['seal', 'D:\\My', 'Results'], /takes one folder, but got 2/],
          [['head', join(W.dir, 'none')], /No folder at/],
          [['head', W.dir], /No ledger at/],
        ]
        for (const [args, re] of cases) {
          const r = await run(entry, args, { home: W.home })
          assert.equal(r.code, 2, `${args.join(' ')}: ${r.out}`)
          assert.match(r.stderr, re)
        }
        // the folder defaults to the current folder
        const st = await run(entry, ['status'], { home: W.home, cwd: W.data })
        assert.equal(st.code, 0, st.out)
        assert.match(st.stdout, /Ledger {3}ImmutableQC\/ledger\.jsonl: intact/)
        // --station and the colors: plain text with NO_COLOR
        put(join(W.data, 'b.csv'), 'b\n')
        const s = await run(entry, ['seal', '--station', 'Plate reader 2', '--settle', '0'], { home: W.home, cwd: W.data })
        assert.equal(s.code, 0)
        assert.equal(records(W.data).at(-1).f.station, 'Plate reader 2')
        assert.doesNotMatch(s.stdout, /\x1b\[/)
        // --quiet prints nothing when all is well
        put(join(W.data, 'c.csv'), 'c\n')
        const q = await run(entry, ['seal', W.data, '--settle', '0', '--quiet'], { home: W.home })
        assert.equal(q.code, 0)
        assert.equal(q.stdout + q.stderr, '')
      } finally {
        W.cleanup()
      }
    })
  })
}
