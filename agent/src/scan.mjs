// Reading the data folder: a walk with lstat (symbolic links are skipped, never followed; only regular files count),
// and a streaming SHA-256 of one file (node's createHash, 1 MiB at a time, so a file of any size never has to fit in
// memory).
import { readdir, lstat, open } from 'node:fs/promises'
import { readdirSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { encodePath, ignoreMatcher, isLedgerFolderPath } from '../../core/immutableqc.mjs'

// Errors that mean "not now": the file is open in another program (Windows locks), or briefly not readable. They are
// retried on the next poll.
export const BUSY = new Set(['EBUSY', 'EPERM', 'EACCES', 'EAGAIN', 'ETXTBSY', 'EMFILE', 'ENFILE', 'UNKNOWN'])

export class Stopped extends Error {}

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
export async function walk(root, { skip = () => false, state = {} } = {}) {
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
export function outOfSight(w, p) {
  if (w.unreadableFiles.has(p) || w.ambiguous.has(p)) return true
  for (const d of w.unreadable) if (d === '' || p.startsWith(d + '/')) return true
  return false
}

// The skip rule for a walk: the ignore patterns (core's matcher: the default ignores plus --ignore), and the agent's
// own files when the ledger is kept inside the data folder somewhere else than ImmutableQC/.
export function skipper(ignore, own = new Set()) {
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
export async function hashFile(abs, { stop = () => false, buf } = {}) {
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
export const sameStat = (a, b) => a.size === b.size && a.mtimeMs === b.mtimeMs && (a.ctimeMs == null || b.ctimeMs == null || a.ctimeMs === b.ctimeMs)
