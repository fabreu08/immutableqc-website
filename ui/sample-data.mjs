// Immutable QC: the demo's sample data (docs/product-v1.md, section 5 "Demo"; the design decision's "demo story").
//
// One small, fictional plate-reader run, the same everywhere it appears (the landing page's hero, the app's demo,
// examples): the data folder `bio-line-2` (also the station name) holds the run folder `run-1007/` with five files. In
// a shared copy of the folder, a sync conflict rewrites one value: well A01 of plate-07.csv reads 0.428 instead of
// 0.482. Same size, same name, different bytes, so its SHA-256 changes and an audit of the copy fails on that one file.
// Every fingerprint below is the real SHA-256 of these bytes; ui/test/ recomputes each one with node:crypto.
//
// The content is deterministic: CSV and JSON text (UTF-8, "\n" line ends, a final "\n"), and one binary file built
// from fixed numbers (little-endian, so the same bytes on every platform). Nothing here touches the network, the clock
// or randomness. Bundle-friendly: no import, only top-level `export const` and `export function`; internal names start
// with `_`, as in core/immutableqc.mjs. Needs TextEncoder (every current browser, Node 11+).
//
// API (paths are relative to the data folder, `/` between segments, and already in the ledger's encoded form)
//   FOLDER                 'bio-line-2'   the data folder's name (what a visitor would drop on the app)
//   STATION                'bio-line-2'   the station name to seal with
//   RUN                    'run-1007'
//   PATHS                  every path, in path order
//   FILES                  [{path, name, type, description, size, sha256, bytes: Uint8Array}] the folder as sealed,
//                          in path order. Shared objects: read them, never write into `bytes` (sampleFiles() copies).
//   EDIT                   {path, name, well, column, line, offset, length, before, after, size, sha256Before,
//                          sha256After, where}: the one change made in the copy (line counts from 1, the header is
//                          line 1; offset and length are the changed value's place in the file, in bytes)
//   EDITED_FILE            {path, name, type, description, size, sha256, bytes}: plate-07.csv as it reads in the copy
//   EDITED_FILES           FILES with plate-07.csv replaced by EDITED_FILE (the copy, as the audit finds it)
//   SHA256                 {path: sha256} of the folder as sealed
//   SHA256_EDITED          {path: sha256} of the copy (only EDIT.path differs)
//   sampleFiles({edited})  fresh copies of FILES (or EDITED_FILES): new objects with new Uint8Arrays, safe to keep
//   sampleFileMap({edited}) Map path -> {sha256, bytes: size}, the shape core's audit() and planSeal() take for
//                          `files` (note: there `bytes` is the size). These are the precomputed fingerprints; the app's
//                          demo should still hash the bytes itself, as a real audit does.
//   plateRows({edited})    [{well, abs_450}] of plate-07.csv as text, 96 rows from A01 (the hero's "inside the file")
//   hexGroups(hex, size)   '57620ea6…' -> ['57620ea6', …]: a fingerprint in 8-character groups (theme.css .hash)
//
// Files and fingerprints (SHA-256, checked by ui/test/sample-data.test.mjs)
//   run-1007/plate-07.csv   973 bytes  477f09c48ac1a6b4b6230fa65012c0cd11fad2c975954bd840911f219f6f6484
//   run-1007/plate-07.csv   973 bytes  1702711c5ebac75175c67210414bd422537e1069944b5b489fa5dbb3f2e50437  in the copy (A01 0.428)
//   run-1007/plate-07.raw   400 bytes  abc34ba5e6d90dc01c9df97818e386338a37becc731c32f8a03747f666ff5c7e
//   run-1007/plate-08.csv   973 bytes  fd7f57e676ea07c2e07a7c32a9f756517e47c89d395b2168cd738643101ffe47
//   run-1007/run.json       340 bytes  70d29db047403429c0f6eaadb4be2b81de1c3f9d2f2f1f1280f78c112e44162c
//   run-1007/standards.csv  150 bytes  4d79c05bcc3bcb8e9f26adb4c90a9c242162217cc6a0067ae12d1c68913b801d

export const FOLDER = 'bio-line-2'
export const STATION = 'bio-line-2'
export const RUN = 'run-1007'

// absorbance at 450 nm, wells A01 to H12 in row order (A01 A02 … A12 B01 …), as the reader software writes them
const _P07 = '0.482 0.517 0.091 0.733 1.377 0.644 0.087 0.132 1.991 0.131 1.497 0.690 ' +
  '0.845 1.269 0.053 1.964 1.303 0.051 0.691 1.827 0.153 0.386 0.259 0.259 ' +
  '0.259 0.287 1.812 0.154 2.131 0.391 1.106 0.157 0.429 0.059 1.074 1.802 ' +
  '0.075 0.112 1.489 0.974 1.681 1.134 0.682 0.639 0.738 2.236 0.464 1.874 ' +
  '1.730 0.053 1.226 1.445 0.102 0.917 0.072 0.049 1.665 0.838 1.354 0.237 ' +
  '0.286 0.064 0.727 0.045 0.244 0.578 0.046 0.314 0.046 1.204 0.280 2.051 ' +
  '1.842 0.557 1.880 0.369 0.161 1.589 0.550 0.568 0.103 0.119 1.823 0.062 ' +
  '1.797 0.194 1.853 0.316 0.565 0.729 2.048 0.509 0.050 0.051 0.329 2.228'
const _P08 = '2.120 0.048 0.132 0.913 0.316 0.051 1.207 0.460 1.408 0.139 0.316 2.017 ' +
  '1.443 0.525 1.464 0.943 0.380 0.441 1.891 0.061 0.784 1.326 0.116 2.003 ' +
  '0.453 0.437 0.520 0.211 0.925 1.839 1.141 1.553 1.750 0.145 0.267 0.677 ' +
  '1.429 1.651 0.263 0.068 2.236 0.082 0.996 0.085 0.141 0.308 0.978 0.095 ' +
  '1.333 1.354 1.828 0.546 0.278 0.561 0.257 0.064 2.077 1.630 1.266 0.107 ' +
  '1.708 0.773 1.455 1.159 1.028 0.072 1.768 0.060 0.788 0.629 0.194 0.588 ' +
  '0.160 1.968 1.163 0.460 1.801 0.197 0.931 0.365 0.045 0.324 0.284 0.108 ' +
  '0.745 0.288 1.420 1.571 0.623 0.102 0.389 0.527 0.723 0.045 0.410 0.690'

const _WELLS = 'ABCDEFGH'.split('').flatMap((r) => Array.from({ length: 12 }, (_, i) => r + String(i + 1).padStart(2, '0')))
const _plateCSV = (values) => 'well,abs_450\n' + values.split(' ').map((v, i) => `${_WELLS[i]},${v}\n`).join('')
const _utf8 = (text) => new TextEncoder().encode(text)

// standard curve: eight standards, a two-fold dilution series
const _STANDARDS = 'standard,conc_ng_ml,abs_450\n' +
  'S1,20.000,2.214\nS2,10.000,1.618\nS3,5.000,1.037\nS4,2.500,0.612\n' +
  'S5,1.250,0.344\nS6,0.625,0.198\nS7,0.313,0.121\nS8,0.000,0.047\n'

// run metadata, as the scheduler writes it beside the results
const _RUN_JSON = JSON.stringify({
  run: 'run-1007',
  station: 'bio-line-2',
  instrument: 'plate-reader-2',
  method: 'absorbance-450nm',
  plates: ['plate-07', 'plate-08'],
  started: '2026-09-14T08:02:11Z',
  finished: '2026-09-14T08:19:47Z',
  files: ['plate-07.csv', 'plate-07.raw', 'plate-08.csv', 'standards.csv'],
}, null, 2) + '\n'

// plate-07.raw, the reader's binary output for plate 07: an 8-byte signature ("PLRAW", 0, version 1, 0), then
// uint16 columns, rows, wavelength in nm and flags, then one float32 per well in row order; all little-endian.
// 16 + 96 * 4 = 400 bytes. It keeps 0.482 for A01 in the copy too: only the CSV was rewritten.
const _raw = () => {
  const values = _P07.split(' ').map(Number)
  const out = new Uint8Array(16 + values.length * 4)
  const dv = new DataView(out.buffer)
  out.set([0x50, 0x4c, 0x52, 0x41, 0x57, 0x00, 0x01, 0x00])
  dv.setUint16(8, 12, true)
  dv.setUint16(10, 8, true)
  dv.setUint16(12, 450, true)
  dv.setUint16(14, 0, true)
  values.forEach((v, i) => dv.setFloat32(16 + i * 4, v, true))
  return out
}

const _SHA = {
  'run-1007/plate-07.csv': '477f09c48ac1a6b4b6230fa65012c0cd11fad2c975954bd840911f219f6f6484',
  'run-1007/plate-07.raw': 'abc34ba5e6d90dc01c9df97818e386338a37becc731c32f8a03747f666ff5c7e',
  'run-1007/plate-08.csv': 'fd7f57e676ea07c2e07a7c32a9f756517e47c89d395b2168cd738643101ffe47',
  'run-1007/run.json': '70d29db047403429c0f6eaadb4be2b81de1c3f9d2f2f1f1280f78c112e44162c',
  'run-1007/standards.csv': '4d79c05bcc3bcb8e9f26adb4c90a9c242162217cc6a0067ae12d1c68913b801d',
}
const _SHA_EDITED_P07 = '1702711c5ebac75175c67210414bd422537e1069944b5b489fa5dbb3f2e50437'

const _file = (path, type, description, bytes, sha256) =>
  Object.freeze({ path, name: path.slice(path.lastIndexOf('/') + 1), type, description, size: bytes.length, sha256, bytes })

export const FILES = Object.freeze([
  _file('run-1007/plate-07.csv', 'text/csv', 'Plate 07: absorbance at 450 nm, one row per well', _utf8(_plateCSV(_P07)), _SHA['run-1007/plate-07.csv']),
  _file('run-1007/plate-07.raw', 'application/octet-stream', 'Plate 07: the reader’s binary output', _raw(), _SHA['run-1007/plate-07.raw']),
  _file('run-1007/plate-08.csv', 'text/csv', 'Plate 08: absorbance at 450 nm, one row per well', _utf8(_plateCSV(_P08)), _SHA['run-1007/plate-08.csv']),
  _file('run-1007/run.json', 'application/json', 'Run metadata from the scheduler', _utf8(_RUN_JSON), _SHA['run-1007/run.json']),
  _file('run-1007/standards.csv', 'text/csv', 'Standard curve: eight standards', _utf8(_STANDARDS), _SHA['run-1007/standards.csv']),
])

export const PATHS = Object.freeze(FILES.map((f) => f.path))

export const EDIT = Object.freeze({
  path: 'run-1007/plate-07.csv',
  name: 'plate-07.csv',
  well: 'A01',
  column: 'abs_450',
  line: 2,
  offset: 17, // 'well,abs_450\n' (13 bytes) + 'A01,' (4 bytes)
  length: 5,
  before: '0.482',
  after: '0.428',
  size: FILES[0].size, // unchanged: the copy looks the same
  sha256Before: _SHA['run-1007/plate-07.csv'],
  sha256After: _SHA_EDITED_P07,
  where: 'a shared copy of the folder (a sync conflict), not the watched instrument PC',
})

export const EDITED_FILE = _file(EDIT.path, 'text/csv', FILES[0].description, _utf8(_plateCSV(_P07.replace(EDIT.before, EDIT.after))), _SHA_EDITED_P07)

export const EDITED_FILES = Object.freeze(FILES.map((f) => (f.path === EDIT.path ? EDITED_FILE : f)))

export const SHA256 = Object.freeze({ ..._SHA })

export const SHA256_EDITED = Object.freeze({ ..._SHA, [EDIT.path]: _SHA_EDITED_P07 })

export function sampleFiles({ edited = false } = {}) {
  return (edited ? EDITED_FILES : FILES).map((f) => ({ ...f, bytes: f.bytes.slice() }))
}

export function sampleFileMap({ edited = false } = {}) {
  return new Map((edited ? EDITED_FILES : FILES).map((f) => [f.path, { sha256: f.sha256, bytes: f.size }]))
}

export function plateRows({ edited = false } = {}) {
  const values = (edited ? _P07.replace(EDIT.before, EDIT.after) : _P07).split(' ')
  return values.map((v, i) => ({ well: _WELLS[i], abs_450: v }))
}

export function hexGroups(hex, size = 8) {
  const out = []
  for (let i = 0; i < hex.length; i += size) out.push(hex.slice(i, i + size))
  return out
}
