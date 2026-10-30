// The review fixes in the agent: --ledger paired with the folder (CLI-1), pins and heads bound to ledgers (CLI-3,
// MCP-1, MISSED-15), the scanner's never-data rule (CLI-4), --station-key and --reviewer-key (CLI-6, HON-2, MISSED-6),
// outputs that stay out of ledger folders (MISSED-7), the trace from core's lineage summary (MISSED-9), steps with no
// inputs (MISSED-10), one role per ledger (CLI-12) and a linked ledger folder (MCP-2). End to end against both entries.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, rmSync, symlinkSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ENTRIES, FAST, workspace, put, run } from './_helpers.mjs'
import { parseHead } from '../../core/immutableqc.mjs'
import { parseArgs } from '../src/args.mjs'

const headerOf = (ledger) => JSON.parse(readFileSync(ledger, 'utf8').split('\n')[0])
const keyOf = (ledger) => headerOf(ledger).keyId
const idOf = (ledger) => headerOf(ledger).ledgerId
const recordsOf = (ledger) => readFileSync(ledger, 'utf8').split('\n').filter(Boolean).slice(1).map((l) => JSON.parse(l))
const L = (dir) => join(dir, 'ImmutableQC', 'ledger.jsonl')
const json = (r) => JSON.parse(r.stdout)

// a lab: st/ (a station that sealed plate.csv), ag/ (an agent root with copies), forge/ (a folder someone sealed with an
// invented file, with its own fresh key)
async function lab(entry) {
  const W = workspace()
  const lab = join(W.dir, 'lab')
  put(join(lab, 'st', 'plate.csv'), 'well,od\nA1,0.482\n')
  put(join(lab, 'forge', 'invented.csv'), 'well,od\nA1,9.999\n')
  put(join(lab, 'ag', 'in.csv'), 'well,od\nA1,0.482\n')
  put(join(lab, 'ag', 'invented.csv'), 'well,od\nA1,9.999\n')
  put(join(lab, 'ag', 'out.csv'), 'mean,1\n')
  put(join(lab, 'ag', 'scratch.txt'), 'not measured\n')
  for (const d of ['st', 'forge']) assert.equal((await run(entry, ['seal', join(lab, d), '--station', d, ...FAST], { home: W.home })).code, 0)
  return { ...W, lab, st: join(lab, 'st'), ag: join(lab, 'ag'), forge: join(lab, 'forge') }
}

const rec = (entry, W, args, o = {}) => run(entry, ['record', '--root', W.ag, '--search', W.lab, '--actor', 'bot', '--action', 'A step', ...args], { home: W.home, cwd: W.ag, ...o })
const stepRef = (ledger) => `${idOf(ledger)}:${recordsOf(ledger).filter((x) => x.kind === 'step')[0].n}`

for (const [name, entry] of ENTRIES) {
  describe(`review fixes in the agent (${name})`, { concurrency: false }, () => {
    test('CLI-1: --ledger is paired with the folder whatever its name or position; a ledger with no folder is never a pass', async () => {
      const W = workspace()
      try {
        put(join(W.data, 'a.csv'), 'a\n')
        put(join(W.data, 'b.csv'), 'b\n')
        const kept = join(W.dir, 'elsewhere', 'plate.ledger.jsonl')
        mkdirSync(join(W.dir, 'elsewhere'))
        assert.equal((await run(entry, ['seal', W.data, '--ledger', kept, ...FAST], { home: W.home })).code, 0)
        writeFileSync(join(W.data, 'a.csv'), 'AA\n')
        rmSync(join(W.data, 'b.csv'))
        const r = await run(entry, ['audit', W.data, '--ledger', kept], { home: W.home })
        assert.equal(r.code, 1, r.out)
        assert.match(r.stdout, /a\.csv changed since it was sealed/)
        assert.match(r.stdout, /b\.csv is missing/)
        // a reviewer's ledger first: the order of the --ledger options does not matter
        const rev = join(W.dir, 'elsewhere', 'rev.ledger.jsonl')
        assert.equal((await run(entry, ['review', `${idOf(kept)}:1`, '--reviewer', 'J. Rivera', '--decision', 'approved', '--ledger', rev, '--search', join(W.dir, 'elsewhere')], { home: W.home, cwd: W.dir })).code, 0)
        const two = await run(entry, ['audit', W.data, '--ledger', rev, '--ledger', kept], { home: W.home })
        assert.equal(two.code, 1, two.out)
        assert.match(two.stdout, /b\.csv is missing/)
        // a ledger kept inside the folder under a *.ledger.jsonl name is paired by what it holds
        rmSync(join(W.data, 'ImmutableQC'), { recursive: true, force: true })
        put(join(W.data, 'a.csv'), 'a\n')
        put(join(W.data, 'b.csv'), 'b\n')
        assert.equal((await run(entry, ['seal', W.data, '--ledger', join(W.data, 'records', 'plate.ledger.jsonl'), ...FAST], { home: W.home })).code, 0)
        writeFileSync(join(W.data, 'a.csv'), 'AA\n')
        const inside = await run(entry, ['audit', W.data], { home: W.home })
        assert.equal(inside.code, 1, inside.out)
        assert.match(inside.stdout, /a\.csv changed since it was sealed/)
        // the folder has its own ledger and a second station ledger is given: no folder to check it against
        put(join(W.dir, 'own', 'x.csv'), 'x\n')
        assert.equal((await run(entry, ['seal', join(W.dir, 'own'), ...FAST], { home: W.home })).code, 0)
        const none = await run(entry, ['audit', join(W.dir, 'own'), '--ledger', kept], { home: W.home })
        assert.equal(none.code, 3, none.out)
        assert.match(none.stdout, /seals 2 files, but no folder was checked against it/)
      } finally { W.cleanup() }
    })

    test('CLI-3, MCP-1, MISSED-15: a restarted ledger fails against the pin file and against the head iqc head prints', async () => {
      const W = workspace()
      try {
        put(join(W.data, 'plate-07.csv'), '0.482\n')
        const pins = join(W.dir, 'pins', 'p.pins')
        mkdirSync(join(W.dir, 'pins'))
        assert.equal((await run(entry, ['seal', W.data, '--pin-file', pins, ...FAST], { home: W.home })).code, 0)
        const h = await run(entry, ['head', W.data], { home: W.home })
        const line = h.stderr.split('\n').find((l) => l.includes('--expect-head')).trim()
        const id = idOf(L(W.data)), head = h.stdout.trim(), key = keyOf(L(W.data))
        assert.equal(line, `iqc audit ${W.data} --expect-head ${id}:${head} --expect-key ${key}`)
        // the printed line is accepted, and passes on the untouched folder
        const ok = await run(entry, ['audit', W.data, '--expect-head', `${id}:${head}`, '--expect-key', key, '--pin-file', pins], { home: W.home })
        assert.equal(ok.code, 0, ok.out)
        // restart: edit the file, delete ImmutableQC, seal again (a new key and a new ledger id)
        rmSync(join(W.data, 'ImmutableQC'), { recursive: true })
        writeFileSync(join(W.data, 'plate-07.csv'), '0.428\n')
        assert.equal((await run(entry, ['seal', W.data, ...FAST], { home: W.home })).code, 0)
        const bad = await run(entry, ['audit', W.data, '--pin-file', pins], { home: W.home })
        assert.equal(bad.code, 1, bad.out)
        assert.match(bad.stdout, /The pin file names ledger [0-9a-f]{32}/)
        const bad2 = await run(entry, ['audit', W.data, '--expect-head', `${id}:${head}`], { home: W.home })
        assert.equal(bad2.code, 1, bad2.out)
        // a head with no ledger id binds to the folder's own ledger: the restarted one does not hold it
        const bad3 = await run(entry, ['audit', W.data, '--expect-head', head], { home: W.home })
        assert.equal(bad3.code, 1, bad3.out)
        const usage = await run(entry, ['audit', W.data, '--expect-head', 'nonsense'], { home: W.home })
        assert.equal(usage.code, 2)
        assert.match(usage.stderr, /<ledger id>:<record number>:<64 hex link>/)
      } finally { W.cleanup() }
    })

    test('CLI-4: the scanner never seals an ImmutableQC folder or a *.ledger.jsonl, and an untouched lab folder does not fail', async () => {
      const W = await lab(entry)
      try {
        // the lab folder is itself a station: a reviewer's ledger and an agent workspace sit inside it
        const r1 = await rec(entry, W, ['--in', 'in.csv', '--out', 'out.csv'])
        assert.equal(r1.code, 0, r1.out)
        const rv = await run(entry, ['review', stepRef(L(W.ag)), '--reviewer', 'J. Rivera', '--decision', 'approved', '--search', W.lab], { home: W.home, cwd: W.lab })
        assert.equal(rv.code, 0, rv.out)
        for (let i = 0; i < 2; i++) assert.equal((await run(entry, ['seal', W.lab, '--station', 'lab', ...FAST], { home: W.home })).code, 0)
        const sealed = recordsOf(L(W.lab)).filter((x) => x.kind === 'file').map((x) => x.f.path)
        assert.ok(sealed.length >= 4, sealed.join())
        for (const p of sealed) assert.ok(!/ImmutableQC|\.ledger\.jsonl$/i.test(p), `${p} was sealed`)
        const a = await run(entry, ['audit', W.lab], { home: W.home })
        assert.notEqual(a.code, 1, a.out) // it failed before, with every sealed ledger "missing"
        assert.doesNotMatch(a.stdout, /is missing/)
        // status agrees with the seal
        const st = await run(entry, ['status', W.lab], { home: W.home })
        assert.match(st.stdout, /Nothing changed since the last seal/)
      } finally { W.cleanup() }
    })

    test('CLI-6, HON-2: --station-key decides which ledgers measure; without it the audit names the keys it counted', async () => {
      const W = await lab(entry)
      try {
        const real = keyOf(L(W.st))
        const r = await rec(entry, W, ['--in', 'in.csv', '--in', 'invented.csv', '--out', 'out.csv'])
        assert.equal(r.code, 0, r.out)
        // the forged station counts as measuring when no station key is listed, and the note says so
        const open = await run(entry, ['audit', W.lab, '--json', '-'], { home: W.home })
        const o = json(open)
        assert.ok(o.notes.some((n) => n.code === 'station-keys-not-listed'), JSON.stringify(o.notes))
        assert.equal(o.counts.untracedInputs, 0)
        // with the real station's key, the invented file is untraced: review, and the reason names the key
        const listed = await run(entry, ['audit', W.lab, '--station-key', real, '--json', '-'], { home: W.home })
        assert.equal(listed.code, 3, listed.stderr)
        const rep = json(listed)
        assert.equal(rep.counts.untracedInputs, 1)
        assert.match(JSON.stringify(rep.steps[0].inputs), /not a listed station key/)
        // a listed key that signs nothing is a problem; a bad key id is a usage error
        const ghost = await run(entry, ['audit', W.lab, '--station-key', real, '--station-key', '0123456789abcdef'], { home: W.home })
        assert.equal(ghost.code, 1, ghost.out)
        assert.match(ghost.stdout, /No audited ledger is signed with the station key 0123456789abcdef/)
        assert.equal((await run(entry, ['audit', W.lab, '--station-key', 'xyz'], { home: W.home })).code, 2)
        // trace and record take it too
        const tr = await run(entry, ['trace', 'invented.csv', '--search', W.lab, '--station-key', real], { home: W.home, cwd: W.ag })
        assert.equal(tr.code, 3, tr.out)
        assert.match(tr.stdout, /Untraced/)
        const ok = await run(entry, ['trace', 'in.csv', '--search', W.lab, '--station-key', real], { home: W.home, cwd: W.ag })
        assert.equal(ok.code, 0, ok.out)
        const r2 = await rec(entry, W, ['--in', 'invented.csv', '--out', 'out.csv', '--station-key', real, '--json', '-'])
        assert.equal(json(r2).untracedInputs, 1)
        // the key list is repeatable for --expect-key too (a lab has several keys)
        const keys = ['--expect-key', real, '--expect-key', keyOf(L(W.forge)), '--expect-key', keyOf(L(W.ag))]
        assert.equal((await run(entry, ['audit', W.lab, ...keys], { home: W.home })).code, 0)
        const some = await run(entry, ['audit', W.lab, '--expect-key', real], { home: W.home })
        assert.equal(some.code, 1, some.out)
        assert.match(some.stdout, /is signed with key [0-9a-f]{16}, which is not among the expected keys\. The keys found:/)
      } finally { W.cleanup() }
    })

    test('MISSED-6: --reviewer-key lists the keys whose approvals count', async () => {
      const W = await lab(entry)
      try {
        const r = await rec(entry, W, ['--out', 'out.csv']) // a step with no inputs is for review until a reviewer approves it
        assert.equal(r.code, 0, r.out)
        assert.equal((await run(entry, ['audit', W.lab], { home: W.home })).code, 3)
        const rv = await run(entry, ['review', stepRef(L(W.ag)), '--reviewer', 'J. Rivera', '--decision', 'approved', '--search', W.lab], { home: W.home, cwd: W.lab })
        assert.equal(rv.code, 0, rv.out)
        const rkey = keyOf(join(W.lab, 'j-rivera.ledger.jsonl'))
        const none = json(await run(entry, ['audit', W.lab, '--json', '-'], { home: W.home }))
        assert.ok(none.notes.some((n) => n.code === 'reviewer-keys-not-listed'))
        const other = await run(entry, ['audit', W.lab, '--reviewer-key', '0123456789abcdef', '--json', '-'], { home: W.home })
        assert.equal(other.code, 3, other.stderr)
        assert.ok(json(other).notes.some((n) => n.code === 'review-unlisted-key'))
        const mine = await run(entry, ['audit', W.lab, '--reviewer-key', rkey, '--json', '-'], { home: W.home })
        assert.equal(mine.code, 0, mine.stderr)
        assert.ok(!json(mine).notes.some((n) => /reviewer|review-unlisted/.test(n.code)))
        assert.equal((await run(entry, ['trace', 'in.csv', '--search', W.lab, '--reviewer-key', rkey], { home: W.home, cwd: W.ag })).code, 0)
      } finally { W.cleanup() }
    })

    test('MISSED-7: record refuses outputs in an ImmutableQC folder, a *.ledger.jsonl, or the folder of another ledger', async () => {
      const W = await lab(entry)
      try {
        put(join(W.ag, 'x.ledger.jsonl'), 'not a ledger\n')
        put(join(W.ag, 'sub', 'ImmutableQC', 'note.txt'), 'x\n')
        const wide = (args) => run(entry, ['record', '--root', W.lab, '--search', W.lab, '--actor', 'bot', '--action', 'a', '--in', 'ag/in.csv', ...args], { home: W.home, cwd: W.lab })
        for (const [out, why] of [['ag/x.ledger.jsonl', /one of the ledger's own files/], ['ag/sub/ImmutableQC/note.txt', /one of the ledger's own files/], ['st/plate.csv', /has its own ledger/]]) {
          const r = await wide(['--out', out])
          assert.equal(r.code, 2, `${out}: ${r.out}`)
          assert.match(r.stderr, why)
        }
        assert.ok(!existsSync(L(W.lab)), 'nothing was written')
        // an input in another station's folder is fine: that is how an agent reads a measured file
        const ok = await wide(['--out', 'ag/in.csv'])
        assert.equal(ok.code, 0, ok.out)
      } finally { W.cleanup() }
    })

    test('MISSED-9: trace decides from core\'s lineage summary, not the display tree (250 measured inputs and one invented)', async () => {
      const W = workspace()
      try {
        const lab = join(W.dir, 'lab')
        const args = []
        for (let i = 0; i < 205; i++) {
          put(join(lab, 'st', `f${String(i).padStart(3, '0')}.csv`), `v,${i}\n`)
          put(join(lab, 'ag', `f${String(i).padStart(3, '0')}.csv`), `v,${i}\n`)
          args.push('--in', `f${String(i).padStart(3, '0')}.csv`)
        }
        put(join(lab, 'ag', 'zz-invented.csv'), 'made up\n')
        assert.equal((await run(entry, ['seal', join(lab, 'st'), '--station', 'st', ...FAST], { home: W.home })).code, 0)
        put(join(lab, 'ag', 'summary.csv'), 'mean,1\n')
        const r = await run(entry, ['record', '--root', join(lab, 'ag'), '--search', lab, '--actor', 'bot', '--action', 'Averaged', ...args, '--in', 'zz-invented.csv', '--out', 'summary.csv', '--json', '-'], { home: W.home, cwd: join(lab, 'ag') })
        assert.equal(r.code, 0, r.stderr)
        assert.equal(json(r).untracedInputs, 1)
        const t = await run(entry, ['trace', 'summary.csv', '--search', lab, '--json', '-'], { home: W.home, cwd: join(lab, 'ag') })
        assert.equal(t.code, 3, t.stderr)
        const d = json(t)
        assert.equal(d.tracesToMeasured, false)
        assert.equal(d.untracedInputs, 1)
        assert.equal(d.measuredFiles, 200)
      } finally { W.cleanup() }
    })

    test('MISSED-10: a step with no inputs is flagged when recorded, traces to nothing measured, and is listed for review', async () => {
      const W = await lab(entry)
      try {
        put(join(W.ag, 'standard.csv'), 'invented curve\n')
        put(join(W.ag, 'result.csv'), 'result\n')
        const a = await rec(entry, W, ['--out', 'standard.csv', '--json', '-'])
        assert.equal(a.code, 0, a.out)
        assert.equal(json(a).noInputs, true)
        assert.match(json(a).warning, /names no inputs/)
        const b = await rec(entry, W, ['--in', 'in.csv', '--in', 'standard.csv', '--out', 'result.csv', '--json', '-'])
        assert.equal(b.code, 0, b.out)
        assert.match(json(b).warning, /step on the way recorded no inputs/)
        const t = await run(entry, ['trace', 'result.csv', '--search', W.lab, '--json', '-'], { home: W.home, cwd: W.ag })
        assert.equal(t.code, 3, t.stdout)
        assert.equal(json(t).tracesToMeasured, false)
        assert.equal(json(t).noInputsOnTheWay, true)
        const au = await run(entry, ['audit', W.lab], { home: W.home })
        assert.equal(au.code, 3, au.out)
        assert.match(au.stdout, /names no inputs/)
      } finally { W.cleanup() }
    })

    test('CLI-12: record refuses a station\'s ledger, seal refuses an agent\'s, review refuses both', async () => {
      const W = await lab(entry)
      try {
        const before = readFileSync(L(W.st), 'utf8')
        const r = await run(entry, ['record', '--root', W.st, '--actor', 'bot', '--action', 'a', '--in', 'plate.csv', '--out', 'plate.csv'], { home: W.home, cwd: W.st })
        assert.equal(r.code, 1, r.out)
        assert.match(r.stderr, /belongs to station st/)
        assert.equal(readFileSync(L(W.st), 'utf8'), before)
        assert.equal((await rec(entry, W, ['--in', 'in.csv', '--out', 'in.csv'])).code, 0)
        const s = await run(entry, ['seal', W.ag, ...FAST], { home: W.home })
        assert.equal(s.code, 1, s.out)
        assert.match(s.stderr, /holds agent steps/)
        const rv = await run(entry, ['review', `${idOf(L(W.st))}:1`, '--reviewer', 'X', '--decision', 'approved', '--ledger', L(W.st), '--search', W.lab], { home: W.home, cwd: W.lab })
        assert.equal(rv.code, 1, rv.out)
        assert.match(rv.stderr, /reviewer's own ledger/)
        assert.equal(readFileSync(L(W.st), 'utf8'), before)
      } finally { W.cleanup() }
    })

    test('MCP-2: record and mcp refuse a symbolic link in place of the ledger folder', async () => {
      const W = await lab(entry)
      try {
        const target = join(W.dir, 'elsewhere')
        mkdirSync(target)
        try { symlinkSync(target, join(W.ag, 'ImmutableQC')) } catch { return } // no symbolic links here
        const r = await rec(entry, W, ['--in', 'in.csv', '--out', 'invented.csv'])
        assert.equal(r.code, 2, r.out)
        assert.match(r.stderr, /symbolic link or a junction/)
        const m = await run(entry, ['mcp', '--root', W.ag], { home: W.home, cwd: W.ag, input: '' })
        assert.equal(m.code, 2, m.out)
        assert.deepEqual(readdirSync(target), [])
      } finally { W.cleanup() }
    })
  })
}

test('args: --station-key, --reviewer-key, --expect-key and --expect-head are lists; heads may name their ledger', () => {
  const id = 'ab'.repeat(16), h = 'cd'.repeat(32)
  const a = parseArgs(['audit', '--station-key', 'C5E3895EADB5EDB4', '--station-key=0123456789abcdef', '--reviewer-key', '0123456789ABCDEF', '--expect-key', 'c5e3895eadb5edb4', '--expect-key', '0123456789abcdef', '--expect-head', `${id}:3:${h}`, '--expect-head', `4:${h}`])
  assert.deepEqual(a.opts['station-key'], ['c5e3895eadb5edb4', '0123456789abcdef'])
  assert.deepEqual(a.opts['reviewer-key'], ['0123456789abcdef'])
  assert.deepEqual(a.opts['expect-key'], ['c5e3895eadb5edb4', '0123456789abcdef'])
  assert.deepEqual(a.opts['expect-head'], [{ ledgerId: id, n: 3, h }, { ledgerId: null, n: 4, h }])
  assert.deepEqual(parseHead(`3:${h}`), { n: 3, h })
  for (const bad of [['--station-key', 'abc'], ['--reviewer-key', 'zzzzzzzzzzzzzzzz'], ['--expect-key', ''], ['--expect-head', `${id}:x:${h}`]]) assert.throws(() => parseArgs(['audit', ...bad]), /./)
  for (const c of ['trace', 'mcp']) assert.deepEqual(parseArgs([c, ...(c === 'trace' ? ['f.csv'] : []), '--station-key', '0123456789abcdef', '--reviewer-key', '0123456789abcdef']).opts['reviewer-key'], ['0123456789abcdef'])
  assert.deepEqual(parseArgs(['record', '--actor', 'a', '--action', 'b', '--out', 'x', '--station-key', '0123456789abcdef']).opts['station-key'], ['0123456789abcdef'])
  assert.throws(() => parseArgs(['seal', '--station-key', '0123456789abcdef']), /is an option of/)
})
