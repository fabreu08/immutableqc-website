// Shared helpers for the agent tests (not a test file itself). Every end-to-end test runs the CLI as a child process
// in a temporary folder, with HOME and USERPROFILE pointed at a temporary home (so keys go to <home>/.immutableqc/keys),
// against both entries: the sources (agent/bin/iqc.mjs) and the one-file download (download/iqc.mjs).
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { verifyLedger } from '../../core/immutableqc.mjs'

export const AGENT = dirname(dirname(fileURLToPath(import.meta.url)))
export const REPO = dirname(AGENT)
export const ENTRIES = [
  ['agent/bin/iqc.mjs', join(AGENT, 'bin', 'iqc.mjs')],
  ['download/iqc.mjs', join(REPO, 'download', 'iqc.mjs')],
]
// fast timing for tests: scan every 0.1 s, seal after 0.4 s without change
export const FAST = ['--interval', '0.1', '--settle', '0.4']
export const SETTLE_MS = 400

export const sha = (b) => createHash('sha256').update(b).digest('hex')
export const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// a temporary workspace: {dir, home, data, cleanup()}
export function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'iqc-agent-test-'))
  const home = join(dir, 'home'), data = join(dir, 'data')
  mkdirSync(home)
  mkdirSync(data)
  return { dir, home, data, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

export function put(file, content) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

export const envFor = (home, extra = {}) => {
  const env = { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1', ...extra }
  delete env.IQC_DEBUG
  delete env.FORCE_COLOR
  return env
}

// runs the CLI to completion: {code, signal, stdout, stderr, out (both)}
export function run(entry, args, { home, cwd, env, timeout = 60000, input } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [entry, ...args], { cwd: cwd || home, env: env || envFor(home), stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    p.stdout.on('data', (d) => { stdout += d })
    p.stderr.on('data', (d) => { stderr += d })
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`timed out: ${args.join(' ')}\n${stdout}\n${stderr}`)) }, timeout)
    p.on('error', reject)
    p.on('close', (code, signal) => { clearTimeout(t); resolve({ code, signal, stdout, stderr, out: stdout + stderr }) })
    if (input !== undefined) p.stdin.end(input)
    else p.stdin.end()
  })
}

// starts a long-running CLI (iqc watch): {proc, text(), waitFor(re, ms), stop(signal) -> {code, signal}}
export function start(entry, args, { home, cwd, env } = {}) {
  const proc = spawn(process.execPath, [entry, ...args], { cwd: cwd || home, env: env || envFor(home), stdio: ['ignore', 'pipe', 'pipe'] })
  let all = ''
  const waiters = new Set()
  const check = () => { for (const w of [...waiters]) if (w.re.test(all.slice(w.from))) { waiters.delete(w); clearTimeout(w.t); w.resolve(all) } }
  proc.stdout.on('data', (d) => { all += d; check() })
  proc.stderr.on('data', (d) => { all += d; check() })
  const closed = new Promise((resolve) => proc.on('close', (code, signal) => resolve({ code, signal })))
  return {
    proc,
    closed,
    text: () => all,
    mark: () => all.length,
    waitFor(re, ms = 15000, from = 0) {
      return new Promise((resolve, reject) => {
        const w = { re, from, resolve, t: null }
        w.t = setTimeout(() => { waiters.delete(w); reject(new Error(`waited ${ms} ms for ${re}; output so far:\n${all}`)) }, ms)
        waiters.add(w)
        check()
        closed.then(() => { if (waiters.has(w)) { waiters.delete(w); clearTimeout(w.t); reject(new Error(`the process ended before ${re}; output:\n${all}`)) } })
      })
    },
    async stop(signal = 'SIGTERM') {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill(signal)
      return closed
    },
  }
}

export const ledgerFile = (data) => join(data, 'ImmutableQC', 'ledger.jsonl')
export const ledgerText = (data) => readFileSync(ledgerFile(data), 'utf8')
export const records = (data) => ledgerText(data).split('\n').filter(Boolean).slice(1).map((l) => JSON.parse(l))
export const brief = (recs) => recs.map((r) => (r.kind === 'session' ? ['session', r.f.event] : [r.kind, r.f.path, r.f.event]))
export async function verified(data) {
  return verifyLedger(readFileSync(ledgerFile(data)))
}
export const exists = existsSync
