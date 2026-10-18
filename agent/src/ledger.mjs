// The ledger file: read and verify it whole before anything is appended (a broken ledger is never extended and never
// repaired), create it, and append records. Each record is one write of one complete line to the file opened for
// append, then fsync. The verified state stays in memory and is brought up to date as records are appended
// (core's extendVerified), so a poll never verifies the whole ledger again; before each append the file's size and
// modification time are compared with what the agent last wrote, and only a ledger changed by something else is read
// and verified again.
import { readFileSync, openSync, writeSync, fsyncSync, closeSync, statSync, ftruncateSync, renameSync, unlinkSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { verifyLedger, extendVerified, createHeader, createRecords, serializeLine, formatCount, formatPinLine } from '../../core/immutableqc.mjs'
import { AGENT, UserError, EXIT_USAGE } from './util.mjs'

export const README_TEXT = `Immutable QC: the sealed record of this data folder
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

  On the command line, with Node.js 22 or later and iqc.mjs (from
  https://immutableqc.com):

      node iqc.mjs audit "<the data folder>"

  Exit code 0 means every file matches its seal and the ledger is intact.
  iqc audit --report audit.html writes a report you can print or keep.
`

export function ensureDir(dir) {
  try {
    mkdirSync(dir, { recursive: true })
  } catch (e) {
    throw new UserError(`Cannot create the folder ${dir} for the ledger (${e.code || e.message}).`)
  }
}

// README.txt beside the ledger, unless one is there already (it is never overwritten)
export function ensureReadme(file, text = README_TEXT) {
  try {
    const fd = openSync(file, 'wx')
    try { writeSync(fd, text) } finally { closeSync(fd) }
    return true
  } catch {
    return false
  }
}

// Reads and verifies the whole ledger. A missing or unreadable ledger is an error with exit code 2 (a read error);
// a ledger that does not verify comes back with its problems, for the caller to refuse or report.
export async function readLedger(file, { missingOk = false, onProgress } = {}) {
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
export async function readLedgerSettled(file, { agentRunning = () => false, onProgress, missingOk = false, tries = 5, delayMs = 200 } = {}) {
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
export function brokenMessage(verified, file, { doing = 'Nothing was written to it' } = {}) {
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
export async function createLedger(file, { key, station }) {
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

// --pin-file: one line `immutableqc-head <ledgerId> <n>:<h> <time>` (core's formatPinLine) appended to a file kept
// somewhere else (another drive, a share, a synced folder) after each batch of records, so a later audit with
// --pin-file shows a ledger rewritten or restarted since. A pin that cannot be written is a warning (once per kind of
// error until one is written again): sealing goes on.
export class PinFile {
  constructor(file, { out } = {}) {
    this.file = file
    this.out = out
    this.failed = null
    this.written = 0
  }

  pin(ledgerId, head) {
    const line = formatPinLine(ledgerId, head, new Date().toISOString()) + '\n'
    let fd
    try {
      fd = openSync(this.file, 'a')
      try { writeAll(fd, Buffer.from(line, 'utf8')); fsyncSync(fd) } finally { closeSync(fd) }
      this.failed = null
      this.written++
      return true
    } catch (e) {
      const code = e.code || e.message
      if (this.failed !== code && this.out) this.out.warn(`Cannot append the head to the pin file ${this.file} (${code}). Sealing goes on; the pin file misses this head (record ${head.n}).`)
      this.failed = code
      return false
    }
  }
}

export class Appender {
  constructor(file, verified, stat, { out, pin = null } = {}) {
    this.file = file
    this.v = verified
    this.size = stat.size
    this.mtimeMs = stat.mtimeMs
    this.out = out
    this.pinFile = pin
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
      if (this.pinFile && done.length) this.pinFile.pin(this.v.header.ledgerId, this.v.head)
    }
    return done
  }
}
