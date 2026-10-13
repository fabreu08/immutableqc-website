// ui/sample-data.mjs: every precomputed SHA-256 is the real fingerprint of the sample bytes (recomputed here with
// node:crypto), the content is deterministic, and the copy's edit changes exactly one value: A01 of plate-07.csv,
// 0.482 -> 0.428, same size.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as S from '../sample-data.mjs'
import { validatePath, isLedgerFolderPath, encodePath } from '../../core/immutableqc.mjs'

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const text = (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes)
const SRC = readFileSync(fileURLToPath(new URL('../sample-data.mjs', import.meta.url)), 'utf8')

test('every file: precomputed SHA-256 and size equal the bytes', () => {
  assert.equal(S.FILES.length, 5)
  for (const f of S.FILES) {
    assert.ok(f.bytes instanceof Uint8Array, f.path)
    assert.equal(f.size, f.bytes.length, `${f.path} size`)
    assert.equal(f.sha256, sha(f.bytes), `${f.path} sha256`)
    assert.equal(S.SHA256[f.path], f.sha256, `${f.path} in SHA256`)
    assert.match(f.sha256, /^[0-9a-f]{64}$/)
  }
  assert.equal(S.EDITED_FILE.sha256, sha(S.EDITED_FILE.bytes), 'edited copy sha256')
  assert.equal(S.EDITED_FILE.size, S.EDITED_FILE.bytes.length)
  assert.equal(S.EDIT.sha256Before, sha(S.FILES.find((f) => f.path === S.EDIT.path).bytes))
  assert.equal(S.EDIT.sha256After, sha(S.EDITED_FILE.bytes))
  for (const f of S.EDITED_FILES) assert.equal(S.SHA256_EDITED[f.path], sha(f.bytes), `${f.path} in SHA256_EDITED`)
})

test('the fingerprints written in the header comment are the real ones', () => {
  for (const f of S.FILES) assert.ok(SRC.includes(`${f.path.padEnd(22)}  ${String(f.size).padStart(3)} bytes  ${f.sha256}`), f.path)
  assert.ok(SRC.includes(`${String(S.EDITED_FILE.size).padStart(3)} bytes  ${S.EDITED_FILE.sha256}  in the copy`))
})

test('the folder: valid, encoded, sorted paths of one run; CSV and JSON parse; the binary is fixed', () => {
  assert.deepEqual([...S.PATHS], [...S.PATHS].sort())
  assert.deepEqual([...S.PATHS], S.FILES.map((f) => f.path))
  assert.deepEqual(S.PATHS, ['run-1007/plate-07.csv', 'run-1007/plate-07.raw', 'run-1007/plate-08.csv', 'run-1007/run.json', 'run-1007/standards.csv'])
  for (const p of S.PATHS) {
    assert.equal(validatePath(p), null, p)
    assert.equal(encodePath(p), p, p)
    assert.equal(isLedgerFolderPath(p), false, p)
    assert.ok(p.startsWith(`${S.RUN}/`), p)
  }
  assert.equal(S.FOLDER, 'bio-line-2')
  assert.equal(S.STATION, 'bio-line-2')
  for (const f of S.FILES.filter((x) => x.type !== 'application/octet-stream')) {
    const t = text(f.bytes)
    assert.ok(t.endsWith('\n') && !t.includes('\r'), `${f.path}: \\n line ends, final \\n`)
  }
  const meta = JSON.parse(text(S.FILES.find((f) => f.path === 'run-1007/run.json').bytes))
  assert.equal(meta.station, S.STATION)
  assert.equal(meta.run, S.RUN)
  const raw = S.FILES.find((f) => f.path === 'run-1007/plate-07.raw').bytes
  assert.equal(raw.length, 400)
  assert.deepEqual([...raw.slice(0, 8)], [0x50, 0x4c, 0x52, 0x41, 0x57, 0x00, 0x01, 0x00])
  assert.ok(raw.some((b) => b >= 0x80), 'the binary file has bytes above 0x7f')
  assert.throws(() => text(raw), 'the binary file is not UTF-8 text')
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  assert.equal(dv.getUint16(8, true), 12)
  assert.equal(dv.getUint16(10, true), 8)
  assert.equal(dv.getUint16(12, true), 450)
  assert.equal(dv.getFloat32(16, true), Math.fround(0.482))
})

test('plate-07.csv: 96 wells A01 to H12, A01 = 0.482 as sealed', () => {
  const lines = text(S.FILES[0].bytes).trimEnd().split('\n')
  assert.equal(lines[0], 'well,abs_450')
  assert.equal(lines.length, 97)
  assert.equal(lines[1], 'A01,0.482')
  assert.deepEqual(lines.slice(1, 5), ['A01,0.482', 'A02,0.517', 'A03,0.091', 'A04,0.733'])
  assert.equal(lines[96].split(',')[0], 'H12')
  for (const l of lines.slice(1)) assert.match(l, /^[A-H](0[1-9]|1[0-2]),\d\.\d{3}$/)
  assert.deepEqual(S.plateRows().slice(0, 2), [{ well: 'A01', abs_450: '0.482' }, { well: 'A02', abs_450: '0.517' }])
  assert.equal(S.plateRows({ edited: true })[0].abs_450, '0.428')
})

test('the edit changes exactly one value, A01 0.482 -> 0.428, and nothing else', () => {
  const before = text(S.FILES.find((f) => f.path === S.EDIT.path).bytes).split('\n').map((l) => l.split(','))
  const after = text(S.EDITED_FILE.bytes).split('\n').map((l) => l.split(','))
  assert.equal(after.length, before.length)
  const diffs = []
  before.forEach((row, i) => { assert.equal(after[i].length, row.length); row.forEach((v, j) => { if (after[i][j] !== v) diffs.push({ line: i + 1, col: before[0][j], well: row[0], from: v, to: after[i][j] }) }) })
  assert.deepEqual(diffs, [{ line: S.EDIT.line, col: S.EDIT.column, well: S.EDIT.well, from: S.EDIT.before, to: S.EDIT.after }])
  assert.deepEqual([S.EDIT.before, S.EDIT.after], ['0.482', '0.428'])
  // the bytes: same size, and only bytes inside [offset, offset + length) differ
  const a = S.FILES[0].bytes, b = S.EDITED_FILE.bytes
  assert.equal(a.length, b.length)
  assert.equal(S.EDIT.size, a.length)
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) assert.ok(i >= S.EDIT.offset && i < S.EDIT.offset + S.EDIT.length, `byte ${i}`)
  assert.equal(text(a.slice(S.EDIT.offset, S.EDIT.offset + S.EDIT.length)), '0.482')
  assert.equal(text(b.slice(S.EDIT.offset, S.EDIT.offset + S.EDIT.length)), '0.428')
  // only one file differs between the folder and the copy
  const changed = S.EDITED_FILES.filter((f, i) => f.sha256 !== S.FILES[i].sha256).map((f) => f.path)
  assert.deepEqual(changed, [S.EDIT.path])
  assert.notEqual(S.SHA256_EDITED[S.EDIT.path], S.SHA256[S.EDIT.path])
})

test('helpers: copies are independent, the file map has core\'s shape, hexGroups splits by 8', () => {
  const copy = S.sampleFiles()
  copy[0].bytes[0] = 0
  assert.equal(S.FILES[0].bytes[0], 'w'.charCodeAt(0), 'sampleFiles() copies the bytes')
  assert.equal(S.sampleFiles({ edited: true })[0].sha256, S.EDITED_FILE.sha256)
  const map = S.sampleFileMap({ edited: true })
  assert.deepEqual(map.get(S.EDIT.path), { sha256: S.EDITED_FILE.sha256, bytes: S.EDITED_FILE.size })
  assert.equal(map.size, 5)
  assert.ok(Object.isFrozen(S.FILES) && Object.isFrozen(S.FILES[0]) && Object.isFrozen(S.EDIT) && Object.isFrozen(S.SHA256))
  const g = S.hexGroups(S.FILES[0].sha256)
  assert.equal(g.length, 8)
  assert.ok(g.every((x) => x.length === 8))
  assert.equal(g.join(''), S.FILES[0].sha256)
})

test('bundle-friendly: no import, only top-level export const and export function, internal names start with _', () => {
  assert.doesNotMatch(SRC, /^\s*import\b|\bimport\s*\(|\brequire\s*\(/m)
  assert.doesNotMatch(SRC, /^export\s+(?:default|\{|\*|let|var|class)/m)
  const top = [...SRC.matchAll(/^(export\s+)?(?:const|let|var|function|async function|class)\s+([\w$]+)/gm)]
  for (const [, exp, name] of top) assert.ok(exp || name.startsWith('_'), `top-level ${name}`)
  assert.doesNotMatch(SRC, /\bMath\.random\b|\bDate\.now\b|\bnew Date\b|\bfetch\s*\(|\bprocess\b|\bBuffer\b/)
})
