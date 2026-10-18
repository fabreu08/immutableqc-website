// Immutable QC app: a lab folder's audit and a reviewer's sign-off (docs/build-notes/spec-addendum-agents.md, sections C
// and E), loaded only when a lab folder is dropped, a sign-off is signed, or the demo runs. engine.mjs reads, verifies
// and hashes; core's auditMany and planReview decide and write; nothing here reads the format itself.
import * as IQC from '../core/immutableqc.mjs'
import { readLedger, verify, prepareFilesSliced, hashList, yieldNow, TOOL } from './engine.mjs'

// A lab folder (locate kind 'lab'): every ledger read and verified, every file under each ledger's root (without the
// folders of the ledgers nested in it) re-read once, then core's auditMany over them all. opts: expectHeads, expectKeyIds,
// allowChanges, pinLines (as auditMany takes them). Returns {report, entries (for a re-audit with a reviewer ledger),
// located, unreadable, skipped, bytes, ms}.
export async function runAuditMany(located, { expectHeads, expectKeyIds, allowChanges, pinLines, onProgress, signal, pool, whole, slice } = {}) {
  const t0 = Date.now()
  const progress = { stage: 'ledger', started: t0, root: located.root, ledgerDone: 0, ledgerTotal: 0 }
  const entries = []
  let records = 0, problems = 0
  for (const d of located.found) {
    const bytes = await readLedger(d.item || { raw: d.ledgerPath, file: null })
    const one = { stage: 'ledger' }
    const verified = await verify(pool, bytes, { signal, progress: one, onProgress: (p) => { progress.ledgerDone = records + (p.ledgerDone || 0); progress.ledgerTotal = records + (p.ledgerTotal || 0); if (onProgress) onProgress(progress) } })
    records += verified.recordCount
    problems += verified.problems.length
    entries.push({ verified, root: d.root, files: null, ledgerPath: d.ledgerPath })
  }
  progress.ledgerDone = progress.ledgerTotal = progress.records = records
  progress.ledgerProblems = problems
  // each ledger's files, by its root; one list for the pool, keyed by the path in the dropped folder
  const all = [], skipped = []
  for (let li = 0; li < entries.length; li++) {
    const d = located.found[li]
    if (d.root === null) continue
    const pre = d.root === '' ? '' : d.root + '/'
    const nested = (d.nested || []).map((r) => r + '/')
    const mine = []
    for (const x of located.items) {
      if (pre && !x.raw.startsWith(pre)) continue
      const rel = x.raw.slice(pre.length)
      if (nested.some((n) => rel.startsWith(n))) continue
      mine.push({ raw: rel, file: x.file, size: x.size, modified: x.modified, error: x.error })
    }
    const prep = await prepareFilesSliced(mine, entries[li].verified.files, signal)
    for (const s of prep.skipped) skipped.push({ raw: pre + s.raw, why: s.why })
    for (const x of prep.list) all.push({ ...x, path: pre + x.path, rel: x.path, li })
  }
  const h = await hashList(pool, all, { onProgress, signal, whole, slice, progress })
  for (let li = 0; li < entries.length; li++) if (located.found[li].root !== null) entries[li].files = new Map()
  for (const x of all) entries[x.li].files.set(x.rel, h.files.get(x.path))
  progress.stage = 'audit'
  if (onProgress) onProgress(progress)
  await yieldNow()
  const report = IQC.auditMany(entries, { expectHeads, expectKeyIds, allowChanges, pinLines, where: 'browser', tool: TOOL, folder: located.root || undefined })
  return { report, entries, located, unreadable: h.unreadable, skipped, bytes: h.bytes, ms: Date.now() - t0 }
}

// ------------------------------------------------------------------------------------------- a reviewer's sign-off
// One review record (core's planReview), signed with `key` (the browser's, from KeyStore.current()), on a new reviewer
// ledger, or appended to `prior` ({text, verified}) when this browser already signed one in this session. Returns
// {text, verified, key}: the ledger to download as <name>.ledger.jsonl and to audit with the others.
export async function signReview({ key, prior = null, reviewer, subjects, decision, note, station = 'Browser', at }) {
  const item = IQC.planReview({ station, reviewer, subjects, decision, note, at })
  let prefix, verified
  if (prior) { prefix = prior.text; verified = prior.verified } else {
    const header = await IQC.createHeader({ station, privateKey: key.privateKey, publicKeyHex: key.publicKeyHex, agent: TOOL })
    prefix = IQC.serializeLine(header)
    verified = await IQC.verifyLedger(prefix)
  }
  const records = await IQC.createRecords({ head: verified.head, items: [item], privateKey: key.privateKey })
  const text = prefix + records.map((r) => IQC.serializeLine(r)).join('')
  return { text, verified: await IQC.verifyLedger(text), key }
}
