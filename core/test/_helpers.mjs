// Shared helpers for the core tests (not a test file itself).
import { createHash } from 'node:crypto'
import * as IQC from '../immutableqc.mjs'

export const sha = (b) => createHash('sha256').update(b).digest('hex')
export const T = (i) => new Date(Date.UTC(2026, 9, 1, 8, 0, 0) + i * 1000).toISOString()
export const STATION = 'HPLC-PC-01'
export const AGENT = 'immutableqc-cli/0.1.0'

let _key = null
export function testKey() {
  if (!_key) _key = IQC.generateKeyPair({ extractable: true })
  return _key
}

export const joinLines = (lines) => lines.map((l) => l + '\n').join('')

// a file record's sealed fields for `content`
export const fileF = (path, content, event, i, station = STATION) => ({ station, path, sha256: sha(content), bytes: String(Buffer.byteLength(content)), observedAt: T(i), event })
export const fileItem = (path, content, event, i) => ({ kind: 'file', f: fileF(path, content, event, i) })
export const removedItem = (path, event, i) => ({ kind: 'file-removed', f: { station: STATION, path, observedAt: T(i), event } })
export const sessionItem = (event, i) => ({ kind: 'session', f: { station: STATION, event, at: T(i), agent: AGENT } })
export const readingItem = (value, capturedAt = '2026-10-01T08:15:00Z') => ({ kind: 'reading', f: { instrumentId: 'LC-02', sensorType: 'peak-area', value, unit: 'mAU*s', capturedAt } })

export async function build(items, { key, station = STATION, createdAt = T(0), ledgerId = 'ab'.repeat(16) } = {}) {
  key = key || (await testKey())
  const pk = await IQC.publicKeyHex(key.publicKey)
  const header = await IQC.createHeader({ station, privateKey: key.privateKey, publicKeyHex: pk, agent: 'immutableqc-test/0.1.0', createdAt, ledgerId })
  const records = await IQC.createRecords({ head: { n: 0, h: header.g }, items, privateKey: key.privateKey })
  const lines = [header, ...records].map((o) => IQC.canonicalJSON(o))
  return { key, pk, header, records, lines, text: joinLines(lines) }
}

// One ledger with every kind and every event, used by the tamper tests and the audit tests.
export const A1 = 'run-0914/injection-01.csv', A2 = 'run-0914/injection-01.csv (v2)'
export const CONTENT = {
  a1: 'sample,area\nS-01,1523.4\n',
  a2: 'sample,area\nS-01,1523.4\nS-02,1498.0\n',
  b1: Buffer.from([0, 1, 2, 3, 255, 254, 128, 10, 13, 0]),
  b2: Buffer.from([0, 1, 2, 3, 255, 254, 128, 10, 13, 1]),
  c: 'blank,1\n',
  d: 'notes\n',
  e: 'to be removed\n',
}
export function fullItems() {
  return [
    sessionItem('watch-started', 1), // 2
    fileItem('run-0914/injection-01.csv', CONTENT.a1, 'existing', 2), // 3
    fileItem('run-0914/raw/injection-01.bin', CONTENT.b1, 'existing', 3), // 4
    fileItem('run-0914/e.txt', CONTENT.e, 'existing', 4), // 5
    fileItem('run-0914/blank.csv', CONTENT.c, 'added', 5), // 6
    fileItem('run-0914/injection-01.csv', CONTENT.a2, 'changed', 6), // 7
    removedItem('run-0914/blank.csv', 'removed', 7), // 8
    readingItem('1523.4'), // 9
    sessionItem('watch-stopped', 8), // 10
    sessionItem('scan', 100), // 11
    fileItem('notes 50%25 done.txt', CONTENT.d, 'added-unwatched', 101), // 12
    fileItem('run-0914/raw/injection-01.bin', CONTENT.b2, 'changed-unwatched', 102), // 13
    removedItem('run-0914/e.txt', 'removed-unwatched', 103), // 14
  ]
}

// the files present that match fullItems() exactly
export function fullFiles() {
  return new Map([
    ['run-0914/injection-01.csv', { sha256: sha(CONTENT.a2), bytes: Buffer.byteLength(CONTENT.a2) }],
    ['run-0914/raw/injection-01.bin', { sha256: sha(CONTENT.b2), bytes: CONTENT.b2.length }],
    ['notes 50%25 done.txt', { sha256: sha(CONTENT.d), bytes: Buffer.byteLength(CONTENT.d) }],
  ])
}

// replace line i (1-based) with obj re-serialized canonically after edit(obj)
export function editLine(lines, i, edit) {
  const out = lines.slice()
  const o = JSON.parse(out[i - 1])
  edit(o)
  out[i - 1] = IQC.canonicalJSON(o)
  return out
}

export const codesAt = (v, line) => v.problems.filter((p) => p.line === line).map((p) => p.code)
