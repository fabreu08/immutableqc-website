// Immutable QC core: ledger format version 1 (docs/product-v1.md, section 3; agent steps, reviews and the multi-ledger
// audit: section 3 as extended by docs/build-notes/spec-addendum-agents.md, B and C).
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
//   KINDS, MODE_EVENTS, DEFAULT_IGNORES, DECISIONS, REF_LIMIT   constants of the format (frozen)
//   toHex(bytes) -> hex;  fromHex(hex) -> Uint8Array (lowercase hex only)
//   sha256Hex(stringOrBytes) -> 64 hex      sync; strings are hashed as UTF-8
//   class Sha256                             new Sha256().update(Uint8Array|string)… .digest() -> Uint8Array(32) | .hex()
//   isTime(s), isReadingTime(s), isSealedText(s), isHex(s, len)            the text rules of 3.2, as booleans
//   encodePath(rawRelPath) -> path          NFC, `/` separators, `%`, `|` and control characters as %XX; throws
//   decodePath(path) -> raw;  validatePath(path) -> null | reason (a phrase)
//   isLedgerFolderPath(path)                 true for the root `ImmutableQC` folder and anything inside it
//   ignoreMatcher(globs) -> (path) => bool   DEFAULT_IGNORES plus globs (* and ?), see the function
//   payloadOf(kind, f) -> text;  fingerprintOf(kind, f) -> r;  genesisOf(header) -> g;  linkOf(prevHex, rHex, n) -> h
//   encodeRef({sha256, bytes, path | rawPath}) -> '<sha256>:<bytes>:<path, "," as %2C>';  parseRef(text) -> {sha256, bytes, path}
//   encodeRefList(refs) -> text ('-' when empty; exact duplicates left out);  parseRefList(text) -> [{sha256, bytes, path}]
//   encodeSubject({ledgerId, n, h}) -> '<ledgerId>:<n>:<h>';  parseSubject(text) -> {ledgerId, n, h}
//   encodeSubjectList(subjects) -> text (1 to 1,000);  parseSubjectList(text) -> [{ledgerId, n, h}]
//   planStep({station, actor, tool?, action, inputs: [{path, sha256, bytes}], outputs: [...], at?}) -> {kind: 'step', f}
//   planReview({station, reviewer, subjects: [{ledgerId, n, h}], decision, note?, at?}) -> {kind: 'review', f}
//         both check every field rule (they throw a plain sentence); tool defaults to '-', note to '-', at to now
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
//   audit(verified, files|null, {expectHead, expectKeyId, allowChanges, strict, auditedAt, where: 'browser'|'command
//         line', tool, ignore, folder}) -> report       (section 3.8; JSON.stringify(report) is the machine-readable form)
//   auditMany([{verified, root?, files?, label?, ledgerPath?}], {expectHeads, expectKeyIds, allowChanges, pinLines, strict,
//         auditedAt, where, tool, ignore, folder, maxDepth}) -> report   (addendum C; see "report (auditMany)" below)
//   discoverLedgers(relativePaths) -> [{ledgerPath, root, nested?}]   the ledgers in a dropped or walked folder (addendum C)
//   parsePinLines(textOrLines) -> [{line, ledgerId, n, h, at} | {line, text, error}];  formatPinLine(ledgerId, {n, h}, at)
//   renderReportHTML(report) -> HTML         (section 3.9; an auditMany report too)
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
// report (audit): {format: 'immutableqc-audit', version: 1, verdict: 'pass'|'review'|'fail', summary, strict,
//   filesChecked, counts, problems (the ledger's, then expect-head, expect-key, then changed and missing files by path),
//   forReview [{code, message, count, items, records: [{ledgerId, n}]}] with codes sealed-more-than-once (a path with
//   more than one sealed version) and removed (a recorded removal), each unless its path matches allowChanges (globs,
//   the ignore rule's syntax; matched changes are listed in allowChanges.matched), notes [{code, message, count, items}]
//   with codes unwatched, not-sealed, back-after-removal, not-checked, unclean-stop (watch or MCP server sessions), gaps;
//   allowChanges {patterns, matched}, ledger (with role: measured, agent, reviewer, mixed or empty), sessions,
//   mcpSessions, gaps, expectations, files [{path, state, versions, latest, sealed, present, matchesN, records}] by path,
//   method, rerun}. File states: match, changed, missing, removed, back after removal, not sealed, not checked.
//   Verdict: fail on any problem; else review when forReview is not empty; else pass. strict: review and notes fail.
// report (auditMany): the same format, version and verdict levels, kind: 'many', and: counts (ledgers, records, files
//   as above summed, steps, inputs, measuredInputs, derivedInputs, untracedInputs, outputs, outputsChanged,
//   outputsMissing, outputsNotChecked, reviews, stepsApproved, stepsQuestion, stepsRejected, stepsAwaiting, problems,
//   review, notes, …); problems [{code, message, ledgerId, ledger, records: [{ledgerId, ledger, n}], …}] (each ledger's,
//   prefixed with its label when there are several, then output-changed, output-missing, review-subject-changed,
//   expect-head, expect-key, pin, pin-unreadable); forReview (sealed-more-than-once, removed, untraced-input,
//   step-cycle, input-changed-after-use, review-rejected, review-question); notes (each ledger's, awaiting-review,
//   review-unknown-ledger, unexpected-key, pin-other-ledger, duplicate-ledger, outputs-not-checked);
//   ledgers [{ledger, label, root, ledgerPath, ledgerId, station, keyId, role, records, goodRecords, head, intact,
//   createdAt, kinds, steps, filesChecked, verdict, summary, report (its own audit, without method and rerun)}];
//   steps [{ledgerId, ledger, label, n, h, station, actor, tool, action, at, inputs [{path, sha256, bytes, state:
//   measured|derived|untraced, measured?: [{ledgerId, ledger, station, path, n, observedAt, event, sealedAgainN?}],
//   step?: {ledgerId, ledger, n}, changedAfter?: {…, n, observedAt, afterUse}}], outputs [{path, sha256, bytes, state:
//   match|changed|missing|not checked|superseded, present?, matchesStep?, supersededBy?}], review {state: approved|
//   question|rejected|awaiting review, decisions [{reviewer, decision, note, at, ledgerId, ledger, n, latest}]},
//   lineage {measured, untraced, over, cycle, empty, tracesToMeasured, sentence}}]; reviews [{ledgerId, ledger, n, h,
//   station, reviewer, decision, note, at, subjects [{ledgerId, n, h, state: matches|changed|unknown ledger, ledger?,
//   kind?, path?, why?}]}]; lineage {maxDepth, outputs [{ledgerId, ledger, n, path, sha256, state, …lineage, tree |
//   null, treeOmitted?}]}, a tree node being {path, sha256, bytes, state, measured?, step?, inputs?, stop?: cycle|
//   shown above|depth} or {stop: 'size', more}; expectations {heads, keyIds, pins}; files (every ledger's, with ledger);
//   allowChanges, method, rerun. A step's output path is relative to its own ledger's root; inputs are matched by
//   SHA-256 only (paths are labels). A step's lineage covers all its inputs (a step does not say which input made which
//   output). Trees stop at maxDepth steps (default 32), 200 nodes each and 50,000 in all; the summaries are complete.

export const VERSION = '0.1.0'
export const FORMAT = 'immutableqc-ledger'
export const FORMAT_VERSION = 1
export const AUDIT_FORMAT = 'immutableqc-audit'
export const ALG = 'ECDSA-P256-SHA256'
export const LEDGER_DIR = 'ImmutableQC'
export const LEDGER_FILE = 'ledger.jsonl'
export const LEDGER_PATH = 'ImmutableQC/ledger.jsonl'
export const HEADER_KEYS = Object.freeze(['format', 'version', 'ledgerId', 'createdAt', 'station', 'alg', 'publicKey', 'keyId', 'g', 'sig', 'ctx'])
export const RECORD_KEYS = Object.freeze(['n', 'kind', 'f', 'r', 'prev', 'h', 'sig', 'ctx'])
export const KINDS = Object.freeze({
  file: Object.freeze({ tag: 'iqc-file-v1', label: 'file', fields: Object.freeze(['station', 'path', 'sha256', 'bytes', 'observedAt', 'event']), events: Object.freeze(['existing', 'added', 'changed', 'added-unwatched', 'changed-unwatched']) }),
  'file-removed': Object.freeze({ tag: 'iqc-file-removed-v1', label: 'removal', fields: Object.freeze(['station', 'path', 'observedAt', 'event']), events: Object.freeze(['removed', 'removed-unwatched']) }),
  session: Object.freeze({ tag: 'iqc-session-v1', label: 'session', fields: Object.freeze(['station', 'event', 'at', 'agent']), events: Object.freeze(['watch-started', 'watch-stopped', 'scan', 'mcp-started', 'mcp-stopped']) }),
  reading: Object.freeze({ tag: null, label: 'reading', fields: Object.freeze(['instrumentId', 'sensorType', 'value', 'unit', 'capturedAt']), events: null }),
  step: Object.freeze({ tag: 'iqc-step-v1', label: 'step', fields: Object.freeze(['station', 'actor', 'tool', 'action', 'inputs', 'outputs', 'at']), events: null }),
  review: Object.freeze({ tag: 'iqc-review-v1', label: 'review', fields: Object.freeze(['station', 'reviewer', 'subjects', 'decision', 'note', 'at']), events: null }),
})
export const DECISIONS = Object.freeze(['approved', 'question', 'rejected'])
export const REF_LIMIT = 1000
// events per planSeal mode: [new file, changed file, removed file]
export const MODE_EVENTS = Object.freeze({
  first: Object.freeze(['existing', 'changed-unwatched', 'removed-unwatched']),
  watch: Object.freeze(['added', 'changed', 'removed']),
  unwatched: Object.freeze(['added-unwatched', 'changed-unwatched', 'removed-unwatched']),
})
export const DEFAULT_IGNORES = Object.freeze(['.DS_Store', 'Thumbs.db', 'desktop.ini', '~$*', '*.tmp'])

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

export function toHex(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes)
  let s = ''
  for (let i = 0; i < b.length; i++) s += _HEXB[b[i]]
  return s
}

const _HEXV = (() => { const t = new Uint8Array(128); for (let i = 0; i < 16; i++) t['0123456789abcdef'.charCodeAt(i)] = i; return t })()

export function fromHex(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !_HEXRE.test(hex)) throw new Error('Expected lowercase hex with an even number of digits.')
  return _hexBytes(hex)
}

// for values already checked to be lowercase hex
function _hexBytes(hex) {
  const b = new Uint8Array(hex.length >> 1)
  for (let i = 0, j = 0; i < b.length; i++, j += 2) b[i] = (_HEXV[hex.charCodeAt(j)] << 4) | _HEXV[hex.charCodeAt(j + 1)]
  return b
}

export function isHex(s, len) {
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
export class Sha256 {
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

export function sha256Hex(input) {
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
export function isSealedText(s) {
  return typeof s === 'string' && !_BADCHAR.test(s) && _wellFormed(s)
}

// YYYY-MM-DDTHH:mm:ss.sssZ, exactly what Date.prototype.toISOString() gives, and a real date
export function isTime(s) {
  if (typeof s !== 'string' || !_TIME.test(s)) return false
  const t = Date.parse(s)
  return !Number.isNaN(t) && new Date(t).toISOString() === s
}

// a reading's capturedAt (the docs pages' rule): the same, where the milliseconds may be left out
export function isReadingTime(s) {
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

export function encodePath(raw) {
  if (typeof raw !== 'string') throw new TypeError('A path must be a string.')
  if (!_wellFormed(raw)) throw new Error(`Not a valid relative path (it holds a lone surrogate): ${JSON.stringify(raw)}`)
  const p = raw.normalize('NFC')
  const why = _segmentProblem(p)
  if (why) throw new Error(`Not a valid relative path (${why}): ${JSON.stringify(raw)}`)
  return p.replace(_ENC, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))
}

export function validatePath(p) {
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

export function decodePath(p) {
  const why = validatePath(p)
  if (why) throw new Error(`Not a valid encoded path (${why}): ${JSON.stringify(p)}`)
  return p.replace(_ESC, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

export function isLedgerFolderPath(p) {
  return p === LEDGER_DIR || (typeof p === 'string' && p.startsWith(LEDGER_DIR + '/'))
}

// Ignore rules, shared by planSeal and audit: DEFAULT_IGNORES plus the given globs. `*` matches any run of characters
// and `?` one character, never "/"; matching ignores case (Windows and macOS folders usually do). A glob without "/"
// matches any one segment of the path (a file name, or a folder name, which ignores everything inside it); a glob with
// "/" matches the whole relative path. Paths are matched decoded (raw), so "50%*" matches "50% B.csv".
export function ignoreMatcher(globs = []) {
  return _globMatcher([...DEFAULT_IGNORES, ...(globs || [])], 'An ignore pattern')
}

// The same glob rule for any list (audit's allowChanges uses it with no default patterns); an empty list matches nothing.
function _globMatcher(list, what) {
  if (list != null && !Array.isArray(list)) list = [list]
  const res = (list || []).map((g) => {
    if (typeof g !== 'string' || g === '') throw new Error(`${what} must be a non-empty string.`)
    const body = g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
    return { whole: g.includes('/'), re: new RegExp(`^${body}$`, 'i') }
  })
  if (!res.length) return () => false
  return (p) => {
    let raw = p
    try { raw = decodePath(p) } catch { /* a raw path */ }
    const segs = raw.split('/')
    return res.some(({ whole, re }) => (whole ? re.test(raw) : segs.some((s) => re.test(s))))
  }
}

// ------------------------------------------------------------------------------------------- payload, fingerprint, link
export function payloadOf(kind, f) {
  const k = KINDS[kind]
  if (!k || !_own(KINDS, kind)) throw new Error(`Unknown kind ${_clip(kind)}.`)
  const vals = k.fields.map((name) => f[name])
  return (k.tag ? [k.tag, ...vals] : vals).join('|')
}

export function fingerprintOf(kind, f) {
  return sha256Hex(payloadOf(kind, f))
}

export function genesisOf(header) {
  return sha256Hex(['immutableqc-ledger-v1', header.ledgerId, header.createdAt, header.station, header.alg, header.publicKey].join('|'))
}

export function linkOf(prevHex, rHex, n) {
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

export async function generateKeyPair({ extractable = false } = {}) {
  return _subtle().generateKey(_EC, !!extractable, ['sign', 'verify'])
}

export async function publicKeyHex(publicKey) {
  return toHex(new Uint8Array(await _subtle().exportKey('raw', publicKey)))
}

export async function importPublicKeyHex(hex) {
  if (typeof hex !== 'string' || !_HEX130.test(hex)) throw new Error('A public key must be 130 lowercase hex characters starting with 04 (an uncompressed P-256 point).')
  return _subtle().importKey('raw', fromHex(hex), _EC, true, ['verify'])
}

export async function exportPrivateJwk(privateKey) {
  return _subtle().exportKey('jwk', privateKey)
}

export async function importPrivateJwk(jwk, { extractable = false } = {}) {
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

export function publicKeyHexOfJwk(jwk) {
  if (!_isObj(jwk) || jwk.kty !== 'EC' || jwk.crv !== 'P-256') throw new Error('Not a P-256 key in JWK form.')
  const x = _b64url(jwk.x), y = _b64url(jwk.y)
  if (x.length !== 32 || y.length !== 32) throw new Error('Not a P-256 key in JWK form.')
  return '04' + toHex(x) + toHex(y)
}

export function keyIdOf(pubHex) {
  if (typeof pubHex !== 'string' || !_HEX130.test(pubHex)) throw new Error('A public key must be 130 lowercase hex characters starting with 04.')
  return sha256Hex(fromHex(pubHex)).slice(0, 16)
}

// null when sigHex is a well-formed low-S signature; else 'form' (not 128 hex), 'range' (r or s is 0 or not below
// the group order) or 'high-s' (s above n/2: the second, refused form of a valid signature).
// 64-digit lowercase hex strings compare in the same order as the numbers they write
const _NHEX = _N.toString(16).padStart(64, '0')
const _HALFHEX = ((_N - BigInt(1)) / BigInt(2)).toString(16).padStart(64, '0')
const _ZERO64 = '0'.repeat(64)

export function sigProblem(sigHex) {
  if (typeof sigHex !== 'string' || !_HEX128.test(sigHex)) return 'form'
  const r = sigHex.slice(0, 64), s = sigHex.slice(64)
  if (r === _ZERO64 || r >= _NHEX || s === _ZERO64 || s >= _NHEX) return 'range'
  if (s > _HALFHEX) return 'high-s'
  return null
}

export function isLowS(sigHex) {
  return sigProblem(sigHex) === null
}

export function normalizeLowS(sigHex) {
  if (typeof sigHex !== 'string' || !_HEX128.test(sigHex)) throw new Error('A signature must be 128 lowercase hex characters.')
  if (sigHex.slice(64) <= _HALFHEX) return sigHex
  return sigHex.slice(0, 64) + (_N - BigInt('0x' + sigHex.slice(64))).toString(16).padStart(64, '0')
}

export async function signLink(privateKey, hex64) {
  if (!isHex(hex64, 64)) throw new Error('A link must be 64 lowercase hex characters.')
  const sig = new Uint8Array(await _subtle().sign(_SIGALG, privateKey, fromHex(hex64)))
  return normalizeLowS(toHex(sig))
}

export async function verifyLink(publicKey, hex64, sigHex) {
  if (!isHex(hex64, 64) || sigProblem(sigHex) !== null) return false
  const key = typeof publicKey === 'string' ? await importPublicKeyHex(publicKey) : publicKey
  return _subtle().verify(_SIGALG, key, fromHex(sigHex), fromHex(hex64))
}

export async function keyMatches(privateKey, pubHex) {
  const probe = toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)))
  try { return await verifyLink(pubHex, probe, await signLink(privateKey, probe)) } catch { return false }
}

// For verifyLedger's verifyBatch option, on the other side (a Web Worker, say): checks each {h, sig} against the public
// key, in order, and resolves to one boolean per item (false for a malformed or high-S signature).
const _keys = new Map()
export async function verifyLinks(pubHex, items, { concurrency = 16 } = {}) {
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

// ------------------------------------------------------------------------------- file and record references (B)
// A file reference (step inputs and outputs): <sha256>:<bytes>:<path>, the path encoded as in 3.2 with "," also written
// as %2C. A list is the references joined by ",", in the order given, without duplicates; an empty list is "-".
// A record reference (review subjects): <ledgerId>:<n>:<h>, naming one record by its link.
const _REF = /^([0-9a-f]{64}):(0|[1-9][0-9]*):([^]*)$/
const _SUBJ = /^([0-9a-f]{32}):([1-9][0-9]*):([0-9a-f]{64})$/

function _bytesText(b) {
  if (typeof b === 'bigint') b = String(b)
  else if (typeof b === 'number' && Number.isSafeInteger(b) && b >= 0) b = String(b)
  return typeof b === 'string' && _DEC.test(b) ? b : null
}

function _refParse(t) {
  if (typeof t !== 'string') return { why: 'it is not text' }
  const m = _REF.exec(t)
  if (!m) return { why: 'it must be written <SHA-256, 64 lowercase hex>:<size in bytes>:<path>' }
  if (m[3].includes(',')) return { why: 'its path holds a "," that is not written as %2C' }
  const path = m[3].replace(/%2C/g, ',')
  const why = validatePath(path)
  return why ? { why: `its path is not valid: ${why}` } : { value: { sha256: m[1], bytes: m[2], path } }
}

function _subjParse(t) {
  const m = typeof t === 'string' ? _SUBJ.exec(t) : null
  if (!m || !Number.isSafeInteger(Number(m[2]))) return { why: 'it must be written <ledger id, 32 lowercase hex>:<record number from 1>:<link h, 64 lowercase hex>' }
  return { value: { ledgerId: m[1], n: Number(m[2]), h: m[3] } }
}

function _listParse(t, one, min, what) {
  if (typeof t !== 'string') return { why: 'it is not text' }
  if (t === '-') return min > 0 ? { why: `it must name at least one ${what}` } : { list: [] }
  if (t === '') return { why: min > 0 ? `it is empty: it must name at least one ${what}` : 'it is empty (an empty list is written "-")' }
  const parts = t.split(',')
  if (parts.length > REF_LIMIT) return { why: `it names ${formatCount(parts.length)} ${what}s; at most ${formatCount(REF_LIMIT)} are allowed` }
  const seen = new Set(), list = []
  for (let i = 0; i < parts.length; i++) {
    if (seen.has(parts[i])) return { why: `${what} ${i + 1} appears twice` }
    seen.add(parts[i])
    const r = one(parts[i])
    if (r.why) return { why: `${what} ${i + 1} is not valid: ${r.why}` }
    list.push(r.value)
  }
  return { list }
}

export function encodeRef(ref) {
  if (!_isObj(ref)) throw new TypeError('A file reference is an object {sha256, bytes, path} (or {sha256, bytes, rawPath}).')
  const path = ref.rawPath !== undefined ? encodePath(ref.rawPath) : ref.path
  const why = validatePath(path)
  if (why) throw new Error(`Not a valid path for a file reference (${why}): ${_clip(String(path), 80)}. Use encodePath() on the relative path, or pass rawPath.`)
  if (!isHex(ref.sha256, 64)) throw new Error(`The file reference for ${path} needs its SHA-256 as 64 lowercase hex characters.`)
  const b = _bytesText(ref.bytes)
  if (b === null) throw new Error(`The file reference for ${path} needs its size in bytes.`)
  return `${ref.sha256}:${b}:${path.replace(/,/g, '%2C')}`
}

export function parseRef(text) {
  const r = _refParse(text)
  if (r.why) throw new Error(`Not a valid file reference (${r.why}): ${_clip(String(text), 80)}.`)
  return r.value
}

// refs: objects for encodeRef, or encoded references; an exact duplicate is left out (the first one stays)
export function encodeRefList(refs) {
  if (!Array.isArray(refs)) throw new TypeError('A list of file references must be an array.')
  const out = [], seen = new Set()
  for (const r of refs) {
    const t = typeof r === 'string' ? (parseRef(r), r) : encodeRef(r)
    if (!seen.has(t)) { seen.add(t); out.push(t) }
  }
  if (out.length > REF_LIMIT) throw new Error(`A list holds at most ${formatCount(REF_LIMIT)} file references, not ${formatCount(out.length)}.`)
  return out.length ? out.join(',') : '-'
}

export function parseRefList(text) {
  const r = _listParse(text, _refParse, 0, 'file reference')
  if (r.why) throw new Error(`Not a valid list of file references (${r.why}).`)
  return r.list
}

export function encodeSubject(s) {
  const t = _isObj(s) ? `${s.ledgerId}:${s.n}:${s.h}` : s
  const r = _subjParse(t)
  if (r.why) throw new Error(`Not a valid record reference (${r.why}): ${_clip(String(t), 120)}.`)
  return t
}

export function parseSubject(text) {
  const r = _subjParse(text)
  if (r.why) throw new Error(`Not a valid record reference (${r.why}): ${_clip(String(text), 120)}.`)
  return r.value
}

export function encodeSubjectList(subjects) {
  if (!Array.isArray(subjects)) throw new TypeError('A list of record references must be an array.')
  const out = [], seen = new Set()
  for (const s of subjects) {
    const t = encodeSubject(s)
    if (!seen.has(t)) { seen.add(t); out.push(t) }
  }
  if (!out.length) throw new Error('A review names at least one record.')
  if (out.length > REF_LIMIT) throw new Error(`A review names at most ${formatCount(REF_LIMIT)} records, not ${formatCount(out.length)}.`)
  return out.join(',')
}

export function parseSubjectList(text) {
  const r = _listParse(text, _subjParse, 1, 'record reference')
  if (r.why) throw new Error(`Not a valid list of record references (${r.why}).`)
  return r.list
}

// ------------------------------------------------------------------------------------------------- field rules (3.4)
const _textOk = (v, min, max) => isSealedText(v) && v.length >= min && _cpLen(v) <= max
const _TIMERULE = 'must be a real UTC time written as YYYY-MM-DDTHH:mm:ss.sssZ'
// name -> [label, ok(v), rule: the rest of the sentence after the label (text, or a function of the value)]
const _FIELD = {
  station: ['the station', (v) => _stationOk(v), 'must be 1 to 64 characters with no "|" and no control character'],
  path: ['the path', (v) => validatePath(v) === null, (v) => `is not valid: ${validatePath(v)}`],
  sha256: ['the file SHA-256', (v) => typeof v === 'string' && _HEX64.test(v), 'must be 64 lowercase hex characters'],
  bytes: ['the size in bytes', (v) => typeof v === 'string' && _DEC.test(v), 'must be a whole number in decimal, written as text, with no leading zero'],
  observedAt: ['the observation time', isTime, _TIMERULE],
  at: ['the session time', isTime, _TIMERULE],
  agent: ['the agent', (v) => isSealedText(v) && v.length > 0, 'must be non-empty text with no "|" and no control character'],
  instrumentId: ['the instrument id', isSealedText, 'must be text with no "|" and no control character'],
  sensorType: ['the measurement type', isSealedText, 'must be text with no "|" and no control character'],
  value: ['the value', isSealedText, 'must be text with no "|" and no control character'],
  unit: ['the unit', isSealedText, 'must be text with no "|" and no control character'],
  capturedAt: ['the capture time', isReadingTime, 'must be a real UTC time written as YYYY-MM-DDTHH:mm:ss.sssZ (the milliseconds may be left out)'],
  actor: ['the actor', (v) => _textOk(v, 1, 64), 'must be 1 to 64 characters with no "|" and no control character'],
  tool: ['the tool', (v) => _textOk(v, 1, 128), 'must be 1 to 128 characters with no "|" and no control character ("-" when it is not known)'],
  action: ['the action', (v) => _textOk(v, 1, 500), 'must be 1 to 500 characters on one line, with no "|" and no control character'],
  inputs: ['the inputs', (v) => !_listParse(v, _refParse, 0, 'file reference').why, (v) => `are not valid: ${_listParse(v, _refParse, 0, 'file reference').why}`],
  outputs: ['the outputs', (v) => !_listParse(v, _refParse, 1, 'file reference').why, (v) => `are not valid: ${_listParse(v, _refParse, 1, 'file reference').why}`],
  reviewer: ['the reviewer', (v) => _textOk(v, 1, 64), 'must be 1 to 64 characters with no "|" and no control character'],
  subjects: ['the subjects', (v) => !_listParse(v, _subjParse, 1, 'record reference').why, (v) => `are not valid: ${_listParse(v, _subjParse, 1, 'record reference').why}`],
  decision: ['the decision', (v) => DECISIONS.includes(v), `must be one of ${DECISIONS.join(', ')}`],
  note: ['the note', (v) => _textOk(v, 1, 500), 'must be 1 to 500 characters with no "|" and no control character, or "-" when there is no note'],
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
    const [label0, ok, rule] = _FIELD[name]
    const label = name === 'at' && kind !== 'session' ? `the ${k.label} time` : label0
    if (typeof v !== 'string') { out.push({ code: 'field', text: `${label} must be a JSON string` }); continue }
    if (ok(v)) continue
    out.push({ code: 'field', text: `${label} ${typeof rule === 'function' ? rule(v) : rule}` })
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

export function canonicalJSON(obj) {
  return JSON.stringify(_ordered(obj))
}

export function serializeLine(obj) {
  return canonicalJSON(obj) + '\n'
}

// --------------------------------------------------------------------------------------------- creating a ledger
export async function createHeader({ station, privateKey, publicKeyHex: pk, publicKey, agent, createdAt, ledgerId } = {}) {
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

export async function createRecord({ n, prev, kind, f, privateKey, ctx } = {}) {
  const b = _recordBody({ n, prev, kind, f, ctx })
  return _finish(b, await signLink(privateKey, b.h))
}

// Several records after head {n, h}: links are computed in order, signatures in parallel.
export async function createRecords({ head, items, privateKey, concurrency = 32 } = {}) {
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
export function parseLedger(input) {
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

export async function verifyLedger(input, { concurrency, onProgress, verifyBatch, batchSize = 1024 } = {}) {
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
    if (_own(o, 'kind') && !kindOk) add('kind', `the kind ${_clip(String(o.kind))} is not one this format defines (${Object.keys(KINDS).join(', ')})`)
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
    mcpSessions: st.mcpSessions,
    gaps: st.gaps,
    kinds: st.kinds,
  }
}

// per-path state, watch sessions and the gaps between them, from records that passed every check
function _state(good) {
  const st = { files: new Map(), sessions: [], mcpSessions: [], kinds: { file: 0, 'file-removed': 0, session: 0, reading: 0, step: 0, review: 0 } }
  for (let i = 0; i < good.length; i++) _stateAdd(st, good[i], i + 2)
  return { files: st.files, sessions: st.sessions, mcpSessions: st.mcpSessions, gaps: _gapsOf(st.sessions), kinds: st.kinds }
}

// One good record (on ledger line `line`) into the state {files, sessions, kinds}. The session that file records count
// toward and the open watch are read from the last session: a scan, or a watch not stopped yet, takes file records; a
// watch not stopped yet is open (a start or a scan ends it, uncleanly); a stop, or a stray stop, ends both. MCP server
// sessions (mcp-started, mcp-stopped) are kept apart in mcpSessions, by the same rule, and count the steps in them.
function _stateAdd(st, o, line) {
  const { files, sessions, kinds } = st
  const mcp = st.mcpSessions || (st.mcpSessions = [])
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
  } else if (o.kind === 'step') {
    const m = mcp.length ? mcp[mcp.length - 1] : null
    if (m && m.open) { m.steps++; m.lastN = o.n; if (f.at > m.lastAt) m.lastAt = f.at }
  } else if (o.kind === 'session' && (f.event === 'mcp-started' || f.event === 'mcp-stopped')) {
    const m = mcp.length ? mcp[mcp.length - 1] : null
    const openM = m && m.open ? m : null
    if (f.event === 'mcp-started') {
      if (openM) { openM.clean = false; openM.open = false; openM.endedByN = o.n }
      mcp.push({ type: 'mcp', startN: o.n, start: f.at, stopN: null, stop: null, clean: null, open: true, endedByN: null, steps: 0, lastN: o.n, lastAt: f.at, station: f.station, agent: f.agent })
    } else if (openM) Object.assign(openM, { stopN: o.n, stop: f.at, clean: true, open: false, lastN: o.n })
    else mcp.push({ type: 'mcp', startN: null, start: null, stopN: o.n, stop: f.at, clean: false, open: false, endedByN: null, steps: 0, lastN: o.n, lastAt: f.at, station: f.station, agent: f.agent, stray: true })
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
export function extendVerified(verified, records) {
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
  if (!verified.mcpSessions) verified.mcpSessions = []
  for (const k of Object.keys(KINDS)) if (!_own(verified.kinds, k)) verified.kinds[k] = 0
  const st = { files: verified.files, sessions: verified.sessions, mcpSessions: verified.mcpSessions, kinds: verified.kinds }
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
export function isFirstScan(verified) {
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
export function planSeal(verified, files, { mode, station, observedAt, ignore } = {}) {
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
export function parseHead(s) {
  if (_isObj(s) && Number.isSafeInteger(s.n) && s.n >= 0 && isHex(s.h, 64)) return { n: s.n, h: s.h }
  const m = typeof s === 'string' && /^\s*(0|[1-9][0-9]*):([0-9a-fA-F]{64})\s*$/.exec(s)
  if (!m || !Number.isSafeInteger(Number(m[1]))) throw new Error('A head is written as <record number>:<64 hex link>, for example 12:9f86d081….')
  return { n: Number(m[1]), h: m[2].toLowerCase() }
}

export function formatHead(head) {
  return `${head.n}:${head.h}`
}

const _STATES = ['match', 'changed', 'missing', 'removed', 'back after removal', 'not sealed', 'not checked']

export function audit(verified, files, opts = {}) {
  return _auditOne(verified, files, opts, null)
}

// Whether record n of a verified ledger still has link h (n = 0: the genesis g), as {ok, message}: the check behind
// expectHead, expectHeads and pins. A ledger that has grown since still matches.
function _headCheck(verified, exp, what = 'pinned head') {
  const H = verified.header
  const rec = exp.n === 0 ? null : verified.records[exp.n - 1]
  const actual = exp.n === 0 ? (H && H.g) : rec && rec.n === exp.n ? rec.h : null
  if (!H) return { ok: false, message: `The ${what} could not be checked, because the ledger has no readable header.` }
  if (exp.n > verified.recordCount) return { ok: false, message: `The ${what} is record ${exp.n}, but the ledger has only ${_plural(verified.recordCount, 'record', 'records')}: records were removed from its end, or the head belongs to another ledger.` }
  if (exp.n > verified.goodCount && !(exp.n === 0 && verified.headerOk)) return { ok: false, message: `The ${what} is record ${exp.n}, which comes after the first problem in the ledger, so it cannot be confirmed.` }
  if (actual !== exp.h) return { ok: false, message: `Record ${exp.n}'s link is ${actual}, not the ${what.replace(/ head$/, '')} ${exp.h}: the ledger was rewritten since the head was pinned, or the head belongs to another ledger.` }
  return { ok: true, message: `Record ${exp.n}'s link matches the ${what}${verified.goodCount > exp.n ? ` (the ledger has grown since, to ${_plural(verified.goodCount, 'record', 'records')})` : ''}.` }
}

// The file changes that put an audit in review: each sealed path with more than one version (changed after its first
// seal), and each recorded removal, unless the path matches allowChanges. Returns {groups, allowed}.
function _changeReview(verified, allow, ledgerId) {
  const changed = [], changedRecs = [], removed = [], removedRecs = [], allowed = []
  for (const e of [...verified.files.values()].sort((x, y) => _cmp(x.path, y.path))) {
    const fv = e.versions.filter((v) => v.kind === 'file')
    const rem = e.versions.filter((v) => v.kind === 'file-removed')
    if (fv.length < 2 && !rem.length) continue
    const later = fv.slice(1)
    const ok = allow(e.path)
    if (fv.length > 1) {
      const text = `${e.path}: ${fv.length} versions (records ${fv.map((v) => v.n).join(', ')}); ${later.map((v) => `${v.event} in record ${v.n}, ${_when(v.observedAt)}`).join('; ')}`
      if (ok) allowed.push(text)
      else { changed.push(text); for (const v of later) changedRecs.push({ ledgerId, n: v.n }) }
    }
    for (const v of rem) {
      const text = `${e.path}: ${v.event} in record ${v.n}, ${_when(v.observedAt)}`
      if (ok) allowed.push(text)
      else { removed.push(text); removedRecs.push({ ledgerId, n: v.n }) }
    }
  }
  const groups = []
  if (changed.length) groups.push({ code: 'sealed-more-than-once', message: `${_plural(changed.length, 'file was', 'files were')} changed after ${changed.length === 1 ? 'it was' : 'they were'} first sealed (each change is recorded).`, count: changed.length, items: changed, records: changedRecs })
  if (removed.length) groups.push({ code: 'removed', message: `${_plural(removed.length, 'file was', 'files were')} removed (each removal is recorded).`, count: removed.length, items: removed, records: removedRecs })
  return { groups, allowed }
}

// covered: paths (step inputs and outputs of this ledger) that are not listed as "not sealed" (auditMany)
function _auditOne(verified, files, { expectHead, expectKeyId, allowChanges, strict = false, auditedAt, where = 'command line', tool, ignore, folder } = {}, covered) {
  const present = _fileMap(files)
  const checked = present !== null
  const ig = ignoreMatcher(ignore)
  const allow = _globMatcher(allowChanges, 'A pattern of files expected to change')
  const H = verified.header
  const ledgerId = H && typeof H.ledgerId === 'string' ? H.ledgerId : null
  const problems = verified.problems.map((p) => ({ code: p.code, line: p.line, n: p.n, message: p.message }))
  const ledgerProblems = problems.length
  const fileProblems = [], notes = []
  const out = []
  const c = { sealed: verified.files.size, match: 0, changed: 0, missing: 0, removed: 0, backAfterRemoval: 0, notSealed: 0, notChecked: 0 }
  let bytesChecked = 0, filesChecked = 0
  const unwatched = [], back = [], unread = []

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
      fileProblems.push({ code: 'changed', path: e.path, n: latest.n, message: `${e.path} changed since it was sealed in record ${latest.n}${matchesN ? `; it matches the earlier version sealed in record ${matchesN}` : ''}.` })
    } else if (state === 'missing') {
      c.missing++
      fileProblems.push({ code: 'missing', path: e.path, n: latest.n, message: `${e.path} is missing: it was sealed in record ${latest.n}, and no removal was recorded.` })
    } else if (state === 'removed') c.removed++
    else if (state === 'back after removal') { c.backAfterRemoval++; back.push(`${e.path}: removed in record ${latest.n}, present again and not sealed since${matchesN ? ` (it matches the version sealed in record ${matchesN})` : ''}`) }
    else if (state === 'not checked') { c.notChecked++; if (checked) unread.push(`${e.path}: present, but it could not be read`) }
    for (const v of e.versions) if (v.event.endsWith('-unwatched')) unwatched.push(`${e.path}: ${v.event} in record ${v.n}, found ${_when(v.observedAt)}`)
  }
  const notSealed = []
  if (checked) {
    for (const [p, v] of present) {
      if (verified.files.has(p) || isLedgerFolderPath(p) || ig(p)) continue
      if (covered && covered.has(p)) { if (v) { bytesChecked += Number(v.bytes); filesChecked++ } continue }
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
    if (exp) ({ ok, message } = _headCheck(verified, exp))
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

  // for review: recorded changes and removals (unless expected to change)
  const { groups: forReview, allowed } = _changeReview(verified, allow, ledgerId)

  // notes
  const note = (code, message, items) => notes.push({ code, message, count: items.length, items })
  if (unwatched.length) note('unwatched', `${_plural(unwatched.length, 'change was', 'changes were')} found by a later scan: ${unwatched.length === 1 ? 'it' : 'they'} happened while nothing was watching, so ${unwatched.length === 1 ? 'its' : 'their'} time is unknown.`, unwatched)
  if (notSealed.length) note('not-sealed', `${_plural(notSealed.length, 'file is', 'files are')} present but never sealed${verified.firstProblemLine ? ` by the records before the first problem (line ${verified.firstProblemLine})` : ''}.`, notSealed)
  if (back.length) note('back-after-removal', `${_plural(back.length, 'file is', 'files are')} present again after ${back.length === 1 ? 'its' : 'their'} removal was recorded, and not sealed since.`, back)
  if (unread.length) note('not-checked', `${_plural(unread.length, 'sealed file', 'sealed files')} could not be read, so ${unread.length === 1 ? 'it was' : 'they were'} not checked.`, unread)
  const mcpS = verified.mcpSessions || []
  const unclean = [...verified.sessions.filter((s) => s.type === 'watch' && s.clean === false), ...mcpS.filter((s) => s.clean === false)]
  if (unclean.length) {
    const what = (s) => (s.type === 'mcp' ? 'MCP server session' : 'watch')
    const noun = unclean.some((s) => s.type === 'mcp') ? ['session', 'sessions'] : ['watch session', 'watch sessions']
    note('unclean-stop', `${_plural(unclean.length, noun[0], noun[1])} did not end cleanly (no stop record before the next start: for example a crash, a forced quit or a power loss).`,
      unclean.map((s) => (s.stray ? `record ${s.stopN} stops ${s.type === 'mcp' ? 'an MCP server session' : 'a watch'} that has no start record` : `the ${what(s)} started in record ${s.startN} (${_when(s.start)}) has no stop record before record ${s.endedByN}`)))
  }
  if (verified.gaps.length) note('gaps', `Nothing was watching during ${_plural(verified.gaps.length, 'period', 'periods')} between sessions; changes made then are sealed with an -unwatched event and an unknown time.`,
    verified.gaps.map((g) => `from ${_when(g.from)} to ${_when(g.to)} (${formatDuration(g.ms)}), between record ${g.afterN} and record ${g.beforeN}`))

  const failing = ledgerProblems + c.changed + c.missing + expectFails
  const verdict = failing || (strict && (forReview.length || notes.length)) ? 'fail' : forReview.length ? 'review' : 'pass'
  const patterns = allowChanges == null ? [] : Array.isArray(allowChanges) ? allowChanges.slice() : [allowChanges]
  const report = {
    format: AUDIT_FORMAT,
    version: 1,
    verdict,
    summary: '',
    strict: !!strict,
    filesChecked: checked,
    counts: { ...c, records: verified.recordCount, goodRecords: verified.goodCount, problems: ledgerProblems + fileProblems.length, ledgerProblems, review: forReview.length, reviewItems: forReview.reduce((a, g) => a + g.count, 0), notes: notes.length, filesRead: filesChecked, bytesRead: bytesChecked },
    problems: [...problems, ...fileProblems],
    forReview,
    notes,
    allowChanges: { patterns, matched: allowed },
    ledger: {
      ledgerId,
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
      role: _roleOf(verified),
      ctx: H && _isObj(H.ctx) ? H.ctx : null,
    },
    sessions: verified.sessions.map((s) => ({ type: s.type, startN: s.startN, start: s.start, stopN: s.stopN, stop: s.stop, clean: s.clean, open: s.open, endedByN: s.endedByN, files: s.files, station: s.station, agent: s.agent })),
    mcpSessions: mcpS.map((s) => ({ type: s.type, startN: s.startN, start: s.start, stopN: s.stopN, stop: s.stop, clean: s.clean, open: s.open, endedByN: s.endedByN, steps: s.steps, station: s.station, agent: s.agent })),
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
    `On the command line: node iqc.mjs audit ${dir}${pin ? ` --expect-head ${pin}` : ''}${verified.keyId ? ` --expect-key ${verified.keyId}` : ''}${patterns.map((g) => ` --allow-changes ${_shellArg(g)}`).join('')}`,
    pin ? `Pin the head ${pin} somewhere else (an email, an ELN entry, a printout). A later audit with --expect-head shows whether the ledger was rewritten from the start or cut short since.` : 'Pin the head once the ledger has records (iqc head), to expose a later rewrite.',
  ]
  return report
}

const _shellArg = (s) => (/^[\w./:@%+-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`)
const _when = (iso) => (typeof iso === 'string' && iso.length >= 19 ? `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC` : String(iso))

function _joinList(parts) {
  return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

// the phrase of one group for review, in a verdict sentence
const _REVIEW_PHRASE = {
  'sealed-more-than-once': (k) => `${_plural(k, 'file was', 'files were')} changed after ${k === 1 ? 'it was' : 'they were'} first sealed`,
  removed: (k) => `${_plural(k, 'file was', 'files were')} removed`,
  'untraced-input': (k) => `${_plural(k, 'agent step', 'agent steps')} used inputs nothing measured`,
  'input-changed-after-use': (k) => `${_plural(k, 'agent step', 'agent steps')} used a file that was sealed again later`,
  'step-cycle': (k) => `${_plural(k, 'agent step is', 'agent steps are')} part of a cycle of steps`,
  'review-rejected': (k) => `${_plural(k, 'agent step was', 'agent steps were')} rejected by a reviewer`,
  'review-question': (k) => `${_plural(k, 'agent step was', 'agent steps were')} questioned by a reviewer`,
}
function _reviewSentence(groups) {
  const parts = groups.map((g) => (_REVIEW_PHRASE[g.code] ? _REVIEW_PHRASE[g.code](g.count) : g.message.replace(/\.$/, '')))
  const filesOnly = groups.every((g) => g.code === 'sealed-more-than-once' || g.code === 'removed')
  return `Review: ${_joinList(parts)}. ${filesOnly ? 'Each change is recorded.' : 'Each is recorded below.'}`
}

function _strictPart(c) {
  const rv = c.review || 0, nt = c.notes || 0
  const what = rv && nt ? `${_plural(rv, 'item for review', 'items for review')} and ${_plural(nt, 'note', 'notes')} count`
    : rv ? _plural(rv, 'item for review counts', 'items for review count') : _plural(nt, 'note counts', 'notes count')
  return `${what} as ${rv + nt === 1 ? 'a failure' : 'failures'} in strict mode`
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
  if (r.verdict === 'review') return _reviewSentence(r.forReview)
  const parts = []
  if (c.changed) parts.push(`${_plural(c.changed, 'file', 'files')} changed since ${c.changed === 1 ? 'it was' : 'they were'} sealed`)
  if (c.missing) parts.push(`${_plural(c.missing, 'file is', 'files are')} missing`)
  if (c.ledgerProblems) parts.push(`the ledger has ${_plural(c.ledgerProblems, 'problem', 'problems')}`)
  if (exp.head && !exp.head.ok) parts.push('the pinned head does not match')
  if (exp.keyId && !exp.keyId.ok) parts.push('the key id is not the expected one')
  if (r.strict && (c.notes || c.review)) parts.push(_strictPart(c))
  return `Fail: ${_joinList(parts)}.`
}

// ------------------------------------------------------------------------------------------ steps and reviews (B)
// The records an agent or a reviewer appends, checked as verifyLedger would check them. inputs and outputs:
// [{path, sha256, bytes}] with path encoded as in 3.2 (or rawPath, encoded here); an exact duplicate is left out.
export function planStep({ station, actor, tool, action, inputs = [], outputs = [], at } = {}) {
  const f = {
    station, actor, tool: tool === undefined || tool === null || tool === '' ? '-' : tool, action,
    inputs: encodeRefList(inputs || []), outputs: encodeRefList(outputs || []), at: at || new Date().toISOString(),
  }
  _checkFields('step', f)
  return { kind: 'step', f }
}

// subjects: [{ledgerId, n, h}] or encoded record references; note: text, or empty / missing for none ("-")
export function planReview({ station, reviewer, subjects = [], decision, note, at } = {}) {
  const f = {
    station, reviewer, subjects: encodeSubjectList(subjects || []), decision,
    note: note === undefined || note === null || note === '' ? '-' : note, at: at || new Date().toISOString(),
  }
  _checkFields('review', f)
  return { kind: 'review', f }
}

// ---------------------------------------------------------------------------------------- ledger discovery (C)
const _DISCOVER_DEPTH = 6

// The ledgers in a dropped or walked folder, from its relative file paths (raw, "/" between segments): every
// ImmutableQC/ledger.jsonl with at most 6 folders above its ImmutableQC folder (root: the folder holding ImmutableQC,
// '' for the top), and every file named *.ledger.jsonl with at most 6 folders above it (root: null, no file root).
// Each ledger with a root also gets `nested`: the roots of the other ledgers inside it, relative to its root (so a
// caller can leave their files out of this ledger's file map). Sorted by ledgerPath.
export function discoverLedgers(paths) {
  if (!Array.isArray(paths) && !(paths && typeof paths[Symbol.iterator] === 'function')) throw new TypeError('discoverLedgers needs a list of relative file paths.')
  const seen = new Set(), out = []
  for (let p of paths) {
    if (typeof p !== 'string') continue
    p = p.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
    if (seen.has(p)) continue
    seen.add(p)
    const segs = p.split('/')
    if (segs.some((s) => s === '' || s === '.' || s === '..')) continue
    const name = segs[segs.length - 1]
    if (name === LEDGER_FILE && segs.length >= 2 && segs[segs.length - 2] === LEDGER_DIR) {
      if (segs.length - 2 <= _DISCOVER_DEPTH) out.push({ ledgerPath: p, root: segs.slice(0, -2).join('/') })
    } else if (name.length > '.ledger.jsonl'.length && name.endsWith('.ledger.jsonl')) {
      if (segs.length - 1 <= _DISCOVER_DEPTH) out.push({ ledgerPath: p, root: null })
    }
  }
  out.sort((a, b) => _cmp(a.ledgerPath, b.ledgerPath))
  const roots = out.filter((x) => x.root !== null).map((x) => x.root)
  for (const x of out) {
    if (x.root === null) continue
    const pre = x.root === '' ? '' : x.root + '/'
    x.nested = roots.filter((r) => r !== x.root && r.startsWith(pre) && (pre !== '' || r !== '')).map((r) => r.slice(pre.length))
  }
  return out
}

// ------------------------------------------------------------------------------------------------- pins (C.5)
// A pin file's lines: `immutableqc-head <ledgerId> <n>:<h> <time>`. Blank lines and lines starting with "#" are left
// out; any other line that does not read is returned as {line, text, error}.
export function parsePinLines(input) {
  const lines = Array.isArray(input) ? input : String(input == null ? '' : input).split('\n')
  const out = []
  lines.forEach((raw, i) => {
    if (_isObj(raw)) { out.push({ line: i + 1, ...raw }); return }
    const t = String(raw).replace(/\r$/, '').trim()
    if (t === '' || t.startsWith('#')) return
    const m = /^immutableqc-head\s+([0-9a-f]{32})\s+(0|[1-9][0-9]*):([0-9a-f]{64})\s+(\S+)$/.exec(t)
    if (!m || !Number.isSafeInteger(Number(m[2])) || !isTime(m[4])) out.push({ line: i + 1, text: _clipText(t, 200), error: 'a pin line is written: immutableqc-head <ledger id, 32 hex> <record number>:<link, 64 hex> <time, YYYY-MM-DDTHH:mm:ss.sssZ>' })
    else out.push({ line: i + 1, ledgerId: m[1], n: Number(m[2]), h: m[3], at: m[4] })
  })
  return out
}

export function formatPinLine(ledgerId, head, at) {
  if (!_HEX32.test(String(ledgerId)) || !head || !Number.isSafeInteger(head.n) || !isHex(head.h, 64) || !isTime(at)) throw new Error('A pin line needs the ledger id (32 hex), the head {n, h} and a time.')
  return `immutableqc-head ${ledgerId} ${head.n}:${head.h} ${at}`
}

const _clipText = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s)

// ---------------------------------------------------------------------------------------- multi-ledger audit (C)
const _ROLE_OF = { file: 'measured', 'file-removed': 'measured', reading: 'measured', step: 'agent', review: 'reviewer' }

// measured (file, file-removed, reading records), agent (step), reviewer (review), mixed (more than one), or by its
// sessions when it holds none of those (watch or scan: measured; MCP server: agent); empty when it holds nothing.
function _roleOf(v) {
  const roles = new Set()
  for (const [k, n] of Object.entries(v.kinds || {})) if (n && _ROLE_OF[k]) roles.add(_ROLE_OF[k])
  if (!roles.size) {
    if ((v.mcpSessions || []).length) roles.add('agent')
    else if ((v.sessions || []).length) roles.add('measured')
  }
  return roles.size === 0 ? 'empty' : roles.size === 1 ? [...roles][0] : 'mixed'
}

const _LINEAGE_CAP = 200, _TREE_NODES = 200, _TREE_BUDGET = 50000

// Several verified ledgers, each with its root (the folder holding its ImmutableQC folder; null for a ledger with no
// file root) and the files present under that root, audited together: each ledger as audit() does, then the lineage of
// every agent step (measured, derived or untraced inputs; outputs against the files), the reviews, the expectations
// and the pins, and one verdict. See the API notes at the top for the report.
export function auditMany(entries, opts = {}) {
  const { expectHeads, expectKeyIds, allowChanges, pinLines, strict = false, where = 'command line', tool, ignore, folder } = opts
  const auditedAt = opts.auditedAt || new Date().toISOString()
  const maxDepth = Math.max(1, Math.min(256, Math.floor(Number(opts.maxDepth)) || 32))
  if (!Array.isArray(entries) || !entries.length) throw new Error('auditMany needs a list of at least one ledger: [{verified, root, files}].')
  _globMatcher(allowChanges, 'A pattern of files expected to change')
  const many = entries.length > 1
  const Ls = entries.map((en, li) => {
    if (!_isObj(en) || !_isObj(en.verified) || !Array.isArray(en.verified.records) || !(en.verified.files instanceof Map)) throw new TypeError(`auditMany: entry ${li + 1} needs {verified}, from verifyLedger.`)
    const v = en.verified, H = _isObj(v.header) ? v.header : null
    const ledgerId = H && typeof H.ledgerId === 'string' && _HEX32.test(H.ledgerId) ? H.ledgerId : null
    const station = H && typeof H.station === 'string' ? H.station : null
    const root = typeof en.root === 'string' ? en.root : null
    const label = typeof en.label === 'string' && en.label ? en.label : root ? root : station || (ledgerId ? `ledger ${ledgerId.slice(0, 8)}` : `ledger ${li + 1}`)
    return { li, v, H, ledgerId, station, root, label, files: _fileMap(en.files == null ? null : en.files), ledgerPath: typeof en.ledgerPath === 'string' ? en.ledgerPath : null, good: v.records.slice(0, v.goodCount), steps: [] }
  })
  const pre = (L) => (many ? `${L.label}: ` : '')
  const recRef = (L, n) => ({ ledgerId: L.ledgerId, ledger: L.li, n })
  const byId = new Map(), dupes = []
  for (const L of Ls) {
    if (!L.ledgerId) continue
    if (byId.has(L.ledgerId)) dupes.push(`${L.label} has the same ledger id as ${byId.get(L.ledgerId).label} (${L.ledgerId}): the first one is used to trace steps and resolve reviews`)
    else byId.set(L.ledgerId, L)
  }

  // steps (from the records before each ledger's first problem)
  const S = [], stepAt = new Map()
  for (const L of Ls) {
    for (const o of L.good) {
      if (!o || o.kind !== 'step') continue
      const ins = _listParse(o.f.inputs, _refParse, 0, 'file reference'), outs = _listParse(o.f.outputs, _refParse, 1, 'file reference')
      if (ins.why || outs.why) continue
      const s = { i: S.length, L, n: o.n, h: o.h, f: o.f, inputs: ins.list, outputs: outs.list, ins: [], inP: [], outs: [], edges: [], revs: [] }
      S.push(s)
      L.steps.push(s)
      stepAt.set(`${L.li}:${o.n}`, s)
    }
  }

  // each ledger on its own, files against its own root (paths a step names are not "not sealed")
  for (const L of Ls) {
    const covered = new Set()
    for (const s of L.steps) { for (const r of s.outputs) covered.add(r.path); for (const r of s.inputs) covered.add(r.path) }
    L.report = _auditOne(L.v, L.files, { allowChanges, strict: false, auditedAt, where, tool, ignore }, covered)
  }

  // lineage index: every sealed file version by SHA-256 (measured), every step output by SHA-256 (derived)
  const measured = new Map()
  for (const L of Ls) {
    for (const e of L.v.files.values()) {
      const fv = e.versions.filter((x) => x.kind === 'file')
      let later = null
      for (let k = fv.length - 1; k >= 0; k--) {
        const x = fv[k], nx = fv[k + 1]
        if (nx && nx.sha256 !== x.sha256) later = nx
        const m = { L, path: e.path, n: x.n, sha256: x.sha256, bytes: x.bytes, observedAt: x.observedAt, event: x.event, later: later ? { n: later.n, observedAt: later.observedAt, event: later.event } : null }
        const a = measured.get(x.sha256)
        if (a) a.push(m)
        else measured.set(x.sha256, [m])
      }
    }
  }
  for (const a of measured.values()) if (a.length > 1) a.sort((x, y) => x.L.li - y.L.li || x.n - y.n)
  const producers = new Map()
  for (const s of S) {
    for (const r of s.outputs) {
      const a = producers.get(r.sha256)
      if (!a) producers.set(r.sha256, [s])
      else if (a[a.length - 1] !== s) a.push(s)
    }
  }
  const stepRef = (s) => ({ ledgerId: s.L.ledgerId, ledger: s.L.li, n: s.n })
  const mOut = (m) => ({ ledgerId: m.L.ledgerId, ledger: m.L.li, station: m.L.station, path: m.path, n: m.n, observedAt: m.observedAt, event: m.event, ...(m.later ? { sealedAgainN: m.later.n } : {}) })

  // each step's inputs: measured, derived (from which step) or untraced
  for (const s of S) {
    const at = s.f.at
    const edges = new Set()
    for (const r of s.inputs) {
      const inp = { path: r.path, sha256: r.sha256, bytes: r.bytes, state: 'untraced' }
      let p = null
      const ms = measured.get(r.sha256)
      if (ms) {
        inp.state = 'measured'
        inp.measured = ms.slice(0, 10).map(mOut)
        if (ms.length > 10) inp.measuredMore = ms.length - 10
        if (ms.every((m) => m.later)) {
          const m = ms[ms.length - 1]
          inp.changedAfter = { ledgerId: m.L.ledgerId, ledger: m.L.li, station: m.L.station, path: m.path, usedN: m.n, n: m.later.n, observedAt: m.later.observedAt, event: m.later.event, afterUse: m.later.observedAt > at }
        }
      } else {
        const ps = producers.get(r.sha256)
        if (ps) {
          for (const c of ps) if (c !== s && c.f.at <= at) p = c
          if (!p) for (const c of ps) if (c !== s) { p = c; break }
        }
        if (p) { inp.state = 'derived'; inp.step = stepRef(p); edges.add(p.i) }
      }
      s.ins.push(inp)
      s.inP.push(p)
    }
    s.edges = [...edges]
  }

  // each step's outputs against the files under its ledger's root (the latest step that wrote a path is the one compared)
  const writers = new Map()
  for (const s of S) {
    for (const r of s.outputs) {
      const key = `${s.L.li}\n${r.path}`
      const a = writers.get(key)
      if (a) a.push({ s, sha256: r.sha256 })
      else writers.set(key, [{ s, sha256: r.sha256 }])
    }
  }
  for (const s of S) {
    for (const r of s.outputs) {
      const ws = writers.get(`${s.L.li}\n${r.path}`), last = ws[ws.length - 1]
      const o = { path: r.path, sha256: r.sha256, bytes: r.bytes, state: 'match' }
      if (last.s !== s || last.sha256 !== r.sha256) { o.state = 'superseded'; o.supersededBy = stepRef(last.s) }
      else if (!s.L.files) o.state = 'not checked'
      else {
        const cur = s.L.files.has(r.path) ? s.L.files.get(r.path) : undefined
        if (cur === undefined) o.state = 'missing'
        else if (cur === null) o.state = 'not checked'
        else if (cur.sha256 !== r.sha256) {
          o.state = 'changed'
          o.present = { sha256: cur.sha256, bytes: cur.bytes }
          for (let k = ws.length - 2; k >= 0; k--) if (ws[k].sha256 === cur.sha256) { o.matchesStep = stepRef(ws[k].s); break }
        }
      }
      s.outs.push(o)
    }
  }

  // reviews: each subject resolved by ledger id, record number and link
  const reviews = []
  for (const L of Ls) {
    for (const o of L.good) {
      if (!o || o.kind !== 'review') continue
      const subs = _listParse(o.f.subjects, _subjParse, 1, 'record reference')
      if (subs.why) continue
      const rv = { ledgerId: L.ledgerId, ledger: L.li, n: o.n, h: o.h, station: o.f.station, reviewer: o.f.reviewer, decision: o.f.decision, note: o.f.note === '-' ? '' : o.f.note, at: o.f.at, subjects: [] }
      for (const sj of subs.list) {
        const T = byId.get(sj.ledgerId)
        const x = { ledgerId: sj.ledgerId, n: sj.n, h: sj.h, state: 'matches' }
        if (!T) x.state = 'unknown ledger'
        else {
          x.ledger = T.li
          const rec = sj.n <= T.v.goodCount ? T.v.records[sj.n - 1] : null
          if (!rec || rec.n !== sj.n || rec.h !== sj.h) {
            x.state = 'changed'
            x.why = rec ? 'its link is not the one reviewed' : sj.n > T.v.recordCount ? 'the ledger has no such record' : 'the record comes after the first problem in its ledger'
          } else {
            x.kind = rec.kind
            if (rec.kind === 'file' || rec.kind === 'file-removed') x.path = rec.f.path
            const st = rec.kind === 'step' ? stepAt.get(`${T.li}:${sj.n}`) : null
            if (st) st.revs.push(rv)
          }
        }
        rv.subjects.push(x)
      }
      reviews.push(rv)
    }
  }
  for (const s of S) {
    const latest = new Map()
    for (const d of s.revs) { const p = latest.get(d.reviewer); if (!p || d.at >= p.at) latest.set(d.reviewer, d) }
    const ds = new Set([...latest.values()].map((d) => d.decision))
    s.reviewState = ds.has('rejected') ? 'rejected' : ds.has('question') ? 'question' : ds.has('approved') ? 'approved' : 'awaiting review'
    s.decisions = s.revs.map((d) => ({ reviewer: d.reviewer, decision: d.decision, note: d.note, at: d.at, ledgerId: d.ledgerId, ledger: d.ledger, n: d.n, latest: latest.get(d.reviewer) === d }))
  }

  // lineage summaries: strongly connected components of the step graph (iterative Tarjan), successors first, so each
  // step's summary is built from those of the steps it read from once (linear in steps and edges)
  const summ = _lineageSummaries(S)
  const sentenceOf = (x) => {
    if (x.cycle) return 'part of a cycle of steps: it does not trace back to measurements'
    if (x.untraced) return `traces to ${_plural(x.measured, 'measured file', 'measured files')}${x.over ? ' or more' : ''}, and ${_plural(x.untraced, 'input', 'inputs')} nothing measured`
    if (x.empty && !x.measured) return 'the step that wrote it recorded no inputs'
    if (x.empty) return `traces to ${_plural(x.measured, 'measured file', 'measured files')}${x.over ? ' or more' : ''}; a step on the way recorded no inputs`
    return `traces to ${_plural(x.measured, 'measured file', 'measured files')}${x.over ? ' or more' : ''}`
  }
  const lin = (s) => {
    const x = summ[s.i]
    const o = { measured: x.m.size, untraced: x.u.size, over: x.over, cycle: x.cycle, empty: x.empty }
    o.tracesToMeasured = !o.cycle && !o.untraced && !o.empty && o.measured > 0
    o.sentence = sentenceOf(o)
    return o
  }

  // trees: per output, depth-bounded and cycle-safe, at most _TREE_NODES nodes each and _TREE_BUDGET in all
  let budget = _TREE_BUDGET
  const treeOf = (s, out) => {
    let nodes = 0
    const seen = new Set(), onPath = new Set()
    const expand = (st, depth) => {
      onPath.add(st)
      seen.add(st)
      const inputs = []
      for (let k = 0; k < st.ins.length; k++) {
        if (nodes >= _TREE_NODES || budget <= 0) { inputs.push({ stop: 'size', more: st.ins.length - k }); break }
        nodes++
        budget--
        const inp = st.ins[k]
        const node = { path: inp.path, sha256: inp.sha256, bytes: inp.bytes, state: inp.state }
        if (inp.state === 'measured') node.measured = inp.measured[0]
        else if (inp.state === 'derived') {
          const p = st.inP[k]
          node.step = stepRef(p)
          if (onPath.has(p)) node.stop = 'cycle'
          else if (seen.has(p)) node.stop = 'shown above'
          else if (depth + 1 >= maxDepth) node.stop = 'depth'
          else node.inputs = expand(p, depth + 1)
        }
        inputs.push(node)
      }
      onPath.delete(st)
      return inputs
    }
    return { path: out.path, sha256: out.sha256, bytes: out.bytes, state: 'derived', step: stepRef(s), inputs: expand(s, 0) }
  }

  // the report's steps and lineage
  const steps = [], lineage = { maxDepth, outputs: [] }
  for (const s of S) {
    const l = lin(s)
    steps.push({
      ledgerId: s.L.ledgerId, ledger: s.L.li, label: s.L.label, n: s.n, h: s.h,
      station: s.f.station, actor: s.f.actor, tool: s.f.tool, action: s.f.action, at: s.f.at,
      inputs: s.ins, outputs: s.outs, review: { state: s.reviewState, decisions: s.decisions }, lineage: l,
    })
    for (const o of s.outs) {
      const tree = budget > 0 ? treeOf(s, o) : null
      lineage.outputs.push({ ledgerId: s.L.ledgerId, ledger: s.L.li, n: s.n, path: o.path, sha256: o.sha256, state: o.state, ...l, tree, ...(tree ? {} : { treeOmitted: true }) })
    }
  }

  // ------------------------------------------------------------------------ problems, for review, notes, verdict
  const problems = [], forReview = [], notes = []
  const groups = new Map()
  const add = (list, code, message, item, records) => {
    let g = groups.get(list === forReview ? 'r:' + code : 'n:' + code)
    if (!g) { g = { code, message, count: 0, items: [], records: [] }; groups.set(list === forReview ? 'r:' + code : 'n:' + code, g); list.push(g) }
    g.count++
    g.items.push(item)
    for (const r of records || []) g.records.push(r)
  }
  const ledgerRows = []
  for (const L of Ls) {
    const R = L.report
    const { method: _m, rerun: _r, ...rest } = R
    for (const p of R.problems) problems.push({ ...p, ledgerId: L.ledgerId, ledger: L.li, message: pre(L) + p.message, records: p.n ? [recRef(L, p.n)] : [] })
    for (const g of R.forReview) for (let k = 0; k < g.items.length; k++) add(forReview, g.code, null, pre(L) + g.items[k], [])
    for (const g of R.forReview) { const G = groups.get('r:' + g.code); for (const r of g.records) G.records.push({ ...r, ledger: L.li }) }
    for (const n of R.notes) for (const x of n.items) add(notes, n.code, null, pre(L) + x)
    ledgerRows.push({
      ledger: L.li, label: L.label, root: L.root, ledgerPath: L.ledgerPath, ledgerId: L.ledgerId, station: L.station, keyId: L.v.keyId,
      role: R.ledger.role, records: L.v.recordCount, goodRecords: L.v.goodCount, head: L.v.head, intact: R.ledger.intact,
      createdAt: R.ledger.createdAt, kinds: L.v.kinds, steps: L.steps.length, filesChecked: R.filesChecked, verdict: R.verdict, summary: R.summary,
      report: rest,
    })
  }
  // the group messages, now that the counts across ledgers are known
  const fileGroupMessage = {
    'sealed-more-than-once': (k) => `${_plural(k, 'file was', 'files were')} changed after ${k === 1 ? 'it was' : 'they were'} first sealed (each change is recorded).`,
    removed: (k) => `${_plural(k, 'file was', 'files were')} removed (each removal is recorded).`,
  }
  for (const g of forReview) g.message = fileGroupMessage[g.code](g.count)
  const noteMessages = new Map()
  for (const L of Ls) for (const n of L.report.notes) if (!noteMessages.has(n.code)) noteMessages.set(n.code, n)
  for (const g of notes) {
    const one = noteMessages.get(g.code)
    g.message = many ? _manyNoteMessage(g.code, g.count, one.message) : one.message
  }

  const stepName = (s) => `${pre(s.L)}record ${s.n} (${s.f.actor}: ${_clip(s.f.action, 60)})`
  let outChanged = 0, outMissing = 0, outNotChecked = 0
  for (const s of S) {
    for (const o of s.outs) {
      if (o.state === 'changed') {
        outChanged++
        problems.push({ code: 'output-changed', ledgerId: s.L.ledgerId, ledger: s.L.li, n: s.n, path: o.path, message: `${pre(s.L)}${o.path} changed since the agent step in record ${s.n} wrote it${o.matchesStep ? `; it matches the version written in record ${o.matchesStep.n}` : ''}.`, records: [recRef(s.L, s.n)] })
      } else if (o.state === 'missing') {
        outMissing++
        problems.push({ code: 'output-missing', ledgerId: s.L.ledgerId, ledger: s.L.li, n: s.n, path: o.path, message: `${pre(s.L)}${o.path} is missing: the agent step in record ${s.n} wrote it, and no removal is recorded.`, records: [recRef(s.L, s.n)] })
      } else if (o.state === 'not checked') outNotChecked++
    }
    const untraced = s.ins.filter((x) => x.state === 'untraced')
    if (untraced.length) add(forReview, 'untraced-input', null, `${stepName(s)}: ${untraced.slice(0, 5).map((x) => `${x.path} (${x.sha256.slice(0, 12)}…)`).join(', ')}${untraced.length > 5 ? ` and ${untraced.length - 5} more` : ''} ${untraced.length === 1 ? 'matches' : 'match'} no sealed measurement and no recorded step output`, [recRef(s.L, s.n)])
    const resealed = s.ins.filter((x) => x.changedAfter)
    if (resealed.length) {
      add(forReview, 'input-changed-after-use', null, `${stepName(s)}: ${resealed.slice(0, 5).map((x) => { const c = x.changedAfter; return c.afterUse ? `${x.path}: the file changed after this step used it (${c.path} sealed again in record ${c.n} of ${Ls[c.ledger].label}, ${_when(c.observedAt)})` : `${x.path}: the step used an earlier version (${c.path} had been sealed again in record ${c.n} of ${Ls[c.ledger].label}, ${_when(c.observedAt)}, before the step)` }).join('; ')}`,
        [recRef(s.L, s.n), ...resealed.map((x) => ({ ledgerId: x.changedAfter.ledgerId, ledger: x.changedAfter.ledger, n: x.changedAfter.n }))])
    }
  }
  // a step in a cycle of steps (its inputs are, through other steps, its own outputs) traces to no measurement for
  // that input, though no input is untraced: it goes to review too
  for (const s of S) if (summ[s.i].ownCycle) add(forReview, 'step-cycle', null, `${stepName(s)}: its inputs come, through other recorded steps, from its own outputs`, [recRef(s.L, s.n)])
  for (const s of S) {
    if (s.reviewState === 'rejected' || s.reviewState === 'question') {
      const ds = s.decisions.filter((d) => d.latest && d.decision === s.reviewState)
      add(forReview, s.reviewState === 'rejected' ? 'review-rejected' : 'review-question', null, `${stepName(s)}: ${ds.map((d) => `${d.decision} by ${d.reviewer}, ${_when(d.at)}${d.note ? ` ("${_clipText(d.note, 120)}")` : ''}`).join('; ')}`,
        [recRef(s.L, s.n), ...ds.map((d) => ({ ledgerId: d.ledgerId, ledger: d.ledger, n: d.n }))])
    }
  }
  const awaiting = S.filter((s) => s.reviewState === 'awaiting review')
  for (const s of awaiting) add(notes, 'awaiting-review', null, stepName(s))
  let reviewMismatch = 0
  for (const rv of reviews) {
    const RL = Ls[rv.ledger]
    for (const x of rv.subjects) {
      if (x.state === 'changed') {
        reviewMismatch++
        problems.push({ code: 'review-subject-changed', ledgerId: rv.ledgerId, ledger: rv.ledger, n: rv.n, message: `${pre(RL)}the review in record ${rv.n} (${rv.decision} by ${rv.reviewer}) names record ${x.n} of ${Ls[x.ledger].label}, which no longer matches: ${x.why}, so the record changed after it was reviewed.`, records: [recRef(RL, rv.n), { ledgerId: x.ledgerId, ledger: x.ledger, n: x.n }] })
      } else if (x.state === 'unknown ledger') add(notes, 'review-unknown-ledger', null, `${pre(RL)}record ${rv.n} (${rv.decision} by ${rv.reviewer}) names record ${x.n} of ledger ${x.ledgerId}, which was not audited`)
    }
  }

  // expectations: heads, key ids, pins
  const expectations = { heads: [], keyIds: [], pins: [] }
  const listOf = (x) => (x == null || x === '' ? [] : Array.isArray(x) ? x : typeof x === 'string' ? x.split(/[\n,]/).map((t) => t.trim()).filter(Boolean) : _isObj(x) && !_own(x, 'n') ? Object.entries(x).map(([id, hd]) => ({ ledgerId: id, ...parseHead(hd) })) : [x])
  for (const raw of listOf(expectHeads)) {
    let exp = null, ok = false, message, target = null
    try {
      if (_isObj(raw)) exp = { ledgerId: raw.ledgerId || null, ...parseHead({ n: raw.n, h: raw.h }) }
      else {
        const m = /^\s*(?:([0-9a-f]{32})[\s:]+)?(.+)$/.exec(String(raw))
        exp = { ledgerId: m && m[1] ? m[1] : null, ...parseHead(m ? m[2] : String(raw)) }
      }
    } catch (e) { message = `The pinned head ${_clip(String(raw), 90)} could not be read: ${e.message}` }
    if (exp) {
      if (exp.ledgerId) {
        target = byId.get(exp.ledgerId)
        if (!target) message = `The pinned head names ledger ${exp.ledgerId}, which was not audited.`
        else ({ ok, message } = _headCheck(target.v, exp))
        if (target && many) message = `${target.label}: ${message}`
      } else if (Ls.length === 1) { target = Ls[0]; ({ ok, message } = _headCheck(target.v, exp)) }
      else {
        target = Ls.find((L) => _headCheck(L.v, exp).ok) || null
        ok = !!target
        message = ok ? `${target.label}: ${_headCheck(target.v, exp).message}` : `No audited ledger has record ${exp.n} with the link ${exp.h}: a ledger was rewritten since the head was pinned, or the head belongs to a ledger not audited.`
      }
    }
    expectations.heads.push({ expected: exp ? `${exp.ledgerId ? exp.ledgerId + ' ' : ''}${formatHead(exp)}` : String(raw), ledgerId: target ? target.ledgerId : exp ? exp.ledgerId : null, ok, message })
    if (!ok) problems.push({ code: 'expect-head', ledgerId: target ? target.ledgerId : null, message, records: exp && target ? [recRef(target, exp.n)] : [] })
  }
  const keyList = listOf(expectKeyIds).map((k) => String(k).trim().toLowerCase())
  for (const want of keyList) {
    const hit = Ls.filter((L) => L.v.keyId === want)
    const ok = hit.length > 0
    const message = ok ? `${hit.map((L) => L.label).join(', ')} ${hit.length === 1 ? 'is' : 'are'} signed with the expected key ${want}.` : `No audited ledger is signed with the expected key ${want}: a ledger was signed with another key, or its ledger was not included.`
    expectations.keyIds.push({ expected: want, ok, message })
    if (!ok) problems.push({ code: 'expect-key', message, records: [] })
  }
  if (keyList.length) for (const L of Ls) if (!keyList.includes(L.v.keyId)) add(notes, 'unexpected-key', null, `${L.label}: key id ${L.v.keyId || 'unknown'}`)
  let pinFails = 0
  for (const pn of parsePinLines(pinLines == null ? [] : pinLines)) {
    if (pn.error) {
      pinFails++
      const message = `Pin line ${pn.line} could not be read (${pn.error}): ${_clip(pn.text || '', 80)}.`
      expectations.pins.push({ line: pn.line, ok: false, message })
      problems.push({ code: 'pin-unreadable', message, records: [] })
      continue
    }
    const T = byId.get(pn.ledgerId)
    if (!T) {
      expectations.pins.push({ line: pn.line, ledgerId: pn.ledgerId, n: pn.n, h: pn.h, at: pn.at, ok: null, message: `The pin names ledger ${pn.ledgerId}, which was not audited.` })
      add(notes, 'pin-other-ledger', null, `pin line ${pn.line}: ledger ${pn.ledgerId}, record ${pn.n}, pinned ${_when(pn.at)}`)
      continue
    }
    const r = _headCheck(T.v, { n: pn.n, h: pn.h })
    const message = `${many ? `${T.label}: ` : ''}pin line ${pn.line} (${_when(pn.at)}): ${r.message}`
    expectations.pins.push({ line: pn.line, ledgerId: pn.ledgerId, ledger: T.li, n: pn.n, h: pn.h, at: pn.at, ok: r.ok, message })
    if (!r.ok) { pinFails++; problems.push({ code: 'pin', ledgerId: pn.ledgerId, ledger: T.li, message, records: [recRef(T, pn.n)] }) }
  }
  if (dupes.length) for (const d of dupes) add(notes, 'duplicate-ledger', null, d)
  if (outNotChecked) add(notes, 'outputs-not-checked', null, `${_plural(outNotChecked, 'agent output', 'agent outputs')}`)

  const NOTE_TEXT = {
    'awaiting-review': (k) => `${_plural(k, 'agent step is', 'agent steps are')} awaiting review (no reviewer has signed off on ${k === 1 ? 'it' : 'them'}).`,
    'review-unknown-ledger': (k) => `${_plural(k, 'review names a record', 'reviews name records')} in a ledger that was not audited.`,
    'unexpected-key': (k) => `${_plural(k, 'ledger is', 'ledgers are')} signed with a key that is not among the expected ones.`,
    'pin-other-ledger': (k) => `${_plural(k, 'pin names', 'pins name')} a ledger that was not audited (another ledger was pinned from this station, or its ledger was not included).`,
    'duplicate-ledger': (k) => `${_plural(k, 'ledger was', 'ledgers were')} given more than once (the same ledger id).`,
    'outputs-not-checked': () => `${_plural(outNotChecked, 'agent output was', 'agent outputs were')} not checked: their files were not given, or could not be read.`,
  }
  const REVIEW_TEXT = {
    'untraced-input': (k) => `${_plural(k, 'agent step', 'agent steps')} used inputs nothing measured: they match no sealed measurement and no recorded step output in the ledgers audited.`,
    'input-changed-after-use': (k) => `${_plural(k, 'agent step', 'agent steps')} used a file that was sealed again later (the file changed after the step used it, or the step used an earlier version).`,
    'step-cycle': (k) => `${_plural(k, 'agent step is', 'agent steps are')} part of a cycle of steps: ${k === 1 ? 'its' : 'their'} inputs are, through other recorded steps, ${k === 1 ? 'its' : 'their'} own outputs, so they do not trace back to measurements.`,
    'review-rejected': (k) => `${_plural(k, 'agent step was', 'agent steps were')} rejected by a reviewer.`,
    'review-question': (k) => `${_plural(k, 'agent step was', 'agent steps were')} questioned by a reviewer.`,
  }
  for (const g of notes) if (NOTE_TEXT[g.code]) g.message = NOTE_TEXT[g.code](g.count)
  for (const g of forReview) if (REVIEW_TEXT[g.code]) g.message = REVIEW_TEXT[g.code](g.count)
  const ORDER = ['sealed-more-than-once', 'removed', 'untraced-input', 'step-cycle', 'input-changed-after-use', 'review-rejected', 'review-question']
  forReview.sort((a, b) => ORDER.indexOf(a.code) - ORDER.indexOf(b.code))

  // counts and verdict
  const sum = (k) => Ls.reduce((a, L) => a + (L.report.counts[k] || 0), 0)
  const inputs = S.reduce((a, s) => a + s.ins.length, 0)
  const counts = {
    ledgers: Ls.length, records: sum('records'), goodRecords: sum('goodRecords'),
    sealed: sum('sealed'), match: sum('match'), changed: sum('changed'), missing: sum('missing'), removed: sum('removed'), backAfterRemoval: sum('backAfterRemoval'), notSealed: sum('notSealed'), notChecked: sum('notChecked'),
    steps: S.length, inputs, measuredInputs: S.reduce((a, s) => a + s.ins.filter((x) => x.state === 'measured').length, 0), derivedInputs: S.reduce((a, s) => a + s.ins.filter((x) => x.state === 'derived').length, 0), untracedInputs: S.reduce((a, s) => a + s.ins.filter((x) => x.state === 'untraced').length, 0),
    outputs: S.reduce((a, s) => a + s.outs.length, 0), outputsChanged: outChanged, outputsMissing: outMissing, outputsNotChecked: outNotChecked,
    reviews: reviews.length, stepsApproved: S.filter((s) => s.reviewState === 'approved').length, stepsQuestion: S.filter((s) => s.reviewState === 'question').length, stepsRejected: S.filter((s) => s.reviewState === 'rejected').length, stepsAwaiting: awaiting.length,
    problems: problems.length, ledgerProblems: sum('ledgerProblems'), review: forReview.length, reviewItems: forReview.reduce((a, g) => a + g.count, 0), notes: notes.length, filesRead: sum('filesRead'), bytesRead: sum('bytesRead'),
    pinsChecked: expectations.pins.filter((p) => p.ok !== null).length, pinFails, reviewMismatch,
  }
  const verdict = problems.length || (strict && (forReview.length || notes.length)) ? 'fail' : forReview.length ? 'review' : 'pass'
  const report = {
    format: AUDIT_FORMAT, version: 1, kind: 'many', verdict, summary: '', strict: !!strict,
    filesChecked: Ls.some((L) => L.files !== null),
    counts, problems, forReview, notes,
    allowChanges: { patterns: allowChanges == null ? [] : Array.isArray(allowChanges) ? allowChanges.slice() : [allowChanges], matched: Ls.flatMap((L) => L.report.allowChanges.matched.map((x) => pre(L) + x)) },
    ledgers: ledgerRows, steps, reviews, lineage, expectations,
    files: Ls.flatMap((L) => L.report.files.map((f) => ({ ...f, ledger: L.li, ledgerId: L.ledgerId }))),
    method: {
      recomputed: [
        'each ledger: its header (key id, genesis fingerprint, signature) and every record (fingerprint, link and signature: ECDSA P-256 with SHA-256, low-S only)',
        `the SHA-256 of every file present under each ledger's folder (${_plural(counts.filesRead, 'file', 'files')}, ${formatBytes(counts.bytesRead)})`,
        "every agent step's inputs, traced: each input's SHA-256 against every sealed measurement and every recorded step output",
        "every review's records, by ledger id, record number and link",
      ],
      format: `${FORMAT} version ${FORMAT_VERSION}`, tool: tool || `immutableqc-core/${VERSION}`, core: VERSION, auditedAt,
      where: where === 'browser' ? 'in a browser' : 'on the command line',
    },
    rerun: [],
  }
  report.summary = _summaryMany(report, Ls)
  const dir = folder ? _shellArg(folder) : '<lab folder>'
  report.rerun = [
    'In a browser: open immutableqc.com/app/ and drop the lab folder (every ledger in it is found). Every file is read in the browser; nothing is uploaded.',
    `On the command line: node iqc.mjs audit ${dir}${report.allowChanges.patterns.map((g) => ` --allow-changes ${_shellArg(g)}`).join('')}`,
    ...Ls.filter((L) => L.ledgerId && L.v.head && L.v.head.n > 0).map((L) => `Pin ${L.label}'s head somewhere else: ${formatPinLine(L.ledgerId, L.v.head, auditedAt)}`),
  ]
  return report
}

function _manyNoteMessage(code, k, one) {
  const T = {
    unwatched: () => `${_plural(k, 'change was', 'changes were')} found by a later scan: ${k === 1 ? 'it' : 'they'} happened while nothing was watching, so ${k === 1 ? 'its' : 'their'} time is unknown.`,
    'not-sealed': () => `${_plural(k, 'file is', 'files are')} present but never sealed.`,
    'back-after-removal': () => `${_plural(k, 'file is', 'files are')} present again after ${k === 1 ? 'its' : 'their'} removal was recorded, and not sealed since.`,
    'not-checked': () => `${_plural(k, 'sealed file', 'sealed files')} could not be read, so ${k === 1 ? 'it was' : 'they were'} not checked.`,
    'unclean-stop': () => `${_plural(k, 'session', 'sessions')} did not end cleanly (no stop record before the next start: for example a crash, a forced quit or a power loss).`,
    gaps: () => `Nothing was watching during ${_plural(k, 'period', 'periods')} between sessions; changes made then are sealed with an -unwatched event and an unknown time.`,
  }
  return T[code] ? T[code]() : one
}

// Lineage summaries per step: {m: Set of measured SHA-256 leaves, u: Set of untraced ones (each capped at
// _LINEAGE_CAP; over: more were left out), cycle, empty (a step on the way recorded no inputs)}.
function _lineageSummaries(S) {
  const N = S.length
  const idx = new Int32Array(N).fill(-1), low = new Int32Array(N), onStack = new Uint8Array(N)
  const summ = new Array(N), cyc = new Uint8Array(N)
  const stack = []
  let counter = 0
  const addAll = (into, from, x) => { for (const v of from) { if (into.size >= _LINEAGE_CAP) { x.over = true; break } into.add(v) } }
  const finish = (comp) => {
    const inComp = comp.length > 1 ? new Set(comp) : null
    let direct = false
    const kids = new Set()
    let empty = false
    for (const j of comp) {
      const s = S[j]
      if (!s.ins.length) empty = true
      for (let k = 0; k < s.ins.length; k++) {
        const st = s.ins[k].state
        if (st !== 'derived') direct = true
        else if (!(inComp && inComp.has(s.inP[k].i))) kids.add(s.inP[k].i)
      }
    }
    let x
    if (!inComp && !direct && !empty && kids.size === 1) x = summ[kids.values().next().value]
    else {
      x = { m: new Set(), u: new Set(), over: false, cycle: !!inComp, empty }
      for (const j of comp) {
        for (const inp of S[j].ins) {
          if (inp.state === 'measured') { if (x.m.size < _LINEAGE_CAP) x.m.add(inp.sha256); else if (!x.m.has(inp.sha256)) x.over = true }
          else if (inp.state === 'untraced') { if (x.u.size < _LINEAGE_CAP) x.u.add(inp.sha256); else if (!x.u.has(inp.sha256)) x.over = true }
        }
      }
      for (const kd of kids) {
        const c = summ[kd]
        addAll(x.m, c.m, x)
        addAll(x.u, c.u, x)
        if (c.over) x.over = true
        if (c.cycle) x.cycle = true
        if (c.empty) x.empty = true
      }
    }
    for (const j of comp) summ[j] = x
    if (inComp) for (const j of comp) cyc[j] = 1
  }
  for (let r = 0; r < N; r++) {
    if (idx[r] !== -1) continue
    idx[r] = low[r] = counter++
    stack.push(r)
    onStack[r] = 1
    const work = [r], ei = [0]
    while (work.length) {
      const top = work.length - 1, v = work[top]
      const es = S[v].edges
      if (ei[top] < es.length) {
        const w = es[ei[top]++]
        if (idx[w] === -1) { idx[w] = low[w] = counter++; stack.push(w); onStack[w] = 1; work.push(w); ei.push(0) }
        else if (onStack[w] && idx[w] < low[v]) low[v] = idx[w]
      } else {
        work.pop()
        ei.pop()
        if (work.length) { const u = work[work.length - 1]; if (low[v] < low[u]) low[u] = low[v] }
        if (low[v] === idx[v]) {
          const comp = []
          let w
          do { w = stack.pop(); onStack[w] = 0; comp.push(w) } while (w !== v)
          finish(comp)
        }
      }
    }
  }
  return summ.map((x, j) => (cyc[j] ? { ...x, ownCycle: true } : x))
}

function _summaryMany(r, Ls) {
  const c = r.counts
  if (r.verdict === 'pass') {
    const parts = [Ls.length === 1 ? 'the ledger is intact' : `all ${formatCount(Ls.length)} ledgers are intact`]
    if (c.sealed) {
      if (c.notChecked) parts.push(`${formatCount(c.match)} of ${_plural(c.match + c.notChecked, 'sealed file', 'sealed files')} ${c.match === 1 ? 'matches its seal' : 'match their seals'} (${formatCount(c.notChecked)} not checked)`)
      else parts.push(c.match === 1 ? '1 file matches its seal' : c.match ? `all ${formatCount(c.match)} files match their seals` : 'every sealed file is recorded as removed')
    }
    if (c.steps) parts.push(`${_plural(c.steps, 'agent step is', 'agent steps are')} recorded with every input traced`)
    return `Pass: ${_joinList(parts)}${c.notes ? ` (${_plural(c.notes, 'note', 'notes')})` : ''}.`
  }
  if (r.verdict === 'review') return _reviewSentence(r.forReview)
  const parts = []
  if (c.changed) parts.push(`${_plural(c.changed, 'file', 'files')} changed since ${c.changed === 1 ? 'it was' : 'they were'} sealed`)
  if (c.missing) parts.push(`${_plural(c.missing, 'file is', 'files are')} missing`)
  if (c.outputsChanged) parts.push(`${_plural(c.outputsChanged, 'agent output', 'agent outputs')} changed since ${c.outputsChanged === 1 ? 'its step' : 'their steps'} wrote ${c.outputsChanged === 1 ? 'it' : 'them'}`)
  if (c.outputsMissing) parts.push(`${_plural(c.outputsMissing, 'agent output is', 'agent outputs are')} missing`)
  const broken = Ls.filter((L) => L.report.counts.ledgerProblems)
  if (broken.length) parts.push(Ls.length === 1 ? `the ledger has ${_plural(c.ledgerProblems, 'problem', 'problems')}` : `${_plural(broken.length, 'ledger has', 'ledgers have')} problems`)
  const hf = r.expectations.heads.filter((x) => !x.ok).length, kf = r.expectations.keyIds.filter((x) => !x.ok).length
  if (hf) parts.push(hf === 1 ? 'the pinned head does not match' : `${hf} pinned heads do not match`)
  if (kf) parts.push(kf === 1 ? 'an expected key id is not found' : `${kf} expected key ids are not found`)
  if (c.pinFails) parts.push(`${_plural(c.pinFails, 'pin does', 'pins do')} not match`)
  if (c.reviewMismatch) parts.push(`${_plural(c.reviewMismatch, 'review names a record', 'reviews name records')} that changed after ${c.reviewMismatch === 1 ? 'it was' : 'they were'} reviewed`)
  if (r.strict && (c.notes || c.review)) parts.push(_strictPart(c))
  return `Fail: ${_joinList(parts)}.`
}

// ---------------------------------------------------------------------------------------------------- formatting
export function formatCount(n) {
  const s = String(Math.trunc(Number(n)))
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function formatBytes(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v < 0) return String(n)
  if (v < 1000) return `${v} B`
  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let x = v / 1000, i = 0
  while (x >= 999.95 && i < units.length - 1) { x /= 1000; i++ }
  return `${x < 100 ? x.toFixed(1) : Math.round(x)} ${units[i]}`
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms)) return 'unknown length'
  if (ms < 0) return 'negative length (the clock went back)'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24)
  if (h < 1) return `${m} min`
  if (d < 1) return `${h} h ${m % 60} min`
  return `${d} d ${h % 24} h`
}

export function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
}

// ---------------------------------------------------------------------------------------------------- report (3.9)
const _CSS = `
:root{color-scheme:light;--fg:#14171c;--muted:#5a6270;--line:#d9dde3;--soft:#f4f6f8;--ok:#0b6b3a;--okbg:#e6f4ec;--bad:#a1121b;--badbg:#fbe9ea;--note:#7a4b00;--notebg:#fdf3e1;--rev:#8a4600;--revbg:#fff1d6}
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
.review{color:var(--rev);background:var(--revbg);border-color:var(--rev)}
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
.st-measured,.st-derived,.st-approved,.st-matches{color:var(--ok)}
.st-untraced,.st-question,.st-cycle,.st-rev{color:var(--rev)}
.st-rejected,.st-bad{color:var(--bad)}
.st-superseded,.st-awaiting,.st-unknown{color:var(--muted)}
ul.tree{margin:4px 0;padding-left:18px;list-style:none;border-left:1px solid var(--line)}
ul.tree li{margin:3px 0}
.step{border:1px solid var(--line);border-radius:6px;padding:8px 10px;margin:8px 0;break-inside:avoid}
.step h3{font-size:1em;margin:0 0 4px}
.tag{display:inline-block;font-size:.8em;border:1px solid var(--line);border-radius:4px;padding:0 4px;color:var(--muted)}
.wrap{overflow-x:auto}
footer{margin-top:32px;color:var(--muted);font-size:.86em}
@page{margin:14mm}
@media print{body{font-size:11px}main{max-width:none;padding:0}.verdict,.counts li,tr{break-inside:avoid}thead{display:table-header-group}h2{break-after:avoid}.wrap{overflow:visible}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`.trim()

const _STATE_CLASS = { match: 'match', changed: 'changed', missing: 'missing', removed: 'removed', 'back after removal': 'back', 'not sealed': 'notsealed', 'not checked': 'notchecked' }
const _MAX_PROBLEMS = 1000, _MAX_ITEMS = 200

export function renderReportHTML(report) {
  const e = escapeHTML
  const r = report
  const L = r.ledger || {}
  const c = r.counts || {}
  if (Array.isArray(r.ledgers)) return _renderMany(r)
  const pass = r.verdict === 'pass'
  const dash = '<span class="none">unknown</span>'
  const v = (x) => (x === null || x === undefined || x === '' ? dash : e(x))
  const code = (x) => (x === null || x === undefined || x === '' ? dash : `<code>${e(x)}</code>`)
  const when = (x) => (x ? e(_when(x)) : dash)
  const out = []
  out.push('<!doctype html><html lang="en"><head><meta charset="utf-8">')
  out.push(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`)
  out.push('<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">')
  out.push(`<title>${e(`Audit report: ${_VWORD[r.verdict] ? r.verdict : 'fail'}${L.station ? `, ${L.station}` : ''}`)}</title><style>${_CSS}</style></head><body><main>`)
  out.push(`<h1>Immutable QC audit report</h1><p class="sub">${e(r.method && r.method.auditedAt ? `Audited ${_when(r.method.auditedAt)}, ${r.method.where}` : '')}${L.station ? ` · station ${e(L.station)}` : ''}</p>`)

  // 1. verdict
  out.push(_verdictHTML(r))
  if (r.strict) out.push('<p class="sub">Strict mode: items for review and notes count as failures.</p>')

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

  // 3b. for review
  out.push(_groupsHTML('For review', r.forReview || [], 'Recorded changes: not failures, but each one needs a look (files expected to change can be named with allowChanges).'))
  const allowed = (r.allowChanges && r.allowChanges.matched) || []
  if (allowed.length) out.push(`<p class="sub">${e(`${_plural(allowed.length, 'recorded change matches', 'recorded changes match')} the files expected to change (${(r.allowChanges.patterns || []).join(', ')}):`)}</p><ul class="items">${allowed.slice(0, _MAX_ITEMS).map((x) => `<li class="path">${e(x)}</li>`).join('')}${allowed.length > _MAX_ITEMS ? `<li>${e(`and ${formatCount(allowed.length - _MAX_ITEMS)} more`)}</li>` : ''}</ul>`)

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

const _VWORD = { pass: 'Pass', review: 'Review', fail: 'Fail' }
const _VMARK = { pass: '&#10003;', review: '!', fail: '&#10007;' }
const _MAX_STEPS = 500, _MAX_LINEAGE = 200, _MAX_REVIEWS = 500, _MAX_FILES = 1000, _MAX_PINS = 200, _MAX_TREE = 400

function _verdictHTML(r) {
  const k = _VWORD[r.verdict] ? r.verdict : 'fail'
  const sentence = String(r.summary || '').replace(/^(?:Pass|Review|Fail): /, '').replace(/^./, (ch) => ch.toUpperCase())
  return `<section aria-label="Verdict" class="verdict ${k}"><span class="mark" aria-hidden="true">${_VMARK[k]}</span><div><span class="word">${_VWORD[k]}</span><span class="sentence">${escapeHTML(sentence)}</span></div></section>`
}

function _groupsHTML(title, groups, sub) {
  const e = escapeHTML
  const out = [`<h2>${e(title)}</h2>`]
  if (sub && groups.length) out.push(`<p class="sub">${e(sub)}</p>`)
  if (!groups.length) { out.push('<p class="none">None.</p>'); return out.join('') }
  out.push('<ul class="list">')
  for (const g of groups) {
    const items = g.items || []
    out.push(`<li>${e(g.message)}${items.length ? `<ul class="items">${items.slice(0, _MAX_ITEMS).map((x) => `<li class="path">${e(x)}</li>`).join('')}${items.length > _MAX_ITEMS ? `<li>${e(`and ${formatCount(items.length - _MAX_ITEMS)} more (all of them are in the JSON report)`)}</li>` : ''}</ul>` : ''}</li>`)
  }
  out.push('</ul>')
  return out.join('')
}

const _cls = (s) => String(s).replace(/[^a-z]+/gi, '').toLowerCase()

function _renderMany(r) {
  const e = escapeHTML
  const c = r.counts || {}
  const dash = '<span class="none">unknown</span>'
  const code = (x) => (x === null || x === undefined || x === '' ? dash : `<code>${e(x)}</code>`)
  const when = (x) => (x ? e(_when(x)) : dash)
  const ledgers = r.ledgers || []
  const lname = (i) => (ledgers[i] ? ledgers[i].label : `ledger ${Number(i) + 1}`)
  const stepBy = new Map((r.steps || []).map((s) => [`${s.ledger}:${s.n}`, s]))
  const stepText = (ref) => {
    if (!ref) return ''
    const s = stepBy.get(`${ref.ledger}:${ref.n}`)
    return `${lname(ref.ledger)}, record ${ref.n}${s ? ` (${s.actor}: ${_clipText(s.action, 80)})` : ''}`
  }
  const st = (state, label) => `<span class="st st-${_cls(state === 'changed' || state === 'missing' ? 'bad' : state === 'not checked' ? 'unknown' : state === 'awaiting review' ? 'awaiting' : state === 'unknown ledger' ? 'unknown' : state)}">${e(label || state)}</span>`
  const out = []
  out.push('<!doctype html><html lang="en"><head><meta charset="utf-8">')
  out.push(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`)
  out.push('<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">')
  out.push(`<title>${e(`Audit report: ${_VWORD[r.verdict] ? r.verdict : 'fail'}, ${_plural(ledgers.length, 'ledger', 'ledgers')}`)}</title><style>${_CSS}</style></head><body><main>`)
  out.push(`<h1>Immutable QC audit report</h1><p class="sub">${e(r.method && r.method.auditedAt ? `Audited ${_when(r.method.auditedAt)}, ${r.method.where} · ${_plural(ledgers.length, 'ledger', 'ledgers')}` : '')}</p>`)
  out.push(_verdictHTML(r))
  if (r.strict) out.push('<p class="sub">Strict mode: items for review and notes count as failures.</p>')

  // counts
  const cnt = [
    ['Ledgers', c.ledgers], ['Records', c.records], ['Files sealed', c.sealed], ['Match', c.match], ['Changed', c.changed], ['Missing', c.missing],
    ['Agent steps', c.steps], ['Inputs measured', c.measuredInputs], ['Inputs derived', c.derivedInputs], ['Inputs untraced', c.untracedInputs],
    ['Outputs', c.outputs], ['Reviews', c.reviews], ['Problems', c.problems], ['For review', c.review], ['Notes', c.notes],
  ]
  out.push(`<h2>Counts</h2><ul class="counts">${cnt.map(([k, n]) => `<li><b>${e(formatCount(n || 0))}</b><span>${e(k)}</span></li>`).join('')}</ul>`)

  // problems, for review, notes
  const probs = r.problems || []
  out.push('<h2>Problems</h2>')
  if (!probs.length) out.push('<p class="none">None.</p>')
  else {
    out.push(`<ul class="list">${probs.slice(0, _MAX_PROBLEMS).map((p) => `<li>${e(p.message)}</li>`).join('')}</ul>`)
    if (probs.length > _MAX_PROBLEMS) out.push(`<p>${e(`And ${formatCount(probs.length - _MAX_PROBLEMS)} more problems (all of them are in the JSON report).`)}</p>`)
  }
  out.push(_groupsHTML('For review', r.forReview || [], 'Not failures, but each one needs a look by a person. Each is recorded.'))
  out.push(_groupsHTML('Notes', r.notes || [], r.strict ? '' : 'Notes are not failures.'))

  // ledgers
  out.push(`<h2>Ledgers audited</h2>`)
  out.push('<div class="wrap"><table><thead><tr><th scope="col">Ledger</th><th scope="col">Role</th><th scope="col">Station</th><th scope="col">Key id</th><th scope="col">Head</th><th scope="col">Records</th><th scope="col">On its own</th></tr></thead><tbody>')
  for (const L of ledgers) {
    out.push(`<tr><td class="path">${e(L.label)}${L.ledgerPath ? `<br><span class="none">${e(L.ledgerPath)}</span>` : ''}</td><td>${e(L.role)}</td><td>${L.station ? e(L.station) : dash}</td><td>${code(L.keyId)}</td><td>${L.head ? `<code>${e(formatHead(L.head))}</code>` : dash}</td><td>${e(formatCount(L.records || 0))}</td><td class="st ${L.verdict === 'pass' ? 'st-match' : L.verdict === 'review' ? 'st-rev' : 'st-changed'}">${e(L.intact ? (L.verdict || '') : 'ledger has problems')}</td></tr>`)
  }
  out.push('</tbody></table></div>')

  // agent steps
  const steps = r.steps || []
  out.push(`<h2>Agent steps</h2>`)
  if (!steps.length) out.push('<p class="none">No agent step is recorded in the ledgers audited.</p>')
  else {
    out.push(`<p class="sub">${e(`${_plural(steps.length, 'step', 'steps')}. A recorded step shows what the agent said it read and wrote, and that those bytes are unchanged; it does not show the analysis was right, or that the agent reported every file it touched.`)}</p>`)
    for (const s of steps.slice(0, _MAX_STEPS)) {
      const rv = s.review || { state: 'awaiting review', decisions: [] }
      out.push(`<div class="step"><h3>${e(`${s.label}, record ${s.n}: ${s.actor}`)}</h3><dl>`)
      out.push(`<dt>Action</dt><dd>${e(s.action)}</dd><dt>Tool</dt><dd>${s.tool === '-' ? '<span class="none">not recorded</span>' : e(s.tool)}</dd><dt>Time</dt><dd>${when(s.at)}</dd>`)
      out.push(`<dt>Review</dt><dd>${st(rv.state)}${rv.decisions.length ? `<ul class="items">${rv.decisions.map((d) => `<li>${e(`${d.decision} by ${d.reviewer}, ${_when(d.at)}${d.note ? `: ${d.note}` : ''}${d.latest ? '' : ' (superseded by a later decision of the same reviewer)'}`)}</li>`).join('')}</ul>` : ''}</dd>`)
      out.push(`<dt>Inputs</dt><dd>${s.inputs.length ? `<ul class="items">${s.inputs.map((x) => {
        let why = ''
        if (x.state === 'measured' && x.measured && x.measured[0]) { const m = x.measured[0]; why = `sealed by ${m.station || lname(m.ledger)} as ${m.path} in record ${m.n}, ${_when(m.observedAt)}` }
        else if (x.state === 'derived') why = `written by ${stepText(x.step)}`
        else if (x.state === 'untraced') why = 'matches nothing measured or derived in the ledgers audited'
        const ch = x.changedAfter ? `<br><span class="st st-rev">${e(x.changedAfter.afterUse ? `the file changed after this step used it (sealed again in record ${x.changedAfter.n}, ${_when(x.changedAfter.observedAt)})` : `an earlier version: sealed again in record ${x.changedAfter.n}, ${_when(x.changedAfter.observedAt)}, before this step`)}</span>` : ''
        return `<li>${st(x.state)} <span class="path">${e(x.path)}</span> <span class="none">${e(`${formatBytes(x.bytes)} · ${x.sha256.slice(0, 16)}… · ${why}`)}</span>${ch}</li>`
      }).join('')}</ul>` : '<span class="none">none recorded</span>'}</dd>`)
      out.push(`<dt>Outputs</dt><dd><ul class="items">${s.outputs.map((x) => `<li>${st(x.state)} <span class="path">${e(x.path)}</span> <span class="none">${e(`${formatBytes(x.bytes)} · ${x.sha256.slice(0, 16)}…${x.state === 'superseded' ? ` · written again by ${stepText(x.supersededBy)}` : ''}${x.state === 'changed' && x.present ? ` · now ${x.present.sha256.slice(0, 16)}…${x.matchesStep ? `, the version written in record ${x.matchesStep.n}` : ''}` : ''}`)}</span></li>`).join('')}</ul></dd>`)
      out.push(`<dt>Traces to</dt><dd>${e(s.lineage ? s.lineage.sentence : '')}</dd></dl></div>`)
    }
    if (steps.length > _MAX_STEPS) out.push(`<p>${e(`And ${formatCount(steps.length - _MAX_STEPS)} more steps (all of them are in the JSON report).`)}</p>`)
  }

  // lineage
  const lo = (r.lineage && r.lineage.outputs) || []
  out.push('<h2>Trace to measurements</h2>')
  if (!lo.length) out.push('<p class="none">No agent output to trace.</p>')
  else {
    out.push(`<p class="sub">${e(`Each output, traced back through the steps that wrote its inputs to the files the instruments sealed (at most ${(r.lineage && r.lineage.maxDepth) || 32} steps deep).`)}</p><ul class="list">`)
    let shown = 0
    const tree = (nodes) => {
      const parts = []
      for (const nd of nodes || []) {
        if (shown >= _MAX_TREE) { parts.push(`<li class="none">${e('and more (the JSON report holds the whole tree)')}</li>`); break }
        shown++
        if (nd.stop === 'size') { parts.push(`<li class="none">${e(`${formatCount(nd.more)} more inputs, left out of this tree`)}</li>`); continue }
        let why = ''
        if (nd.state === 'measured' && nd.measured) why = `sealed by ${nd.measured.station || lname(nd.measured.ledger)} in record ${nd.measured.n}, ${_when(nd.measured.observedAt)}`
        else if (nd.state === 'derived') why = `written by ${stepText(nd.step)}${nd.stop === 'cycle' ? ': a cycle, not followed again' : nd.stop === 'shown above' ? ': shown above' : nd.stop === 'depth' ? ': deeper steps are not shown' : ''}`
        else why = 'nothing measured or derived'
        parts.push(`<li>${st(nd.stop === 'cycle' ? 'cycle' : nd.state)} <span class="path">${e(nd.path)}</span> <span class="none">${e(why)}</span>${nd.inputs && nd.inputs.length ? `<ul class="tree">${tree(nd.inputs)}</ul>` : ''}</li>`)
      }
      return parts.join('')
    }
    for (const o of lo.slice(0, _MAX_LINEAGE)) {
      out.push(`<li><span class="path"><b>${e(o.path)}</b></span> ${st(o.tracesToMeasured ? 'measured' : o.cycle ? 'cycle' : 'untraced', o.tracesToMeasured ? 'traced' : 'not fully traced')} <span class="none">${e(`${lname(o.ledger)}, record ${o.n}: ${o.sentence}`)}</span>`)
      if (o.tree && shown < _MAX_TREE) out.push(`<ul class="tree">${tree(o.tree.inputs)}</ul>`)
      out.push('</li>')
    }
    out.push('</ul>')
    if (lo.length > _MAX_LINEAGE) out.push(`<p>${e(`And ${formatCount(lo.length - _MAX_LINEAGE)} more outputs (all of them are in the JSON report).`)}</p>`)
  }

  // reviews
  const rvs = r.reviews || []
  out.push('<h2>Reviews</h2>')
  if (!rvs.length) out.push('<p class="none">No review is recorded in the ledgers audited.</p>')
  else {
    out.push('<p class="sub">A review signed in a browser identifies that browser’s key, not a person.</p><div class="wrap"><table><thead><tr><th scope="col">Reviewer</th><th scope="col">Decision</th><th scope="col">When</th><th scope="col">Records reviewed</th><th scope="col">Note</th></tr></thead><tbody>')
    for (const x of rvs.slice(0, _MAX_REVIEWS)) {
      const subs = x.subjects.slice(0, 20).map((sj) => `${st(sj.state === 'matches' ? 'matches' : sj.state === 'changed' ? 'changed' : 'unknown ledger')} ${e(sj.ledger !== undefined ? `${lname(sj.ledger)}, record ${sj.n}${sj.kind ? ` (${sj.kind}${sj.path ? `: ${sj.path}` : ''})` : ''}` : `ledger ${sj.ledgerId}, record ${sj.n}`)}`).join('<br>') + (x.subjects.length > 20 ? `<br>${e(`and ${x.subjects.length - 20} more`)}` : '')
      out.push(`<tr><td>${e(x.reviewer)}</td><td>${st(x.decision)}</td><td class="nw">${when(x.at)}</td><td>${subs}</td><td>${x.note ? e(x.note) : '<span class="none">none</span>'}</td></tr>`)
    }
    out.push('</tbody></table></div>')
    if (rvs.length > _MAX_REVIEWS) out.push(`<p>${e(`And ${formatCount(rvs.length - _MAX_REVIEWS)} more reviews (all of them are in the JSON report).`)}</p>`)
  }

  // expectations
  const ex = r.expectations || {}
  const exl = [...(ex.heads || []), ...(ex.keyIds || [])]
  const pins = ex.pins || []
  if (exl.length || pins.length) {
    out.push('<h2>Expectations and pins</h2><ul class="list">')
    for (const x of exl) out.push(`<li><span class="st ${x.ok ? 'st-match' : 'st-changed'}">${x.ok ? 'Matches' : 'Does not match'}</span>: ${e(x.message)}</li>`)
    for (const x of pins.slice(0, _MAX_PINS)) out.push(`<li><span class="st ${x.ok === null ? 'st-unknown' : x.ok ? 'st-match' : 'st-changed'}">${x.ok === null ? 'Not audited' : x.ok ? 'Matches' : 'Does not match'}</span>: ${e(x.message)}</li>`)
    out.push('</ul>')
    if (pins.length > _MAX_PINS) out.push(`<p>${e(`And ${formatCount(pins.length - _MAX_PINS)} more pins (all of them are in the JSON report).`)}</p>`)
  }

  // files
  const files = (r.files || []).slice().sort((a, b) => _fileRank(a) - _fileRank(b))
  out.push(`<h2>Files</h2><p class="sub">${e(`${formatCount(files.length)} ${files.length === 1 ? 'path' : 'paths'} sealed by the ledgers audited (problems first). Paths are shown as stored: "%", "|" and control characters are written as %XX.`)}</p>`)
  if (files.length) {
    out.push('<div class="wrap"><table><thead><tr><th scope="col">Ledger</th><th scope="col">Path</th><th scope="col">State</th><th scope="col">Size</th><th scope="col">SHA-256</th><th scope="col">Versions</th></tr></thead><tbody>')
    for (const f of files.slice(0, _MAX_FILES)) {
      const sz = f.present ? f.present.bytes : f.sealed ? f.sealed.bytes : null
      let sha = f.sealed ? `<code>${e(f.sealed.sha256)}</code>` : f.present ? `<code>${e(f.present.sha256)}</code>` : dash
      if (f.state === 'changed' && f.sealed && f.present) sha = `sealed <code>${e(f.sealed.sha256)}</code><br>now <code>${e(f.present.sha256)}</code>`
      out.push(`<tr><td>${e(lname(f.ledger))}</td><td class="path">${e(f.path)}</td><td class="st st-${_STATE_CLASS[f.state] || 'notchecked'}">${e(f.state)}${f.matchesN ? `<br><span class="none">${e(`matches record ${f.matchesN}`)}</span>` : ''}</td><td class="nw">${sz !== null && sz !== undefined ? e(formatBytes(sz)) : dash}</td><td>${sha}</td><td>${e(f.versions)}</td></tr>`)
    }
    out.push('</tbody></table></div>')
    if (files.length > _MAX_FILES) out.push(`<p>${e(`And ${formatCount(files.length - _MAX_FILES)} more files (all of them are in the JSON report).`)}</p>`)
  }

  // method, re-run
  const m = r.method || {}
  out.push('<h2>Method</h2><p>Recomputed:</p><ul class="list">')
  for (const x of m.recomputed || []) out.push(`<li>${e(x)}</li>`)
  out.push('</ul><dl>')
  out.push(`<dt>Format</dt><dd>${m.format ? e(m.format) : dash}</dd><dt>Tool</dt><dd>${m.tool ? e(m.tool) : dash}${m.core ? e(` (core ${m.core})`) : ''}</dd><dt>When</dt><dd>${when(m.auditedAt)}</dd><dt>Where</dt><dd>${m.where ? e(m.where) : dash}</dd>`)
  out.push('</dl><p class="sub">A pass shows each sealed file is byte for byte the one that was sealed, that each ledger has not been edited, reordered or cut since it was signed, and that every input of every recorded agent step matches a sealed measurement or the output of another recorded step. It does not show a file or an analysis was right, that an agent reported every file it touched, or a change made before a file was sealed. Each ledger is a local file signed by its own key; the ledgers are joined only here, by content.</p>')
  out.push(`<h2>How to re-run this audit</h2><ul class="list">${(r.rerun || []).map((x) => `<li>${e(x)}</li>`).join('')}</ul>`)
  out.push(`<footer>${e(`${AUDIT_FORMAT} version ${r.version || 1}. The machine-readable form of this report is its JSON.`)}</footer>`)
  out.push('</main></body></html>\n')
  return out.join('')
}

const _fileRank = (f) => (f.state === 'changed' || f.state === 'missing' ? 0 : f.state === 'match' || f.state === 'removed' ? 2 : 1)
