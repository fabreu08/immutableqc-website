// One agent per ledger. agent.lock holds the agent's process id, computer name and start time; it is created with
// exclusive create, so two agents cannot both make it. A second agent on the same ledger refuses; a lock whose process
// is gone (on this computer) is taken over with a warning; a lock from another computer is left alone (its process
// cannot be checked from here). The lock is removed on exit.
import { hostname } from 'node:os'
import { openSync, writeSync, fsyncSync, closeSync, readFileSync, unlinkSync, statSync } from 'node:fs'
import { AGENT, UserError, whenUTC } from './util.mjs'

export function readLock(file) {
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
export function peekLock(file) {
  try { return readLock(file) } catch { return null }
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

const sameHost = (h) => typeof h === 'string' && h.toLowerCase() === hostname().toLowerCase()

// 'none' | 'live' | 'stale' | 'other-host' | 'young' (being written) | 'unreadable'
export function lockState(lock) {
  if (!lock) return 'none'
  const i = lock.info
  if (!i) return lock.ageMs < 10000 ? 'young' : 'unreadable'
  if (i.host !== undefined && !sameHost(i.host)) return 'other-host'
  if (i.pid === process.pid) return 'stale'
  return pidAlive(i.pid) ? 'live' : 'stale'
}

export const describeLock = (i) => `pid ${i.pid}${i.host ? ` on ${i.host}` : ''}${i.command ? `, iqc ${i.command}` : ''}, started ${whenUTC(i.startedAt)}`

export function acquireLock(file, { command, out }) {
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
