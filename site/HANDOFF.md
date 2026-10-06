# Redesign handoff (branch claude/new-session-wut618)

Status: step 3a is built at 3a4723c, and `node site/build.mjs --check` passes. Nothing is live.

## Founder decisions
- Path B (controlled document) with three things from A: the Fig. 2 record history, the ring-and-dot mark, and the rule that a changed value breaks only the link into the next record.
- The console is an in-browser demo with publishing removed.
- Filecoin Calibration is named once, on sealed.html. The FAQ asks "Do I need to buy or hold anything?". Contact goes through joseqc.com. The demo names stay.
- Privacy on public networks (salted commitments, then zero-knowledge proofs) is on the roadmap. The intelligence-explosion line appears exactly once.
- **New: anything that does not work yet is listed as an upcoming feature.** Present tense only for what works today: the fingerprint, the chain, the demo signatures, corrections with a reason, and the in-browser checks. This means:
  - Anchoring on a public test network moves to upcoming. Reword the Scope definition and every copy of it (pages, console, og card, asserts) so it no longer says "Batches can be anchored…" as a present fact; the simulated anchor stays labelled simulated.
  - Roadmap: replace "Reviewer sign-off and verification do not work yet" with upcoming items (reviewer sign-off, server-side verification, per-analyst signatures, and so on).
  - Update the joseqc.com replacement copy to match, if the founder applies it.

## Still open
- Should Pages deploy only the built output through GitHub Actions? Today /site/ templates are public.
- The founder to confirm these clauses: ISO/IEC 17025:2017 7.11.3 a) b) d); EU GMP Ch. 4, 4.9; TNI 2016 V1M2 4.13 and 5.8.

## Next, step 3b
1. Apply the new decision above.
2. Run five adversarial reviews: design/mobile/performance, a data-integrity auditor, a security and crypto engineer, a copy editor, and the audience (lab director and AI-agent builder).
3. Fix what they find, re-run --check and site/tools/check.mjs --perf, and push.
4. Ask the founder before anything goes live.
