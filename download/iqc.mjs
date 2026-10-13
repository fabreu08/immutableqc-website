#!/usr/bin/env node
// iqc.mjs: the Immutable QC agent (iqc), version 0.1.0, in one file. Seals every file in a folder as it is written,
// and audits the folder against its seals. Run it with Node.js 20 or later: node iqc.mjs help
// No dependencies, and it never uses the network: it reads files, and writes its ledger, README.txt and lock file.
//
// The SHA-256 of this file is printed on immutableqc.com, beside the download link. Compare it before you run the file:
//   Windows: certutil -hashfile iqc.mjs SHA256    macOS: shasum -a 256 iqc.mjs    Linux: sha256sum iqc.mjs
//
// Built by agent/tools/bundle.mjs from agent/src/*.mjs and core/immutableqc.mjs (the one implementation of the ledger
// format, inlined below, unchanged but for its export keywords). Each module runs in its own scope. Edit those files,
// not this one: a test checks that this file is up to date.

import * as __node_crypto from 'node:crypto'
import * as __node_fs from 'node:fs'
import * as __node_fs_promises from 'node:fs/promises'
import * as __node_os from 'node:os'
import * as __node_path from 'node:path'

// ---------------------------------------------------------------------------------------------- core/immutableqc.mjs
const __core = (() => {
// Immutable QC core: ledger format version 1 (docs/product-v1.md, section 3).
//
// The one implementation of the format, used by the command-line agent (Node 20+) and the web app (current Chrome,
// Firefox and Safari). An ES module with no imports and no dependencies. Signatures use the platform's WebCrypto
// (globalThis.crypto.subtle, read lazily, so the module loads anywhere); SHA-256 is the pure-JS hasher below
// (FIPS 180-4), synchronous and incremental. Every hex string is lowercase. "path" means an encoded path, the form
// stored in the ledger (section 3.2), unless it says "raw".
//
// Bundling: only top-level `export const`, `export function`, `export async function` and `export class`
// declarations; internal top-level names start with `_`; no default export, no export list, no top-level await, no
// import, no Node globals (Buffer, process, require).
//
// API
//   VERSION                                  '0.1.0', the version of this module (and of the tools built on it)
//   FORMAT, FORMAT_VERSION, AUDIT_FORMAT, ALG, LEDGER_DIR, LEDGER_FILE, LEDGER_PATH, HEADER_KEYS, RECORD_KEYS,
//   KINDS, MODE_EVENTS, DEFAULT_IGNORES        constants of the format (frozen)
//   toHex(bytes) -> hex;  fromHex(hex) -> Uint8Array (lowercase hex only)
//   sha256Hex(stringOrBytes) -> 64 hex      sync; strings are hashed as UTF-8
//   class Sha256                             new Sha256().update(Uint8Array|string)… .digest() -> Uint8Array(32) | .hex()
//   isTime(s), isReadingTime(s), isSealedText(s), isHex(s, len)            the text rules of 3.2, as booleans
//   encodePath(rawRelPath) -> path          NFC, `/` separators, `%`, `|` and control characters as %XX; throws
//   decodePath(path) -> raw;  validatePath(path) -> null | reason (a phrase)
//   isLedgerFolderPath(path)                 true for the root `ImmutableQC` folder and anything inside it
//   ignoreMatcher(globs) -> (path) => bool   DEFAULT_IGNORES plus globs (* and ?), see the function
//   payloadOf(kind, f) -> text;  fingerprintOf(kind, f) -> r;  genesisOf(header) -> g;  linkOf(prevHex, rHex, n) -> h
//   async generateKeyPair({extractable}) -> CryptoKeyPair (ECDSA P-256)
//   async publicKeyHex(publicKey) -> 130 hex;  async importPublicKeyHex(hex) -> CryptoKey
//   async exportPrivateJwk(privateKey) -> JWK;  async importPrivateJwk(jwk, {extractable}) -> CryptoKey
//   publicKeyHexOfJwk(jwk) -> 130 hex;  keyIdOf(publicKeyHex) -> 16 hex;  async keyMatches(privateKey, publicKeyHex)
//   async signLink(privateKey, hex64) -> 128 hex (low-S);  async verifyLink(publicKeyOrHex, hex64, sigHex) -> bool
//   sigProblem(sigHex) -> null | 'form' | 'range' | 'high-s';  isLowS(sigHex);  normalizeLowS(sigHex)
//   async createHeader({station, privateKey, publicKeyHex | publicKey, agent?, createdAt?, ledgerId?}) -> header
//   async createRecord({n, prev, kind, f, privateKey, ctx?}) -> record
//   async createRecords({head: {n, h}, items: [{kind, f, ctx?}], privateKey}) -> records (signed in parallel)
//   canonicalJSON(obj) -> text;  serializeLine(obj) -> text + "\n"   (header or record, keys in format order)
//   parseLedger(textOrBytes) -> {lines, header, records, problems}     structure only, sync, no checks of content
//   async verifyLedger(textOrBytes, {concurrency, onProgress(done, total), verifyBatch, batchSize}) -> verified
//         (section 3.7, below). Signature checks run concurrently with the line checks. A browser runs WebCrypto
//         operations one at a time per thread, so a page can pass verifyBatch(publicKeyHex, [{h, sig}]) ->
//         Promise<boolean[]> to spread them over Web Workers (each worker calls verifyLinks); with verifyBatch,
//         concurrency counts batches in flight (default 8) of batchSize records (default 1024).
//   async verifyLinks(publicKeyHex, [{h, sig}], {concurrency}) -> boolean[]   the worker side of verifyBatch
//   isFirstScan(verified) -> bool            whether a scan now is this ledger's first (events `existing`)
//   extendVerified(verified, records) -> verified   updated in place after appending records (no re-verification)
//   planSeal(verified, files, {mode: 'first'|'watch'|'unwatched', station, observedAt, ignore}) -> [{kind, f, ctx?}]
//   audit(verified, files|null, {expectHead, expectKeyId, strict, auditedAt, where: 'browser'|'command line', tool,
//         ignore, folder}) -> report       (section 3.8; JSON.stringify(report) is the machine-readable form)
//   renderReportHTML(report) -> HTML         (section 3.9)
//   parseHead('n:h') -> {n, h};  formatHead({n, h}) -> 'n:h';  formatBytes(n);  formatCount(n);  formatDuration(ms)
//   escapeHTML(s)
//
// `files` (planSeal, audit): a Map, a plain object, or an array of {path, …}, keyed by encoded path, each value
//   {sha256, bytes, observedAt?, modifiedAt?}, or null for a file that is present but could not be read yet (planSeal
//   leaves it alone; audit marks it "not checked"). The root `ImmutableQC` folder is never sealed or reported.
//
// verified (verifyLedger): {ok, header, headerOk, keyId, records, recordCount, goodCount, firstProblemLine, problems,
//   head, files, sessions, gaps, kinds}. problems: [{line, n, code, message, detail}], sorted by line; message is a
//   plain sentence that starts "Line 7 (record 6): …". head: {n, h} of the last record before the first problem
//   ({n: 0, h: g} when there is none yet; null when the header fails). files: Map path -> {path, versions, latest},
//   versions: [{n, line, kind, event, observedAt, sha256?, bytes?, modifiedAt?}], built only from the records before
//   the first problem. sessions: [{type: 'watch'|'scan', startN, start, stopN, stop, clean, open, endedByN, files,
//   lastN, lastAt, station, agent}]. gaps: [{afterN, beforeN, from, to, ms}].
//   Problem codes. Lines: empty, not-utf8, bom, crlf, blank, json, truncated, not-object, no-newline. Header:
//   header-missing, header-format, header-version, header-field, header-keyid, header-g, header-key, header-sig,
//   sig-unchecked. Records: header-again, n-form, n-gap, n-order, kind, f-form, f-key-unknown, f-key-missing, field,
//   event, r-form, prev-form, h-form, r, prev, h, sig, sig-error. Both: key-unknown, key-missing, canonical, ctx-form,
//   sig-form, sig-high-s.
// report (audit): {format: 'immutableqc-audit', version: 1, verdict: 'pass'|'fail', summary, strict, filesChecked,
//   counts, problems (the ledger's, then expect-head, expect-key, then changed and missing files by path), notes
//   [{code, message, count, items}] with codes sealed-more-than-once, unwatched, not-sealed, back-after-removal,
//   not-checked, unclean-stop, gaps; ledger, sessions, gaps, expectations, files [{path, state, versions, latest,
//   sealed, present, matchesN, records}] by path, method, rerun}. File states: match, changed, missing, removed,
//   back after removal, not sealed, not checked.

const VERSION = '0.1.0'
const FORMAT = 'immutableqc-ledger'
const FORMAT_VERSION = 1
const AUDIT_FORMAT = 'immutableqc-audit'
const ALG = 'ECDSA-P256-SHA256'
const LEDGER_DIR = 'ImmutableQC'
const LEDGER_FILE = 'ledger.jsonl'
const LEDGER_PATH = 'ImmutableQC/ledger.jsonl'
const HEADER_KEYS = Object.freeze(['format', 'version', 'ledgerId', 'createdAt', 'station', 'alg', 'publicKey', 'keyId', 'g', 'sig', 'ctx'])
const RECORD_KEYS = Object.freeze(['n', 'kind', 'f', 'r', 'prev', 'h', 'sig', 'ctx'])
const KINDS = Object.freeze({
  file: Object.freeze({ tag: 'iqc-file-v1', label: 'file', fields: Object.freeze(['station', 'path', 'sha256', 'bytes', 'observedAt', 'event']), events: Object.freeze(['existing', 'added', 'changed', 'added-unwatched', 'changed-unwatched']) }),
  'file-removed': Object.freeze({ tag: 'iqc-file-removed-v1', label: 'removal', fields: Object.freeze(['station', 'path', 'observedAt', 'event']), events: Object.freeze(['removed', 'removed-unwatched']) }),
  session: Object.freeze({ tag: 'iqc-session-v1', label: 'session', fields: Object.freeze(['station', 'event', 'at', 'agent']), events: Object.freeze(['watch-started', 'watch-stopped', 'scan']) }),
  reading: Object.freeze({ tag: null, label: 'reading', fields: Object.freeze(['instrumentId', 'sensorType', 'value', 'unit', 'capturedAt']), events: null }),
})
// events per planSeal mode: [new file, changed file, removed file]
const MODE_EVENTS = Object.freeze({
  first: Object.freeze(['existing', 'changed-unwatched', 'removed-unwatched']),
  watch: Object.freeze(['added', 'changed', 'removed']),
  unwatched: Object.freeze(['added-unwatched', 'changed-unwatched', 'removed-unwatched']),
})
const DEFAULT_IGNORES = Object.freeze(['.DS_Store', 'Thumbs.db', 'desktop.ini', '~$*', '*.tmp'])

const _own = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const _isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o)
const _clip = (s, n = 40) => { const t = typeof s === 'string' ? s : String(s); return JSON.stringify(t.length > n ? t.slice(0, n) + '…' : t) }
const _plural = (n, one, many) => `${formatCount(n)} ${n === 1 ? one : many}`

// ------------------------------------------------------------------------------------------------------------- hex
const _HEXB = Array.from({ length: 256 }, (_, i) => (i < 16 ? '0' : '') + i.toString(16))
const _HEXRE = /^[0-9a-f]*$/
const _HEX16 = /^[0-9a-f]{16}$/
const _HEX32 = /^[0-9a-f]{32}$/
const _HEX64 = /^[0-9a-f]{64}$/
const _HEX128 = /^[0-9a-f]{128}$/
const _HEX130 = /^04[0-9a-f]{128}$/

function toHex(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes)
  let s = ''
  for (let i = 0; i < b.length; i++) s += _HEXB[b[i]]
  return s
}

const _HEXV = (() => { const t = new Uint8Array(128); for (let i = 0; i < 16; i++) t['0123456789abcdef'.charCodeAt(i)] = i; return t })()

function fromHex(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !_HEXRE.test(hex)) throw new Error('Expected lowercase hex with an even number of digits.')
  return _hexBytes(hex)
}

// for values already checked to be lowercase hex
function _hexBytes(hex) {
  const b = new Uint8Array(hex.length >> 1)
  for (let i = 0, j = 0; i < b.length; i++, j += 2) b[i] = (_HEXV[hex.charCodeAt(j)] << 4) | _HEXV[hex.charCodeAt(j + 1)]
  return b
}

function isHex(s, len) {
  return typeof s === 'string' && s.length === len && _HEXRE.test(s)
}

// ----------------------------------------------------------------------------------------------- SHA-256 (FIPS 180-4)
const _K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])
const _H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
const _te = new TextEncoder()

function _bytesOf(data) {
  if (typeof data === 'string') return _te.encode(data)
  if (data instanceof Uint8Array) return data
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  throw new TypeError('Expected a string, a Uint8Array or an ArrayBuffer.')
}

// Incremental SHA-256: update() any number of times with any slice sizes, then digest() or hex() once.
class Sha256 {
  constructor() {
    this._h = new Int32Array(_H0)
    this._w = new Int32Array(64)
    this._buf = new Uint8Array(64)
    this._bl = 0
    this._len = 0
    this._out = null
  }

  _reset() {
    this._h.set(_H0)
    this._bl = 0
    this._len = 0
    this._out = null
    return this
  }

  update(data) {
    if (this._out) throw new Error('This SHA-256 is already finished.')
    const d = _bytesOf(data), L = d.length
    let i = 0
    this._len += L
    if (this._bl > 0) {
      const t = Math.min(64 - this._bl, L)
      this._buf.set(d.subarray(0, t), this._bl)
      this._bl += t
      i = t
      if (this._bl < 64) return this
      this._block(this._buf, 0)
      this._bl = 0
    }
    for (; i + 64 <= L; i += 64) this._block(d, i)
    if (i < L) { this._buf.set(d.subarray(i), 0); this._bl = L - i }
    return this
  }

  _block(d, o) {
    const w = this._w, H = this._h, K = _K
    for (let i = 0; i < 16; i++, o += 4) w[i] = (d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2]
      w[i] = ((((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)) + w[i - 7] + w[i - 16]) | 0
    }
    let a = H[0], b = H[1], c = H[2], e = H[4], f = H[5], g = H[6], h = H[7], dd = H[3]
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0
      const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      h = g; g = f; f = e; e = (dd + t1) | 0; dd = c; c = b; b = a; a = (t1 + t2) | 0
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + dd) | 0
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0
  }

  digest() {
    if (this._out) return this._out.slice()
    const b = this._buf, len = this._len
    let bl = this._bl
    b[bl++] = 0x80
    if (bl > 56) { b.fill(0, bl, 64); this._block(b, 0); bl = 0 }
    b.fill(0, bl, 56)
    const hi = Math.floor(len / 0x20000000), lo = (len % 0x20000000) * 8
    b[56] = hi >>> 24; b[57] = hi >>> 16; b[58] = hi >>> 8; b[59] = hi
    b[60] = lo >>> 24; b[61] = lo >>> 16; b[62] = lo >>> 8; b[63] = lo
    this._block(b, 0)
    const out = new Uint8Array(32)
    for (let i = 0; i < 8; i++) { const x = this._h[i]; out[4 * i] = x >>> 24; out[4 * i + 1] = x >>> 16; out[4 * i + 2] = x >>> 8; out[4 * i + 3] = x }
    this._out = out
    return out.slice()
  }

  hex() {
    return toHex(this.digest())
  }
}

// one-shot hashing reuses one hasher and one text buffer (sha256Hex is synchronous, so nothing can interleave)
const _one = new Sha256()
let _txt = new Uint8Array(1024)

function sha256Hex(input) {
  _one._reset()
  if (typeof input === 'string' && input.length * 3 <= 65536) {
    if (input.length * 3 > _txt.length) _txt = new Uint8Array(65536)
    const { written } = _te.encodeInto(input, _txt)
    _one.update(_txt.subarray(0, written))
  } else _one.update(input)
  return toHex(_one.digest())
}

// ------------------------------------------------------------------------------------------------- text rules (3.2)
const _BADCHAR = /[|\u0000-\u001f\u007f]/
const _SURR = /[\ud800-\udfff]/
const _TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const _RTIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/
const _DEC = /^(0|[1-9][0-9]*)$/

function _wellFormed(s) {
  if (!_SURR.test(s)) return true
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1)
      if (!(d >= 0xdc00 && d <= 0xdfff)) return false
      i++
    } else if (c >= 0xdc00 && c <= 0xdfff) return false
  }
  return true
}

// A sealed field: a string with no "|", no control character (U+0000 to U+001F, U+007F) and no lone surrogate (it is
// hashed as UTF-8, where a lone surrogate has no encoding of its own).
function isSealedText(s) {
  return typeof s === 'string' && !_BADCHAR.test(s) && _wellFormed(s)
}

// YYYY-MM-DDTHH:mm:ss.sssZ, exactly what Date.prototype.toISOString() gives, and a real date
function isTime(s) {
  if (typeof s !== 'string' || !_TIME.test(s)) return false
  const t = Date.parse(s)
  return !Number.isNaN(t) && new Date(t).toISOString() === s
}

// a reading's capturedAt (the docs pages' rule): the same, where the milliseconds may be left out
function isReadingTime(s) {
  if (typeof s !== 'string' || !_RTIME.test(s)) return false
  const full = s.length === 20 ? s.slice(0, 19) + '.000Z' : s
  const t = Date.parse(full)
  return !Number.isNaN(t) && new Date(t).toISOString() === full
}

const _cpLen = (s) => { let n = 0; for (const _ of s) n++; return n }
const _stationOk = (s) => isSealedText(s) && s.length > 0 && _cpLen(s) <= 64

// ------------------------------------------------------------------------------------------------------------ paths
const _ENC = /[%|\u0000-\u001f\u007f]/g
const _ESC = /%([0-9A-F]{2})/g

function _segmentProblem(p) {
  if (p === '') return 'it is empty'
  if (p[0] === '/') return 'it starts with "/"'
  for (const s of p.split('/')) {
    if (s === '') return 'it has an empty segment (two "/" in a row, or a "/" at the end)'
    if (s === '.' || s === '..') return `it has a "${s}" segment`
  }
  return null
}

function encodePath(raw) {
  if (typeof raw !== 'string') throw new TypeError('A path must be a string.')
  if (!_wellFormed(raw)) throw new Error(`Not a valid relative path (it holds a lone surrogate): ${JSON.stringify(raw)}`)
  const p = raw.normalize('NFC')
  const why = _segmentProblem(p)
  if (why) throw new Error(`Not a valid relative path (${why}): ${JSON.stringify(raw)}`)
  return p.replace(_ENC, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))
}

function validatePath(p) {
  if (typeof p !== 'string') return 'it is not a string'
  if (_BADCHAR.test(p)) return 'it holds "|" or a control character that is not percent-encoded'
  if (!_wellFormed(p)) return 'it holds a lone surrogate'
  for (let i = p.indexOf('%'); i !== -1; i = p.indexOf('%', i + 1)) {
    const hx = p.slice(i + 1, i + 3)
    if (!/^[0-9A-F]{2}$/.test(hx)) return 'it has a "%" that is not followed by two uppercase hex digits'
    const c = parseInt(hx, 16)
    if (!(c === 0x25 || c === 0x7c || c <= 0x1f || c === 0x7f)) return `it encodes "%${hx}", which must be written as itself`
  }
  const raw = p.replace(_ESC, (_, h) => String.fromCharCode(parseInt(h, 16)))
  if (raw.normalize('NFC') !== raw) return 'it is not in Unicode NFC form'
  return _segmentProblem(raw)
}

function decodePath(p) {
  const why = validatePath(p)
  if (why) throw new Error(`Not a valid encoded path (${why}): ${JSON.stringify(p)}`)
  return p.replace(_ESC, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

function isLedgerFolderPath(p) {
  return p === LEDGER_DIR || (typeof p === 'string' && p.startsWith(LEDGER_DIR + '/'))
}

// Ignore rules, shared by planSeal and audit: DEFAULT_IGNORES plus the given globs. `*` matches any run of characters
// and `?` one character, never "/"; matching ignores case (Windows and macOS folders usually do). A glob without "/"
// matches any one segment of the path (a file name, or a folder name, which ignores everything inside it); a glob with
// "/" matches the whole relative path. Paths are matched decoded (raw), so "50%*" matches "50% B.csv".
function ignoreMatcher(globs = []) {
  const list = [...DEFAULT_IGNORES, ...(globs || [])]
  const res = list.map((g) => {
    if (typeof g !== 'string' || g === '') throw new Error('An ignore pattern must be a non-empty string.')
    const body = g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
    return { whole: g.includes('/'), re: new RegExp(`^${body}$`, 'i') }
  })
  return (p) => {
    let raw = p
    try { raw = decodePath(p) } catch { /* a raw path */ }
    const segs = raw.split('/')
    return res.some(({ whole, re }) => (whole ? re.test(raw) : segs.some((s) => re.test(s))))
  }
}

// ------------------------------------------------------------------------------------------- payload, fingerprint, link
function payloadOf(kind, f) {
  const k = KINDS[kind]
  if (!k || !_own(KINDS, kind)) throw new Error(`Unknown kind ${_clip(kind)}.`)
  const vals = k.fields.map((name) => f[name])
  return (k.tag ? [k.tag, ...vals] : vals).join('|')
}

function fingerprintOf(kind, f) {
  return sha256Hex(payloadOf(kind, f))
}

function genesisOf(header) {
  return sha256Hex(['immutableqc-ledger-v1', header.ledgerId, header.createdAt, header.station, header.alg, header.publicKey].join('|'))
}

function linkOf(prevHex, rHex, n) {
  return sha256Hex(prevHex + rHex + String(n))
}

// ------------------------------------------------------------------------------------------------------ signatures
const _EC = { name: 'ECDSA', namedCurve: 'P-256' }
const _SIGALG = { name: 'ECDSA', hash: 'SHA-256' }
const _N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551')

function _subtle() {
  const c = globalThis.crypto
  const s = c && c.subtle
  if (!s) throw new Error('Signatures cannot be made or checked here: a browser allows it only on a secure page (https or localhost).')
  return s
}

async function generateKeyPair({ extractable = false } = {}) {
  return _subtle().generateKey(_EC, !!extractable, ['sign', 'verify'])
}

async function publicKeyHex(publicKey) {
  return toHex(new Uint8Array(await _subtle().exportKey('raw', publicKey)))
}

async function importPublicKeyHex(hex) {
  if (typeof hex !== 'string' || !_HEX130.test(hex)) throw new Error('A public key must be 130 lowercase hex characters starting with 04 (an uncompressed P-256 point).')
  return _subtle().importKey('raw', fromHex(hex), _EC, true, ['verify'])
}

async function exportPrivateJwk(privateKey) {
  return _subtle().exportKey('jwk', privateKey)
}

async function importPrivateJwk(jwk, { extractable = false } = {}) {
  if (!_isObj(jwk) || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.d !== 'string') throw new Error('Not a P-256 private key in JWK form.')
  const { kty, crv, x, y, d } = jwk
  return _subtle().importKey('jwk', { kty, crv, x, y, d, ext: !!extractable }, _EC, !!extractable, ['sign'])
}

function _b64url(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('Not base64url text.')
  const out = []
  let acc = 0, bits = 0
  for (const ch of s) {
    acc = (acc << 6) | A.indexOf(ch)
    bits += 6
    if (bits >= 8) { bits -= 8; out.push((acc >>> bits) & 0xff) }
  }
  return new Uint8Array(out)
}

function publicKeyHexOfJwk(jwk) {
  if (!_isObj(jwk) || jwk.kty !== 'EC' || jwk.crv !== 'P-256') throw new Error('Not a P-256 key in JWK form.')
  const x = _b64url(jwk.x), y = _b64url(jwk.y)
  if (x.length !== 32 || y.length !== 32) throw new Error('Not a P-256 key in JWK form.')
  return '04' + toHex(x) + toHex(y)
}

function keyIdOf(pubHex) {
  if (typeof pubHex !== 'string' || !_HEX130.test(pubHex)) throw new Error('A public key must be 130 lowercase hex characters starting with 04.')
  return sha256Hex(fromHex(pubHex)).slice(0, 16)
}

// null when sigHex is a well-formed low-S signature; else 'form' (not 128 hex), 'range' (r or s is 0 or not below
// the group order) or 'high-s' (s above n/2: the second, refused form of a valid signature).
// 64-digit lowercase hex strings compare in the same order as the numbers they write
const _NHEX = _N.toString(16).padStart(64, '0')
const _HALFHEX = ((_N - BigInt(1)) / BigInt(2)).toString(16).padStart(64, '0')
const _ZERO64 = '0'.repeat(64)

function sigProblem(sigHex) {
  if (typeof sigHex !== 'string' || !_HEX128.test(sigHex)) return 'form'
  const r = sigHex.slice(0, 64), s = sigHex.slice(64)
  if (r === _ZERO64 || r >= _NHEX || s === _ZERO64 || s >= _NHEX) return 'range'
  if (s > _HALFHEX) return 'high-s'
  return null
}

function isLowS(sigHex) {
  return sigProblem(sigHex) === null
}

function normalizeLowS(sigHex) {
  if (typeof sigHex !== 'string' || !_HEX128.test(sigHex)) throw new Error('A signature must be 128 lowercase hex characters.')
  if (sigHex.slice(64) <= _HALFHEX) return sigHex
  return sigHex.slice(0, 64) + (_N - BigInt('0x' + sigHex.slice(64))).toString(16).padStart(64, '0')
}

async function signLink(privateKey, hex64) {
  if (!isHex(hex64, 64)) throw new Error('A link must be 64 lowercase hex characters.')
  const sig = new Uint8Array(await _subtle().sign(_SIGALG, privateKey, fromHex(hex64)))
  return normalizeLowS(toHex(sig))
}

async function verifyLink(publicKey, hex64, sigHex) {
  if (!isHex(hex64, 64) || sigProblem(sigHex) !== null) return false
  const key = typeof publicKey === 'string' ? await importPublicKeyHex(publicKey) : publicKey
  return _subtle().verify(_SIGALG, key, fromHex(sigHex), fromHex(hex64))
}

async function keyMatches(privateKey, pubHex) {
  const probe = toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)))
  try { return await verifyLink(pubHex, probe, await signLink(privateKey, probe)) } catch { return false }
}

// For verifyLedger's verifyBatch option, on the other side (a Web Worker, say): checks each {h, sig} against the public
// key, in order, and resolves to one boolean per item (false for a malformed or high-S signature).
const _keys = new Map()
async function verifyLinks(pubHex, items, { concurrency = 16 } = {}) {
  let key = _keys.get(pubHex)
  if (!key) {
    key = await importPublicKeyHex(pubHex)
    if (_keys.size > 8) _keys.clear()
    _keys.set(pubHex, key)
  }
  const out = new Array(items.length)
  await _pool(items.length, concurrency, async (i) => { out[i] = await verifyLink(key, items[i].h, items[i].sig) })
  return out
}

async function _pool(count, limit, fn, onTick) {
  let next = 0, done = 0
  const worker = async () => {
    while (next < count) {
      const i = next++
      await fn(i)
      done++
      if (onTick) onTick(done)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, count)) }, worker))
}

// ------------------------------------------------------------------------------------------------- field rules (3.4)
const _FIELD = {
  station: ['the station', (v) => _stationOk(v), 'must be 1 to 64 characters with no "|" and no control character'],
  path: ['the path', (v) => validatePath(v) === null, null],
  sha256: ['the file SHA-256', (v) => typeof v === 'string' && _HEX64.test(v), 'must be 64 lowercase hex characters'],
  bytes: ['the size in bytes', (v) => typeof v === 'string' && _DEC.test(v), 'must be a whole number in decimal, written as text, with no leading zero'],
  observedAt: ['the observation time', isTime, 'must be a real UTC time written as YYYY-MM-DDTHH:mm:ss.sssZ'],
  at: ['the session time', isTime, 'must be a real UTC time written as YYYY-MM-DDTHH:mm:ss.sssZ'],
  agent: ['the agent', (v) => isSealedText(v) && v.length > 0, 'must be non-empty text with no "|" and no control character'],
  instrumentId: ['the instrument id', isSealedText, 'must be text with no "|" and no control character'],
  sensorType: ['the measurement type', isSealedText, 'must be text with no "|" and no control character'],
  value: ['the value', isSealedText, 'must be text with no "|" and no control character'],
  unit: ['the unit', isSealedText, 'must be text with no "|" and no control character'],
  capturedAt: ['the capture time', isReadingTime, 'must be a real UTC time written as YYYY-MM-DDTHH:mm:ss.sssZ (the milliseconds may be left out)'],
}

// The problems of one record's sealed fields, as phrases: [] when f holds exactly the fields of its kind, each valid.
function _fieldProblems(kind, f) {
  const k = KINDS[kind]
  if (!_isObj(f)) return [{ code: 'f-form', text: 'the sealed fields f must be a JSON object' }]
  const out = []
  const extra = Object.keys(f).filter((x) => !k.fields.includes(x))
  const missing = k.fields.filter((x) => !_own(f, x))
  if (extra.length) out.push({ code: 'f-key-unknown', text: `its sealed fields hold ${extra.length === 1 ? 'an unknown field' : 'unknown fields'} ${extra.slice(0, 5).map((x) => _clip(x)).join(', ')}${extra.length > 5 ? ' and more' : ''} (a ${kind} record holds exactly: ${k.fields.join(', ')})` })
  if (missing.length) out.push({ code: 'f-key-missing', text: `the sealed ${missing.length === 1 ? 'field' : 'fields'} ${missing.map((x) => `"${x}"`).join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing` })
  for (const name of k.fields) {
    if (!_own(f, name)) continue
    const v = f[name]
    if (name === 'event') {
      if (typeof v !== 'string' || !k.events.includes(v)) out.push({ code: 'event', text: `the event ${typeof v === 'string' ? _clip(v) : 'value'} is not allowed for a ${kind} record (allowed: ${k.events.join(', ')})` })
      continue
    }
    const [label, ok, rule] = _FIELD[name]
    if (typeof v !== 'string') { out.push({ code: 'field', text: `${label} must be a JSON string` }); continue }
    if (ok(v)) continue
    out.push({ code: 'field', text: name === 'path' ? `the path is not valid: ${validatePath(v)}` : `${label} ${rule}` })
  }
  return out
}

function _checkFields(kind, f) {
  if (!_own(KINDS, kind)) throw new Error(`Unknown kind ${_clip(kind)}.`)
  const p = _fieldProblems(kind, f)
  if (p.length) throw new Error(`Not a valid ${kind} record: ${p.map((x) => x.text).join('; ')}.`)
}

// ----------------------------------------------------------------------------------------------- serialization (3.1)
function _ordered(o) {
  if (!_isObj(o)) throw new TypeError('Expected a header or a record object.')
  const isHeader = _own(o, 'format')
  const keys = isHeader ? HEADER_KEYS : RECORD_KEYS
  const unknown = Object.keys(o).filter((k) => !keys.includes(k))
  if (unknown.length) throw new Error(`Unknown ${isHeader ? 'header' : 'record'} key ${_clip(unknown[0])}.`)
  const out = {}
  for (const k of keys) {
    if (!_own(o, k) || o[k] === undefined) continue
    if (k === 'f' && _isObj(o.f) && _own(KINDS, o.kind)) {
      const f = {}
      const fk = KINDS[o.kind].fields
      for (const name of fk) if (_own(o.f, name)) f[name] = o.f[name]
      for (const name of Object.keys(o.f)) if (!fk.includes(name)) throw new Error(`Unknown sealed field ${_clip(name)} for kind ${o.kind}.`)
      out.f = f
    } else out[k] = o[k]
  }
  return out
}

function canonicalJSON(obj) {
  return JSON.stringify(_ordered(obj))
}

function serializeLine(obj) {
  return canonicalJSON(obj) + '\n'
}

// --------------------------------------------------------------------------------------------- creating a ledger
async function createHeader({ station, privateKey, publicKeyHex: pk, publicKey, agent, createdAt, ledgerId } = {}) {
  if (!pk && publicKey) pk = await publicKeyHex(publicKey)
  if (typeof pk !== 'string' || !_HEX130.test(pk)) throw new Error('createHeader needs the public key (publicKeyHex: 130 hex, or publicKey).')
  createdAt = createdAt || new Date().toISOString()
  ledgerId = ledgerId || toHex(globalThis.crypto.getRandomValues(new Uint8Array(16)))
  if (!_stationOk(station)) throw new Error('The station must be 1 to 64 characters with no "|" and no control character.')
  if (!isTime(createdAt)) throw new Error('createdAt must be a real UTC time written as YYYY-MM-DDTHH:mm:ss.sssZ.')
  if (!_HEX32.test(ledgerId)) throw new Error('The ledger id must be 32 lowercase hex characters.')
  if (agent !== undefined && typeof agent !== 'string') throw new Error('The agent must be text.')
  const h = { format: FORMAT, version: FORMAT_VERSION, ledgerId, createdAt, station, alg: ALG, publicKey: pk, keyId: keyIdOf(pk) }
  h.g = genesisOf(h)
  h.sig = await signLink(privateKey, h.g)
  if (!(await verifyLink(pk, h.g, h.sig))) throw new Error('The private key does not belong to this public key.')
  if (agent) h.ctx = { agent }
  return h
}

function _recordBody({ n, prev, kind, f, ctx }) {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('A record number n must be a whole number from 1.')
  if (!isHex(prev, 64)) throw new Error('prev must be the previous link: 64 lowercase hex characters.')
  _checkFields(kind, f)
  if (ctx !== undefined && ctx !== null && !_isObj(ctx)) throw new Error('ctx must be a plain object.')
  const of = {}
  for (const name of KINDS[kind].fields) of[name] = f[name]
  const r = fingerprintOf(kind, of)
  return { n, kind, f: of, r, prev, h: linkOf(prev, r, n), ctx: ctx || undefined }
}

const _finish = (b, sig) => {
  const o = { n: b.n, kind: b.kind, f: b.f, r: b.r, prev: b.prev, h: b.h, sig }
  if (b.ctx) o.ctx = b.ctx
  return o
}

async function createRecord({ n, prev, kind, f, privateKey, ctx } = {}) {
  const b = _recordBody({ n, prev, kind, f, ctx })
  return _finish(b, await signLink(privateKey, b.h))
}

// Several records after head {n, h}: links are computed in order, signatures in parallel.
async function createRecords({ head, items, privateKey, concurrency = 32 } = {}) {
  if (!head || !Number.isSafeInteger(head.n) || !isHex(head.h, 64)) throw new Error('createRecords needs the head {n, h} to continue from.')
  const bodies = []
  let n = head.n, prev = head.h
  for (const it of items) {
    const b = _recordBody({ n: ++n, prev, kind: it.kind, f: it.f, ctx: it.ctx })
    bodies.push(b)
    prev = b.h
  }
  const sigs = new Array(bodies.length)
  await _pool(bodies.length, concurrency, async (i) => { sigs[i] = await signLink(privateKey, bodies[i].h) })
  return bodies.map((b, i) => _finish(b, sigs[i]))
}

// ---------------------------------------------------------------------------------------------------- parsing (3.1)
function _where(line, n) {
  if (line === 1) return 'Line 1 (header): '
  if (line == null) return ''
  return Number.isSafeInteger(n) && n >= 1 ? `Line ${line} (record ${n}): ` : `Line ${line}: `
}

function _problem(line, n, code, detail) {
  const msg = detail[0].toUpperCase() + detail.slice(1)
  return { line, n: Number.isSafeInteger(n) && n >= 1 && line !== 1 ? n : null, code, message: (line == null ? msg : _where(line, n) + detail) + '.', detail }
}

function _decode(input, problems) {
  if (typeof input === 'string') return input
  const bytes = _bytesOf(input)
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    // find the lines that are not UTF-8, then go on with a lossy reading so every other problem is still found
    const lossy = new TextDecoder('utf-8', { ignoreBOM: true }), strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
    let start = 0, line = 1
    for (let i = 0; i <= bytes.length; i++) {
      if (i === bytes.length || bytes[i] === 0x0a) {
        try { strict.decode(bytes.subarray(start, i)) } catch { problems.push(_problem(line, null, 'not-utf8', 'the line is not valid UTF-8 text')) }
        start = i + 1
        line++
      }
    }
    return lossy.decode(bytes)
  }
}

// Structure only: the lines, each parsed as JSON (obj, or null when it cannot be read), and the problems of form a
// line can have before its content is looked at (not UTF-8, carriage return, blank, not JSON, no final newline).
function parseLedger(input) {
  const problems = []
  const text = _decode(input, problems)
  const parts = text.split('\n')
  const tail = parts.pop()
  const raw = parts.map((t) => ({ t, nl: true }))
  if (tail !== '') raw.push({ t: tail, nl: false })
  const lines = []
  if (!raw.length) problems.push(_problem(null, null, 'empty', 'the ledger is empty: it has no header line'))
  for (let i = 0; i < raw.length; i++) {
    const line = i + 1
    let t = raw[i].t
    if (i === 0 && t.startsWith('\ufeff')) {
      problems.push(_problem(line, null, 'bom', 'the ledger starts with a byte order mark (perhaps added by an editor); a ledger starts with the header\'s "{"'))
      t = t.slice(1)
    }
    if (t.endsWith('\r')) {
      problems.push(_problem(line, null, 'crlf', 'the line ends with a carriage return (a Windows line ending, perhaps added by an editor or a copy); a ledger line ends with a newline only'))
      t = t.slice(0, -1)
    }
    if (t === '') {
      problems.push(_problem(line, null, 'blank', 'the line is blank; every line must hold one JSON object'))
      lines.push({ line, text: t, obj: null })
      continue
    }
    let obj = null, parsed = true
    try { obj = JSON.parse(t) } catch { parsed = false }
    const n = _isObj(obj) ? obj.n : null
    if (!parsed) problems.push(_problem(line, null, raw[i].nl ? 'json' : 'truncated', raw[i].nl ? 'the line is not valid JSON' : 'the line is cut off: it is not complete JSON and has no newline at the end (the ledger may have been cut short while a record was being written)'))
    else if (!_isObj(obj)) { problems.push(_problem(line, null, 'not-object', 'the line is not a JSON object')); obj = null }
    if (parsed && !raw[i].nl) problems.push(_problem(line, n, 'no-newline', 'the last line does not end with a newline, so it may be incomplete'))
    lines.push({ line, text: t, obj })
  }
  return { lines, header: lines.length ? lines[0].obj : null, records: lines.slice(1).map((l) => l.obj), problems }
}

// ---------------------------------------------------------------------------------------------- verification (3.7)
function _checkHeader(o, text, add) {
  const keys = Object.keys(o)
  const unknown = keys.filter((k) => !HEADER_KEYS.includes(k))
  const missing = HEADER_KEYS.filter((k) => k !== 'ctx' && !_own(o, k))
  if (_own(o, 'n') && _own(o, 'kind') && !_own(o, 'format')) {
    add('header-missing', 'this line is a record, not the header: the header line is missing')
    return false
  }
  if (unknown.length) add('key-unknown', `the header has ${unknown.length === 1 ? 'an unknown key' : 'unknown keys'} ${unknown.slice(0, 5).map((k) => _clip(k)).join(', ')}`)
  if (missing.length) add('key-missing', `the header's ${missing.length === 1 ? 'key' : 'keys'} ${missing.map((k) => `"${k}"`).join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing`)
  if (_own(o, 'format') && o.format !== FORMAT) add('header-format', `the format is ${_clip(String(o.format))}, not "${FORMAT}": this is not an Immutable QC ledger`)
  if (_own(o, 'version') && o.version !== FORMAT_VERSION) add('header-version', typeof o.version === 'number' ? `the ledger is format version ${o.version}; this tool reads version ${FORMAT_VERSION}` : `the version must be the number ${FORMAT_VERSION}`)
  if (_own(o, 'ledgerId') && !(typeof o.ledgerId === 'string' && _HEX32.test(o.ledgerId))) add('header-field', 'the ledger id must be 32 lowercase hex characters')
  if (_own(o, 'createdAt') && !isTime(o.createdAt)) add('header-field', 'the creation time must be a real UTC time written as YYYY-MM-DDTHH:mm:ss.sssZ')
  if (_own(o, 'station') && !_stationOk(o.station)) add('header-field', 'the station must be 1 to 64 characters with no "|" and no control character')
  if (_own(o, 'alg') && o.alg !== ALG) add('header-field', `the algorithm must be "${ALG}"`)
  const pkOk = typeof o.publicKey === 'string' && _HEX130.test(o.publicKey)
  if (_own(o, 'publicKey') && !pkOk) add('header-field', 'the public key must be 130 lowercase hex characters starting with 04')
  if (_own(o, 'keyId')) {
    if (!(typeof o.keyId === 'string' && _HEX16.test(o.keyId))) add('header-field', 'the key id must be 16 lowercase hex characters')
    else if (pkOk && keyIdOf(o.publicKey) !== o.keyId) add('header-keyid', 'the key id does not match the public key (it must be the first 16 hex of the SHA-256 of the public key)')
  }
  if (_own(o, 'g')) {
    if (!(typeof o.g === 'string' && _HEX64.test(o.g))) add('header-field', 'the genesis fingerprint g must be 64 lowercase hex characters')
    else if (['ledgerId', 'createdAt', 'station', 'alg', 'publicKey'].every((k) => typeof o[k] === 'string') && genesisOf(o) !== o.g) add('header-g', "the genesis fingerprint g does not match the header's sealed fields (ledger id, creation time, station, algorithm and public key)")
  }
  if (_own(o, 'sig')) {
    const sp = sigProblem(o.sig)
    if (sp) add(sp === 'high-s' ? 'sig-high-s' : 'sig-form', _sigText(sp))
  }
  if (_own(o, 'ctx') && !_isObj(o.ctx)) add('ctx-form', 'ctx (not sealed) must be a JSON object')
  if (!unknown.length && !missing.length && canonicalJSON(o) !== text) add('canonical', 'the line is not in its one canonical form (for example an extra space, another key order, an escaped character or a duplicate key)')
  return pkOk
}

function _sigText(sp) {
  return sp === 'high-s' ? 'the signature is in its high-S form, which is refused (a signature is accepted only in its low-S form)'
    : sp === 'range' ? 'the signature is not a valid P-256 signature (r or s is out of range)'
      : 'the signature must be 128 lowercase hex characters'
}

const _NONE = Object.freeze([])
const _CHUNK = 2048
const _yield = () => new Promise((resolve) => setTimeout(resolve, 0))
const _fieldOrder = (f, names) => { const k = Object.keys(f); if (k.length !== names.length) return false; for (let i = 0; i < k.length; i++) if (k[i] !== names[i]) return false; return true }

async function verifyLedger(input, { concurrency, onProgress, verifyBatch, batchSize = 1024 } = {}) {
  const batched = typeof verifyBatch === 'function'
  concurrency = Math.max(1, Math.floor(Number(concurrency)) || (batched ? 8 : 64))
  batchSize = Math.max(1, Math.floor(Number(batchSize)) || 1024)
  const parsed = parseLedger(input)
  const problems = parsed.problems.slice()
  const lines = parsed.lines
  let header = null, h0 = null, pubKey = null, keyUnusable = false
  const head = lines[0]
  if (head && head.obj) {
    header = head.obj
    const add = (code, detail) => problems.push(_problem(1, null, code, detail))
    const pkOk = _checkHeader(header, head.text, add)
    if (typeof header.g === 'string' && _HEX64.test(header.g)) h0 = header.g
    if (pkOk) {
      try { pubKey = await importPublicKeyHex(header.publicKey) } catch (e) {
        if (/secure page/.test(String(e && e.message))) throw e
        add('header-key', 'the public key is not a valid P-256 public key')
      }
    }
    if (pubKey && h0 && sigProblem(header.sig) === null && !(await _subtle().verify(_SIGALG, pubKey, fromHex(header.sig), fromHex(h0)))) {
      add('header-sig', "the header's signature does not verify with its public key")
    }
    if (!pubKey) keyUnusable = true
  }

  // Signatures are checked while the lines are: each record's check is queued as soon as its line is read, at most
  // `concurrency` at a time, and the loop yields every CHUNK lines so the checks (and a page's progress) can run.
  const total = lines.length - 1
  const subtle = pubKey ? _subtle() : null
  const queue = []
  let qi = 0, running = 0, done = 0, reported = -1, settle = null
  const report = () => { if (onProgress && done !== reported) { reported = done; onProgress(done, total) } }
  const one = (j, ok) => {
    if (ok === false) problems.push(_problem(j.line, j.n, 'sig', "the signature does not verify with the ledger's public key"))
    else if (ok !== true) problems.push(_problem(j.line, j.n, 'sig-error', 'the signature could not be checked (the check itself failed), so this record cannot be confirmed'))
    const before = done++
    if ((before >> 10) !== (done >> 10)) report()
  }
  const pump = () => {
    while (running < concurrency && qi < queue.length) {
      running++
      if (batched) {
        const end = Math.min(queue.length, qi + batchSize)
        const batch = queue.slice(qi, end)
        for (let k = qi; k < end; k++) queue[k] = null
        qi = end
        Promise.resolve().then(() => verifyBatch(header.publicKey, batch.map((j) => ({ h: j.h, sig: j.sig })))).then(
          (res) => { const okList = Array.isArray(res) && res.length === batch.length; batch.forEach((j, k) => one(j, okList ? res[k] : null)) },
          () => batch.forEach((j) => one(j, null)),
        ).then(() => { running--; pump() })
      } else {
        const j = queue[qi]
        queue[qi++] = null
        subtle.verify(_SIGALG, pubKey, _hexBytes(j.sig), _hexBytes(j.h)).then((ok) => one(j, ok), () => one(j, null)).then(() => { running--; pump() })
      }
    }
    if (settle && running === 0 && qi >= queue.length) settle()
  }
  report()
  let prevH = h0, lastN = 0, firstRecord = true
  for (let i = 1; i < lines.length; i++) {
    if (i % _CHUNK === 0) { pump(); report(); await _yield() }
    const { line, text, obj: o } = lines[i]
    // a blank line holds no record (the next one continues from the record before it); any other unreadable line
    // is taken to be a record that cannot be checked
    if (!o) { if (text !== '') { lastN++; prevH = null; firstRecord = false } done++; continue }
    const nOk = Number.isSafeInteger(o.n) && o.n >= 1
    const n = nOk ? o.n : null
    const add = (code, detail) => problems.push(_problem(line, n, code, detail))
    if (_own(o, 'format') && !_own(o, 'n')) add('header-again', 'this line is a header; only line 1 is the header')
    const keys = Object.keys(o)
    const exact = (keys.length === 7 || (keys.length === 8 && keys[7] === 'ctx')) && keys[0] === 'n' && keys[1] === 'kind' && keys[2] === 'f' && keys[3] === 'r' && keys[4] === 'prev' && keys[5] === 'h' && keys[6] === 'sig'
    const unknown = exact ? _NONE : keys.filter((k) => !RECORD_KEYS.includes(k))
    const missing = exact ? _NONE : RECORD_KEYS.filter((k) => k !== 'ctx' && !_own(o, k))
    if (unknown.length) add('key-unknown', `the record has ${unknown.length === 1 ? 'an unknown key' : 'unknown keys'} ${unknown.slice(0, 5).map((k) => _clip(k)).join(', ')}`)
    if (missing.length) add('key-missing', `the record's ${missing.length === 1 ? 'key' : 'keys'} ${missing.map((k) => `"${k}"`).join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing`)

    // the record number: one more than the record before it
    const expected = lastN + 1
    if (_own(o, 'n') && !nOk) add('n-form', 'the record number n must be a whole number from 1')
    else if (nOk && n !== expected) {
      if (lastN === 0) add('n-gap', `the first record must be number 1, not ${n}`)
      else if (n > expected) add('n-gap', `the record number jumps from ${lastN} to ${n}: ${n === expected + 1 ? `record ${expected} is` : `records ${expected} to ${n - 1} are`} missing`)
      else if (n === lastN) add('n-order', `the record number ${n} appears twice: a record was copied or inserted here`)
      else add('n-order', `the record number goes back from ${lastN} to ${n}: a record was moved or copied here`)
    }
    lastN = nOk ? n : expected

    const kindOk = typeof o.kind === 'string' && _own(KINDS, o.kind)
    if (_own(o, 'kind') && !kindOk) add('kind', `the kind ${_clip(String(o.kind))} is not one this format defines (file, file-removed, session, reading)`)
    let fieldsOk = false
    if (kindOk && _own(o, 'f')) {
      const fp = _fieldProblems(o.kind, o.f)
      for (const p of fp) add(p.code, p.text)
      fieldsOk = !fp.some((p) => p.code === 'f-form' || p.code === 'f-key-unknown' || p.code === 'f-key-missing')
      if (fieldsOk && !KINDS[o.kind].fields.every((k) => typeof o.f[k] === 'string')) fieldsOk = false
    }
    const rForm = typeof o.r === 'string' && _HEX64.test(o.r)
    const pForm = typeof o.prev === 'string' && _HEX64.test(o.prev)
    const hForm = typeof o.h === 'string' && _HEX64.test(o.h)
    if (_own(o, 'r') && !rForm) add('r-form', 'the fingerprint r must be 64 lowercase hex characters')
    if (_own(o, 'prev') && !pForm) add('prev-form', 'the previous link prev must be 64 lowercase hex characters')
    if (_own(o, 'h') && !hForm) add('h-form', 'the link h must be 64 lowercase hex characters')
    const sp = _own(o, 'sig') ? sigProblem(o.sig) : 'missing'
    if (sp && sp !== 'missing') add(sp === 'high-s' ? 'sig-high-s' : 'sig-form', _sigText(sp))
    if (_own(o, 'ctx') && !_isObj(o.ctx)) add('ctx-form', 'ctx (not sealed) must be a JSON object')
    if (!unknown.length && !missing.length && (!kindOk || fieldsOk)) {
      // canonical: the line is JSON.stringify of what it parses to, and its keys (and f's) are in the format's order
      let canon = exact && kindOk && JSON.stringify(o) === text && _fieldOrder(o.f, KINDS[o.kind].fields)
      if (!canon) { try { canon = canonicalJSON(o) === text } catch { canon = false } }
      if (!canon) add('canonical', 'the line is not in its one canonical form (for example an extra space, another key order, an escaped character or a duplicate key)')
    }

    // fingerprint, previous link, link
    const rCalc = kindOk && fieldsOk ? fingerprintOf(o.kind, o.f) : null
    if (rCalc && rForm && rCalc !== o.r) add('r', `the ${KINDS[o.kind].label} fingerprint does not match its sealed fields`)
    if (pForm && prevH !== null && o.prev !== prevH) {
      add('prev', prevH === h0 && firstRecord ? "it does not continue from the header: its previous link is not the header's genesis fingerprint g (a record was removed, inserted or moved here)"
        : 'it does not continue from the record before it: its previous link is not the link of the line before (a record was removed, inserted or moved here)')
    }
    if (hForm && nOk && (rCalc || rForm) && (prevH !== null || pForm)) {
      const base = prevH !== null ? prevH : o.prev
      const rUse = rCalc || o.r
      if (linkOf(base, rUse, n) !== o.h) {
        // name the link only when no other problem of this record explains it
        const alts = []
        for (const b of new Set([base, pForm ? o.prev : base])) for (const r of new Set([rUse, rForm ? o.r : rUse])) for (const k of new Set([n, expected])) alts.push(linkOf(b, r, k))
        if (!alts.includes(o.h)) add('h', 'the stored link h does not match the one recomputed from the previous link, the fingerprint and the record number')
      }
    }
    if (hForm && sp === null && pubKey) queue.push({ line, n, h: o.h, sig: o.sig })
    else done++
    prevH = hForm ? o.h : null
    firstRecord = false
  }
  if (keyUnusable && header && lines.length > 1) problems.push(_problem(1, null, 'sig-unchecked', "the records' signatures could not be checked, because the header's public key cannot be used"))
  await new Promise((resolve) => { settle = resolve; pump() })
  report()

  problems.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
  const firstProblemLine = problems.length ? Math.max(1, problems[0].line ?? 1) : null
  const headerOk = !!header && (firstProblemLine === null || firstProblemLine > 1)
  const limit = firstProblemLine === null ? lines.length : firstProblemLine - 1
  const good = headerOk ? lines.slice(1, limit).map((l) => l.obj) : []
  const st = _state(good)
  const records = lines.slice(1).map((l) => l.obj)
  return {
    ok: problems.length === 0,
    header,
    headerOk,
    keyId: header && typeof header.keyId === 'string' ? header.keyId : null,
    records,
    recordCount: records.length,
    goodCount: good.length,
    firstProblemLine,
    problems,
    head: headerOk ? (good.length ? { n: good[good.length - 1].n, h: good[good.length - 1].h } : { n: 0, h: header.g }) : null,
    files: st.files,
    sessions: st.sessions,
    gaps: st.gaps,
    kinds: st.kinds,
  }
}

// per-path state, watch sessions and the gaps between them, from records that passed every check
function _state(good) {
  const st = { files: new Map(), sessions: [], kinds: { file: 0, 'file-removed': 0, session: 0, reading: 0 } }
  for (let i = 0; i < good.length; i++) _stateAdd(st, good[i], i + 2)
  return { files: st.files, sessions: st.sessions, gaps: _gapsOf(st.sessions), kinds: st.kinds }
}

// One good record (on ledger line `line`) into the state {files, sessions, kinds}. The session that file records count
// toward and the open watch are read from the last session: a scan, or a watch not stopped yet, takes file records; a
// watch not stopped yet is open (a start or a scan ends it, uncleanly); a stop, or a stray stop, ends both.
function _stateAdd(st, o, line) {
  const { files, sessions, kinds } = st
  const last = sessions.length ? sessions[sessions.length - 1] : null
  const open = last && last.open ? last : null
  const cur = last && !last.stray && (last.type === 'scan' || last.open) ? last : null
  const f = o.f
  kinds[o.kind]++
  if (o.kind === 'file' || o.kind === 'file-removed') {
    let e = files.get(f.path)
    if (!e) { e = { path: f.path, versions: [], latest: null }; files.set(f.path, e) }
    const v = { n: o.n, line, kind: o.kind, event: f.event, observedAt: f.observedAt }
    if (o.kind === 'file') { v.sha256 = f.sha256; v.bytes = f.bytes }
    if (o.ctx && o.ctx.modifiedAt !== undefined) v.modifiedAt = o.ctx.modifiedAt
    e.versions.push(v)
    e.latest = v
    if (cur) { cur.files++; cur.lastN = o.n; if (f.observedAt > cur.lastAt) cur.lastAt = f.observedAt }
  } else if (o.kind === 'session') {
    const ev = f.event
    if (ev === 'watch-started' || ev === 'scan') {
      if (open) { open.clean = false; open.open = false; open.endedByN = o.n }
      sessions.push({ type: ev === 'scan' ? 'scan' : 'watch', startN: o.n, start: f.at, stopN: null, stop: null, clean: ev === 'scan' ? true : null, open: ev !== 'scan', endedByN: null, files: 0, lastN: o.n, lastAt: f.at, station: f.station, agent: f.agent })
    } else if (ev === 'watch-stopped') {
      if (open) {
        Object.assign(open, { stopN: o.n, stop: f.at, clean: true, open: false, lastN: o.n })
        if (f.at > open.lastAt) open.lastAt = f.at
      } else {
        sessions.push({ type: 'watch', startN: null, start: null, stopN: o.n, stop: f.at, clean: false, open: false, endedByN: null, files: 0, lastN: o.n, lastAt: f.at, station: f.station, agent: f.agent, stray: true })
      }
    }
  }
}

function _gapsOf(sessions) {
  const gaps = []
  const real = sessions.filter((s) => !s.stray)
  for (let i = 0; i + 1 < real.length; i++) {
    const a = real[i], b = real[i + 1]
    const from = a.type === 'watch' && a.clean ? a.stop : a.lastAt
    gaps.push({ afterN: a.lastN, beforeN: b.startN, from, to: b.start, ms: Date.parse(b.start) - Date.parse(from) })
  }
  return gaps
}

// Brings a verified ledger up to date with records just appended to it, without reading or verifying the ledger again
// (the agent keeps `verified` in memory between polls; a poll never re-verifies the whole ledger). `verified` must have
// no problem, and the records must continue its head: each record's number, previous link, sealed fields, fingerprint
// and link are checked (its signature is not: the caller just made it). A list that fails changes nothing. Updates
// records, recordCount, goodCount, head, files, sessions, gaps and kinds in place, and returns `verified`.
function extendVerified(verified, records) {
  if (!verified || !verified.ok || !verified.head || verified.goodCount !== verified.recordCount) throw new Error('extendVerified needs a ledger that verified with no problem.')
  if (!Array.isArray(records)) throw new TypeError('extendVerified needs an array of records.')
  let { n, h } = verified.head
  for (const o of records) {
    const where = `Record ${_isObj(o) && Number.isSafeInteger(o.n) ? o.n : '?'}`
    if (!_isObj(o) || o.n !== n + 1) throw new Error(`${where} does not continue the head: the next record is number ${n + 1}.`)
    if (o.prev !== h) throw new Error(`${where} does not continue the head: its previous link is not the head's link.`)
    if (typeof o.kind !== 'string' || !_own(KINDS, o.kind)) throw new Error(`${where} has an unknown kind.`)
    const fp = _fieldProblems(o.kind, o.f)
    if (fp.length) throw new Error(`${where} is not valid: ${fp.map((x) => x.text).join('; ')}.`)
    if (fingerprintOf(o.kind, o.f) !== o.r || linkOf(h, o.r, o.n) !== o.h) throw new Error(`${where}'s fingerprint or link does not match its sealed fields.`)
    if (sigProblem(o.sig) !== null) throw new Error(`${where}'s signature is not a low-S signature of 128 hex characters.`)
    n = o.n
    h = o.h
  }
  const st = { files: verified.files, sessions: verified.sessions, kinds: verified.kinds }
  for (const o of records) {
    _stateAdd(st, o, verified.recordCount + 2)
    verified.records.push(o)
    verified.recordCount++
    verified.goodCount++
  }
  verified.head = { n, h }
  verified.gaps = _gapsOf(verified.sessions)
  return verified
}

// Whether a scan now is the first this ledger ever made (planSeal mode 'first', events `existing`): no file or removal
// record, no stopped watch, and at most one session start (the one the caller may have just written).
function isFirstScan(verified) {
  const k = verified.kinds
  if (k.file || k['file-removed']) return false
  const s = verified.sessions
  return s.length <= 1 && !s.some((x) => x.stopN !== null)
}

// ------------------------------------------------------------------------------------------------------- planSeal
function _fileMap(files) {
  if (files == null) return null
  let entries
  if (files instanceof Map) entries = [...files.entries()]
  else if (Array.isArray(files)) entries = files.map((x) => [x.path, x])
  else if (_isObj(files)) entries = Object.entries(files)
  else throw new TypeError('The file list must be a Map, an object or an array.')
  const m = new Map()
  for (const [p, v] of entries) {
    const why = validatePath(p)
    if (why) throw new Error(`The file list holds an invalid path (${why}): ${JSON.stringify(p)}. Use encodePath() on each relative path.`)
    if (v !== null && v !== undefined) {
      if (!_isObj(v) || !isHex(v.sha256, 64)) throw new Error(`The file list entry for ${p} needs its SHA-256 as 64 lowercase hex characters.`)
      const b = typeof v.bytes === 'bigint' ? String(v.bytes) : typeof v.bytes === 'number' && Number.isSafeInteger(v.bytes) && v.bytes >= 0 ? String(v.bytes) : v.bytes
      if (typeof b !== 'string' || !_DEC.test(b)) throw new Error(`The file list entry for ${p} needs its size in bytes.`)
      m.set(p, { ...v, bytes: b })
    } else m.set(p, null)
  }
  return m
}

// The records to seal now, so the agent and the app follow one diff rule: a file seen for the first time (or back
// after a removal) is new, a file whose SHA-256 differs from its latest sealed version is changed (a touched file
// with the same bytes is not sealed again), and a sealed file that is no longer present is removed. Events by mode
// (MODE_EVENTS): 'first' (the first scan of a new ledger: existing), 'watch' (seen while a watch runs: added,
// changed, removed), 'unwatched' (found by a later scan or watch start: the -unwatched forms). In mode 'first' a path
// that already has history gets the -unwatched event. Order: present files by path, then removals by path.
function planSeal(verified, files, { mode, station, observedAt, ignore } = {}) {
  const ev = MODE_EVENTS[mode]
  if (!ev || !_own(MODE_EVENTS, mode)) throw new Error("planSeal needs mode 'first', 'watch' or 'unwatched'.")
  if (!_stationOk(station)) throw new Error('The station must be 1 to 64 characters with no "|" and no control character.')
  if (!isTime(observedAt)) throw new Error('observedAt must be a real UTC time written as YYYY-MM-DDTHH:mm:ss.sssZ.')
  const present = _fileMap(files) || new Map()
  const ig = ignoreMatcher(ignore)
  const skip = (p) => isLedgerFolderPath(p) || ig(p)
  const state = verified.files
  const out = []
  for (const p of [...present.keys()].sort(_cmp)) {
    const v = present.get(p)
    if (v === null || skip(p)) continue
    const e = state.get(p), latest = e && e.latest
    let event
    if (!latest || latest.kind === 'file-removed') event = mode === 'first' && e ? 'added-unwatched' : ev[0]
    else if (latest.sha256 !== v.sha256) event = ev[1]
    else continue
    const at = v.observedAt !== undefined ? v.observedAt : observedAt
    if (!isTime(at)) throw new Error(`The observation time of ${p} must be a real UTC time written as YYYY-MM-DDTHH:mm:ss.sssZ.`)
    const item = { kind: 'file', f: { station, path: p, sha256: v.sha256, bytes: v.bytes, observedAt: at, event } }
    if (v.modifiedAt !== undefined) item.ctx = { modifiedAt: v.modifiedAt }
    out.push(item)
  }
  const gone = [...state.values()].filter((e) => e.latest.kind === 'file' && !present.has(e.path) && !skip(e.path)).map((e) => e.path).sort(_cmp)
  for (const p of gone) out.push({ kind: 'file-removed', f: { station, path: p, observedAt, event: ev[2] } })
  return out
}

const _cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

// ---------------------------------------------------------------------------------------------------- audit (3.8)
function parseHead(s) {
  if (_isObj(s) && Number.isSafeInteger(s.n) && s.n >= 0 && isHex(s.h, 64)) return { n: s.n, h: s.h }
  const m = typeof s === 'string' && /^\s*(0|[1-9][0-9]*):([0-9a-fA-F]{64})\s*$/.exec(s)
  if (!m || !Number.isSafeInteger(Number(m[1]))) throw new Error('A head is written as <record number>:<64 hex link>, for example 12:9f86d081….')
  return { n: Number(m[1]), h: m[2].toLowerCase() }
}

function formatHead(head) {
  return `${head.n}:${head.h}`
}

const _STATES = ['match', 'changed', 'missing', 'removed', 'back after removal', 'not sealed', 'not checked']

function audit(verified, files, { expectHead, expectKeyId, strict = false, auditedAt, where = 'command line', tool, ignore, folder } = {}) {
  const present = _fileMap(files)
  const checked = present !== null
  const ig = ignoreMatcher(ignore)
  const H = verified.header
  const problems = verified.problems.map((p) => ({ code: p.code, line: p.line, n: p.n, message: p.message }))
  const ledgerProblems = problems.length
  const fileProblems = [], notes = []
  const out = []
  const c = { sealed: verified.files.size, match: 0, changed: 0, missing: 0, removed: 0, backAfterRemoval: 0, notSealed: 0, notChecked: 0 }
  let bytesChecked = 0, filesChecked = 0
  const multi = [], unwatched = [], back = [], unread = []

  for (const e of verified.files.values()) {
    const fv = e.versions.filter((v) => v.kind === 'file')
    const latest = e.latest
    const lastFile = fv[fv.length - 1] || null
    const cur = checked ? (present.has(e.path) ? present.get(e.path) : undefined) : undefined
    let state, matchesN = null
    if (!checked) state = 'not checked'
    else if (cur === null) state = 'not checked'
    else if (latest.kind === 'file') {
      if (cur === undefined) state = 'missing'
      else if (cur.sha256 === latest.sha256) state = 'match'
      else {
        state = 'changed'
        for (let i = fv.length - 2; i >= 0; i--) if (fv[i].sha256 === cur.sha256) { matchesN = fv[i].n; break }
      }
    } else {
      state = cur === undefined ? 'removed' : 'back after removal'
      if (cur) for (let i = fv.length - 1; i >= 0; i--) if (fv[i].sha256 === cur.sha256) { matchesN = fv[i].n; break }
    }
    if (cur) { bytesChecked += Number(cur.bytes); filesChecked++ }
    const row = {
      path: e.path, state, versions: fv.length,
      latest: { n: latest.n, kind: latest.kind, event: latest.event, observedAt: latest.observedAt },
      sealed: lastFile ? { n: lastFile.n, sha256: lastFile.sha256, bytes: lastFile.bytes, observedAt: lastFile.observedAt } : null,
      present: cur ? { sha256: cur.sha256, bytes: cur.bytes } : null,
      matchesN,
      records: e.versions.map((v) => v.n),
    }
    out.push(row)
    if (state === 'match') c.match++
    else if (state === 'changed') {
      c.changed++
      fileProblems.push({ code: 'changed', path: e.path, message: `${e.path} changed since it was sealed in record ${latest.n}${matchesN ? `; it matches the earlier version sealed in record ${matchesN}` : ''}.` })
    } else if (state === 'missing') {
      c.missing++
      fileProblems.push({ code: 'missing', path: e.path, message: `${e.path} is missing: it was sealed in record ${latest.n}, and no removal was recorded.` })
    } else if (state === 'removed') c.removed++
    else if (state === 'back after removal') { c.backAfterRemoval++; back.push(`${e.path}: removed in record ${latest.n}, present again and not sealed since${matchesN ? ` (it matches the version sealed in record ${matchesN})` : ''}`) }
    else if (state === 'not checked') { c.notChecked++; if (checked) unread.push(`${e.path}: present, but it could not be read`) }
    if (fv.length > 1) multi.push(`${e.path}: ${fv.length} versions (records ${fv.map((v) => v.n).join(', ')})`)
    for (const v of e.versions) if (v.event.endsWith('-unwatched')) unwatched.push(`${e.path}: ${v.event} in record ${v.n}, found ${_when(v.observedAt)}`)
  }
  const notSealed = []
  if (checked) {
    for (const [p, v] of present) {
      if (verified.files.has(p) || isLedgerFolderPath(p) || ig(p)) continue
      c.notSealed++
      if (v) { bytesChecked += Number(v.bytes); filesChecked++ }
      notSealed.push(p)
      out.push({ path: p, state: 'not sealed', versions: 0, latest: null, sealed: null, present: v ? { sha256: v.sha256, bytes: v.bytes } : null, matchesN: null, records: [] })
    }
  }
  out.sort((a, b) => _cmp(a.path, b.path))
  fileProblems.sort((a, b) => _cmp(a.path, b.path))

  // expectations
  const expectations = {}
  if (expectHead !== undefined && expectHead !== null && expectHead !== '') {
    let exp = null, ok = false, message
    try { exp = parseHead(expectHead) } catch (e) { message = `The pinned head could not be read: ${e.message}` }
    if (exp) {
      const rec = exp.n === 0 ? null : verified.records[exp.n - 1]
      const actual = exp.n === 0 ? (H && H.g) : rec && rec.n === exp.n ? rec.h : null
      if (!H) message = 'The pinned head could not be checked, because the ledger has no readable header.'
      else if (exp.n > verified.recordCount) message = `The pinned head is record ${exp.n}, but the ledger has only ${_plural(verified.recordCount, 'record', 'records')}: records were removed from its end, or the head belongs to another ledger.`
      else if (exp.n > verified.goodCount && !(exp.n === 0 && verified.headerOk)) message = `The pinned head is record ${exp.n}, which comes after the first problem in the ledger, so it cannot be confirmed.`
      else if (actual !== exp.h) message = `Record ${exp.n}'s link is ${actual}, not the pinned ${exp.h}: the ledger was rewritten since the head was pinned, or the head belongs to another ledger.`
      else { ok = true; message = `Record ${exp.n}'s link matches the pinned head${verified.goodCount > exp.n ? ` (the ledger has grown since, to ${_plural(verified.goodCount, 'record', 'records')})` : ''}.` }
    }
    expectations.head = { expected: exp ? formatHead(exp) : String(expectHead), ok, message }
    if (!ok) fileProblems.unshift({ code: 'expect-head', message })
  }
  if (expectKeyId !== undefined && expectKeyId !== null && expectKeyId !== '') {
    const want = String(expectKeyId).trim().toLowerCase()
    const have = verified.keyId
    const ok = !!have && have === want
    const message = ok ? `The ledger's key id is the expected ${want}.` : `The ledger's key id is ${have || 'unknown'}, not the expected ${want}: it was signed with another key.`
    expectations.keyId = { expected: want, ok, message }
    if (!ok) fileProblems.unshift({ code: 'expect-key', message })
  }
  const expectFails = Object.values(expectations).filter((x) => !x.ok).length

  // notes
  const note = (code, message, items) => notes.push({ code, message, count: items.length, items })
  if (multi.length) note('sealed-more-than-once', `${_plural(multi.length, 'file was', 'files were')} sealed more than once (changed after the first seal).`, multi)
  if (unwatched.length) note('unwatched', `${_plural(unwatched.length, 'change was', 'changes were')} found by a later scan: ${unwatched.length === 1 ? 'it' : 'they'} happened while nothing was watching, so ${unwatched.length === 1 ? 'its' : 'their'} time is unknown.`, unwatched)
  if (notSealed.length) note('not-sealed', `${_plural(notSealed.length, 'file is', 'files are')} present but never sealed${verified.firstProblemLine ? ` by the records before the first problem (line ${verified.firstProblemLine})` : ''}.`, notSealed)
  if (back.length) note('back-after-removal', `${_plural(back.length, 'file is', 'files are')} present again after ${back.length === 1 ? 'its' : 'their'} removal was recorded, and not sealed since.`, back)
  if (unread.length) note('not-checked', `${_plural(unread.length, 'sealed file', 'sealed files')} could not be read, so ${unread.length === 1 ? 'it was' : 'they were'} not checked.`, unread)
  const unclean = verified.sessions.filter((s) => s.type === 'watch' && s.clean === false)
  if (unclean.length) {
    note('unclean-stop', `${_plural(unclean.length, 'watch session', 'watch sessions')} did not end cleanly (no stop record before the next start: for example a crash, a forced quit or a power loss).`,
      unclean.map((s) => (s.stray ? `record ${s.stopN} stops a watch that has no start record` : `the watch started in record ${s.startN} (${_when(s.start)}) has no stop record before record ${s.endedByN}`)))
  }
  if (verified.gaps.length) note('gaps', `Nothing was watching during ${_plural(verified.gaps.length, 'period', 'periods')} between sessions; changes made then are sealed with an -unwatched event and an unknown time.`,
    verified.gaps.map((g) => `from ${_when(g.from)} to ${_when(g.to)} (${formatDuration(g.ms)}), between record ${g.afterN} and record ${g.beforeN}`))

  const failing = ledgerProblems + c.changed + c.missing + expectFails + (strict ? notes.length : 0)
  const verdict = failing ? 'fail' : 'pass'
  const report = {
    format: AUDIT_FORMAT,
    version: 1,
    verdict,
    summary: '',
    strict: !!strict,
    filesChecked: checked,
    counts: { ...c, records: verified.recordCount, goodRecords: verified.goodCount, problems: ledgerProblems + fileProblems.length, ledgerProblems, notes: notes.length, filesRead: filesChecked, bytesRead: bytesChecked },
    problems: [...problems, ...fileProblems],
    notes,
    ledger: {
      ledgerId: H && typeof H.ledgerId === 'string' ? H.ledgerId : null,
      station: H && typeof H.station === 'string' ? H.station : null,
      keyId: verified.keyId,
      publicKey: H && typeof H.publicKey === 'string' ? H.publicKey : null,
      alg: H && typeof H.alg === 'string' ? H.alg : null,
      createdAt: H && typeof H.createdAt === 'string' ? H.createdAt : null,
      formatVersion: H ? H.version : null,
      intact: ledgerProblems === 0,
      records: verified.recordCount,
      goodRecords: verified.goodCount,
      firstProblemLine: verified.firstProblemLine,
      head: verified.head,
      kinds: verified.kinds,
      ctx: H && _isObj(H.ctx) ? H.ctx : null,
    },
    sessions: verified.sessions.map((s) => ({ type: s.type, startN: s.startN, start: s.start, stopN: s.stopN, stop: s.stop, clean: s.clean, open: s.open, endedByN: s.endedByN, files: s.files, station: s.station, agent: s.agent })),
    gaps: verified.gaps,
    expectations,
    files: out,
    method: {
      recomputed: checked
        ? ['the header: key id, genesis fingerprint and signature', "every record: fingerprint, link and signature (ECDSA P-256 with SHA-256, low-S only)", `the SHA-256 of every file present (${_plural(filesChecked, 'file', 'files')}, ${formatBytes(bytesChecked)})`]
        : ['the header: key id, genesis fingerprint and signature', "every record: fingerprint, link and signature (ECDSA P-256 with SHA-256, low-S only)", 'the files were not checked (the audit covers the ledger only)'],
      format: `${FORMAT} version ${FORMAT_VERSION}`,
      tool: tool || `immutableqc-core/${VERSION}`,
      core: VERSION,
      auditedAt: auditedAt || new Date().toISOString(),
      where: where === 'browser' ? 'in a browser' : 'on the command line',
    },
    rerun: [],
  }
  report.summary = _summary(report, expectations)
  const pin = verified.head && verified.head.n > 0 ? formatHead(verified.head) : null
  const dir = folder ? _shellArg(folder) : '<data folder>'
  report.rerun = [
    'In a browser: open immutableqc.com/app/ and drop the data folder. Every file is read in the browser; nothing is uploaded.',
    `On the command line: node iqc.mjs audit ${dir}${pin ? ` --expect-head ${pin}` : ''}${verified.keyId ? ` --expect-key ${verified.keyId}` : ''}`,
    pin ? `Pin the head ${pin} somewhere else (an email, an ELN entry, a printout). A later audit with --expect-head shows whether the ledger was rewritten from the start or cut short since.` : 'Pin the head once the ledger has records (iqc head), to expose a later rewrite.',
  ]
  return report
}

const _shellArg = (s) => (/^[\w./:@%+-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`)
const _when = (iso) => (typeof iso === 'string' && iso.length >= 19 ? `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC` : String(iso))

function _joinList(parts) {
  return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

function _summary(r, exp) {
  const c = r.counts
  if (r.verdict === 'pass') {
    const tail = c.notes ? ` (${_plural(c.notes, 'note', 'notes')})` : ''
    if (!r.filesChecked) return `Pass: the ledger is intact (${_plural(c.records, 'record', 'records')} checked); the files were not checked${tail}.`
    if (c.sealed === 0) return `Pass: the ledger is intact, and it seals no files yet${tail}.`
    if (c.match === 0) return `Pass: the ledger is intact, and every sealed file is recorded as removed${tail}.`
    if (c.match === 1) return `Pass: 1 file matches its seal, and the ledger is intact${tail}.`
    return `Pass: all ${formatCount(c.match)} files match their seals, and the ledger is intact${tail}.`
  }
  const parts = []
  if (c.changed) parts.push(`${_plural(c.changed, 'file', 'files')} changed since ${c.changed === 1 ? 'it was' : 'they were'} sealed`)
  if (c.missing) parts.push(`${_plural(c.missing, 'file is', 'files are')} missing`)
  if (c.ledgerProblems) parts.push(`the ledger has ${_plural(c.ledgerProblems, 'problem', 'problems')}`)
  if (exp.head && !exp.head.ok) parts.push('the pinned head does not match')
  if (exp.keyId && !exp.keyId.ok) parts.push('the key id is not the expected one')
  if (r.strict && c.notes) parts.push(`${_plural(c.notes, 'note counts', 'notes count')} as ${c.notes === 1 ? 'a failure' : 'failures'} in strict mode`)
  return `Fail: ${_joinList(parts)}.`
}

// ---------------------------------------------------------------------------------------------------- formatting
function formatCount(n) {
  const s = String(Math.trunc(Number(n)))
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function formatBytes(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v < 0) return String(n)
  if (v < 1000) return `${v} B`
  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let x = v / 1000, i = 0
  while (x >= 999.95 && i < units.length - 1) { x /= 1000; i++ }
  return `${x < 100 ? x.toFixed(1) : Math.round(x)} ${units[i]}`
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return 'unknown length'
  if (ms < 0) return 'negative length (the clock went back)'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24)
  if (h < 1) return `${m} min`
  if (d < 1) return `${h} h ${m % 60} min`
  return `${d} d ${h % 24} h`
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
}

// ---------------------------------------------------------------------------------------------------- report (3.9)
const _CSS = `
:root{color-scheme:light;--fg:#14171c;--muted:#5a6270;--line:#d9dde3;--soft:#f4f6f8;--ok:#0b6b3a;--okbg:#e6f4ec;--bad:#a1121b;--badbg:#fbe9ea;--note:#7a4b00;--notebg:#fdf3e1}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;color:var(--fg);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;overflow-wrap:anywhere}
main{max-width:960px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.45em;margin:0 0 4px}
h2{font-size:1.15em;margin:28px 0 8px;padding-bottom:4px;border-bottom:1px solid var(--line)}
p{margin:6px 0}
.sub{color:var(--muted);margin:0 0 16px}
.verdict{display:flex;gap:12px;align-items:flex-start;border:2px solid;border-radius:8px;padding:14px 16px;margin:8px 0 4px}
.verdict .mark{font-size:1.9em;line-height:1;font-weight:700}
.verdict .word{display:block;font-size:.93em;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.verdict .sentence{font-size:1.2em;font-weight:600}
.pass{color:var(--ok);background:var(--okbg);border-color:var(--ok)}
.fail{color:var(--bad);background:var(--badbg);border-color:var(--bad)}
.counts{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:0;padding:0;list-style:none}
.counts li{border:1px solid var(--line);border-radius:6px;padding:8px 10px}
.counts b{display:block;font-size:1.3em}
.counts span{color:var(--muted);font-size:.86em}
ul.list{margin:4px 0;padding-left:20px}
ul.list li{margin:3px 0}
.items{margin:4px 0 10px;padding-left:20px;color:var(--muted);font-size:.93em}
.none{color:var(--muted)}
table{border-collapse:collapse;width:100%;font-size:.9em;overflow-wrap:normal}
th,td{border-bottom:1px solid var(--line);padding:5px 6px;text-align:left;vertical-align:top}
th,td.nw{white-space:nowrap}
th{background:var(--soft);font-weight:600}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:0}
dt{color:var(--muted)}
dd{margin:0}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-size:.88em;overflow-wrap:anywhere;word-break:break-all}
.path{overflow-wrap:anywhere}
.st{font-weight:600;white-space:nowrap}
.st-match,.st-removed{color:var(--ok)}
.st-changed,.st-missing{color:var(--bad)}
.st-back,.st-notsealed,.st-notchecked{color:var(--note)}
.tag{display:inline-block;font-size:.8em;border:1px solid var(--line);border-radius:4px;padding:0 4px;color:var(--muted)}
.wrap{overflow-x:auto}
footer{margin-top:32px;color:var(--muted);font-size:.86em}
@page{margin:14mm}
@media print{body{font-size:11px}main{max-width:none;padding:0}.verdict,.counts li,tr{break-inside:avoid}thead{display:table-header-group}h2{break-after:avoid}.wrap{overflow:visible}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`.trim()

const _STATE_CLASS = { match: 'match', changed: 'changed', missing: 'missing', removed: 'removed', 'back after removal': 'back', 'not sealed': 'notsealed', 'not checked': 'notchecked' }
const _MAX_PROBLEMS = 1000, _MAX_ITEMS = 200

function renderReportHTML(report) {
  const e = escapeHTML
  const r = report
  const L = r.ledger || {}
  const c = r.counts || {}
  const pass = r.verdict === 'pass'
  const dash = '<span class="none">unknown</span>'
  const v = (x) => (x === null || x === undefined || x === '' ? dash : e(x))
  const code = (x) => (x === null || x === undefined || x === '' ? dash : `<code>${e(x)}</code>`)
  const when = (x) => (x ? e(_when(x)) : dash)
  const out = []
  out.push('<!doctype html><html lang="en"><head><meta charset="utf-8">')
  out.push(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`)
  out.push('<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">')
  out.push(`<title>${e(`Audit report: ${pass ? 'pass' : 'fail'}${L.station ? `, ${L.station}` : ''}`)}</title><style>${_CSS}</style></head><body><main>`)
  out.push(`<h1>Immutable QC audit report</h1><p class="sub">${e(r.method && r.method.auditedAt ? `Audited ${_when(r.method.auditedAt)}, ${r.method.where}` : '')}${L.station ? ` · station ${e(L.station)}` : ''}</p>`)

  // 1. verdict
  out.push(`<section aria-label="Verdict" class="verdict ${pass ? 'pass' : 'fail'}"><span class="mark" aria-hidden="true">${pass ? '&#10003;' : '&#10007;'}</span><div><span class="word">${pass ? 'Pass' : 'Fail'}</span><span class="sentence">${e(String(r.summary || '').replace(/^(?:Pass|Fail): /, '').replace(/^./, (ch) => ch.toUpperCase()))}</span></div></section>`)
  if (r.strict) out.push('<p class="sub">Strict mode: notes count as failures.</p>')

  // 2. counts
  const cnt = [
    ['Files sealed', c.sealed], ['Match', c.match], ['Changed', c.changed], ['Missing', c.missing], ['Removed (recorded)', c.removed],
    ['Back after removal', c.backAfterRemoval], ['Not sealed', c.notSealed], ['Not checked', c.notChecked], ['Records', c.records], ['Problems', c.problems], ['Notes', c.notes],
  ]
  out.push(`<h2>Counts</h2><ul class="counts">${cnt.map(([k, n]) => `<li><b>${e(formatCount(n || 0))}</b><span>${e(k)}</span></li>`).join('')}</ul>`)
  if (!r.filesChecked) out.push('<p class="sub">The files were not checked: this audit covers the ledger only.</p>')

  // 3. problems
  const probs = r.problems || []
  out.push('<h2>Problems</h2>')
  if (!probs.length) out.push('<p class="none">None.</p>')
  else {
    out.push(`<ul class="list">${probs.slice(0, _MAX_PROBLEMS).map((p) => `<li>${e(p.message)}</li>`).join('')}</ul>`)
    if (probs.length > _MAX_PROBLEMS) out.push(`<p>${e(`And ${formatCount(probs.length - _MAX_PROBLEMS)} more problems (all of them are in the JSON report).`)}</p>`)
  }

  // 4. notes
  const notes = r.notes || []
  out.push(`<h2>Notes</h2>${r.strict ? '' : '<p class="sub">Notes are not failures.</p>'}`)
  if (!notes.length) out.push('<p class="none">None.</p>')
  else {
    out.push('<ul class="list">')
    for (const n of notes) {
      const items = n.items || []
      out.push(`<li>${e(n.message)}${items.length ? `<ul class="items">${items.slice(0, _MAX_ITEMS).map((x) => `<li class="path">${e(x)}</li>`).join('')}${items.length > _MAX_ITEMS ? `<li>${e(`and ${formatCount(items.length - _MAX_ITEMS)} more`)}</li>` : ''}</ul>` : ''}</li>`)
    }
    out.push('</ul>')
  }

  // 5. ledger
  const head = L.head
  out.push('<h2>Ledger</h2><dl>')
  out.push(`<dt>Ledger id</dt><dd>${code(L.ledgerId)}</dd><dt>Station</dt><dd>${v(L.station)}</dd><dt>Key id</dt><dd>${code(L.keyId)}</dd>`)
  out.push(`<dt>Public key</dt><dd>${code(L.publicKey)}</dd><dt>Algorithm</dt><dd>${v(L.alg)}</dd>`)
  out.push(`<dt>Records</dt><dd>${e(formatCount(L.records || 0))}${L.firstProblemLine ? e(` (${formatCount(L.goodRecords || 0)} before the first problem, on line ${L.firstProblemLine})`) : ''}</dd>`)
  out.push(`<dt>Head</dt><dd>${head ? `record ${e(head.n)}, link <code>${e(head.h)}</code>` : dash}</dd>`)
  out.push(`<dt>Head to pin</dt><dd>${head ? code(formatHead(head)) : dash}</dd><dt>Created</dt><dd>${when(L.createdAt)}</dd>`)
  if (L.ctx) out.push(`<dt>Context <span class="tag">not sealed</span></dt><dd>${code(JSON.stringify(L.ctx))}</dd>`)
  out.push('</dl>')
  const ex = r.expectations || {}
  if (ex.head || ex.keyId) {
    out.push('<h2>Expectations</h2><ul class="list">')
    for (const x of [ex.head, ex.keyId].filter(Boolean)) out.push(`<li><span class="st ${x.ok ? 'st-match' : 'st-changed'}">${x.ok ? 'Matches' : 'Does not match'}</span>: ${e(x.message)}</li>`)
    out.push('</ul>')
  }

  // 6. watch sessions
  const ss = r.sessions || []
  out.push('<h2>Watch sessions</h2>')
  if (!ss.length) out.push('<p class="none">None recorded.</p>')
  else {
    out.push('<div class="wrap"><table><thead><tr><th scope="col">Kind</th><th scope="col">Started</th><th scope="col">Stopped</th><th scope="col">Ended</th><th scope="col">Files sealed</th></tr></thead><tbody>')
    for (const s of ss) {
      const ended = s.type === 'scan' ? 'one scan' : s.open ? 'still running, or stopped without a record' : s.clean ? 'cleanly' : 'not cleanly'
      out.push(`<tr><td>${s.type === 'scan' ? 'Scan' : 'Watch'}</td><td>${s.startN ? `record ${e(s.startN)}, ${when(s.start)}` : dash}</td><td>${s.stopN ? `record ${e(s.stopN)}, ${when(s.stop)}` : s.endedByN ? e(`no stop record (next start: record ${s.endedByN})`) : '<span class="none">none</span>'}</td><td class="${s.clean === false ? 'st st-changed' : ''}">${e(ended)}</td><td>${e(formatCount(s.files || 0))}</td></tr>`)
    }
    out.push('</tbody></table></div>')
    const gaps = r.gaps || []
    out.push(gaps.length ? `<p>${e(`Gaps between sessions: ${gaps.length}.`)}</p><ul class="items">${gaps.slice(0, _MAX_ITEMS).map((g) => `<li>${e(`From ${_when(g.from)} to ${_when(g.to)} (${formatDuration(g.ms)}), between record ${g.afterN} and record ${g.beforeN}`)}</li>`).join('')}</ul>` : '<p class="sub">No gaps between sessions.</p>')
  }

  // 7. files
  const files = r.files || []
  out.push(`<h2>Files</h2><p class="sub">${e(`${formatCount(files.length)} ${files.length === 1 ? 'path' : 'paths'}. Paths are shown as stored: "%", "|" and control characters are written as %XX.`)}</p>`)
  if (files.length) {
    out.push('<div class="wrap"><table><thead><tr><th scope="col">Path</th><th scope="col">State</th><th scope="col">Size</th><th scope="col">SHA-256</th><th scope="col">Versions</th></tr></thead><tbody>')
    for (const f of files) {
      const sz = f.present ? f.present.bytes : f.sealed ? f.sealed.bytes : null
      let sha = f.sealed ? `<code>${e(f.sealed.sha256)}</code>` : f.present ? `<code>${e(f.present.sha256)}</code>` : dash
      if (f.state === 'changed' || (f.state === 'back after removal' && f.sealed && f.present && f.present.sha256 !== f.sealed.sha256)) sha = `sealed <code>${e(f.sealed.sha256)}</code><br>now <code>${e(f.present.sha256)}</code>`
      let st = e(f.state)
      if (f.matchesN) st += `<br><span class="none">${e(`matches record ${f.matchesN}`)}</span>`
      out.push(`<tr><td class="path">${e(f.path)}</td><td class="st st-${_STATE_CLASS[f.state] || 'notchecked'}">${st}</td><td class="nw">${sz !== null && sz !== undefined ? e(formatBytes(sz)) : dash}</td><td>${sha}</td><td>${e(f.versions)}</td></tr>`)
    }
    out.push('</tbody></table></div>')
  }

  // 8. method
  const m = r.method || {}
  out.push('<h2>Method</h2><p>Recomputed:</p><ul class="list">')
  for (const x of m.recomputed || []) out.push(`<li>${e(x)}</li>`)
  out.push('</ul><dl>')
  out.push(`<dt>Format</dt><dd>${v(m.format)}</dd><dt>Tool</dt><dd>${v(m.tool)}${m.core ? e(` (core ${m.core})`) : ''}</dd><dt>When</dt><dd>${when(m.auditedAt)}</dd><dt>Where</dt><dd>${v(m.where)}</dd>`)
  out.push('</dl><p class="sub">A pass shows each file is byte for byte the one that was sealed, and that the ledger has not been edited, reordered or cut since it was signed. It does not show a file was right when it was written, and it does not cover a change made before the file was sealed.</p>')

  // 9. how to re-run
  out.push(`<h2>How to re-run this audit</h2><ul class="list">${(r.rerun || []).map((x) => `<li>${e(x)}</li>`).join('')}</ul>`)
  out.push(`<footer>${e(`${AUDIT_FORMAT} version ${r.version || 1}. The machine-readable form of this report is its JSON.`)}</footer>`)
  out.push('</main></body></html>\n')
  return out.join('')
}

return { VERSION, FORMAT, FORMAT_VERSION, AUDIT_FORMAT, ALG, LEDGER_DIR, LEDGER_FILE, LEDGER_PATH, HEADER_KEYS, RECORD_KEYS, KINDS, MODE_EVENTS, DEFAULT_IGNORES, toHex, fromHex, isHex, Sha256, sha256Hex, isSealedText, isTime, isReadingTime, encodePath, validatePath, decodePath, isLedgerFolderPath, ignoreMatcher, payloadOf, fingerprintOf, genesisOf, linkOf, generateKeyPair, publicKeyHex, importPublicKeyHex, exportPrivateJwk, importPrivateJwk, publicKeyHexOfJwk, keyIdOf, sigProblem, isLowS, normalizeLowS, signLink, verifyLink, keyMatches, verifyLinks, canonicalJSON, serializeLine, createHeader, createRecord, createRecords, parseLedger, verifyLedger, extendVerified, isFirstScan, planSeal, parseHead, formatHead, audit, formatCount, formatBytes, formatDuration, escapeHTML, renderReportHTML }
})()

// ---------------------------------------------------------------------------------------------- agent/src/util.mjs
const __iqc_util = (() => {
// Small shared pieces of the agent: version, errors, time and a promise pool.
const { VERSION, isTime } = __core

// The agent's version is core's: they ship together (agent/package.json says the same; a test checks it).
const AGENT_VERSION = VERSION
const AGENT = `immutableqc-cli/${VERSION}`

// Exit codes. Audit: 0 pass, 1 fail, 2 usage or read error. The other commands: 0 done, 1 refused or failed (a broken
// ledger, a missing key, a held lock, a write error), 2 usage or read error.
const EXIT_OK = 0
const EXIT_FAIL = 1
const EXIT_USAGE = 2

// An error meant for the person at the terminal: its message is shown as is, without a stack trace.
class UserError extends Error {
  constructor(message, code = EXIT_FAIL) {
    super(message)
    this.name = 'UserError'
    this.exitCode = code
  }
}

const usageError = (message) => new UserError(message, EXIT_USAGE)

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(done, Math.max(0, ms))
    function done() { clearTimeout(t); if (signal) signal.off(done); resolve() }
    if (signal) signal.on(done)
  })
}

// A tiny event for waking a sleep early (a stop request).
class Wake {
  constructor() { this.fns = new Set() }
  on(fn) { this.fns.add(fn) }
  off(fn) { this.fns.delete(fn) }
  fire() { for (const fn of [...this.fns]) fn() }
}

// Runs fn over items with at most `limit` running at once.
async function pool(items, limit, fn) {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
}

// A file's modification time as the ledger's time text (whole milliseconds), or null when it has none that fits.
function isoOf(ms) {
  try {
    const s = new Date(Math.floor(ms)).toISOString()
    return isTime(s) ? s : null
  } catch {
    return null
  }
}

const whenUTC = (iso) => (typeof iso === 'string' && iso.length >= 19 ? `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC` : String(iso))

function clock(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

return { AGENT_VERSION, AGENT, EXIT_OK, EXIT_FAIL, EXIT_USAGE, UserError, usageError, sleep, Wake, pool, isoOf, whenUTC, clock, plural }
})()

// ---------------------------------------------------------------------------------------------- agent/src/args.mjs
const __iqc_args = (() => {
// The command line: iqc <command> [folder] [options]. Options may come before or after the folder; --name value and
// --name=value both work; "--" ends the options.
const { parseHead, isSealedText } = __core
const { usageError } = __iqc_util

const COMMANDS = ['watch', 'seal', 'audit', 'head', 'status', 'help']
const VALUE = ['ledger', 'key', 'station', 'interval', 'settle', 'ignore', 'report', 'json', 'expect-head', 'expect-key']
const FLAG = ['quiet', 'no-color', 'strict', 'help', 'version']
const AUDIT_ONLY = ['report', 'json', 'expect-head', 'expect-key', 'strict']
const PATHS = ['ledger', 'key', 'report', 'json']

// Windows: a quoted folder that ends in a backslash ("D:\Results\") reaches the program as D:\Results" (the backslash
// escapes the quote), and a path quoted with single quotes in cmd.exe keeps its quotes. Both are cleaned up here, on
// Windows only (elsewhere a quote is a legal file name character).
function cleanPathArg(s, platform = process.platform) {
  if (typeof s !== 'string' || platform !== 'win32') return s
  let t = s.trim()
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) t = t.slice(1, -1)
  else if (t.endsWith('"') && !t.slice(0, -1).includes('"')) t = t.slice(0, -1)
  return t
}

function seconds(name, v, { min, max }) {
  const n = Number(String(v).trim())
  if (String(v).trim() === '' || !Number.isFinite(n) || n < min || n > max) throw usageError(`--${name} takes a number of seconds from ${min} to ${max}, not ${JSON.stringify(v)}.`)
  return n
}

function stationProblem(s) {
  if (typeof s !== 'string' || s.length === 0) return 'it is empty'
  if (!isSealedText(s)) return 'it holds "|" or a control character'
  if ([...s].length > 64) return 'it is longer than 64 characters'
  return null
}

// -> { command, folder, opts, help, version }
function parseArgs(argv, { platform = process.platform } = {}) {
  const opts = { ignore: [] }
  const pos = []
  let help = false, version = false, ended = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!ended && a === '--') { ended = true; continue }
    if (!ended && a.startsWith('--')) {
      let name = a.slice(2), val
      const eq = name.indexOf('=')
      if (eq >= 0) { val = name.slice(eq + 1); name = name.slice(0, eq) }
      if (VALUE.includes(name)) {
        if (val === undefined) {
          if (i + 1 >= argv.length) throw usageError(`--${name} needs a value.`)
          val = argv[++i]
        }
        if (name === 'ignore') {
          if (val === '') throw usageError('--ignore needs a pattern, for example --ignore "*.bak".')
          opts.ignore.push(val)
        } else {
          if (name in opts) throw usageError(`--${name} is given twice.`)
          opts[name] = PATHS.includes(name) ? cleanPathArg(val, platform) : val
        }
      } else if (FLAG.includes(name)) {
        if (val !== undefined) throw usageError(`--${name} takes no value.`)
        if (name === 'help') help = true
        else if (name === 'version') version = true
        else opts[name] = true
      } else {
        throw usageError(`Unknown option --${name}. Run "iqc help" for the options.`)
      }
    } else if (!ended && (a === '-h' || a === '-?')) help = true
    else if (!ended && (a === '-v' || a === '-V')) version = true
    else if (!ended && a.length > 1 && a.startsWith('-')) throw usageError(`Unknown option ${a}. Run "iqc help" for the options.`)
    else pos.push(a)
  }
  const command = pos.length ? pos.shift() : null
  if (command !== null && !COMMANDS.includes(command)) {
    throw usageError(`Unknown command ${JSON.stringify(command)}. The commands are: ${COMMANDS.join(', ')}. Run "iqc help".`)
  }
  let folder = null
  if (command === 'help') {
    if (pos.length > 1) throw usageError('iqc help takes at most one command name.')
    folder = pos.length ? pos[0] : null
    return { command, topic: folder, folder: null, opts, help: true, version }
  }
  if (pos.length > 1) {
    throw usageError(`iqc ${command} takes one folder, but got ${pos.length}: ${pos.map((p) => JSON.stringify(p)).join(' ')}. A path with spaces needs quotes, for example "D:\\Instrument Data".`)
  }
  if (pos.length) folder = cleanPathArg(pos[0], platform)
  if (folder === '') throw usageError('The folder is empty. Give a folder, or leave it out to use the current one.')
  for (const k of AUDIT_ONLY) if (k in opts && command !== 'audit' && command !== null) throw usageError(`--${k} is an option of iqc audit, not of iqc ${command}.`)
  if ('interval' in opts) opts.interval = seconds('interval', opts.interval, { min: 0.05, max: 86400 })
  if ('settle' in opts) opts.settle = seconds('settle', opts.settle, { min: 0, max: 86400 })
  if ('station' in opts) {
    const why = stationProblem(opts.station)
    if (why) throw usageError(`--station ${JSON.stringify(opts.station)} cannot be used: ${why}. A station name is 1 to 64 characters, with no "|" and no control character.`)
  }
  if ('expect-head' in opts) {
    try { opts['expect-head'] = parseHead(opts['expect-head']) } catch {
      throw usageError(`--expect-head ${JSON.stringify(opts['expect-head'])} is not a head. A head is written <record number>:<64 hex link>, as iqc head prints it.`)
    }
  }
  if ('expect-key' in opts) {
    const k = String(opts['expect-key']).trim()
    if (!/^[0-9a-fA-F]{16}$/.test(k)) throw usageError(`--expect-key ${JSON.stringify(opts['expect-key'])} is not a key id. A key id is 16 hex characters, as iqc head and iqc status print it.`)
    opts['expect-key'] = k.toLowerCase()
  }
  for (const g of opts.ignore) if (/[\u0000-\u001f]/.test(g)) throw usageError(`--ignore ${JSON.stringify(g)} holds a control character.`)
  return { command, folder, opts, help, version }
}

return { COMMANDS, cleanPathArg, stationProblem, parseArgs }
})()

// ---------------------------------------------------------------------------------------------- agent/src/out.mjs
const __iqc_out = (() => {
// What the agent prints: short human lines on standard output, warnings and errors on standard error. Colors only on a
// terminal, and never with --no-color or NO_COLOR (https://no-color.org: set and not empty). --quiet prints only
// problems (warnings and errors).
const { clock } = __iqc_util

const SGR = { red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, gray: 90, bold: 1, dim: 2 }

function colorWanted(stream, { noColor = false, env = process.env } = {}) {
  if (noColor) return false
  if (typeof env.NO_COLOR === 'string' && env.NO_COLOR !== '') return false
  return !!(stream && stream.isTTY)
}

const _guarded = new WeakSet()
function guard(stream) {
  // a closed pipe (iqc watch | head) is not an error worth a crash
  if (stream && typeof stream.on === 'function' && !_guarded.has(stream)) {
    _guarded.add(stream)
    stream.on('error', (e) => { if (e && e.code !== 'EPIPE') throw e })
  }
}

class Out {
  constructor({ quiet = false, noColor = false, env = process.env, stdout = process.stdout, stderr = process.stderr, stamp = false } = {}) {
    this.quiet = quiet
    this.stdout = stdout
    this.stderr = stderr
    this.color = colorWanted(stdout, { noColor, env })
    this.ecolor = colorWanted(stderr, { noColor, env })
    this.stamp = stamp
    this.warnings = 0
    this.progressShown = false
    this.progressAt = 0
    guard(stdout)
    guard(stderr)
  }

  paint(name, s) { return this.color ? `\x1b[${SGR[name]}m${s}\x1b[0m` : s }
  epaint(name, s) { return this.ecolor ? `\x1b[${SGR[name]}m${s}\x1b[0m` : s }

  _out(s) { this.clearProgress(); this.stdout.write(s + '\n') }
  _err(s) { this.clearProgress(); this.stderr.write(s + '\n') }

  // a line of normal output (not with --quiet)
  print(s = '') { if (!this.quiet) this._out(s) }
  // output that is the point of the command (iqc head), printed even with --quiet
  result(s) { this._out(s) }
  // a detail on standard error (not with --quiet), for commands whose standard output is meant for a program
  note(s) { if (!this.quiet) this._err(s) }
  warn(s) {
    this.warnings++
    this._err(`${this.epaint('yellow', 'warning')}  ${s}`)
  }
  error(s) { this._err(`${this.epaint('red', 'error')}  ${s}`) }

  // one record or event: "sealed  QC/run-0914/injection-06.csv  1.2 MB  eb1690bc…"
  event(word, color, text, { problem = false } = {}) {
    const line = `${this.stamp ? this.paint('dim', clock()) + ' ' : ''}${this.paint(color, word.padEnd(9))}${text}`
    if (problem) this._err(line)
    else this.print(line)
  }

  // a progress line on a terminal's standard error, rewritten in place (at most 10 times a second)
  progress(s) {
    if (this.quiet || !this.stderr.isTTY) return
    const now = Date.now()
    if (now - this.progressAt < 100) return
    this.progressAt = now
    const cols = this.stderr.columns || 80
    this.stderr.write(`\r${s.length >= cols ? s.slice(0, cols - 2) + '…' : s}\x1b[K`)
    this.progressShown = true
  }

  clearProgress() {
    if (this.progressShown) { this.stderr.write('\r\x1b[K'); this.progressShown = false }
  }
}

return { colorWanted, Out }
})()

// ---------------------------------------------------------------------------------------------- agent/src/paths.mjs
const __iqc_paths = (() => {
// Where things are: the data folder, the ledger, its lock and README.txt, and how a file's path on disk becomes the
// path stored in the ledger (relative, "/" between segments, NFC, percent-encoded as core's encodePath says).
const { resolve, dirname, basename, join, sep, relative, isAbsolute } = __node_path
const { statSync, existsSync } = __node_fs
const { encodePath, LEDGER_DIR, LEDGER_FILE } = __core
const { usageError } = __iqc_util

// The stored path of `abs` inside `root`, using the path module `p` (node:path, or path.win32 / path.posix in tests).
// Throws when abs is not inside root.
function relPathOf(root, abs, p = { relative, sep, isAbsolute }) {
  const rel = p.relative(root, abs)
  if (!rel || rel === '..' || rel.startsWith('..' + p.sep) || p.isAbsolute(rel)) throw new Error(`${abs} is not inside ${root}.`)
  return encodePath(rel.split(p.sep).join('/'))
}

// The stored path, null when abs is not inside root (or has no stored form).
function relPathOrNull(root, abs, p) {
  try { return relPathOf(root, abs, p) } catch { return null }
}

// How a stored path is shown to a person: "%" and "|" as themselves, control characters still as %XX.
const displayPath = (p) => p.replace(/%(25|7C)/g, (_, h) => (h === '25' ? '%' : '|'))

// The data folder: it must exist and be a folder. A folder that is itself an ImmutableQC folder (it holds the ledger)
// is refused with a hint: the data folder is the one around it.
function dataFolder(arg) {
  const root = resolve(arg == null ? '.' : arg)
  let st
  try { st = statSync(root) } catch (e) {
    throw usageError(e.code === 'ENOENT' ? `No folder at ${root}.` : `Cannot open the folder ${root} (${e.code || e.message}).`)
  }
  if (!st.isDirectory()) throw usageError(`${root} is a file, not a folder. Give the data folder (the folder that holds ImmutableQC).`)
  if (basename(root) === LEDGER_DIR && existsSync(join(root, LEDGER_FILE))) {
    throw usageError(`${root} is the ledger's own folder. Give the data folder around it instead: ${dirname(root)}`)
  }
  return root
}

// The ledger and the files beside it. Default: <root>/ImmutableQC/ledger.jsonl, agent.lock and README.txt. With
// --ledger the ledger may live anywhere (an existing folder means ledger.jsonl inside it); its lock is agent.lock
// beside it when the file is named ledger.jsonl, else <ledger>.lock.
function locate(root, ledgerOpt) {
  let ledgerPath = ledgerOpt ? resolve(ledgerOpt) : join(root, LEDGER_DIR, LEDGER_FILE)
  if (ledgerOpt) {
    try { if (statSync(ledgerPath).isDirectory()) ledgerPath = join(ledgerPath, LEDGER_FILE) } catch { /* not there yet */ }
  }
  const dir = dirname(ledgerPath)
  const isDefault = ledgerPath === join(root, LEDGER_DIR, LEDGER_FILE)
  const lockPath = basename(ledgerPath) === LEDGER_FILE ? join(dir, 'agent.lock') : ledgerPath + '.lock'
  // the agent's own files are never sealed: the root ImmutableQC folder (core skips it), and a ledger kept elsewhere
  // inside the data folder, with its lock and its temporary file
  const own = new Set()
  for (const f of [ledgerPath, lockPath]) {
    const p = relPathOrNull(root, f)
    if (p) own.add(p)
  }
  return { root, ledgerPath, dir, isDefault, lockPath, readmePath: join(dir, 'README.txt'), own, shown: shownPath(root, ledgerPath) }
}

// a path as short as it can be shown: relative to the data folder when inside it
function shownPath(root, abs) {
  const rel = relative(root, abs)
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : abs
}

return { relPathOf, relPathOrNull, displayPath, dataFolder, locate, shownPath }
})()

// ---------------------------------------------------------------------------------------------- agent/src/lock.mjs
const __iqc_lock = (() => {
// One agent per ledger. agent.lock holds the agent's process id, computer name and start time; it is created with
// exclusive create, so two agents cannot both make it. A second agent on the same ledger refuses; a lock whose process
// is gone (on this computer) is taken over with a warning; a lock from another computer is left alone (its process
// cannot be checked from here). The lock is removed on exit.
const { hostname } = __node_os
const { openSync, writeSync, fsyncSync, closeSync, readFileSync, unlinkSync, statSync } = __node_fs
const { AGENT, UserError, whenUTC } = __iqc_util

function readLock(file) {
  let raw, st
  try {
    raw = readFileSync(file, 'utf8')
    st = statSync(file)
  } catch (e) {
    if (e.code === 'ENOENT') return null
    throw new UserError(`Cannot read the lock file ${file} (${e.code || e.message}).`)
  }
  let info = null
  try {
    const o = JSON.parse(raw)
    if (o && Number.isSafeInteger(o.pid) && o.pid > 0) info = o
  } catch { /* unreadable */ }
  return { raw, info, ageMs: Date.now() - st.mtimeMs }
}

// for the read-only commands: a lock that cannot be read is treated as no lock
function peekLock(file) {
  try { return readLock(file) } catch { return null }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

const sameHost = (h) => typeof h === 'string' && h.toLowerCase() === hostname().toLowerCase()

// 'none' | 'live' | 'stale' | 'other-host' | 'young' (being written) | 'unreadable'
function lockState(lock) {
  if (!lock) return 'none'
  const i = lock.info
  if (!i) return lock.ageMs < 10000 ? 'young' : 'unreadable'
  if (i.host !== undefined && !sameHost(i.host)) return 'other-host'
  if (i.pid === process.pid) return 'stale'
  return pidAlive(i.pid) ? 'live' : 'stale'
}

const describeLock = (i) => `pid ${i.pid}${i.host ? ` on ${i.host}` : ''}${i.command ? `, iqc ${i.command}` : ''}, started ${whenUTC(i.startedAt)}`

function acquireLock(file, { command, out }) {
  const info = { pid: process.pid, host: hostname(), startedAt: new Date().toISOString(), command, agent: AGENT }
  const text = JSON.stringify(info) + '\n'
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const fd = openSync(file, 'wx')
      try {
        writeSync(fd, text)
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      return makeHandle(file, info)
    } catch (e) {
      if (e.code !== 'EEXIST') throw new UserError(`Cannot create the lock file ${file} (${e.code || e.message}).`)
    }
    const cur = readLock(file)
    const state = lockState(cur)
    if (state === 'none') continue
    if (state === 'live') {
      throw new UserError(`Another agent is already sealing this ledger (${describeLock(cur.info)}). Only one agent may write to a ledger. Stop that one first; iqc status shows it.`)
    }
    if (state === 'other-host') {
      throw new UserError(`An agent on another computer holds this ledger's lock (${describeLock(cur.info)}). If no agent runs there any more, delete ${file} and try again.`)
    }
    if (state === 'young') throw new UserError(`Another agent is starting on this ledger right now (its lock file ${file} is being written). Try again in a few seconds.`)
    // stale or unreadable: take it over, unless it changed since it was read
    const again = readLock(file)
    if (!again || again.raw !== cur.raw) continue
    try { unlinkSync(file) } catch (e) { if (e.code !== 'ENOENT') throw new UserError(`Cannot remove the stale lock file ${file} (${e.code || e.message}).`) }
    out.warn(state === 'stale'
      ? `Took over a stale lock: the agent that held it (${describeLock(cur.info)}) is no longer running. If it was watching, it stopped without a stop record; an audit shows that as a note.`
      : `Took over an unreadable lock file (${file}).`)
  }
  throw new UserError(`Cannot take the lock ${file}: other agents keep taking it.`)
}

function makeHandle(file, info) {
  let released = false
  const release = () => {
    if (released) return
    released = true
    try {
      const cur = readLock(file)
      if (cur && cur.info && cur.info.pid === info.pid && cur.info.startedAt === info.startedAt) unlinkSync(file)
    } catch { /* gone already */ }
  }
  // a crash or process.exit still removes it
  process.once('exit', release)
  return { file, info, release: () => { process.removeListener('exit', release); release() } }
}

return { readLock, peekLock, pidAlive, lockState, describeLock, acquireLock }
})()

// ---------------------------------------------------------------------------------------------- agent/src/keys.mjs
const __iqc_keys = (() => {
// The signing key. First use creates an ECDSA P-256 key and saves its private part as a JWK file in
// ~/.immutableqc/keys/<keyId>.jwk (the folder 0700, the file 0600 where the system has modes; created with exclusive
// create, so an existing file is never overwritten). Later runs load the key named by the ledger header's keyId, or
// the file given with --key, and refuse when it is missing or is not the ledger's key.
const { homedir } = __node_os
const { join, resolve, dirname } = __node_path
const { mkdirSync, chmodSync, openSync, writeSync, fsyncSync, closeSync, readFileSync, statSync } = __node_fs
const { generateKeyPair, publicKeyHex, keyIdOf, exportPrivateJwk, importPrivateJwk, publicKeyHexOfJwk, keyMatches } = __core
const { UserError } = __iqc_util

const keysDir = () => join(homedir(), '.immutableqc', 'keys')
const keyFileOf = (keyId) => join(keysDir(), `${keyId}.jwk`)

async function createKey() {
  const pair = await generateKeyPair({ extractable: true })
  const pub = await publicKeyHex(pair.publicKey)
  const keyId = keyIdOf(pub)
  const { kty, crv, x, y, d } = await exportPrivateJwk(pair.privateKey)
  const dir = keysDir()
  const file = join(dir, `${keyId}.jwk`)
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    for (const f of [dirname(dir), dir]) try { chmodSync(f, 0o700) } catch { /* a system without modes */ }
    const fd = openSync(file, 'wx', 0o600)
    try {
      writeSync(fd, JSON.stringify({ kty, crv, x, y, d, kid: keyId }, null, 2) + '\n')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    try { chmodSync(file, 0o600) } catch { /* a system without modes */ }
  } catch (e) {
    throw new UserError(`Could not save the new signing key to ${file} (${e.code || e.message}). Nothing was written to the ledger.`)
  }
  return { privateKey: await importPrivateJwk({ kty, crv, x, y, d }), publicKeyHex: pub, keyId, file, created: true }
}

// Loads the key for a ledger whose header is `header` (or, for a new ledger, the --key file alone).
async function loadKey({ header = null, keyOpt = null, out = null } = {}) {
  const file = keyOpt ? resolve(keyOpt) : keyFileOf(header.keyId)
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT' && !keyOpt) {
      throw new UserError(`This ledger's signing key (key id ${header.keyId}) is not on this computer: there is no ${header.keyId}.jwk in ${keysDir()}. ` +
        'Copy the key file there from the computer that started this ledger, or give it with --key <file>. Nothing was written. (An audit needs no key: iqc audit.)')
    }
    throw new UserError(e.code === 'ENOENT' ? `No key file at ${file}. Nothing was written.` : `Cannot read the key file ${file} (${e.code || e.message}). Nothing was written.`)
  }
  let jwk, pub
  try {
    jwk = JSON.parse(text)
    pub = publicKeyHexOfJwk(jwk)
  } catch {
    throw new UserError(`${file} is not a signing key file (a P-256 private key in JWK form). Nothing was written.`)
  }
  if (header && pub !== header.publicKey) {
    throw new UserError(`The key in ${file} (key id ${keyIdOf(pub)}) is not this ledger's key (key id ${header.keyId}): records signed with it would not verify. Nothing was written.`)
  }
  let privateKey
  try {
    privateKey = await importPrivateJwk(jwk)
  } catch {
    throw new UserError(`${file} does not hold a usable private key. Nothing was written.`)
  }
  if (!(await keyMatches(privateKey, pub))) throw new UserError(`The private part of ${file} does not belong to its public key. Nothing was written.`)
  if (out && process.platform !== 'win32') {
    try {
      if (statSync(file).mode & 0o077) out.warn(`The key file ${file} can be read by other users of this computer; only its owner should (chmod 600).`)
    } catch { /* checked above */ }
  }
  return { privateKey, publicKeyHex: pub, keyId: keyIdOf(pub), file, created: false }
}

return { keysDir, keyFileOf, createKey, loadKey }
})()

// ---------------------------------------------------------------------------------------------- agent/src/ledger.mjs
const __iqc_ledger = (() => {
// The ledger file: read and verify it whole before anything is appended (a broken ledger is never extended and never
// repaired), create it, and append records. Each record is one write of one complete line to the file opened for
// append, then fsync. The verified state stays in memory and is brought up to date as records are appended
// (core's extendVerified), so a poll never verifies the whole ledger again; before each append the file's size and
// modification time are compared with what the agent last wrote, and only a ledger changed by something else is read
// and verified again.
const { readFileSync, openSync, writeSync, fsyncSync, closeSync, statSync, ftruncateSync, renameSync, unlinkSync, existsSync, mkdirSync } = __node_fs
const { dirname } = __node_path
const { verifyLedger, extendVerified, createHeader, createRecords, serializeLine, formatCount } = __core
const { AGENT, UserError, EXIT_USAGE } = __iqc_util

const README_TEXT = `Immutable QC: the sealed record of this data folder
====================================================

This folder (ImmutableQC) is kept by the Immutable QC agent (iqc), which seals
every file in the data folder around it: the folder that holds this one.

  ledger.jsonl  One record per line. Each record holds a file's SHA-256
                fingerprint, size and the time the agent read it, signed and
                linked to the record before it.
  README.txt    This note.
  agent.lock    Present only while an agent is sealing the folder.

Do not edit, rename, move or delete this folder or anything in it. Any edit to
the ledger shows in an audit, and deleting it loses the record of every file.
Back it up, or copy it, together with the data folder.

How to audit (check every file against its seal):

  In a browser: open https://immutableqc.com/app/ and drop the data folder
  (the folder that holds this ImmutableQC folder) on the page. Your browser
  reads every file; nothing is uploaded.

  On the command line, with Node.js 20 or later and iqc.mjs (from
  https://immutableqc.com):

      node iqc.mjs audit "<the data folder>"

  Exit code 0 means every file matches its seal and the ledger is intact.
  iqc audit --report audit.html writes a report you can print or keep.
`

function ensureDir(dir) {
  try {
    mkdirSync(dir, { recursive: true })
  } catch (e) {
    throw new UserError(`Cannot create the folder ${dir} for the ledger (${e.code || e.message}).`)
  }
}

// README.txt beside the ledger, unless one is there already (it is never overwritten)
function ensureReadme(file) {
  try {
    const fd = openSync(file, 'wx')
    try { writeSync(fd, README_TEXT) } finally { closeSync(fd) }
    return true
  } catch {
    return false
  }
}

// Reads and verifies the whole ledger. A missing or unreadable ledger is an error with exit code 2 (a read error);
// a ledger that does not verify comes back with its problems, for the caller to refuse or report.
async function readLedger(file, { missingOk = false, onProgress } = {}) {
  let bytes, st
  try {
    // read, then stat: the size and time kept as the baseline are never older than the bytes verified
    bytes = readFileSync(file)
    st = statSync(file)
  } catch (e) {
    if (e.code === 'ENOENT' && missingOk) return null
    if (e.code === 'ENOENT') throw new UserError(`No ledger at ${file}. Seal the folder first (iqc seal or iqc watch), or give the ledger with --ledger <file>.`, EXIT_USAGE)
    throw new UserError(`Cannot read the ledger ${file} (${e.code || e.message}).`, EXIT_USAGE)
  }
  const verified = await verifyLedger(bytes, { onProgress })
  return { verified, bytes: bytes.length, stat: { size: st.size, mtimeMs: st.mtimeMs } }
}

// For the read-only commands (audit, head, status): while an agent appends, a reader may catch the last line half
// written (a record is one write, but a read is not atomic with it on every file system or share). When the only
// problem is a last line without its newline and agentRunning() says an agent holds the lock, read again a few times.
async function readLedgerSettled(file, { agentRunning = () => false, onProgress, missingOk = false, tries = 5, delayMs = 200 } = {}) {
  for (let i = 0; ; i++) {
    const r = await readLedger(file, { onProgress, missingOk })
    if (!r) return r
    const p = r.verified.problems
    const tail = p.length > 0 && p.every((x) => (x.code === 'truncated' || x.code === 'no-newline') && x.line === r.verified.recordCount + 1)
    if (!tail || i >= tries - 1 || !agentRunning()) return r
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
}

// The refusal for a ledger with problems: the first few, and where to see all of them.
function brokenMessage(verified, file, { doing = 'Nothing was written to it' } = {}) {
  const p = verified.problems
  const list = p.slice(0, 3).map((x) => `  ${x.message}`).join('\n')
  return `The ledger ${file} does not verify: ${p.length === 1 ? 'it has 1 problem' : `it has ${formatCount(p.length)} problems`}.\n${list}${p.length > 3 ? `\n  …and ${formatCount(p.length - 3)} more.` : ''}\n` +
    `${doing}: a broken ledger is never extended or repaired. Run iqc audit to see every problem and what it means.`
}

function writeAll(fd, buf) {
  let off = 0
  while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off)
}

// Creates a new ledger holding only its header: written to a temporary file, flushed, then renamed into place, so a
// crash never leaves a half-written ledger. The caller holds the lock.
async function createLedger(file, { key, station }) {
  const header = await createHeader({ station, privateKey: key.privateKey, publicKeyHex: key.publicKeyHex, agent: AGENT })
  const text = serializeLine(header)
  const tmp = `${file}.${process.pid}.tmp`
  try {
    const fd = openSync(tmp, 'wx')
    try {
      writeAll(fd, Buffer.from(text, 'utf8'))
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    if (existsSync(file)) throw new UserError(`A ledger appeared at ${file} while this one was being made. Nothing was written.`)
    renameSync(tmp, file)
  } catch (e) {
    try { unlinkSync(tmp) } catch { /* not there */ }
    if (e instanceof UserError) throw e
    throw new UserError(`Cannot create the ledger ${file} (${e.code || e.message}).`)
  }
  syncDir(dirname(file))
  const verified = await verifyLedger(text)
  if (!verified.ok) throw new Error('The new ledger does not verify.')
  const st = statSync(file)
  return { verified, header, stat: { size: st.size, mtimeMs: st.mtimeMs } }
}

function syncDir(dir) {
  // makes the new name durable where the system allows it (not on Windows)
  try {
    const fd = openSync(dir, 'r')
    try { fsyncSync(fd) } finally { closeSync(fd) }
  } catch { /* not supported here */ }
}

class Appender {
  constructor(file, verified, stat, { out } = {}) {
    this.file = file
    this.v = verified
    this.size = stat.size
    this.mtimeMs = stat.mtimeMs
    this.out = out
  }

  // Before planning and appending: if the ledger is not as the agent left it, read and verify it again. A ledger that
  // still verifies and still holds the agent's head (touched, or grown by another program) is taken as it is now; any
  // other change stops the agent without writing.
  async sync() {
    let st
    try { st = statSync(this.file) } catch (e) {
      throw new UserError(`The ledger ${this.file} is gone or cannot be read (${e.code || e.message}). Stopped without writing.`)
    }
    if (st.size === this.size && st.mtimeMs === this.mtimeMs) return false
    const r = await readLedger(this.file)
    const v = r.verified
    if (!v.ok) throw new UserError(brokenMessage(v, this.file, { doing: 'The ledger was changed on disk by something other than this agent, and it no longer verifies. Stopped without writing' }))
    const head = this.v.head
    const holds = head.n === 0 ? v.header.g === this.v.header.g : v.recordCount >= head.n && v.records[head.n - 1].h === head.h
    if (!holds) throw new UserError(`The ledger ${this.file} was replaced on disk by a different ledger while this agent was running. Stopped without writing. Run iqc audit.`)
    if (v.recordCount > head.n && this.out) this.out.warn(`The ledger grew on disk while this agent held its lock (${formatCount(v.recordCount - head.n)} records added by another program). They verify; carrying on from record ${v.recordCount}.`)
    this.v = v
    this.size = r.stat.size
    this.mtimeMs = r.stat.mtimeMs
    return true
  }

  // Signs the items after the head and appends them, one write and one fsync per record. A failed write is cut back
  // to the last complete record, so the ledger never keeps a partial line written by this agent.
  async append(items, privateKey) {
    if (!items.length) return []
    const records = await createRecords({ head: this.v.head, items, privateKey })
    let fd
    try {
      fd = openSync(this.file, 'a')
    } catch (e) {
      throw new UserError(`Cannot open the ledger ${this.file} to append (${e.code || e.message}). Nothing was written.`)
    }
    const done = []
    try {
      for (const rec of records) {
        const buf = Buffer.from(serializeLine(rec), 'utf8')
        const before = this.size
        try {
          writeAll(fd, buf)
          fsyncSync(fd)
        } catch (e) {
          try { ftruncateSync(fd, before); fsyncSync(fd) } catch { /* nothing more to do */ }
          throw new UserError(`Cannot write to the ledger ${this.file} (${e.code || e.message}). Stopped; the ledger ends at record ${this.v.head.n}, its last complete record.`)
        }
        this.size += buf.length
        extendVerified(this.v, [rec])
        done.push(rec)
      }
    } finally {
      try { closeSync(fd) } catch { /* closed */ }
      try { const st = statSync(this.file); this.size = st.size; this.mtimeMs = st.mtimeMs } catch { /* checked on the next sync */ }
    }
    return done
  }
}

return { README_TEXT, ensureDir, ensureReadme, readLedger, readLedgerSettled, brokenMessage, createLedger, Appender }
})()

// ---------------------------------------------------------------------------------------------- agent/src/scan.mjs
const __iqc_scan = (() => {
// Reading the data folder: a walk with lstat (symbolic links are skipped, never followed; only regular files count),
// and a streaming SHA-256 of one file (node's createHash, 1 MiB at a time, so a file of any size never has to fit in
// memory).
const { readdir, lstat, open } = __node_fs_promises
const { readdirSync, lstatSync } = __node_fs
const { join } = __node_path
const { createHash } = __node_crypto
const { encodePath, ignoreMatcher, isLedgerFolderPath } = __core

// Errors that mean "not now": the file is open in another program (Windows locks), or briefly not readable. They are
// retried on the next poll.
const BUSY = new Set(['EBUSY', 'EPERM', 'EACCES', 'EAGAIN', 'ETXTBSY', 'EMFILE', 'ENFILE', 'UNKNOWN'])

class Stopped extends Error {}

const yieldNow = () => new Promise((resolve) => setImmediate(resolve))

// Walks root. skip(path, isDir) -> true leaves a path out (a skipped folder is not entered). A walk runs every poll,
// so it is made cheap: on a local disk it lists and looks at each folder with synchronous calls (several times less
// work than one promise per file), and yields between folders so a stop request is never kept waiting long; when a
// folder's lookups are slow (a network share, where each one is a round trip), `state.async` is set and this walk and
// the next ones look at up to 64 files at once instead. Pass the same `state` object to every walk of a folder. Returns
//   files:        Map path -> {abs, size, mtimeMs, ctimeMs}   (regular files; path is the stored, encoded form)
//   unreadable:   Set of folder paths that could not be listed (what is inside them is unknown, not removed)
//   unreadableFiles: Set of file paths that could not be looked at (present, unknown)
//   ambiguous:    Map path -> [raw names]: two names on disk with the same stored path (the same name in NFC and NFD)
//   symlinks:     [path]   badNames: [raw]
// Throws when root itself cannot be listed.
async function walk(root, { skip = () => false, state = {} } = {}) {
  // every 30th walk tries the synchronous way again (a share may have come back to a local disk's speed, or the slow
  // walk was a cold cache)
  state.walks = (state.walks || 0) + 1
  if (state.async && state.walks % 30 === 0) state.async = false
  const files = new Map(), unreadable = new Set(), unreadableFiles = new Set(), ambiguous = new Map(), symlinks = [], badNames = []
  const raws = new Map()
  const stack = [{ abs: root, rel: '' }]
  let first = true
  while (stack.length) {
    const { abs, rel } = stack.pop()
    let entries
    try {
      entries = state.async ? await readdir(abs, { withFileTypes: true }) : readdirSync(abs, { withFileTypes: true })
    } catch (e) {
      if (first) throw e
      if (e.code === 'ENOENT') continue
      unreadable.add(rel)
      continue
    }
    first = false
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    const todo = []
    for (const ent of entries) {
      const raw = rel ? `${rel}/${ent.name}` : ent.name
      let p
      try { p = encodePath(raw) } catch { badNames.push(raw); continue }
      if (isLedgerFolderPath(p) && !rel) continue
      todo.push({ ent, raw, p, abs: join(abs, ent.name) })
    }
    for (let i = 0; i < todo.length; i += 64) {
      const chunk = todo.slice(i, i + 64)
      let stats
      if (state.async) stats = await Promise.all(chunk.map((t) => lstat(t.abs).then((s) => s, (e) => e)))
      else {
        const t0 = performance.now()
        stats = chunk.map((t) => { try { return lstatSync(t.abs) } catch (e) { return e } })
        if (chunk.length >= 8 && (performance.now() - t0) / chunk.length > 0.25) state.async = true
      }
      chunk.forEach((t, k) => {
        const s = stats[k]
        if (s instanceof Error) {
          if (s.code === 'ENOENT') return
          if (t.ent.isDirectory()) { if (!skip(t.p, true)) unreadable.add(t.p) } else if (!skip(t.p, false)) unreadableFiles.add(t.p)
          return
        }
        if (s.isSymbolicLink()) { if (!skip(t.p, false)) symlinks.push(t.p); return }
        if (s.isDirectory()) { if (!skip(t.p, true)) stack.push({ abs: t.abs, rel: t.raw }); return }
        if (!s.isFile() || skip(t.p, false)) return
        if (files.has(t.p) || ambiguous.has(t.p)) {
          const names = ambiguous.get(t.p) || [raws.get(t.p)]
          names.push(t.raw)
          ambiguous.set(t.p, names)
          files.delete(t.p)
          return
        }
        raws.set(t.p, t.raw)
        files.set(t.p, { abs: t.abs, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs })
      })
    }
    if (!state.async) await yieldNow()
  }
  return { files, unreadable, unreadableFiles, ambiguous, symlinks, badNames }
}

// Whether a sealed path that the walk did not find is really gone, or only out of sight (inside a folder that could
// not be listed, present but unreadable, or one of two names that share its stored path).
function outOfSight(w, p) {
  if (w.unreadableFiles.has(p) || w.ambiguous.has(p)) return true
  for (const d of w.unreadable) if (d === '' || p.startsWith(d + '/')) return true
  return false
}

// The skip rule for a walk: the ignore patterns (core's matcher: the default ignores plus --ignore), and the agent's
// own files when the ledger is kept inside the data folder somewhere else than ImmutableQC/.
function skipper(ignore, own = new Set()) {
  const ig = ignoreMatcher(ignore)
  const seen = new Map()
  return (p) => {
    let v = seen.get(p)
    if (v === undefined) {
      v = own.has(p) || ig(p)
      if (seen.size > 1000000) seen.clear()
      seen.set(p, v)
    }
    return v
  }
}

const BUF = 1 << 20

// Streams the file through SHA-256. Returns {sha256, bytes, before, after, observedAt}: the stats taken when the file
// was opened and when it was read to the end (the caller compares them to see whether it changed while being read),
// and the time reading finished. stop() -> true aborts with Stopped.
async function hashFile(abs, { stop = () => false, buf } = {}) {
  const fh = await open(abs, 'r')
  try {
    const before = await fh.stat()
    const h = createHash('sha256')
    const b = buf || Buffer.allocUnsafe(BUF)
    let bytes = 0
    for (;;) {
      if (stop()) throw new Stopped('stopped')
      const { bytesRead } = await fh.read(b, 0, b.length, null)
      if (!bytesRead) break
      h.update(b.subarray(0, bytesRead))
      bytes += bytesRead
    }
    const after = await fh.stat()
    return { sha256: h.digest('hex'), bytes, before, after, observedAt: new Date().toISOString() }
  } finally {
    await fh.close()
  }
}

// whether a stat still describes the file as it was seen
const sameStat = (a, b) => a.size === b.size && a.mtimeMs === b.mtimeMs && (a.ctimeMs == null || b.ctimeMs == null || a.ctimeMs === b.ctimeMs)

return { BUSY, Stopped, walk, outOfSight, skipper, hashFile, sameStat }
})()

// ---------------------------------------------------------------------------------------------- agent/src/session.mjs
const __iqc_session = (() => {
// iqc watch and iqc seal: open (or start) the ledger, then seal what changed.
//
// A file is a candidate when its size or modification time differs from what was last sealed (the record's bytes and
// ctx.modifiedAt) or last seen by this agent. A candidate is read once its size and times have not changed for
// --settle seconds, and only if it can be opened (a busy or locked file is retried on the next poll; after a minute
// the agent warns once). If it changed while being read, it waits again. Its SHA-256 goes to core's planSeal with
// the rest of the folder, which decides what to seal and with which event (a touched file with the same bytes is
// not sealed again), so the agent and the app follow one rule.
//
// Events: the files found at the start of a session (a watch's first pass, or a seal) get the first-scan events
// (existing) on a ledger's first scan, else the -unwatched ones; files seen while a watch runs get added, changed and
// removed. A file missing at the start is recorded removed at once (its removal is a past fact); during a watch a
// file must stay missing for --settle seconds first (a program that saves by deleting and renaming does not make a
// removal). A seal handles the files present when it starts, then exits; it waits for files that are being written
// or are locked as long as other files make progress, and at most a minute without progress.
const { hostname } = __node_os
const { existsSync } = __node_fs
const { isFirstScan, planSeal, formatBytes, formatHead, formatDuration, formatCount } = __core
const { AGENT, UserError, EXIT_OK, EXIT_FAIL, EXIT_USAGE, Wake, sleep, pool, isoOf, plural } = __iqc_util
const { dataFolder, locate, displayPath } = __iqc_paths
const { acquireLock } = __iqc_lock
const { createKey, loadKey } = __iqc_keys
const { readLedger, brokenMessage, createLedger, ensureDir, ensureReadme, Appender } = __iqc_ledger
const { walk, outOfSight, skipper, hashFile, sameStat, BUSY, Stopped } = __iqc_scan
const { stationProblem } = __iqc_args

const MINUTE = 60000
const HASHERS = 4

// Opens the ledger for writing: verifies an existing one whole (and refuses a broken one), or starts a new one with
// a new key (or the --key file). Returns {appender, key, station, created}. A missing ledger whose folder was set up
// before (README.txt is written only once a ledger exists) is not replaced silently: it may have been moved or deleted.
async function openForWriting(loc, opts, out) {
  const r = await readLedger(loc.ledgerPath, { missingOk: true })
  if (!r && loc.isDefault && existsSync(loc.readmePath)) {
    throw new UserError(`There is no ledger at ${loc.ledgerPath}, but its folder was set up before (its README.txt is there): the ledger may have been moved, renamed or deleted. Nothing was written. ` +
      `Put the ledger back; or, to start a new ledger for this folder, delete ${loc.readmePath} and run again.`)
  }
  if (r) {
    if (!r.verified.ok) throw new UserError(brokenMessage(r.verified, loc.ledgerPath))
    const key = await loadKey({ header: r.verified.header, keyOpt: opts.key, out })
    const station = opts.station || r.verified.header.station
    return { appender: new Appender(loc.ledgerPath, r.verified, r.stat, { out }), key, station, created: false }
  }
  let station = opts.station
  if (!station) {
    station = hostname()
    const why = stationProblem(station)
    if (why) throw new UserError(`This computer's name (${JSON.stringify(station)}) cannot be the station name: ${why}. Give one with --station <name>.`)
  }
  const key = opts.key ? await loadKey({ keyOpt: opts.key, out }) : await createKey()
  const made = await createLedger(loc.ledgerPath, { key, station })
  return { appender: new Appender(loc.ledgerPath, made.verified, made.stat, { out }), key, station, created: true }
}

async function runSession(kind, { folder, opts, out, signals = process }) {
  const root = dataFolder(folder)
  const loc = locate(root, opts.ledger)
  ensureDir(loc.dir)
  const lock = acquireLock(loc.lockPath, { command: kind, out })
  try {
    const open = await openForWriting(loc, opts, out)
    if (loc.isDefault) ensureReadme(loc.readmePath)
    const s = new Session(kind, { root, loc, opts, out, ...open, signals })
    return await s.run()
  } finally {
    lock.release()
  }
}

class Session {
  constructor(kind, { root, loc, opts, out, appender, key, station, created, signals }) {
    Object.assign(this, { kind, root, loc, opts, out, appender, key, station, created, signals })
    this.settleMs = Math.round((opts.settle ?? 3) * 1000)
    this.intervalMs = Math.round((opts.interval ?? 2) * 1000)
    this.ignore = opts.ignore || []
    this.skip = skipper(this.ignore, loc.own)
    this.known = new Map() // path -> {size, mtimeMs, ctimeMs?, floor?}: what was last sealed or last read
    this.pending = new Map() // path -> candidate {abs, size, mtimeMs, ctimeMs, since, firstAt, startup, busySince, busyCode, warned}
    this.absent = new Map() // path -> since when a sealed file has been missing (watch)
    this.warnedOnce = new Set()
    this.stopping = false
    this.wake = new Wake()
    this.count = { sealed: 0, changed: 0, removed: 0, unchanged: 0 }
    this.buffers = Array.from({ length: HASHERS }, () => Buffer.allocUnsafe(1 << 20))
    this.rootDown = false
    this.walkState = {}
    // what the ledger says was last sealed: a file whose size and modification time still match is not read again
    for (const e of this.v.files.values()) {
      const l = e.latest
      if (l.kind === 'file' && typeof l.modifiedAt === 'string' && Number.isFinite(Date.parse(l.modifiedAt))) {
        this.known.set(e.path, { size: Number(l.bytes), floor: Date.parse(l.modifiedAt) })
      }
    }
  }

  get v() { return this.appender.v }

  async run() {
    const { out } = this
    const startedAt = Date.now()
    if (this.created) {
      const h = this.v.header
      out.print(`New ledger ${this.loc.shown} (ledger id ${h.ledgerId}, station ${h.station}).`)
      if (this.key.created) {
        out.print(`New signing key ${this.key.keyId}, saved to ${this.key.file}`)
        out.print('  Keep a backup of that file: it is needed to add records to this ledger (never to audit it).')
      }
    }
    const stopOn = ['SIGINT', 'SIGTERM', ...(process.platform === 'win32' ? ['SIGBREAK', 'SIGHUP'] : ['SIGHUP'])]
    let signalled = 0
    const onSignal = () => {
      signalled++
      if (signalled > 1) {
        out.error('Stopped at once (second signal). The ledger is complete up to its last record; the next start records the missing stop as a note.')
        process.exit(130)
      }
      this.stop()
    }
    for (const s of stopOn) this.signals.on(s, onSignal)
    try {
      if (this.kind === 'watch') return await this.watch(startedAt)
      return await this.sealOnce(startedAt)
    } finally {
      for (const s of stopOn) this.signals.removeListener(s, onSignal)
    }
  }

  stop() {
    this.stopping = true
    this.wake.fire()
  }

  async session(event) {
    await this.appender.sync()
    const at = new Date().toISOString()
    await this.appender.append([{ kind: 'session', f: { station: this.station, event, at, agent: AGENT } }], this.key.privateKey)
  }

  async watch(startedAt) {
    const { out } = this
    await this.session('watch-started')
    const startup = isFirstScan(this.v) ? 'first' : 'unwatched'
    out.print(`Watching ${this.root}`)
    out.print(`  ledger ${this.loc.shown}, ${plural(this.v.recordCount, 'record', 'records')}, station ${this.station}, key id ${this.key.keyId}`)
    out.print(`  every ${this.intervalMs / 1000} s; a file is sealed once it has not changed for ${this.settleMs / 1000} s. Press Ctrl+C to stop.`)
    this.warnUnclean()
    out.stamp = true
    let first = true, caughtUp = false
    while (!this.stopping) {
      // the start-of-session pass is the first poll that could read the folder
      if (await this.poll({ first, startup, allowNew: true })) first = false
      if (this.stopping) break
      if (!first && !caughtUp && ![...this.pending.values()].some((c) => c.startup)) {
        caughtUp = true
        let n = 0
        for (const e of this.v.files.values()) if (e.latest.kind === 'file') n++
        out.print(`Every file found at the start is sealed (${plural(n, 'file', 'files')} in the ledger). Watching for changes.`)
      }
      await sleep(this.nextWait(), this.wake)
    }
    await this.session('watch-stopped')
    out.stamp = false
    const c = this.count
    out.print(`Stopped after ${formatDuration(Date.now() - startedAt)}: ${c.sealed} sealed, ${c.changed} changed, ${c.removed} removed. Head ${formatHead(this.v.head)}`)
    return EXIT_OK
  }

  async sealOnce(startedAt) {
    const { out } = this
    await this.session('scan')
    this.warnUnclean()
    const startup = isFirstScan(this.v) ? 'first' : 'unwatched'
    await this.poll({ first: true, startup, allowNew: false })
    // wait as long as files keep being sealed; give up on the rest after a minute without progress (longer when the
    // settle time is long: a file needs at least two looks, --settle seconds apart)
    const patience = Math.max(MINUTE, 2 * this.settleMs + 2 * this.intervalMs)
    let lastProgress = Date.now(), done = this.done()
    while (this.pending.size && !this.stopping) {
      if (Date.now() - lastProgress >= patience) break
      await sleep(this.nextWait(), this.wake)
      if (this.stopping) break
      await this.poll({ first: false, startup, allowNew: false })
      if (this.done() !== done) { done = this.done(); lastProgress = Date.now() }
    }
    for (const [p, c] of this.pending) {
      out.warn(`Not sealed: ${displayPath(p)} ${c.busySince !== null ? `could not be read (${c.busyCode}: open in another program, or no permission)` : 'kept changing'}. The next seal or watch picks it up.`)
    }
    const c = this.count
    if (this.stopping) {
      out.error(`Stopped before the seal finished: ${c.sealed} sealed, ${c.changed} changed, ${c.removed} removed so far. The ledger is complete up to record ${this.v.head.n}.`)
      return EXIT_FAIL
    }
    const what = c.sealed + c.changed + c.removed
      ? `Sealed ${c.sealed} new, ${c.changed} changed, ${c.removed} removed; ${formatCount(c.unchanged)} unchanged`
      : `Nothing new to seal: ${plural(c.unchanged, 'file', 'files')} unchanged`
    out.print(`${what} (${formatDuration(Date.now() - startedAt)}). Head ${formatHead(this.v.head)}`)
    return EXIT_OK
  }

  // the session record just written ended a watch that never recorded its stop
  warnUnclean() {
    const s = this.v.sessions.find((x) => x.type === 'watch' && x.clean === false && x.endedByN === this.v.head.n)
    if (s) this.out.warn(`The watch before this one (started in record ${s.startN}) has no stop record: it did not stop cleanly (a crash, a forced quit or a power loss). An audit shows it as a note.`)
  }

  done() { return this.count.sealed + this.count.changed + this.count.removed + this.count.unchanged }

  // how long to sleep: the poll interval, or less when a candidate settles (or a removal is due) sooner
  nextWait() {
    const now = Date.now()
    let next = now + this.intervalMs
    for (const c of this.pending.values()) if (c.busySince === null && c.since + this.settleMs < next) next = c.since + this.settleMs
    for (const t of this.absent.values()) if (t + this.settleMs < next) next = t + this.settleMs
    return Math.max(20, next - now)
  }

  warnOnce(key, msg) {
    if (this.warnedOnce.has(key)) return
    this.warnedOnce.add(key)
    this.out.warn(msg)
  }

  async poll({ first, startup, allowNew }) {
    const { out } = this
    let w
    try {
      w = await walk(this.root, { skip: this.skip, state: this.walkState })
    } catch (e) {
      if (this.kind === 'seal') throw new UserError(`Cannot read the folder ${this.root} (${e.code || e.message}).`, EXIT_USAGE)
      if (!this.rootDown) out.warn(`Cannot read the folder ${this.root} (${e.code || e.message}). Nothing is recorded as removed while it is out of reach; retrying every ${this.intervalMs / 1000} s.`)
      this.rootDown = true
      return false
    }
    if (this.rootDown) { out.print(`The folder ${this.root} can be read again.`); this.rootDown = false }
    for (const d of w.unreadable) this.warnOnce(`dir:${d}`, `Cannot open the folder ${displayPath(d)}; what is inside it is left as it was sealed until it can be read.`)
    for (const [p, names] of w.ambiguous) this.warnOnce(`amb:${p}`, `Not sealed: ${names.length} files are named ${displayPath(p)}, written in different Unicode forms (NFC and NFD). Rename one of them.`)
    for (const p of w.symlinks) this.warnOnce(`link:${p}`, `Skipped ${displayPath(p)}: it is a symbolic link (links are never followed or sealed).`)
    for (const raw of w.badNames) this.warnOnce(`name:${raw}`, `Skipped a file whose name cannot be stored: ${JSON.stringify(raw)}.`)

    const now = Date.now()
    // 1. candidates
    for (const [p, e] of w.files) {
      const k = this.known.get(p)
      if (k && (k.floor !== undefined ? k.size === e.size && k.floor === Math.floor(e.mtimeMs) : sameStat(k, e))) {
        if (first) this.count.unchanged++
        this.pending.delete(p)
        continue
      }
      let c = this.pending.get(p)
      if (!c) {
        if (!first && !allowNew) continue
        c = { size: e.size, mtimeMs: e.mtimeMs, ctimeMs: e.ctimeMs, since: now, firstAt: now, startup: first, busySince: null, busyCode: null, warned: false }
        this.pending.set(p, c)
      } else if (!sameStat(c, e)) {
        Object.assign(c, { size: e.size, mtimeMs: e.mtimeMs, ctimeMs: e.ctimeMs, since: now })
      }
      c.abs = e.abs
      if (this.kind === 'watch' && !c.warned && c.busySince === null && now - c.firstAt >= 5 * MINUTE) {
        c.warned = true
        out.warn(`${displayPath(p)} has kept changing for ${formatDuration(now - c.firstAt)}; it is sealed once it stops changing for ${this.settleMs / 1000} s.`)
      }
    }
    for (const p of [...this.pending.keys()]) if (!w.files.has(p)) this.pending.delete(p)

    // 2. removals
    const removeNow = new Set()
    for (const e of this.v.files.values()) {
      if (e.latest.kind !== 'file') continue
      const p = e.path
      if (w.files.has(p) || outOfSight(w, p) || this.skip(p)) { this.absent.delete(p); continue }
      if (first) removeNow.add(p)
      else if (this.kind === 'watch') {
        const t = this.absent.get(p) ?? now
        this.absent.set(p, t)
        if (now - t >= this.settleMs) removeNow.add(p)
      }
    }

    // 3. read the candidates that have settled
    const due = [...this.pending].filter(([, c]) => now - c.since >= this.settleMs).map(([p]) => p)
    const read = new Map()
    const free = [...this.buffers]
    await pool(due, HASHERS, async (p) => {
      if (this.stopping) return
      const c = this.pending.get(p)
      const buf = free.pop()
      try {
        const r = await hashFile(c.abs, { stop: () => this.stopping, buf })
        if (r.bytes !== c.size || !sameStat(c, r.before) || !sameStat(c, r.after)) {
          // it changed while it was read: wait for it to settle again
          Object.assign(c, { size: r.after.size, mtimeMs: r.after.mtimeMs, ctimeMs: r.after.ctimeMs, since: Date.now(), busySince: null })
          return
        }
        this.pending.delete(p)
        this.known.set(p, { size: c.size, mtimeMs: c.mtimeMs, ctimeMs: c.ctimeMs })
        const v = { sha256: r.sha256, bytes: String(r.bytes), observedAt: r.observedAt, startup: c.startup }
        const m = isoOf(c.mtimeMs)
        if (m) v.modifiedAt = m
        read.set(p, v)
      } catch (e) {
        if (e instanceof Stopped) return
        if (e.code === 'ENOENT') { this.pending.delete(p); return }
        const t = Date.now()
        if (c.busySince === null) c.busySince = t
        c.busyCode = e.code || 'error'
        if (this.kind === 'watch' && !c.warned && t - c.busySince >= MINUTE) {
          c.warned = true
          out.warn(`Cannot read ${displayPath(p)} for ${formatDuration(t - c.busySince)} (${c.busyCode}${BUSY.has(e.code) ? ': open in another program, or no permission' : ''}). Still trying.`)
        }
      } finally {
        free.push(buf)
      }
    })
    if (this.stopping && !read.size && !removeNow.size) return true

    // 4. seal: the start-of-session files with the start events, the rest with the watch events. Each plan sees the
    //    whole folder; paths that belong to the other plan are passed as present-but-unread, so neither seals or
    //    removes them twice.
    const groups = [[startup, new Map([...read].filter(([, v]) => v.startup)), first ? removeNow : new Set()],
      ['watch', new Map([...read].filter(([, v]) => !v.startup)), first ? new Set() : removeNow]]
    for (const [mode, seal, remove] of groups) {
      if (!seal.size && !remove.size) continue
      if (await this.appender.sync()) { this.reload(); }
      const files = new Map()
      for (const e of this.v.files.values()) if (e.latest.kind === 'file' && !remove.has(e.path)) files.set(e.path, null)
      for (const [p, v] of seal) files.set(p, { sha256: v.sha256, bytes: v.bytes, observedAt: v.observedAt, ...(v.modifiedAt ? { modifiedAt: v.modifiedAt } : {}) })
      const items = planSeal(this.v, files, { mode, station: this.station, observedAt: new Date().toISOString(), ignore: this.ignore })
      const sealedPaths = new Set(items.map((x) => x.f.path))
      for (const p of seal.keys()) if (!sealedPaths.has(p)) this.count.unchanged++
      const recs = await this.appender.append(items, this.key.privateKey)
      for (const r of recs) {
        if (r.kind === 'file-removed') this.known.delete(r.f.path)
        this.show(r)
      }
      for (const p of remove) this.absent.delete(p)
    }
    return true
  }

  // after the ledger was read again from disk (grown by another program), what it says was last sealed
  reload() {
    for (const e of this.v.files.values()) {
      const l = e.latest
      if (l.kind === 'file' && !this.known.has(e.path) && typeof l.modifiedAt === 'string') this.known.set(e.path, { size: Number(l.bytes), floor: Date.parse(l.modifiedAt) })
    }
  }

  show(r) {
    const f = r.f, out = this.out
    const tag = f.event.endsWith('-unwatched') ? out.paint('dim', '  (while nothing was watching)') : ''
    if (r.kind === 'file') {
      const changed = f.event === 'changed' || f.event === 'changed-unwatched'
      if (changed) this.count.changed++
      else this.count.sealed++
      out.event(changed ? 'changed' : 'sealed', changed ? 'yellow' : 'green', `${displayPath(f.path)}  ${formatBytes(f.bytes)}  ${f.sha256.slice(0, 8)}…${tag}`)
    } else if (r.kind === 'file-removed') {
      this.count.removed++
      out.event('removed', 'red', `${displayPath(f.path)}${tag}`)
    }
  }
}

return { openForWriting, runSession }
})()

// ---------------------------------------------------------------------------------------------- agent/src/audit.mjs
const __iqc_audit = (() => {
// iqc audit: verify the ledger whole, read every file in the folder (streaming SHA-256), and give core's verdict.
// Exit 0 pass, 1 fail, 2 usage or read error. --report writes core's HTML report, --json its JSON (- for standard
// output). Nothing is written to the ledger or the data folder, and no lock is taken.
const { writeFileSync } = __node_fs
const { resolve } = __node_path
const { audit, renderReportHTML, ignoreMatcher, formatBytes, formatCount } = __core
const { AGENT, UserError, EXIT_OK, EXIT_FAIL, EXIT_USAGE, pool, plural } = __iqc_util
const { dataFolder, locate, displayPath } = __iqc_paths
const { readLedgerSettled } = __iqc_ledger
const { peekLock, lockState, describeLock } = __iqc_lock
const { walk, outOfSight, hashFile } = __iqc_scan

const MAX_PROBLEMS = 30, MAX_ITEMS = 10

// Reads the files present: path -> {sha256, bytes}, or null for a file that is there but could not be read (and for
// sealed paths out of sight). Files that are ignored and were never sealed are not read.
async function readFolder(root, verified, { ignore = [], own = new Set(), out, label = 'Reading' } = {}) {
  let w
  try {
    w = await walk(root, { skip: (p) => own.has(p) })
  } catch (e) {
    throw new UserError(`Cannot read the folder ${root} (${e.code || e.message}).`, EXIT_USAGE)
  }
  const ig = ignoreMatcher(ignore)
  const sealed = verified ? verified.files : new Map()
  const files = new Map()
  const todo = []
  for (const [p, e] of w.files) if (!ig(p) || sealed.has(p)) todo.push([p, e])
  for (const p of w.unreadableFiles) if (!ig(p) || sealed.has(p)) files.set(p, null)
  for (const p of w.ambiguous.keys()) files.set(p, null)
  for (const e of sealed.values()) if (!w.files.has(e.path) && outOfSight(w, e.path)) files.set(e.path, null)
  const total = todo.reduce((a, [, e]) => a + e.size, 0)
  let doneFiles = 0, doneBytes = 0, unread = 0
  const bufs = Array.from({ length: 4 }, () => Buffer.allocUnsafe(1 << 20))
  await pool(todo, 4, async ([p, e]) => {
    const buf = bufs.pop()
    try {
      const r = await hashFile(e.abs, { buf })
      files.set(p, { sha256: r.sha256, bytes: String(r.bytes) })
    } catch {
      files.set(p, null)
      unread++
    } finally {
      bufs.push(buf)
    }
    doneFiles++
    doneBytes += e.size
    if (out) out.progress(`${label} ${formatCount(doneFiles)} of ${formatCount(todo.length)} files (${formatBytes(doneBytes)} of ${formatBytes(total)})`)
  })
  if (out) out.clearProgress()
  return { files, walk: w, unread, read: todo.length - unread }
}

async function runAudit({ folder, opts, out, stdout = process.stdout }) {
  const root = dataFolder(folder)
  const loc = locate(root, opts.ledger)
  const lock = peekLock(loc.lockPath)
  const live = lockState(lock) === 'live'
  const r = await readLedgerSettled(loc.ledgerPath, { agentRunning: () => live, onProgress: (d, t) => out.progress(`Checking the ledger: ${formatCount(d)} of ${formatCount(t)} records`) })
  out.clearProgress()
  const v = r.verified
  if (live) out.note(`An agent is sealing this folder now (${describeLock(lock.info)}): a file written during the audit may show as changed or not sealed. Audit again to be sure.`)
  const { files, walk: w } = await readFolder(root, v, { ignore: opts.ignore, own: loc.own, out, label: 'Reading' })
  for (const p of w.symlinks) out.note(`Skipped ${displayPath(p)}: a symbolic link (links are never followed or sealed).`)
  for (const [p] of w.ambiguous) out.note(`Not checked: more than one file is named ${displayPath(p)}, in different Unicode forms (NFC and NFD).`)
  const report = audit(v, files, {
    expectHead: opts['expect-head'], expectKeyId: opts['expect-key'], strict: !!opts.strict,
    where: 'command line', tool: AGENT, ignore: opts.ignore, folder: folder == null ? '.' : folder,
  })
  const written = []
  const save = (file, text, what) => {
    try {
      writeFileSync(resolve(file), text)
      written.push([what, resolve(file)])
    } catch (e) {
      throw new UserError(`Cannot write the ${what} to ${resolve(file)} (${e.code || e.message}).`, EXIT_USAGE)
    }
  }
  if (opts.report) save(opts.report, renderReportHTML(report), 'report')
  if (opts.json === '-') stdout.write(JSON.stringify(report, null, 2) + '\n')
  else if (opts.json) save(opts.json, JSON.stringify(report, null, 2) + '\n', 'JSON report')
  printReport(report, { out, loc, written })
  return report.verdict === 'pass' ? EXIT_OK : EXIT_FAIL
}

function printReport(report, { out, loc, written }) {
  const pass = report.verdict === 'pass'
  const c = report.counts
  const sentence = report.summary.replace(/^(?:Pass|Fail): /, '').replace(/^./, (ch) => ch.toUpperCase())
  const verdict = `${pass ? out.paint('green', out.paint('bold', 'PASS')) : out.paint('red', out.paint('bold', 'FAIL'))}  ${sentence}`
  // with --quiet, a pass prints nothing (the exit code says it); a fail prints its verdict and problems
  const say = pass ? (s) => out.print(s) : (s) => out.result(s)
  say(verdict)
  if (report.problems.length) {
    say(out.paint('bold', 'Problems'))
    for (const p of report.problems.slice(0, MAX_PROBLEMS)) say(`  ${out.paint('red', '✗')} ${p.message}`)
    if (report.problems.length > MAX_PROBLEMS) say(`  …and ${formatCount(report.problems.length - MAX_PROBLEMS)} more (every one is in the report: --report or --json).`)
  }
  if (report.notes.length) {
    const strictFail = report.strict
    const sayN = strictFail ? say : (s) => out.print(s)
    sayN(out.paint('bold', strictFail ? 'Notes (failures in strict mode)' : 'Notes (not failures)'))
    for (const n of report.notes) {
      sayN(`  ${out.paint('yellow', '•')} ${n.message}`)
      for (const x of n.items.slice(0, MAX_ITEMS)) sayN(`      ${x}`)
      if (n.items.length > MAX_ITEMS) sayN(`      …and ${formatCount(n.items.length - MAX_ITEMS)} more`)
    }
  }
  const L = report.ledger
  out.print(`${out.paint('dim', 'Ledger ')}  ${loc.shown}: ${plural(L.records, 'record', 'records')}${L.station ? `, station ${L.station}` : ''}${L.keyId ? `, key id ${L.keyId}` : ''}`)
  if (L.head) out.print(`${out.paint('dim', 'Head   ')}  ${L.head.n}:${L.head.h}`)
  const parts = [`${c.match} match`]
  if (c.changed) parts.push(`${c.changed} changed`)
  if (c.missing) parts.push(`${c.missing} missing`)
  if (c.removed) parts.push(`${c.removed} removed (recorded)`)
  if (c.backAfterRemoval) parts.push(`${c.backAfterRemoval} back after removal`)
  if (c.notChecked) parts.push(`${c.notChecked} not checked`)
  out.print(`${out.paint('dim', 'Files  ')}  ${plural(c.sealed, 'file', 'files')} sealed: ${parts.join(', ')}${c.notSealed ? `; ${plural(c.notSealed, 'file', 'files')} not sealed` : ''}; read ${plural(c.filesRead, 'file', 'files')} (${formatBytes(c.bytesRead)})`)
  for (const [what, file] of written) out.print(`${out.paint('dim', what === 'report' ? 'Report ' : 'JSON   ')}  ${file}`)
}

return { readFolder, runAudit }
})()

// ---------------------------------------------------------------------------------------------- agent/src/info.mjs
const __iqc_info = (() => {
// iqc head and iqc status: read-only views of a ledger (no lock, nothing written).
const { existsSync } = __node_fs
const { resolve } = __node_path
const { formatHead, formatBytes, formatCount, ignoreMatcher } = __core
const { EXIT_OK, EXIT_FAIL, pool, plural, whenUTC } = __iqc_util
const { dataFolder, locate, displayPath } = __iqc_paths
const { readLedgerSettled } = __iqc_ledger
const { peekLock, lockState, describeLock } = __iqc_lock
const { keyFileOf } = __iqc_keys
const { walk, outOfSight, hashFile } = __iqc_scan

const MAX_LIST = 20

function problemLines(v, out) {
  const p = v.problems
  out.error(`The ledger does not verify: ${p.length === 1 ? 'it has 1 problem' : `it has ${formatCount(p.length)} problems`}.`)
  for (const x of p.slice(0, 3)) out.error(`  ${x.message}`)
  if (p.length > 3) out.error(`  …and ${formatCount(p.length - 3)} more. Run iqc audit to see every problem.`)
  else out.error('Run iqc audit to see what each problem means.')
}

// iqc head: the head on standard output (n:h, nothing else), what it is on standard error.
async function runHead({ folder, opts, out }) {
  const root = dataFolder(folder)
  const loc = locate(root, opts.ledger)
  const { verified: v } = await readLedgerSettled(loc.ledgerPath, { agentRunning: () => lockState(peekLock(loc.lockPath)) === 'live' })
  if (!v.ok) {
    problemLines(v, out)
    out.error('No head is printed: pin a head only from a ledger that verifies.')
    return EXIT_FAIL
  }
  const head = formatHead(v.head)
  out.result(head)
  out.note(`Record ${v.head.n} of ledger ${v.header.ledgerId} (station ${v.header.station}, key id ${v.keyId}).`)
  out.note('Pin it somewhere else (an email, an ELN entry, a printout). A later audit shows whether the ledger was rewritten or cut short since:')
  out.note(`  iqc audit ${folder == null ? '.' : /\s/.test(folder) ? `"${folder}"` : folder} --expect-head ${head} --expect-key ${v.keyId}`)
  return EXIT_OK
}

// iqc status: the ledger, the key, the agent, the last session, and what changed since the last seal.
async function runStatus({ folder, opts, out }) {
  const root = dataFolder(folder)
  const loc = locate(root, opts.ledger)
  const label = (s) => out.paint('dim', s.padEnd(9))
  const lock = peekLock(loc.lockPath)
  const ls = lockState(lock)
  const r = await readLedgerSettled(loc.ledgerPath, { missingOk: true, agentRunning: () => ls === 'live' })
  out.print(`${label('Folder')}${root}`)
  if (!r) {
    out.print(`${label('Ledger')}none yet (it would be ${loc.ledgerPath})`)
    const ch = await changes(root, null, loc, opts)
    out.print(`${plural(ch.added.length, 'file', 'files')} (${formatBytes(ch.bytes)}) would be sealed by iqc seal or iqc watch.`)
    return EXIT_OK
  }
  const v = r.verified
  out.print(`${label('Ledger')}${loc.shown}: ${v.ok ? out.paint('green', 'intact') : out.paint('red', 'does not verify')}, ${plural(v.recordCount, 'record', 'records')}, ${formatBytes(r.bytes)}`)
  const H = v.header
  if (H && typeof H.station === 'string') out.print(`${label('Station')}${H.station}`)
  if (H && typeof H.keyId === 'string') {
    const kf = opts.key ? resolve(opts.key) : keyFileOf(H.keyId)
    out.print(`${label('Key')}${H.keyId}, ${existsSync(kf) ? `on this computer (${kf})` : `not on this computer (no ${kf}): needed to add records, not to audit`}`)
  }
  if (H && typeof H.createdAt === 'string') out.print(`${label('Created')}${whenUTC(H.createdAt)}`)
  if (v.head) out.print(`${label('Head')}${formatHead(v.head)}`)
  if (ls === 'live') out.print(`${label('Agent')}running (${describeLock(lock.info)})`)
  else if (ls === 'other-host') out.print(`${label('Agent')}a lock is held from another computer (${describeLock(lock.info)})`)
  else if (ls === 'stale' || ls === 'unreadable') out.print(`${label('Agent')}not running (a stale lock is left${lock.info ? ` from ${describeLock(lock.info)}` : ''}; the next agent takes it over)`)
  else out.print(`${label('Agent')}not running`)
  const s = v.sessions[v.sessions.length - 1]
  if (s) {
    let t
    if (s.type === 'scan') t = `seal at ${whenUTC(s.start)} (record ${s.startN}), ${plural(s.files, 'file record', 'file records')}`
    else if (s.stray) t = `a watch stop without a start (record ${s.stopN})`
    else {
      const end = s.open ? (ls === 'live' ? 'running now' : 'no stop record yet (it did not stop cleanly)') : s.clean ? `stopped ${whenUTC(s.stop)} (record ${s.stopN})` : `ended without a stop record (next start: record ${s.endedByN})`
      t = `watch started ${whenUTC(s.start)} (record ${s.startN}), ${end}, ${plural(s.files, 'file record', 'file records')}`
    }
    out.print(`${label('Last')}${t}`)
  }
  if (!v.ok) {
    problemLines(v, out)
    return EXIT_FAIL
  }
  const ch = await changes(root, v, loc, opts)
  const n = ch.added.length + ch.changed.length + ch.removed.length
  out.print(n ? `Since the last seal: ${ch.added.length} new, ${ch.changed.length} changed, ${ch.removed.length} removed; ${formatCount(ch.unchanged)} unchanged.`
    : `Nothing changed since the last seal (${plural(ch.unchanged, 'file', 'files')}).`)
  for (const [word, color, list] of [['new', 'green', ch.added], ['changed', 'yellow', ch.changed], ['removed', 'red', ch.removed]]) {
    for (const p of list.slice(0, MAX_LIST)) out.event(word, color, displayPath(p))
    if (list.length > MAX_LIST) out.print(`         …and ${formatCount(list.length - MAX_LIST)} more ${word}`)
  }
  if (ch.unread.length) out.print(`Could not read ${plural(ch.unread.length, 'file', 'files')} (open in another program, or no permission): ${ch.unread.slice(0, 5).map(displayPath).join(', ')}${ch.unread.length > 5 ? ', …' : ''}`)
  return EXIT_OK
}

// What a seal now would do, read-only: a file whose size and modification time match its last seal is unchanged;
// any other is read, and is changed only if its SHA-256 differs.
async function changes(root, v, loc, opts) {
  const ig = ignoreMatcher(opts.ignore)
  const w = await walk(root, { skip: (p) => loc.own.has(p) || ig(p) })
  const added = [], changed = [], removed = [], unread = []
  let unchanged = 0, bytes = 0
  const toRead = []
  for (const [p, e] of w.files) {
    const l = v && v.files.has(p) ? v.files.get(p).latest : null
    if (!l || l.kind !== 'file') { added.push(p); bytes += e.size; continue }
    if (String(e.size) === l.bytes && typeof l.modifiedAt === 'string' && Date.parse(l.modifiedAt) === Math.floor(e.mtimeMs)) { unchanged++; continue }
    toRead.push([p, e, l])
  }
  await pool(toRead, 4, async ([p, e, l]) => {
    try {
      const r = await hashFile(e.abs)
      if (r.sha256 === l.sha256) unchanged++
      else changed.push(p)
    } catch {
      unread.push(p)
    }
  })
  if (v) for (const e of v.files.values()) if (e.latest.kind === 'file' && !w.files.has(e.path) && !outOfSight(w, e.path) && !ig(e.path) && !loc.own.has(e.path)) removed.push(e.path)
  const sort = (a) => a.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))
  return { added: sort(added), changed: sort(changed), removed: sort(removed), unread: sort(unread), unchanged, bytes }
}

return { runHead, runStatus }
})()

// ---------------------------------------------------------------------------------------------- agent/src/cli.mjs
const __iqc_cli = (() => {
// iqc: the command line. run(argv) returns the exit code; it never throws for a mistake a person can fix (those are
// printed as one clear message, with a stack trace only when IQC_DEBUG=1).
const { AGENT_VERSION, UserError, EXIT_OK, EXIT_FAIL, EXIT_USAGE } = __iqc_util
const { parseArgs } = __iqc_args
const { Out } = __iqc_out
const { runSession } = __iqc_session
const { runAudit } = __iqc_audit
const { runHead, runStatus } = __iqc_info

const HELP = `iqc ${AGENT_VERSION}: the Immutable QC agent. It seals every file in a folder as it is written,
and audits the folder against its seals. Nothing is sent anywhere: iqc reads files and writes
its ledger; it never uses the network.

Usage:  node iqc.mjs <command> [folder] [options]

  watch  [folder]   Seal everything now, then keep sealing new, changed and removed files
                    until Ctrl+C.
  seal   [folder]   Seal once and exit (for a scheduler or a pipeline).
  audit  [folder]   Check the ledger and every file. Exit 0 pass, 1 fail, 2 usage or read error.
                    --report <file.html>   write the audit report (one HTML file, prints well)
                    --json <file.json>     write the machine-readable report (- for the output)
                    --expect-head <n>:<h>  fail unless record n's link is h (a head pinned earlier)
                    --expect-key <keyId>   fail unless the ledger is signed with this key id
                    --strict               count notes as failures
  head   [folder]   Print the current head, to pin somewhere else (an email, an ELN entry,
                    a printout).
  status [folder]   Ledger, key, records, last session, and what changed since the last seal.
  help [command]    This help, or one command's.  --version prints the version.

The folder defaults to the current folder. Quote a path with spaces: "D:\\Instrument Data".

Options for every command:
  --ledger <path>    the ledger file (default: <folder>/ImmutableQC/ledger.jsonl)
  --key <path>       the signing key (default: ~/.immutableqc/keys/<key id>.jwk)
  --station <name>   the station in new records (default: the ledger's, or this computer's name)
  --interval <s>     seconds between scans (default 2)
  --settle <s>       seconds a file must stay unchanged before it is sealed (default 3)
  --ignore <glob>    skip matching files and folders; repeatable; * and ? (always skipped:
                     .DS_Store, Thumbs.db, desktop.ini, ~$*, *.tmp)
  --quiet            print only problems
  --no-color         no colors (NO_COLOR is honored too)

Examples:
  node iqc.mjs watch "D:\\Results"            Windows
  node iqc.mjs seal ~/instrument-data         macOS, Linux
  node iqc.mjs audit . --report audit.html
  node iqc.mjs head

Files: <folder>/ImmutableQC/ holds ledger.jsonl, README.txt and, while an agent runs,
agent.lock. Keys are kept in ~/.immutableqc/keys/. To audit in a browser, drop the folder on
https://immutableqc.com/app/ (nothing is uploaded).
`

const COMMAND_HELP = {
  watch: `iqc watch [folder] [options]

Seals every file in the folder now, then keeps sealing new, changed and removed files until you
press Ctrl+C (or the process is stopped). It writes a watch-started record first and a
watch-stopped record when it stops. A file is sealed once its size and modification time have
not changed for --settle seconds; the folder is scanned every --interval seconds, so it works on
network shares too. Only one agent may write to a ledger at a time.

Options: --ledger --key --station --interval <s> (2) --settle <s> (3) --ignore <glob> --quiet
         --no-color
Example: node iqc.mjs watch "D:\\Results"`,
  seal: `iqc seal [folder] [options]

Seals the folder once and exits: a scan record, then every file that is new, changed or removed
since the last seal. For a scheduled task or a pipeline. Exit 0 when done, 1 when it refused
(a broken ledger, a missing key, another agent running) or could not write, 2 for a usage or
read error.

Options: --ledger --key --station --settle <s> (3) --ignore <glob> --quiet --no-color
Example: node iqc.mjs seal /data/plate-reader --quiet`,
  audit: `iqc audit [folder] [options]

Checks the ledger (every signature and link) and reads every file to compare it with its seal.
Prints the verdict; exit 0 pass, 1 fail, 2 usage or read error. Writes nothing unless asked.

  --report <file.html>   the audit report: one self-contained HTML file
  --json <file.json>     the machine-readable report (- writes it to the standard output)
  --expect-head <n>:<h>  fail unless record n's link is h (a head pinned earlier with iqc head)
  --expect-key <keyId>   fail unless the ledger is signed with this key id
  --strict               count notes as failures
  --ledger --ignore --quiet --no-color

Example: node iqc.mjs audit "D:\\Results" --report audit.html --expect-head 1234:9f86d081…`,
  head: `iqc head [folder] [options]

Prints the current head (record number and link, n:h) on its own line, to pin somewhere else:
an email, an ELN entry, a printout. A later audit with --expect-head shows whether the ledger was
rewritten or cut short since. Exit 1 if the ledger does not verify.

Options: --ledger --quiet --no-color
Example: node iqc.mjs head "D:\\Results"`,
  status: `iqc status [folder] [options]

Shows the ledger (records, intact or not), the station, whether the signing key is on this
computer, the head, whether an agent is running, the last session, and what changed since the
last seal (read-only: nothing is written).

Options: --ledger --key --ignore --quiet --no-color
Example: node iqc.mjs status`,
  help: 'iqc help [command]\n\nShows the help, or one command\'s.',
}

async function run(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env, signals = process } = {}) {
  const major = Number(String(process.versions.node).split('.')[0])
  if (!(major >= 20)) {
    stderr.write(`iqc needs Node.js 20 or later; this is Node.js ${process.versions.node}. Get a current version from https://nodejs.org\n`)
    return EXIT_USAGE
  }
  let out = new Out({ stdout, stderr, env })
  let command = null
  try {
    const a = parseArgs(argv)
    command = a.command
    if (a.version) { stdout.write(`iqc ${AGENT_VERSION}\n`); return EXIT_OK }
    if (a.help || command === null) {
      const topic = a.topic || (command !== 'help' ? command : null)
      stdout.write((topic && COMMAND_HELP[topic] ? COMMAND_HELP[topic] + '\n' : HELP))
      return EXIT_OK
    }
    // with --json -, the JSON is the standard output; the human lines go to standard error
    const humanOut = command === 'audit' && a.opts.json === '-' ? stderr : stdout
    out = new Out({ quiet: !!a.opts.quiet, noColor: !!a.opts['no-color'], env, stdout: humanOut, stderr })
    const ctx = { folder: a.folder, opts: a.opts, out, stdout, signals }
    if (command === 'watch' || command === 'seal') return await runSession(command, ctx)
    if (command === 'audit') return await runAudit(ctx)
    if (command === 'head') return await runHead(ctx)
    if (command === 'status') return await runStatus(ctx)
    return EXIT_USAGE
  } catch (e) {
    if (e instanceof UserError) {
      out.error(e.message)
      return e.exitCode
    }
    out.error(`Something went wrong that iqc did not expect: ${e && e.message ? e.message : e}`)
    if (env.IQC_DEBUG === '1') stderr.write(`${e && e.stack ? e.stack : e}\n`)
    else out.error('Run it again with IQC_DEBUG=1 to see the details.')
    return command === 'audit' ? EXIT_USAGE : EXIT_FAIL
  }
}

return { HELP, run }
})()

process.exitCode = await __iqc_cli.run(process.argv.slice(2))
