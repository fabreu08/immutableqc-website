// iqc record, trace, review, the lab-wide audit (discovery, --allow-changes, --pin-file, --ledger) and the defaults
// they share, end to end against both entries, on a copy of core's lab fixture (core/test/fixtures/lab).
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, cpSync, symlinkSync, mkdirSync, utimesSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ENTRIES, REPO, workspace, put, run } from './_helpers.mjs'
import { verifyLedger } from '../../core/immutableqc.mjs'

const LAB = join(REPO, 'core', 'test', 'fixtures', 'lab')
const EXPECTED = JSON.parse(readFileSync(join(REPO, 'core', 'test', 'fixtures', 'expected-lab.json'), 'utf8'))
const lines = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean)
const recsOf = (f) => lines(f).slice(1).map((l) => JSON.parse(l))

// a copy of the lab, plus agent-2/: a new agent root holding a copy of a measured file (bio-line-2/plate-07.csv)
function lab() {
  const W = workspace()
  const L = join(W.dir, 'lab')
  cpSync(LAB, L, { recursive: true })
  mkdirSync(join(L, 'agent-2'))
  writeFileSync(join(L, 'agent-2', 'in.csv'), readFileSync(join(L, 'bio-line-2', 'plate-07.csv')))
  writeFileSync(join(L, 'agent-2', 'out.csv'), 'mean,1\n')
  writeFileSync(join(L, 'agent-2', 'scratch.txt'), 'not measured\n')
  return { ...W, lab: L, a2: join(L, 'agent-2') }
}

for (const [name, entry] of ENTRIES) {
  describe(`iqc steps (${name})`, { concurrency: false }, () => {
    test('audit: finds every ledger of the lab fixture; pass, with core\'s summary; --json kind many', async () => {
      const W = lab()
      try {
        const r = await run(entry, ['audit', LAB], { home: W.home })
        assert.equal(r.code, 0, r.out)
        assert.equal(EXPECTED.verdict, 'pass')
        assert.ok(r.stdout.startsWith(`PASS  ${EXPECTED.summary.replace(/^Pass: /, '').replace(/^./, (c) => c.toUpperCase())}`), r.stdout)
        for (const l of ['agent-workspace/ImmutableQC/ledger.jsonl', 'bio-line-2/ImmutableQC/ledger.jsonl', 'hplc-3/ImmutableQC/ledger.jsonl', 'reviews/j-rivera.ledger.jsonl']) assert.match(r.stdout, new RegExp(l.replace(/\./g, '\\.')))
        const j = await run(entry, ['audit', LAB, '--json', '-'], { home: W.home })
        assert.equal(j.code, 0, j.stderr)
        const rep = JSON.parse(j.stdout)
        assert.equal(rep.kind, 'many')
        assert.equal(rep.verdict, 'pass')
        assert.equal(rep.summary, EXPECTED.summary)
        assert.equal(rep.ledgers.length, 4)
        // one ledger given with --ledger: the reviewer ledger, from outside the folder audited
        const one = await run(entry, ['audit', join(LAB, 'hplc-3'), '--ledger', join(LAB, 'reviews', 'j-rivera.ledger.jsonl')], { home: W.home })
        assert.ok([0, 3].includes(one.code), one.out)
        assert.match(one.stdout, /j-rivera\.ledger\.jsonl: reviewer/)
        // --ledger twice on another command is a usage error
        const two = await run(entry, ['seal', W.data, '--ledger', 'a.jsonl', '--ledger', 'b.jsonl'], { home: W.home })
        assert.equal(two.code, 2)
        assert.match(two.stderr, /Only iqc audit takes more than one ledger/)
        const none = await run(entry, ['audit', W.data, '--ledger', join(W.dir, 'nope.ledger.jsonl')], { home: W.home })
        assert.equal(none.code, 2)
      } finally { W.cleanup() }
    })

    test('trace: derived back to measured files (0), untraced (3), missing file and symlink (2)', async () => {
      const W = lab()
      try {
        const r = await run(entry, ['trace', 'agent-workspace/report/summary.md'], { home: W.home, cwd: W.lab })
        assert.equal(r.code, 0, r.out)
        assert.match(r.stdout, /Derived: it traces to 3 measured files\./)
        assert.match(r.stdout, /inputs\/plate-07\.csv .* measured on bio-line-2/)
        const m = await run(entry, ['trace', join(W.lab, 'agent-2', 'in.csv'), '--search', W.lab, '--json', '-'], { home: W.home })
        assert.equal(m.code, 0, m.out)
        const d = JSON.parse(m.stdout)
        assert.equal(d.state, 'measured')
        assert.equal(d.measured.station, 'bio-line-2')
        const u = await run(entry, ['trace', 'agent-2/scratch.txt'], { home: W.home, cwd: W.lab })
        assert.equal(u.code, 3, u.out)
        assert.match(u.stdout, /^Untraced: /m)
        const x = await run(entry, ['trace', 'agent-2/nope.txt'], { home: W.home, cwd: W.lab })
        assert.equal(x.code, 2)
        try {
          symlinkSync(join(W.lab, 'agent-2', 'in.csv'), join(W.lab, 'agent-2', 'link.csv'))
          const s = await run(entry, ['trace', 'agent-2/link.csv'], { home: W.home, cwd: W.lab })
          assert.equal(s.code, 2)
          assert.match(s.stderr, /symbolic link/)
        } catch (e) { if (e.code !== 'EPERM') throw e }
        const two = await run(entry, ['trace', 'a', 'b'], { home: W.home })
        assert.equal(two.code, 2)
      } finally { W.cleanup() }
    })

    test('record: a signed step in the root\'s ledger, inputs traced; paths confined to the root; field errors are usage errors', async () => {
      const W = lab()
      try {
        const r = await run(entry, ['record', '--actor', 'analyst-bot', '--tool', 'model-x', '--action', 'Averaged plate 07', '--in', 'in.csv', '--in', 'scratch.txt', '--out', 'out.csv', '--search', '..', '--json', join(W.dir, 'rec.json')], { home: W.home, cwd: W.a2 })
        assert.equal(r.code, 0, r.out)
        assert.match(r.stdout, /Recorded step 1 in ImmutableQC\/ledger\.jsonl: analyst-bot \(model-x\): Averaged plate 07/)
        assert.match(r.stdout, /measured +in\.csv/)
        assert.match(r.stderr, /warning {2}1 input matches no sealed measurement/)
        const j = JSON.parse(readFileSync(join(W.dir, 'rec.json'), 'utf8'))
        assert.equal(j.record, 1)
        assert.equal(j.reference, `${j.ledger.ledgerId}:1:${j.link}`)
        assert.deepEqual(j.inputs.map((x) => x.state), ['measured', 'untraced'])
        assert.equal(j.untracedInputs, 1)
        const ledger = join(W.a2, 'ImmutableQC', 'ledger.jsonl')
        const v = await verifyLedger(readFileSync(ledger))
        assert.equal(v.ok, true)
        assert.equal(v.kinds.step, 1)
        const rec = recsOf(ledger)[0]
        assert.equal(rec.kind, 'step')
        assert.equal(rec.f.actor, 'analyst-bot')
        assert.match(rec.f.inputs, /^[0-9a-f]{64}:48:in\.csv,[0-9a-f]{64}:13:scratch\.txt$/)
        assert.match(readFileSync(join(W.a2, 'ImmutableQC', 'README.txt'), 'utf8'), /what an agent did in this folder/)
        // the trace of the new output: derived, with one untraced input -> 3
        const t = await run(entry, ['trace', 'agent-2/out.csv'], { home: W.home, cwd: W.lab })
        assert.equal(t.code, 3, t.out)
        assert.match(t.stdout, /not every input on the way traces to a measurement/)
        // refused: outside the root, an absolute path elsewhere, a symlink, the ledger itself, a folder
        const bad = [['--out', '../bio-line-2/plate-07.csv', /outside the root/], ['--out', join(W.lab, 'hplc-3', 'run-0914', 'injection-01.csv'), /outside the root/],
          ['--out', 'ImmutableQC/ledger.jsonl', /ledger's own files/], ['--out', '.', /outside the root|not a file/], ['--out', 'nope.csv', /No output at/]]
        let linked = false
        try { symlinkSync(join(W.lab, 'bio-line-2'), join(W.a2, 'linked')); linked = true } catch { /* no symlinks */ }
        if (linked) bad.push(['--out', 'linked/plate-07.csv', /linked folder/], ['--out', 'linked', /symbolic link/])
        for (const [o, p, re] of bad) {
          const b = await run(entry, ['record', '--actor', 'a', '--action', 'b', o, p], { home: W.home, cwd: W.a2 })
          assert.equal(b.code, 2, `${p}: ${b.out}`)
          assert.match(b.stderr, re, p)
        }
        for (const args of [['--action', 'b', '--out', 'out.csv'], ['--actor', 'a', '--out', 'out.csv'], ['--actor', 'a', '--action', 'b'], ['--actor', 'a', '--action', 'b|c', '--out', 'out.csv'],
          ['--actor', 'a', '--action', 'b', '--out', 'out.csv', '--in-ref', 'zz'], ['--actor', 'a', '--action', 'b', '--out', 'out.csv', 'extra-folder']]) {
          const b = await run(entry, ['record', ...args], { home: W.home, cwd: W.a2 })
          assert.equal(b.code, 2, `${args.join(' ')}: ${b.out}`)
        }
        // nothing more was written by the refused calls
        assert.equal(recsOf(ledger).length, 1)
        // --in-ref: an input that is not a file under the root
        const ref = `${'a'.repeat(64)}:12:outside%2Cvalue.csv`
        const r2 = await run(entry, ['record', '--root', W.a2, '--actor', 'a', '--action', 'b', '--in-ref', ref, '--out', join(W.a2, 'out.csv')], { home: W.home })
        assert.equal(r2.code, 0, r2.out)
        assert.equal(recsOf(ledger)[1].f.inputs, ref)
      } finally { W.cleanup() }
    })

    test('review: a reviewer ledger the audit reads (question -> review); a wrong link is refused (1), an unknown ledger without its link (2)', async () => {
      const W = lab()
      try {
        const r = await run(entry, ['record', '--actor', 'bot', '--action', 'Averaged plate 07', '--in', 'in.csv', '--out', 'out.csv', '--search', '..', '--json', '-'], { home: W.home, cwd: W.a2 })
        assert.equal(r.code, 0, r.out)
        const j = JSON.parse(r.stdout)
        const before = await run(entry, ['audit', W.lab], { home: W.home })
        assert.equal(before.code, 0, before.out) // a step awaiting review is not, by itself, an item for review (core's rule)
        const bad = await run(entry, ['review', `${j.ledger.ledgerId}:1:${'b'.repeat(64)}`, '--reviewer', 'J. Doe', '--decision', 'approved'], { home: W.home, cwd: W.lab })
        assert.equal(bad.code, 1, bad.out)
        assert.match(bad.stderr, /is not the record that reference named/)
        const unknown = await run(entry, ['review', `${'c'.repeat(32)}:1`, '--reviewer', 'J. Doe', '--decision', 'approved'], { home: W.home, cwd: W.lab })
        assert.equal(unknown.code, 2, unknown.out)
        for (const args of [['--reviewer', 'J. Doe', '--decision', 'ok', `${j.ledger.ledgerId}:1`], ['--decision', 'approved', `${j.ledger.ledgerId}:1`], ['--reviewer', 'J. Doe', '--decision', 'approved'], ['--reviewer', 'J. Doe', '--decision', 'approved', 'not-a-ref'], ['--reviewer', 'J. Doe', '--decision', 'approved', `${j.ledger.ledgerId}:9`]]) {
          const b = await run(entry, ['review', ...args], { home: W.home, cwd: W.lab })
          assert.ok(b.code === 2 || b.code === 1, `${args.join(' ')}: ${b.out}`)
        }
        assert.equal(existsSync(join(W.lab, 'j-doe.ledger.jsonl')), false)
        const ok = await run(entry, ['review', `${j.ledger.ledgerId}:1`, '--reviewer', 'J. Doe', '--decision', 'question', '--note', 'Check the blank'], { home: W.home, cwd: W.lab })
        assert.equal(ok.code, 0, ok.out)
        assert.match(ok.stdout, /Recorded review 1 in j-doe\.ledger\.jsonl: question by J\. Doe/)
        const rv = recsOf(join(W.lab, 'j-doe.ledger.jsonl'))[0]
        assert.equal(rv.kind, 'review')
        assert.equal(rv.f.subjects, `${j.ledger.ledgerId}:1:${j.link}`)
        const after = await run(entry, ['audit', W.lab, '--json', '-'], { home: W.home })
        assert.equal(after.code, 3, after.stderr)
        const rep = JSON.parse(after.stdout)
        assert.equal(rep.verdict, 'review')
        assert.equal(rep.counts.stepsQuestion, 1)
        const ap = await run(entry, ['review', `${j.ledger.ledgerId}:1:${j.link}`, '--reviewer', 'J. Doe', '--decision', 'approved'], { home: W.home, cwd: W.lab })
        assert.equal(ap.code, 0, ap.out)
        const fin = await run(entry, ['audit', W.lab], { home: W.home })
        assert.equal(fin.code, 0, fin.out)
      } finally { W.cleanup() }
    })

    test('--allow-changes, --pin-file (seal pins each batch; audit checks the pins), the 10 s default settle', async () => {
      const W = workspace()
      try {
        put(join(W.data, 'a.csv'), 'one\n')
        put(join(W.data, 'b.csv'), 'two\n')
        const pins = join(W.dir, 'pins.txt')
        let r = await run(entry, ['seal', W.data, '--settle', '0', '--pin-file', pins], { home: W.home })
        assert.equal(r.code, 0, r.out)
        put(join(W.data, 'a.csv'), 'one, changed\n')
        const t = new Date(Date.now() + 5000)
        utimesSync(join(W.data, 'a.csv'), t, t)
        r = await run(entry, ['seal', W.data, '--settle', '0', '--pin-file', pins], { home: W.home })
        assert.equal(r.code, 0, r.out)
        const pl = lines(pins)
        assert.ok(pl.length >= 2, pl.join('\n'))
        for (const l of pl) assert.match(l, /^immutableqc-head [0-9a-f]{32} \d+:[0-9a-f]{64} \d{4}-\d\d-\d\dT/)
        const plain = await run(entry, ['audit', W.data], { home: W.home })
        assert.equal(plain.code, 3, plain.out)
        assert.match(plain.stdout, /changed after it was first sealed/)
        const allowed = await run(entry, ['audit', W.data, '--allow-changes', '*.csv'], { home: W.home })
        assert.equal(allowed.code, 0, allowed.out)
        const pinned = await run(entry, ['audit', W.data, '--allow-changes', 'a.csv', '--pin-file', pins], { home: W.home })
        assert.equal(pinned.code, 0, pinned.out)
        assert.match(pinned.stdout, new RegExp(`${pl.length} pin lines checked, all matching`))
        const bad = join(W.dir, 'bad.txt')
        writeFileSync(bad, pl[0].replace(/:[0-9a-f]{64}/, `:${'b'.repeat(64)}`) + '\n')
        const failed = await run(entry, ['audit', W.data, '--allow-changes', 'a.csv', '--pin-file', bad], { home: W.home })
        assert.equal(failed.code, 1, failed.out)
        assert.match(failed.stdout, /^FAIL /)
        const missing = await run(entry, ['audit', W.data, '--pin-file', join(W.dir, 'none.txt')], { home: W.home })
        assert.equal(missing.code, 2)
        const nofolder = await run(entry, ['seal', W.data, '--pin-file', join(W.dir, 'no', 'p.txt')], { home: W.home })
        assert.equal(nofolder.code, 2)
        // a pin file inside the data folder is the agent's own file: never sealed
        r = await run(entry, ['seal', W.data, '--settle', '0', '--pin-file', join(W.data, 'pins.txt')], { home: W.home })
        assert.equal(r.code, 0, r.out)
        assert.ok(!readFileSync(join(W.data, 'ImmutableQC', 'ledger.jsonl'), 'utf8').includes('"pins.txt"'))
        const h = await run(entry, ['help', 'watch'], { home: W.home })
        assert.match(h.stdout, /--settle <s> \(10\)/)
      } finally { W.cleanup() }
    })
  })
}
