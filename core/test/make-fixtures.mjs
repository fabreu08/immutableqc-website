// Writes the cross-implementation fixtures in core/test/fixtures/ (committed; the agent, the app and any other
// implementation of ledger format v1 can test against them):
//   fixtures/test-key.DO-NOT-USE.jwk   the TEST-ONLY private key that signed the fixture ledgers. Published on purpose:
//                                      never use it for anything else.
//   fixtures/sample/                   a small instrument data folder and its ledger (ImmutableQC/ledger.jsonl): pass
//   fixtures/tampered-file/            the same ledger; files changed, reverted, deleted and added after sealing: fail
//   fixtures/tampered-ledger/          a file edited, and its record edited to match (sha256 and bytes): fail, line 8
//   fixtures/expected.json             per variant: verdict, head, key id, problems (line, code), notes, file states
//
//   node core/test/make-fixtures.mjs --write   (re)write everything (the key is kept if it exists)
//   node core/test/make-fixtures.mjs --check   exit 1 if the data files, the ledgers (signatures aside) or
//                                              expected.json differ from what this script makes
// ECDSA signatures are randomized, so a rewrite changes every "sig" (and nothing else: g, r, h and the head are fixed).
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import * as IQC from '../immutableqc.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const FIXTURES = join(HERE, 'fixtures')
const KEY_FILE = join(FIXTURES, 'test-key.DO-NOT-USE.jwk')
const STATION = 'LAB-PC-07'
const AGENT = 'immutableqc-cli/0.1.0'
const T = (sec) => new Date(Date.UTC(2026, 9, 1, 8, 0, 0) + sec * 1000).toISOString()
const sha = (b) => createHash('sha256').update(b).digest('hex')

// a deterministic binary result file: a small header, then float32 samples of a peak, then a trailer with 0x00 and 0xFF
function binary() {
  const n = 256
  const buf = new ArrayBuffer(16 + n * 4 + 16)
  const dv = new DataView(buf)
  const head = [0x49, 0x51, 0x43, 0x44, 0x41, 0x54, 0x00, 0x01, 0xff, 0xfe, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00]
  head.forEach((b, i) => dv.setUint8(i, b))
  for (let i = 0; i < n; i++) dv.setFloat32(16 + 4 * i, 2 + 1500 * Math.exp(-(((i - 128) / 9) ** 2)), true)
  for (let i = 0; i < 16; i++) dv.setUint8(16 + n * 4 + i, i % 2 ? 0xff : 0x00)
  return new Uint8Array(buf)
}

const LOG1 = '2026-10-01T07:58:12Z run 0914 queued\n2026-10-01T07:58:40Z injection 01 done\n'
const LOG2 = LOG1 + '2026-10-01T08:03:05Z injection 02 done\n'
const INJ01 = 'sample,retention_min,area,unit\nS-0914-01,4.212,1523.4,mAU*s\n'
const INJ02 = 'sample,retention_min,area,unit\nS-0914-02,4.208,1498.0,mAU*s\n'
const INJ02_EDITED = 'sample,retention_min,area,unit\nS-0914-02,4.208,1598.0,mAU*s\n'
const METHOD = 'Méthode isocratique, 50% B, 1.0 mL/min, 30 °C\n'
const SCRATCH = 'scratch,1\n'
const INJ0915 = 'sample,retention_min,area,unit\nS-0915-01,4.215,1511.9,mAU*s\n'
const README = 'This folder holds the Immutable QC ledger for the data folder around it (a test fixture).\nledger.jsonl: one sealed record per line. Drop the data folder on immutableqc.com/app/ to audit it.\n'

// raw relative path -> bytes
export function sampleFiles() {
  return {
    'instrument.log': LOG2,
    'run-0914/injection-01.csv': INJ01,
    'run-0914/injection-02.csv': INJ02,
    'run-0914/méthode 50%.txt': METHOD,
    'run-0914/raw/injection-01.dat': binary(),
    'run-0915/injection-01.csv': INJ0915,
  }
}

const bytesOf = (c) => (typeof c === 'string' ? new TextEncoder().encode(c) : c)
const fileRec = (raw, content, event, sec, ctx) => ({ kind: 'file', f: { station: STATION, path: IQC.encodePath(raw), sha256: sha(bytesOf(content)), bytes: String(bytesOf(content).length), observedAt: T(sec), event }, ...(ctx ? { ctx } : {}) })
const session = (event, sec) => ({ kind: 'session', f: { station: STATION, event, at: T(sec), agent: AGENT } })

function items() {
  return [
    session('watch-started', 60), //                                                         record 1, line 2
    fileRec('instrument.log', LOG1, 'existing', 61, { modifiedAt: T(-80) }), //                2
    fileRec('run-0914/injection-01.csv', INJ01, 'existing', 61), //                            3
    fileRec('run-0914/méthode 50%.txt', METHOD, 'existing', 62), //                            4
    fileRec('run-0914/raw/injection-01.dat', binary(), 'existing', 62), //                     5
    fileRec('run-0914/scratch.csv', SCRATCH, 'existing', 63), //                               6
    fileRec('run-0914/injection-02.csv', INJ02, 'added', 190, { modifiedAt: T(185) }), //       7, line 8
    fileRec('instrument.log', LOG2, 'changed', 191, { modifiedAt: T(185) }), //                8
    { kind: 'file-removed', f: { station: STATION, path: 'run-0914/scratch.csv', observedAt: T(300), event: 'removed' } }, // 9
    session('watch-stopped', 3600), //                                                        10
    session('scan', 86400), //                                                                11
    fileRec('run-0915/injection-01.csv', INJ0915, 'added-unwatched', 86401), //               12
  ]
}

async function ledgerText(privateKey, publicKeyHex) {
  const header = await IQC.createHeader({ station: STATION, privateKey, publicKeyHex, agent: AGENT, createdAt: T(59), ledgerId: sha('immutableqc test fixture ledger').slice(0, 32) })
  const records = await IQC.createRecords({ head: { n: 0, h: header.g }, items: items(), privateKey })
  return [header, ...records].map((o) => IQC.serializeLine(o)).join('')
}

// every file under dir, as encoded relative path -> {sha256, bytes} (what an agent or the app would hand to audit)
export function readFolder(dir) {
  const out = new Map()
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name)
      const s = statSync(p)
      if (s.isDirectory()) walk(p)
      else {
        const b = readFileSync(p)
        out.set(IQC.encodePath(relative(dir, p).split(sep).join('/')), { sha256: sha(b), bytes: b.length })
      }
    }
  }
  walk(dir)
  return out
}

export async function expectedFor(dir) {
  const text = readFileSync(join(dir, 'ImmutableQC', 'ledger.jsonl'))
  const v = await IQC.verifyLedger(new Uint8Array(text))
  const files = readFolder(dir)
  const a = IQC.audit(v, files, { auditedAt: T(90000), tool: `immutableqc-core/${IQC.VERSION}` })
  return {
    folder: relative(FIXTURES, dir),
    ledger: `${relative(FIXTURES, dir)}/ImmutableQC/ledger.jsonl`,
    verdict: a.verdict,
    summary: a.summary,
    keyId: v.keyId,
    ledgerId: v.header && v.header.ledgerId,
    records: v.recordCount,
    head: v.head,
    headString: v.head ? IQC.formatHead(v.head) : null,
    problems: v.problems.map((p) => ({ line: p.line, code: p.code })),
    notes: a.notes.map((n) => n.code),
    counts: Object.fromEntries(['sealed', 'match', 'changed', 'missing', 'removed', 'backAfterRemoval', 'notSealed', 'notChecked'].map((k) => [k, a.counts[k]])),
    files: Object.fromEntries(a.files.map((f) => [f.path, { state: f.state, ...(f.present ? { sha256: f.present.sha256, bytes: f.present.bytes } : {}), ...(f.matchesN ? { matchesN: f.matchesN } : {}) }])),
  }
}

// the whole fixture set as {relative path: bytes}, made with the given key
async function make(jwk) {
  const privateKey = await IQC.importPrivateJwk(jwk)
  const pub = IQC.publicKeyHexOfJwk(jwk)
  const out = {}
  const put = (variant, files, ledger) => {
    for (const [raw, c] of Object.entries(files)) out[`${variant}/${raw}`] = bytesOf(c)
    out[`${variant}/ImmutableQC/README.txt`] = bytesOf(README)
    out[`${variant}/ImmutableQC/ledger.jsonl`] = bytesOf(ledger)
  }
  const ledger = await ledgerText(privateKey, pub)
  put('sample', sampleFiles(), ledger)
  // tampered-file: one value changed, the log reverted to its first sealed version, the raw file deleted, a new file
  const tf = sampleFiles()
  tf['run-0914/injection-02.csv'] = INJ02_EDITED
  tf['instrument.log'] = LOG1
  delete tf['run-0914/raw/injection-01.dat']
  tf['run-0914/injection-03.csv'] = 'sample,retention_min,area,unit\nS-0914-03,4.210,1502.2,mAU*s\n'
  put('tampered-file', tf, ledger)
  // tampered-ledger: injection-02.csv edited, and its record (line 8) edited to match the new bytes
  const tl = sampleFiles()
  tl['run-0914/injection-02.csv'] = INJ02_EDITED
  const lines = ledger.split('\n')
  const o = JSON.parse(lines[7])
  if (o.f.path !== 'run-0914/injection-02.csv') throw new Error('fixture layout changed: line 8 is not injection-02.csv')
  o.f.sha256 = sha(bytesOf(INJ02_EDITED))
  o.f.bytes = String(bytesOf(INJ02_EDITED).length)
  lines[7] = IQC.canonicalJSON(o)
  put('tampered-ledger', tl, lines.join('\n'))
  return out
}

const stripSig = (text) => text.split('\n').map((l) => (l ? IQC.canonicalJSON({ ...JSON.parse(l), sig: undefined }) : l)).join('\n')
const listFiles = (dir) => (existsSync(dir) ? [...readFolder(dir).keys()].map((p) => IQC.decodePath(p)) : [])

async function main(arg) {
  if (arg !== '--write' && arg !== '--check') {
    console.log('usage: node core/test/make-fixtures.mjs --write | --check')
    return 0
  }
  let jwk
  if (existsSync(KEY_FILE)) jwk = JSON.parse(readFileSync(KEY_FILE, 'utf8'))
  else if (arg === '--write') {
    const kp = await IQC.generateKeyPair({ extractable: true })
    jwk = await IQC.exportPrivateJwk(kp.privateKey)
  } else { console.error('no fixture key'); return 1 }
  const files = await make(jwk)
  const variants = ['sample', 'tampered-file', 'tampered-ledger']
  if (arg === '--write') {
    mkdirSync(FIXTURES, { recursive: true })
    for (const v of variants) rmSync(join(FIXTURES, v), { recursive: true, force: true })
    writeFileSync(KEY_FILE, JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }, null, 1) + '\n')
    writeFileSync(join(FIXTURES, '.gitattributes'), '# fixture bytes are hashed: never convert line endings\n* -text\n')
    for (const [p, b] of Object.entries(files)) { mkdirSync(dirname(join(FIXTURES, p)), { recursive: true }); writeFileSync(join(FIXTURES, p), b) }
  }
  const expected = { _note: 'Made by core/test/make-fixtures.mjs. Paths are encoded (ledger format v1, section 3.2). The key in test-key.DO-NOT-USE.jwk is published for tests only.', format: IQC.FORMAT, version: IQC.FORMAT_VERSION, variants: {} }
  for (const v of variants) expected.variants[v] = await expectedFor(join(FIXTURES, v))
  const expText = JSON.stringify(expected, null, 1) + '\n'
  if (arg === '--write') { writeFileSync(join(FIXTURES, 'expected.json'), expText); console.log(`wrote ${Object.keys(files).length + 3} files in ${relative(process.cwd(), FIXTURES) || FIXTURES}`); return 0 }
  // --check
  const bad = []
  for (const [p, b] of Object.entries(files)) {
    const f = join(FIXTURES, p)
    if (!existsSync(f)) { bad.push(`missing ${p}`); continue }
    const have = readFileSync(f)
    const same = p.endsWith('ledger.jsonl') ? stripSig(have.toString('utf8')) === stripSig(new TextDecoder().decode(b)) : Buffer.compare(have, Buffer.from(b)) === 0
    if (!same) bad.push(`differs ${p}`)
  }
  for (const v of variants) for (const p of listFiles(join(FIXTURES, v))) if (!(`${v}/${p}` in files)) bad.push(`extra ${v}/${p}`)
  const have = existsSync(join(FIXTURES, 'expected.json')) ? readFileSync(join(FIXTURES, 'expected.json'), 'utf8') : ''
  if (have !== expText) bad.push('differs expected.json')
  for (const b of bad) console.error(b)
  return bad.length ? 1 : 0
}

export const checkFixtures = () => main('--check')

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await main(process.argv[2])
