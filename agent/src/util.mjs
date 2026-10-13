// Small shared pieces of the agent: version, errors, time and a promise pool.
import { VERSION, isTime } from '../../core/immutableqc.mjs'

// The agent's version is core's: they ship together (agent/package.json says the same; a test checks it).
export const AGENT_VERSION = VERSION
export const AGENT = `immutableqc-cli/${VERSION}`

// Exit codes. Audit: 0 pass, 1 fail, 2 usage or read error. The other commands: 0 done, 1 refused or failed (a broken
// ledger, a missing key, a held lock, a write error), 2 usage or read error.
export const EXIT_OK = 0
export const EXIT_FAIL = 1
export const EXIT_USAGE = 2

// An error meant for the person at the terminal: its message is shown as is, without a stack trace.
export class UserError extends Error {
  constructor(message, code = EXIT_FAIL) {
    super(message)
    this.name = 'UserError'
    this.exitCode = code
  }
}

export const usageError = (message) => new UserError(message, EXIT_USAGE)

export function sleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(done, Math.max(0, ms))
    function done() { clearTimeout(t); if (signal) signal.off(done); resolve() }
    if (signal) signal.on(done)
  })
}

// A tiny event for waking a sleep early (a stop request).
export class Wake {
  constructor() { this.fns = new Set() }
  on(fn) { this.fns.add(fn) }
  off(fn) { this.fns.delete(fn) }
  fire() { for (const fn of [...this.fns]) fn() }
}

// Runs fn over items with at most `limit` running at once.
export async function pool(items, limit, fn) {
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
export function isoOf(ms) {
  try {
    const s = new Date(Math.floor(ms)).toISOString()
    return isTime(s) ? s : null
  } catch {
    return null
  }
}

export const whenUTC = (iso) => (typeof iso === 'string' && iso.length >= 19 ? `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC` : String(iso))

export function clock(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
