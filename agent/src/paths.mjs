// Where things are: the data folder, the ledger, its lock and README.txt, and how a file's path on disk becomes the
// path stored in the ledger (relative, "/" between segments, NFC, percent-encoded as core's encodePath says).
import { resolve, dirname, basename, join, sep, relative, isAbsolute } from 'node:path'
import { statSync, existsSync, lstatSync, realpathSync } from 'node:fs'
import { encodePath, isNeverDataPath, LEDGER_DIR, LEDGER_FILE } from '../../core/immutableqc.mjs'
import { usageError } from './util.mjs'

// The stored path of `abs` inside `root`, using the path module `p` (node:path, or path.win32 / path.posix in tests).
// Throws when abs is not inside root.
export function relPathOf(root, abs, p = { relative, sep, isAbsolute }) {
  const rel = p.relative(root, abs)
  if (!rel || rel === '..' || rel.startsWith('..' + p.sep) || p.isAbsolute(rel)) throw new Error(`${abs} is not inside ${root}.`)
  return encodePath(rel.split(p.sep).join('/'))
}

// The stored path, null when abs is not inside root (or has no stored form).
export function relPathOrNull(root, abs, p) {
  try { return relPathOf(root, abs, p) } catch { return null }
}

// How a stored path is shown to a person: "%" and "|" as themselves, control characters still as %XX.
export const displayPath = (p) => p.replace(/%(25|7C)/g, (_, h) => (h === '25' ? '%' : '|'))

// The data folder: it must exist and be a folder. A folder that is itself an ImmutableQC folder (it holds the ledger)
// is refused with a hint: the data folder is the one around it.
export function dataFolder(arg) {
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
export function locate(root, ledgerOpt) {
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
export function shownPath(root, abs) {
  const rel = relative(root, abs)
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : abs
}

// A file an agent step names (iqc record, the MCP server): `p` resolved against `base` (the current folder for the
// command line, the root for the MCP server), refused unless it is a regular file inside `root`. Refused: a path that
// leaves the root ("..", or an absolute path elsewhere), a symbolic link (links are never followed), a file reached
// through a linked folder that leads outside the root, the ledger's own folder, and anything that is not a file.
// Returns {abs, rel (raw, "/" between segments), path (the stored form, core's encodePath)}.
export function confinedFile(root, p, { base = root, what = 'file', own = new Set() } = {}) {
  if (typeof p !== 'string' || p === '') throw usageError(`The ${what} path is empty.`)
  if (/[\u0000]/.test(p)) throw usageError(`The ${what} path ${JSON.stringify(p)} holds a NUL character.`)
  const abs = resolve(base, p)
  const rel = relative(root, abs)
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw usageError(`${JSON.stringify(p)} is outside the root ${root}: an agent step names only files under its root. Give a file inside it, or a wider --root.`)
  }
  let st
  try { st = lstatSync(abs) } catch (e) {
    throw usageError(e.code === 'ENOENT' ? `No ${what} at ${abs}.` : `Cannot look at the ${what} ${abs} (${e.code || e.message}).`)
  }
  if (st.isSymbolicLink()) throw usageError(`${JSON.stringify(p)} is a symbolic link: links are never followed. Name the file itself.`)
  if (!st.isFile()) throw usageError(`${JSON.stringify(p)} is not a file${st.isDirectory() ? ' (it is a folder)' : ''}.`)
  let real, realRoot
  try { real = realpathSync(abs); realRoot = realpathSync(root) } catch (e) { throw usageError(`Cannot resolve ${abs} (${e.code || e.message}).`) }
  const rr = relative(realRoot, real)
  if (!rr || rr === '..' || rr.startsWith('..' + sep) || isAbsolute(rr)) {
    throw usageError(`${JSON.stringify(p)} leads outside the root ${root} through a linked folder: links are never followed.`)
  }
  const raw = rel.split(sep).join('/')
  let path
  try { path = encodePath(raw) } catch (e) { throw usageError(`${JSON.stringify(p)} cannot be named in a record: ${e.message}`) }
  // core's one rule of what is never data (any ImmutableQC folder, any *.ledger.jsonl), and the agent's own files
  if (isNeverDataPath(path) || own.has(path)) throw usageError(`${JSON.stringify(p)} is one of the ledger's own files, not data.`)
  // an output in the folder of another ledger (a station's folder under the root) would be audited against that
  // ledger, not this agent's: the audit would report it missing
  if (what === 'output') {
    const segs = raw.split('/')
    for (let k = 1; k < segs.length; k++) {
      const dir = join(root, ...segs.slice(0, k))
      if (existsSync(join(dir, LEDGER_DIR, LEDGER_FILE))) {
        throw usageError(`${JSON.stringify(p)} is inside ${segs.slice(0, k).join('/')}, a folder that has its own ledger (${LEDGER_DIR}/${LEDGER_FILE}). An output belongs in the agent's own folder, not in another ledger's: write it under the root outside that folder, or give a --root of its own.`)
      }
    }
  }
  return { abs, rel: raw, path }
}

// iqc record and iqc mcp write to the ledger they open: refused when its folder or file is a symbolic link or a
// junction (the write would land somewhere else, signed for this ledger), or when the default folder resolves outside
// the root.
export function refuseLinkedLedger(loc) {
  for (const f of loc.isDefault ? [loc.dir, loc.ledgerPath] : [loc.ledgerPath]) {
    let st = null
    try { st = lstatSync(f) } catch { /* not there yet */ }
    if (st && st.isSymbolicLink()) throw usageError(`${f} is a symbolic link or a junction: links are never followed, so nothing is written there. Use a real folder.`)
  }
  if (loc.isDefault) {
    try {
      const rr = relative(realpathSync(loc.root), realpathSync(loc.dir))
      if (rr === '..' || rr.startsWith('..' + sep) || isAbsolute(rr)) throw usageError(`${loc.dir} leads outside the root ${loc.root} through a linked folder: links are never followed, so nothing is written there.`)
    } catch (e) {
      if (e && e.exitCode !== undefined) throw e
      /* the folder is not there yet */
    }
  }
}
