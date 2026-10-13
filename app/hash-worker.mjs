// Immutable QC app: the background worker (docs/product-v1.md, section 5). The page runs a few of these (engine.mjs,
// class Pool) so that reading and fingerprinting files, and checking the ledger's signatures, never block the page.
//
// Messages in (one job at a time per worker; every reply carries the job's id):
//   {id, op: 'hash', files: [{i, file}], whole, slice}
//       The SHA-256 of each File (or Blob), in order. A file up to `whole` bytes (256 MiB) is read at once and hashed with
//       the platform's SHA-256 (crypto.subtle.digest); a larger one is read in `slice`-byte pieces (8 MiB) into core's
//       incremental Sha256, so a multi-gigabyte file never has to fit in memory. A file that cannot be read gives
//       {i, error} and the job goes on with the next one.
//   {id, op: 'verify', pub, items: [{h, sig}]}
//       core's verifyLinks: one boolean per signature (the worker side of verifyLedger's verifyBatch).
// Messages out:
//   {id, type: 'tick', bytes, files, cur: {i, done, size, k, n}}   progress inside a hash job, at most every 80 ms
//                                                                  (k of n slices of file i, `done` bytes of it read)
//   {id, type: 'done', res}       res: [{i, sha256, at} | {i, error}] for a hash job; [boolean] for a verify job
//   {id, type: 'error', error}    the job failed as a whole (the page shows the message)
import { Sha256, toHex, verifyLinks } from '../core/immutableqc.mjs'

const WHOLE = 256 * 1024 * 1024
const SLICE = 8 * 1024 * 1024
const TICK_MS = 80
const PARALLEL = 8 // small files read at once in one job: reading a file is mostly waiting for the disk

const describe = (e) => {
  const name = e && e.name ? e.name : 'Error'
  const msg = e && e.message ? e.message : String(e)
  return name === 'Error' || msg.startsWith(name) ? msg : `${name}: ${msg}`
}

async function hashOne(file, whole, slice, tick) {
  const size = file.size
  if (size <= whole) {
    const buf = await file.arrayBuffer()
    if (buf.byteLength !== size) throw new Error(`the file changed while it was read (${buf.byteLength} bytes read, ${size} expected)`)
    const d = await crypto.subtle.digest('SHA-256', buf)
    tick(size, 1, 1)
    return toHex(new Uint8Array(d))
  }
  const h = new Sha256()
  const n = Math.ceil(size / slice)
  let read = 0
  for (let k = 0; k < n; k++) {
    const end = Math.min(size, (k + 1) * slice)
    const part = new Uint8Array(await file.slice(k * slice, end).arrayBuffer())
    if (part.length !== end - k * slice) throw new Error('the file changed while it was read (a slice came back short)')
    h.update(part)
    read = end
    tick(read, k + 1, n)
  }
  return h.hex()
}

async function hashJob(m) {
  const whole = Number.isFinite(m.whole) && m.whole >= 0 ? m.whole : WHOLE
  const slice = Number.isFinite(m.slice) && m.slice >= 64 ? Math.floor(m.slice / 64) * 64 : SLICE
  const list = m.files
  const res = new Array(list.length)
  let bytes = 0, files = 0, last = 0, next = 0
  const one = async () => {
    while (next < list.length) {
      const k0 = next++
      const { i, file } = list[k0]
      const size = file.size
      const tick = (done, k, n) => {
        const now = Date.now()
        if (now - last < TICK_MS && k < n) return
        last = now
        postMessage({ id: m.id, type: 'tick', bytes: bytes + done, files, cur: { i, done, size, k, n } })
      }
      try {
        res[k0] = { i, sha256: await hashOne(file, whole, slice, tick), at: Date.now() }
      } catch (e) {
        res[k0] = { i, error: describe(e) }
      }
      bytes += size
      files++
    }
  }
  // one large file at a time (its memory), several small ones together
  const width = list.length > 1 && list.every((x) => x.file.size <= 4 * 1024 * 1024) ? PARALLEL : 1
  await Promise.all(Array.from({ length: Math.min(width, list.length) }, one))
  return res
}

onmessage = async (e) => {
  const m = e.data || {}
  try {
    if (m.op === 'hash') postMessage({ id: m.id, type: 'done', res: await hashJob(m) })
    else if (m.op === 'verify') postMessage({ id: m.id, type: 'done', res: await verifyLinks(m.pub, m.items) })
    else postMessage({ id: m.id, type: 'error', error: `unknown job "${m.op}"` })
  } catch (err) {
    postMessage({ id: m.id, type: 'error', error: describe(err) })
  }
}
