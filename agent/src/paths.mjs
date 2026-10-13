// Where things are: the data folder, the ledger, its lock and README.txt, and how a file's path on disk becomes the
// path stored in the ledger (relative, "/" between segments, NFC, percent-encoded as core's encodePath says).
import { resolve, dirname, basename, join, sep, relative, isAbsolute } from 'node:path'
import { statSync, existsSync } from 'node:fs'
import { encodePath, LEDGER_DIR, LEDGER_FILE } from '../../core/immutableqc.mjs'
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
