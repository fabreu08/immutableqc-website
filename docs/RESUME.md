# Resume: repositioning for automated research labs (paused 2026-10-07)

The founder paused this to switch models. State on branch `claude/new-session-wut618`:

- `docs/architecture-and-threat-model.md`: the brief. Its writer finished or nearly finished; read it and check it against the brief below (every claim labelled Works today / Upcoming; standards by number; no employer name).
- Site sources under `site/` and the rebuilt root pages: PARTIALLY changed by a site builder that was stopped mid-work. Treat the working tree as a draft. Run `node site/build.mjs --check` first; if it fails, finish the changes rather than reverting them (the brief below says what the end state is).
- Not reviewed yet: the planned review (accuracy: auditor + crypto; copy + design) and fix pass did not run.
- Nothing from this work is live. `main` is the live site. Merge only through a PR after `node site/build.mjs --check` and `node site/tools/check.mjs --perf` pass and the founder says go.

Next steps, in order:
1. `node site/build.mjs --check`; fix until it passes. Then `node site/tools/check.mjs --perf`.
2. Finish every site change in the brief that is still missing; keep every lint and extend them for the new copy.
3. Review (accuracy; copy and design) and fix.
4. Commit, push the branch, open a PR, show the founder the brief and screenshots, wait for go.

The founder's standing rules are in `site/HANDOFF.md`. Never name the founder's employer.

---

# Repositioning: Immutable QC for automated research labs

## Context
- Repo: `/home/user/immutableqc-website`, branch `claude/new-session-wut618`, reset to `main` (07188a5, the live site).
- Read `site/HANDOFF.md` and how `site/build.mjs`, `site/data/site.json`, `site/pages/*.html`, `site/partials/*.html` and the lints work before changing anything.
- Every existing rule, lint and assert stays. Never weaken one. Extend them for new copy. If a lint blocks a word the founder asked for, find wording that stays true without it (the banned list exists for a reason).
- Never name the founder's employer. Never run git commit/push/checkout/reset.
- Scratch files go under `/tmp/claude-0/-home-user/c61feb86-006d-513c-a18e-742ba4538b41/scratchpad/reposition/<role>/`.
- Local Playwright: require('/opt/node22/lib/node_modules/playwright') or site/node_modules; Chromium at /opt/pw-browsers. Never run `playwright install`.

## The founder's decisions (today)
1. **Audience:** automated research labs first: biotechnology, microbiology, chemistry and materials science (self-driving labs, robotic workcells, cloud labs, AI-first research companies, CROs that hand automated data to clients). Regulated QC labs stay as the expansion path, not the opening. The founder's own background is materials science, chemistry and microbiology.
2. **Why now:** results arrive faster than people can review them, and models train on them and choose the next experiment. The founder's line stays, once per site: "In an intelligence explosion, human review can't keep up with every result; records have to verify themselves."
3. **Risks are mostly not malicious.** Lead with that. Most bad data comes from a script that "fixed" units, a sync conflict, a crash halfway through a write, a backup restored from last week, a migration that rounded values, an outage, or a model that filled in a blank. One wrong value snowballs: it feeds an analysis, the analysis feeds a model, the model picks the next experiment. Sabotage and espionage are the minority case the same machinery covers; name them once, plainly, as a risk to discuss with a lab, and say what is and is not covered.
4. **Two new concepts** (both Upcoming; neither exists in code):
   - **Measured vs. derived records.** Only records sealed at capture by the instrument or orchestrator's key count as measured. Anything an agent, script or analysis produces is a derived record under a different signer, and must cite the fingerprints of the sealed records it came from. A number an agent gives either traces back to a measurement or it does not; one that does not is flagged before use. This is the defense against a hallucinated or invented value, which hashing alone cannot catch (a hash shows a record has not changed since sealing, not that it was ever measured).
   - **Lineage and recall.** Because derived records cite their inputs, records form a lineage graph. When a measurement is found wrong and corrected, its reach is computable in one step: every analysis, model and decision that used it, and which agents must re-check. A data recall, like an out-of-specification investigation's impact assessment, but automatic.
5. **Sealing at capture becomes the main integration** (Upcoming): in an automated lab, software already sits between instrument and record (the scheduler/orchestrator, SiLA 2 or OPC UA LADS device drivers, the data pipeline). Sealing each result there, when it is produced, is the plan. Name SiLA 2 and OPC UA LADS as the standards to integrate with; name no vendors (vendor names are banned).
6. **Storage tiers** (Upcoming): anchor only (default); an encrypted archive on Filecoin, encrypted in the lab before upload with keys that stay in the lab (content addressing lets anyone who fetches a copy check it is the one captured; storage deals must be renewed; it is not "permanent" or "unchangeable"); or the lab's own storage. Filecoin never holds readable results.
7. **Merkle trees** (Upcoming): one 32-byte root commits to a whole run; inclusion proofs let a lab show one result belongs to an anchored batch without revealing the others (selective disclosure); every leaf is salted (this is the existing "salted commitments" item); the standard RFC 9162-style construction with domain separation, not the console's old odd-leaf flaw. Prior art: Certificate Transparency and Sigstore's Rekor. Do not use the word "proofs" except in the allowed phrase "zero-knowledge proofs"; say "inclusion checks" or "a short path of hashes that shows a record is in the batch".
8. **Post-quantum path** (Upcoming, long term): SHA-256 and Merkle trees hold up; ECDSA P-256 signatures are the part a future quantum computer breaks. Build algorithm agility now (an algorithm id on every signature), then hybrid signatures (ECDSA plus ML-DSA, NIST FIPS 204) or SLH-DSA (FIPS 205, hash-based, a natural fit); re-anchor old records under stronger algorithms as long-term archive standards do (RFC 4998). Encryption of anything stored publicly is not long term: harvest-now-decrypt-later means AES-256 for data and ML-KEM (FIPS 203) to wrap keys from the first encrypted archive.
9. **Wording rules.** "Can't be changed", "trustless", "immutable" (as a property), "guarantee", "proof" (except zero-knowledge proofs), "compliant/compliance" and "crypto" are banned on the site by the build. Use "tamper-evident", "a later change shows", "you do not have to trust us, or any single party". Present tense only for what works today; everything else is "Upcoming". Lab vocabulary, plain sentences, US spelling, no hype.
10. **Contact:** the site stays contact-via-joseqc.com. Do not add an email address (the build forbids it).

## What works today (unchanged; do not overclaim)
- A SHA-256 fingerprint of five fields, the chain from 64 zeros, demo ECDSA P-256 signatures, corrections appended with a reason, every check recomputed in the browser; the alpha app's HPLC CSV import signed by one server key. Everything else is Upcoming.

## Deliverable A: the brief (document)
Write `docs/architecture-and-threat-model.md` in the repo (NOT published; the deploy allowlist excludes .md; confirm with site/tools/deploy.mjs) and a copy at `/tmp/claude-0/-home-user/c61feb86-006d-513c-a18e-742ba4538b41/scratchpad/reposition/architecture-and-threat-model.md`. Length: about 2,000–3,000 words. Plain, specific, for the founder to use with labs, in the Claude Startups application and as the source for the Roadmap. Sections:
1. Who it is for and why now (automated labs; the snowball).
2. Failure modes, malicious and not: a table with columns What happens · What catches it · Status (Works today / Upcoming / Out of scope). Cover: value changed after capture (script, sync, migration, agent write-back, insider); crash or outage truncates or drops records; stale backup restored; hallucinated or invented value; one wrong value spreading downstream; sabotage; espionage; tampering before capture (swapped sample, miscalibrated instrument, compromised robot software), which is out of scope with sealing at capture narrowing the window.
3. What is sealed where: capture (orchestrator/driver), measured vs. derived signers, lineage, corrections, anchoring, storage tiers.
4. Cryptography: fingerprints, chain, Merkle batches with salted leaves and inclusion checks, signatures (today's demo; per-analyst and per-signer; position-binding), anchoring, encryption of archives, post-quantum path with the NIST standard numbers, and what each piece does and does not show.
5. Confidentiality principle: nothing readable leaves the lab; what a public anchor reveals (nothing, once salted); keys stay in the lab.
6. What is in and out of the threat model, in two lists.
7. Integrations: SiLA 2, OPC UA LADS, data formats (AnIML, Allotrope ASM), ELN/LIMS, data lakes; what the first adapter would be.
8. The pitch in three sentences and the talking points for a first conversation with a lab, including five questions to ask them.
Cite standards by number (FIPS 203/204/205, RFC 9162, RFC 4998, 21 CFR Part 11, EU Annex 11, ISO/IEC 17025:2017, NSPM-33 for US research security) and nothing you are unsure of. Never name the founder's employer.

## Deliverable B: the website
Update the site's sources so the pages speak to automated research labs first, then rebuild and pass every check. Keep the document set, the walkthrough, the verifier, the console and the visual design. Specific changes:
- **site/data/site.json**
  - `definition` (Scope): keep the construction; add the audience and the snowball in one or two sentences. Suggested: "Each result becomes a sealed record: a SHA-256 fingerprint of five of its recorded fields, signed and linked to the record before it, so a later change shows. Built for automated research labs in biotechnology, microbiology, chemistry and materials science, where results arrive faster than people can review them and models train on them. Anchoring batches on a public network is an upcoming feature; only a fingerprint will go on the network, never the values." Update every assert that pins the definition and the joseqc-copy if it quotes it (`scratchpad/build/joseqc-copy.md`: regenerate the paste file to match).
  - `regulatory`: keep the sentence but it moves lower on the Overview (see below); keep it on the Regulatory map.
  - Add a `whyNow` or similar copy key if the templates need it.
  - Meta descriptions and titles: mention automated research labs on the Overview.
  - Add a Draft 6 revision row (2026-10-07) summarizing the repositioning in one sentence; set `revision` to Draft 6.
- **site/pages/overview.html**
  - New section right after Scope (before the walkthrough): **"Why: one wrong value snowballs"**: a short section (3–5 sentences plus a compact list) saying most bad data is not malicious, listing the ordinary causes, and the snowball (analysis → model → next experiment). End with the founder's line as the pull quote (move it here from the Agentic workflows section; it must still appear exactly once on the site; update the lint that pins where it appears).
  - Move "1.1 Regulatory position" to a later section ("When your process moves into GMP") near the Regulatory map link; keep the regulatory sentence verbatim.
  - **"Where it fits"**: redraw the flow for an automated lab: Instrument → Orchestrator/driver (SiLA 2, OPC UA LADS) → Data pipeline → Models and agents, with Immutable QC sealing at the orchestrator (Upcoming) and, today, beside the CDS/CSV export. Keep the existing GMP flow as the second figure or fold it into one with labels; keep every figure legible at 320 px and asserted.
  - **"Today, upcoming and not claimed"**: add the new Upcoming items (sealing at capture, measured vs. derived records, lineage and recall, Merkle batches with inclusion checks, encrypted archive on Filecoin, post-quantum signatures).
  - **Agentic workflows** section: add measured vs. derived and "an agent's number either traces back to a measurement or it does not".
  - Keep "tokenized" once per page as the H1.
- **site/pages/roadmap.html**: add items (all Upcoming; renumber; update the UPCOMING pin in build.mjs and every roadmap.html#id link): Sealing at capture (SiLA 2, OPC UA LADS adapters; the first adapter); Measured vs. derived records; Lineage and recall; Merkle batches with salted leaves and inclusion checks (merge with or sit beside the privacy item; keep "salted commitments" and "zero-knowledge proofs" wording); Encrypted archive on Filecoin (rewrite the Filecoin item: encrypted in the lab, keys stay in the lab, content addressed, deals renewed; never readable); Post-quantum signatures and encryption (FIPS 203/204/205, algorithm agility first). Order them so the automated-lab items come first.
- **site/pages/sealed.html**: in "What a pass and a fail show", add the hallucination point (a pass shows a record has not changed since sealing, not that it was ever measured; measured vs. derived is upcoming). In the privacy section, add the storage principle (nothing readable leaves the lab).
- **site/pages/about.html**: add two questions: "What kinds of labs is this for?" and "What about sabotage and espionage?" (answer plainly: what is detected, what is not, confidentiality principle; most bad data is not malicious). Keep 5–7 questions total: if that exceeds 7, merge or drop the weakest existing one and update the lint.
- **site/partials/story.html**: leave the walkthrough as is unless a sentence contradicts the new positioning.
- **Console (dashboard/)**: no change unless a lint requires it.
- **og card**: unchanged unless the status line changes (it does not).
- **Lints**: extend build.mjs so the new fixed copy is pinned (definition, the founder's line location, the roadmap list, the About question count), the new words are checked against the banned list, and present-tense claims about sealing at capture, lineage, Filecoin storage or post-quantum do not appear (they are all Upcoming).
- Then: `node site/build.mjs` (writes), `node site/build.mjs --check`, `node site/tools/check.mjs --perf`. All must pass. Take screenshots of the Overview at 1440×900 (top, Why section, Where it fits) and 390×844 (top, Why) into `/tmp/claude-0/-home-user/c61feb86-006d-513c-a18e-742ba4538b41/scratchpad/reposition/shots/` and LOOK at them.
