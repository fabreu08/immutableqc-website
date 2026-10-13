import test from 'node:test'
import assert from 'node:assert/strict'
import { bench } from './bench.mjs'

// a small run of the 100,000-record bench (node core/test/bench.mjs --run), so the script stays working
test('bench: a 3,000-record ledger builds, verifies, audits and renders', async () => {
  const lines = []
  const r = await bench(3000, (s) => lines.push(s))
  assert.equal(r.records, 3000)
  assert.ok(r.verifyMs > 0 && r.reportBytes > 0)
  assert.match(lines[0], /^records 3,000 /)
})
