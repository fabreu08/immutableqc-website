// download/iqc.mjs: up to date with its sources, valid as one file, and with no way to reach a network.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildBundle, OUT, ALLOWED_BUILTINS } from '../tools/bundle.mjs'
import { REPO, AGENT } from './_helpers.mjs'

const bundle = () => readFileSync(OUT, 'utf8')
// the code without its comment lines, for the greps below (strings stay: a module name is a string)
const code = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')

test('bundle: node agent/tools/bundle.mjs --check passes (download/iqc.mjs is up to date)', () => {
  const r = spawnSync(process.execPath, [join(AGENT, 'tools', 'bundle.mjs'), '--check'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /download\/iqc\.mjs is up to date \(SHA-256 [0-9a-f]{64}\)/)
  assert.equal(bundle(), buildBundle())
})

test('bundle: one file with a shebang and the header; core inlined in its own scope; valid ES module code', () => {
  const b = bundle()
  assert.ok(b.startsWith('#!/usr/bin/env node\n// iqc.mjs: the Immutable QC agent (iqc), version 0.1.0, in one file.'))
  assert.match(b, /The SHA-256 of this file is printed on immutableqc\.com/)
  assert.match(b, /^const __core = \(\(\) => \{$/m)
  assert.doesNotMatch(b, /^export\b/m, 'no export left (the file is a program, not a module to import)')
  assert.doesNotMatch(b, /from ['"]\.\.?\//, 'no relative import: everything is inlined')
  assert.ok(b.includes(readFileSync(join(REPO, 'core', 'immutableqc.mjs'), 'utf8').split('\n').filter((l) => !/^export /.test(l)).slice(0, 60).join('\n')), 'core is inlined as written')
  const r = spawnSync(process.execPath, ['--check', OUT], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const v = spawnSync(process.execPath, [OUT, '--version'], { encoding: 'utf8' })
  assert.equal(v.stdout, 'iqc 0.1.0\n')
  // every agent source module is in it
  for (const f of readdirSync(join(AGENT, 'src'))) assert.ok(b.includes(`// ---------------------------------------------------------------------------------------------- agent/src/${f}\n`), f)
})

test('bundle: no network API: no fetch, no http, https, http2, net, tls, dgram or dns module, no child processes, no dynamic import', () => {
  const b = code(bundle())
  const specs = [...b.matchAll(/^import\s.*?from\s+(['"])([^'"]+)\1/gm)].map((m) => m[2])
  assert.ok(specs.length > 0)
  for (const s of specs) assert.ok(ALLOWED_BUILTINS.includes(s), `imports ${s}`)
  for (const s of ALLOWED_BUILTINS) assert.ok(!/^node:(?:https?|http2|net|tls|dgram|dns|child_process|worker_threads|cluster|inspector)\b/.test(s))
  const banned = [
    /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bEventSource\b/, /\bsendBeacon\b/, /\bRTCPeerConnection\b/, /\bWebTransport\b/,
    /['"](?:node:)?(?:https?|http2|net|tls|dgram|dns|dns\/promises|child_process|undici)['"]/, /\brequire\s*\(/, /\bimport\s*\(/, /\bcreateRequire\b/,
    /\bprocess\.binding\b/, /\bnew\s+Worker\b/, /\bdlopen\b/, /\bcreateConnection\b/, /\bcreateServer\b/, /\bconnect\s*\(/, /\blookup\s*\(/, /\bresolve4\b/,
  ]
  for (const re of banned) assert.doesNotMatch(b, re, `the bundle matches ${re}`)
})
