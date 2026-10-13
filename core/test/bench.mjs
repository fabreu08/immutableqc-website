// Timing of the core on a large ledger: node core/test/bench.mjs --run [records] (default 100000).
// Builds a ledger of that many file records (one watch session around them), then times verifyLedger, audit with a
// file map of the same size, and renderReportHTML. Prints one line per step. Without --run it only prints its usage
// (so a bare `node --test`, which runs every .mjs file under test/, does not start it).
import { createHash } from 'node:crypto'
import * as IQC from '../immutableqc.mjs'

export async function bench(count, log = console.log) {
  const sha = (s) => createHash('sha256').update(s).digest('hex')
  const T = (i) => new Date(Date.UTC(2026, 9, 1) + i).toISOString()
  const kp = await IQC.generateKeyPair()
  const pk = await IQC.publicKeyHex(kp.publicKey)
  let t = performance.now()
  const header = await IQC.createHeader({ station: 'BENCH-PC', privateKey: kp.privateKey, publicKeyHex: pk, createdAt: T(0) })
  const items = [{ kind: 'session', f: { station: 'BENCH-PC', event: 'watch-started', at: T(1), agent: 'immutableqc-cli/0.1.0' } }]
  const files = new Map()
  for (let i = 0; i < count - 2; i++) {
    const path = `run-${String(Math.floor(i / 96)).padStart(4, '0')}/well-${String(i % 96).padStart(2, '0')}.csv`
    const s = sha(`content ${i}`)
    items.push({ kind: 'file', f: { station: 'BENCH-PC', path, sha256: s, bytes: String(1000 + (i % 5000)), observedAt: T(2 + i), event: 'existing' } })
    files.set(path, { sha256: s, bytes: 1000 + (i % 5000) })
  }
  items.push({ kind: 'session', f: { station: 'BENCH-PC', event: 'watch-stopped', at: T(count + 5), agent: 'immutableqc-cli/0.1.0' } })
  const records = await IQC.createRecords({ head: { n: 0, h: header.g }, items, privateKey: kp.privateKey, concurrency: 64 })
  const text = [header, ...records].map((o) => IQC.serializeLine(o)).join('')
  const out = { records: records.length, ledgerBytes: text.length }
  out.buildMs = performance.now() - t
  t = performance.now()
  const v = await IQC.verifyLedger(text)
  out.verifyMs = performance.now() - t
  if (!v.ok || v.goodCount !== records.length) throw new Error('the bench ledger does not verify')
  t = performance.now()
  const a = IQC.audit(v, files)
  out.auditMs = performance.now() - t
  if (a.verdict !== 'pass' || a.counts.match !== files.size) throw new Error('the bench audit does not pass')
  t = performance.now()
  const html = IQC.renderReportHTML(a)
  out.reportMs = performance.now() - t
  out.reportBytes = html.length
  log(`records ${IQC.formatCount(out.records)} (ledger ${IQC.formatBytes(out.ledgerBytes)}): build and sign ${(out.buildMs / 1000).toFixed(2)} s, verifyLedger ${(out.verifyMs / 1000).toFixed(2)} s, audit ${(out.auditMs / 1000).toFixed(2)} s, report HTML ${(out.reportMs / 1000).toFixed(2)} s (${IQC.formatBytes(out.reportBytes)})`)
  return out
}

const self = new URL(import.meta.url).pathname
if (process.argv[1] && decodeURIComponent(self) === process.argv[1]) {
  if (process.argv[2] !== '--run') console.log('usage: node core/test/bench.mjs --run [records]')
  else await bench(Number(process.argv[3]) || 100000)
}
