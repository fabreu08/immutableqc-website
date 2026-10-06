# Path B: "Controlled document"

## The concept in five lines

1. immutableqc.com is laid out as a controlled document set: one document per page (IQC-OV-01 … IQC-AB-01), with a header block (document, revision, date, status), numbered sections and "Basis" notes.
2. Body pages use cool paper (#F4F6F5) and ink. Every live figure sits on a dark instrument plate (#0A1520 / #060D14), where #00D4AA and #52D6B6 mark verified signals and #FF8F6B marks failures.
3. The first screen leads with the check itself. Plate "Fig. 1, One sealed record" reads like a certificate of analysis: the record's fields, then three results your browser computes (fingerprint, signature, link), then "Check any record yourself", then the raw data the results recompute.
4. The key demo is an auditor's verifier, "Check a record". You can edit any sealed field of the 8-record synthetic HPLC sequence and the page recomputes per keystroke. It prints the exact `printf | sha256sum` recipe. Edit, "Rewrite history to hide it" and "Append a correction instead" each behave as the brief describes.
5. The page has no entrance choreography and nothing moves at rest. The only signs of life are real checks completing, and brief state changes when you edit.

## How to build and check

```
node build/build.mjs            # compute, assert (471 checks), render, write, lint
node build/build.mjs --resign   # sign with a fresh demo key; its private key is never written
```

- Node 20 or later. There are no dependencies and nothing loads at runtime.
- The build writes `index.html sealed.html check.html regulatory.html roadmap.html about.html` and `assets/site.css`, `assets/iqc.js`. The fonts are committed in `fonts/`, and their bytes are pinned in `build/data/site.json`.
- If the sequence data changes, the build stops and asks for `--resign`. Re-signing changed data is the "rewrite and re-sign" pattern the site warns about, so it never happens silently.
- Sources:
  - `build/data/` holds the sequence, the site copy (including document control and the revision history) and `signed.json` (the public key and signatures only)
  - `build/partials/` and `build/pages/` hold the HTML
  - `build/src/` holds the CSS, the JS and the pure-JS SHA-256
- The measurement scripts are in `scratchpad/paths/b-work/`:
  - `sweep.js` (overflow, taps, smallest text, axe; adapted from the design reviewer's script)
  - `load.js`, `load320.js`, `idle.js`, `hidden3.js`, `rm.js`, `a11y.js`, `urlbar.js`, `fontcls.js`, `fbsweep.js`
  - `insecure.js`, `fixes.js`, `state.js`, `laptop.js`, `tablefit2.js`, `crypto-check.mjs`, `filetest.js`, `shots.js`
  - `serve.mjs` is a gzip static server for the website root.
- Every path is relative. "Open the alpha console" (`../../dashboard/`) is switched off by `consoleLink: false` in `site.json`, because the console still carries the wallet UI the audit flags. The Roadmap page says the console is being reworked. Set the flag to `true` to restore the link; the build's link check already allows that one path.

## Decisions

**Document furniture, kept true**
- **Header block.** Document id · Revision · Updated · Status.
  - The revision reads "Draft" and the date is a full ISO date (2026-10-06). There is no "Effective" date, because nothing has been approved.
  - About §5 holds the revision history. It has one row, the current draft. Earlier revisions would have to be invented, so there are none.
  - The Status cell carries the full required status line, so the status line is in real HTML at the top of every page at every width (13 px mono, 16.8:1).
- **Sections and figures.** Section numbers are real (1, 1.1, 2 …). The Overview plate is "Fig. 1". The verifier is no longer labelled as a figure: it is section 1 of the Check page, set on a plate, with subsections 1.1–1.6.
- **Basis notes.** These cite only what has a basis: FIPS 180-4, FIPS 186-5, the alpha app's payload and link rule, and the clauses.
- **Left out.** No stamps, seals, signatures-as-graphics or ornamental rules. The two bordered boxes are labels: "Roadmap" and "Simulated · demo data".

**Certificate-of-analysis plate (Overview)**
- **Order.** The plate reads in this order: identity line, sealed fields and context, the three results (Check · Basis · Result), the status line with the CTA, then "Raw data": payload, fingerprint r₆, previous/link h₅/h₆, signature.
- **Laptop fit.** The CTA ends at 620 px at every laptop size from 1180 to 1920 wide, so the results and CTA are on screen in a real browser window. The tick-in plays where it can be seen.
- **Labels.** Lab labels lead (Instrument, Measurement, Peak area, Unit, Captured (UTC)). The exact payload keys appear once, in the raw-data payload line, and in full on the Check page and in its Method.
- **Before and after JavaScript.** Before JavaScript runs, the results read "checked at build" with a muted icon. When the plate scrolls into view, the browser runs fingerprint, then signature, then link, and each line turns teal with a 220 ms tick when its own check resolves.
- **Status line.** It reads "Checked in your browser: 3 of 3 pass · 1.1 ms", counting passes, with the time measured in the browser.
- **Demo key.** The plate's key id links to the Check page's Method, where the public key is printed and the page says why it is not independent evidence.

**One auditor's model in the verifier**
- **Replay.** The verifier replays the record history from the start of record (64 zeros). It compares each stored fingerprint and link with the replayed one and checks every signature over the recomputed fingerprint.
- **Edit.** Editing record k fails k's fingerprint, signature and link. Every later record still has its own fingerprint and signature but shows "link broken", and the replayed h₈ no longer matches the anchor.
- **Rewrite history to hide it.** This recomputes the changed record's fingerprint and every link from it on. The chain becomes consistent again, and record k's signature still fails. The page says why, and what that does not prove: "only because the demo key was discarded; in the alpha, whoever holds the one server key could re-sign the edited record, and only a fingerprint anchored outside the lab beforehand would still disagree."
- **Append a correction instead.** Record k returns to its sealed values. A record N+1 is appended with the edited values, a required reason, and a signature made with a one-time demo key generated in the browser. The one-time public key is shown in the agent JSON, so the correction can be checked outside the browser too. Records 1–8 still match the anchored fingerprint, and the new head is "not yet anchored".
- **Where the words come from.** Every status word comes from the verifier's output, through four exported functions (`statusLine`, `rowStatus`, `sentence`, `agentLine`) and `<template>` words. The build runs the same functions on Node for the sealed, edited, rewritten, corrected and no-WebCrypto-corrected cases.
  - The status line counts results: "Checked in your browser: 5 of 8 records pass · 3 fail · anchor does not match"; after a correction, "9 of 9 records pass · anchor matches records 1 to 8 · record 9 not yet anchored".
  - The agent line says a pass means "unchanged since it was sealed", never that the result was right, and a corrected original is "superseded".
- **On phones.** Under the payload, a line "Record 6 now: ✗ Fingerprint No match · ✗ Signature Fails · ✗ Link Broken · ✗ Anchor No match" sits next to the field you type in, with links to the details and the record history. The actions come right after it. From 1024 px wide, the results column beside the fields replaces that line.
- **Context.** The reason and the "corrects #k" reference sit beside the seal as context, like injection, sample and RT, because the alpha's payload has only five fields. The page and the regulatory map say so.

**Crypto: real, and asserted three ways**
- **Fingerprint and link.**
  - r = SHA-256(`instrumentId|sensorType|value|unit|capturedAt`), which is exactly the app's canonical payload.
  - h_n = SHA-256(hex h_{n−1} + hex r_n + decimal n), starting from 64 zeros.
- **Signatures.**
  - Records 1–8 carry ECDSA P-256 / SHA-256 signatures over the 32 bytes of r, in P1363 hex.
  - The build signs them once and stores the public key and signatures in `build/data/signed.json`. The private key is never written.
  - The current demo key id is 7A15F562…, and the anchor (h₈) is 0a35688a….
- **Three cross-checks in the build:**
  - node:crypto
  - the joseqc pure-JS SHA-256 that the page falls back to
  - the page's own `replay()` running on Node's WebCrypto
- **Independent re-check.** The auditor reviewer's script passes 189 of 189 against the new output, including real `printf | sha256sum` for every record.
- **Recipe.** The recipe is produced by the same function at build time and in the browser.
- **Anchor.** h₈ is stored on the page as "Anchored fingerprint (simulated, no network call)". There is no Merkle tree.
- **Limits.** The Method says plainly that a key and an anchor shipped with the page show the method, not independent evidence.

**Without JavaScript, and without WebCrypto**
- With JS off, all text and all values are there. The fields are read-only and say why, and every result reads "checked at build".
- Where `crypto.subtle` is missing (tested on a real insecure origin), the page uses the inlined pure-JS SHA-256 and never claims a signature it does not have:
  - **Overview:** "Checked in your browser: 2 of 2 pass. The signature could not be checked here (it needs an https:// page)."
  - **Button help:** the help under "Append a correction instead" says the correction will not be signed.
  - **The appended correction:** it is announced as "Not signed". Its row reads "fingerprint and link pass · not signed", and the agent line reads "fingerprint and link pass; it is not signed …; it is not yet anchored".

**One script, not a module**
- `iqc.js` is authored as an ES module so the build can import and test it.
- It ships as one classic `defer` script: the source plus the SHA-256 fallback in one function scope.
- The fallback's joseqc header is replaced in the bundle by one accurate line.
- It runs from `file://` and inside sandboxed previews.

**Type and colour**
- **Typefaces.** Archivo 620 (wdth 115) is used for display only. IBM Plex Sans 400 is used for body text and notes, and IBM Plex Mono 400/500 for ids, hashes, labels, buttons and numbers.
- **One scale.**
  - Mono comes in 12 (labels), 13 (data) and 15 (key values) px. Form fields keep 16 px so phones do not zoom on focus.
  - Sans comes in 14 (notes, captions), 15 (plate text), 16/17 (body) and 17/19 (lead) px.
- **Symbols.** r and h stay lowercase inside uppercase labels.
- **No broken identifiers.** A build step keeps SHA-256, 21 CFR Part 11, EU Annex 11, ISO/IEC 17025:2017, FIPS ids, sequence and document ids and the founder's name from breaking inside. It applies to text only, never to code or scripts. The payload and recipe break by character, never preferentially at a hyphen.
- **Phones.** Plates run edge to edge below 600 px, which lets field labels sit beside their inputs from 360 px.
- **Measured contrast.**
  - ink 16.83:1, ink-2 #4A5560 7.01:1 and teal #006E5A 5.73:1, all on paper
  - on the plate: fg 15.88:1, fg-2 #8FA1B4 6.95:1, #52D6B6 10.21:1, #FF8F6B 8.23:1
  - input borders #62768B 3.93:1 (non-text)

**Copy**
- The fixed blocks are verbatim: H1, definition, status line, regulatory line, footer and the demo-signature line. The footer uses a typographic apostrophe.
- "Tokenized" appears once, as the Overview H1.
- The build lints for the banned words, now including any "crypto" substring (it used to miss "WebCrypto"), and for vendor names.
- Status words say "pass", never "verified". In GMP, "verified" implies a second person.

## Measured numbers

Measured on 2026-10-06 after the review fixes, Chromium 141 (Playwright 1.56), served locally with gzip. "Slow" means Slow 4G (150 ms RTT, 1.6 Mbps) plus CPU 4×, at 390×844 and DPR 3, median of 5 runs.

| Measure | Result | Budget |
|---|---|---|
| Requests, first load (every page) | **7**: HTML, CSS, JS, 4 fonts; 0 third-party | ≤ 8 |
| Transfer, first load (gzip, headers included) | Overview **86.9 KB** · Check **92.5 KB** · other pages 84.7–85.6 KB | ≤ 160 KB |
| … by type | HTML 2.6–10.5 · CSS 5.8 · JS 10.3 · fonts 65.9 KB | |
| Fonts | 65.2 KB (Archivo 620, Plex Sans 400, Plex Mono 400/500) | ≤ 100 KB |
| Eager JS | 10.1 KB gz (includes the 0.9 KB SHA-256 fallback) | ≤ 22 KB |
| LCP, slow 390×844 | Overview **644 ms** (640–660) · Check **712 ms** (656–724) · others 608–624 ms. LCP = FCP (first paragraph) | as low as possible |
| TBT, slow | 0 ms on every page except Check: **57 ms** (48–140; one post-FCP task while the verifier first paints) | < 200 ms |
| CLS, slow | **0.0000** on every page, every run; also at 320×568, 358×640 and 380×700 (5 runs each, Overview and Check) | ≤ 0.02 |
| CLS with fonts held back 0.8 s and 2.5 s after first paint | 390: Overview 0.0006, Check 0 · 1440: ≤ 0.0005 · 320×568: Check 0, Overview **0.0246** (see note 1) | |
| Frames at rest, 3 s idle | **0** at the top; after the plate played; at the bottom; menu open; Check after load; after typing (blurred); after Rewrite; after Append a correction. Same at 390, 390 with reduced motion, and 1440. rAF 0, intervals 0, timers 0, running animations 0 | 0 |
| Frames while an input keeps focus | 5–6 DrawFrames per 3 s with 0 paints: the browser's text caret, not the page | |
| One-shot motion | The plate's tick-in, once, when it first enters view; brief fades on each edit (about 25 WAAPI one-shots per change, 160–260 ms each); then 0 | |
| Hidden tab (emulated) | 0 WAAPI animations started; the checks still run and report | 0 |
| Reduced motion | 0 WAAPI, transitions 0 s, final state at once; a runtime change of the setting is followed | |
| axe-core 4 | **0 violations** in 24 runs: 6 pages, Check edited / long edit / rewritten / corrected / corrected ×3, menu open, at 375 and 1280. "Incomplete" only: the 44 px padding box of the plate's key link (its text is 6.95:1) and, with the menu open, content under the overlay | 0 |
| Horizontal overflow | **0 of 156** runs: 6 pages + the 6 states above × 320, 360, 375, 390, 412, 480, 600, 768, 1024, 1180, 1280, 1440, 1920. The record table no longer scrolls sideways in any state, or for 7- to 14-digit values at 320–412 (note 2). The only inner scroller is the agent JSON box, on purpose | 0 |
| Tap targets < 44 px | **0** in 36 runs (12 page/states at 320, 375 and 390) | 0 |
| Smallest text at 320 px | 12 px | ≥ 12 px |
| Laptop first screen (Overview) | Results 416–568 px, status line ≤ 607, **CTA bottom 620 px** at 1180×820, 1280×720, 1366×657, 1440×789, 1536×730, 1920×960 (was 827–920) | |
| Laptop first screen (Check) | Fields from 630 px; value field 738–782 at 1440×900 (was below 900); first result at 499 | |
| Phone verifier, 390 wide, value edited | Value field 1028 → "Record 6 now" verdict 1294 → Rewrite 1542 → record history 3435 (was 1365 → 1726 → 2736 → 3849) | |
| Keyboard | Skip link (focus lands on `<main>` with no page-wide ring) → nav → record picker (arrow keys) → fields → reason → buttons → copy → JSON box. The Contents menu closes on Escape, outside click and when focus tabs past it | |
| No-JS text diff | All content present. Only differences: nav as a list instead of the "Contents" button; "at build" wording instead of "in your browser"; no "Copy" button; fields read-only | |
| URL bar 390×664 ↔ 390×745 | scrollY, document height and element positions unchanged; 0 layout shifts; nothing replays | stable |
| Build | 471 assertions pass; two builds byte-identical; independent re-check 189/189 | |

Notes:
1. **Late-font shift at 320.** With fonts deliberately held back until after first paint, the Overview lead re-wraps from 8 to 7 lines at exactly 320 px. The fallback's overall width is within 0.1% of Plex Sans, but individual words differ by up to 1.3%, and that changes the line count at 9 of 61 widths from 320 to 440 (11 of 61 without the nowrap spans). I tried other size-adjust values: they move the mismatch to other widths rather than remove it. In a real slow load the preloaded fonts arrive before first paint, and CLS was 0 in all 30 slow runs at 320–380.
2. **Table fit.** The previous NOTES claimed the table fit at every width. That was wrong for 10+ digit values at 320 and 14-digit values at 360/375. It is now true for those cases, because edited values wrap by character on phones.

Screenshots are in `scratchpad/paths/shots/`:
- **390 wide:** `b-390-first.png`, `b-390-plate.png`
- **390 wide, demo:**
  - `b-390-demo-tampered.png`: edited value, the "Record 6 now" verdict, and the actions
  - `b-390-demo-tampered-history.png`, `b-390-demo-rewritten.png`, `b-390-demo-corrected.png`
- **390 wide, no JS:** `b-390-nojs-first.png`
- **Desktop:** `b-1440-first.png`, `b-1366x657-first.png`, `b-1440-check-first.png`, `b-1440-check-tampered.png`

## Review fixes

Two reviews (design/mobile/perf and auditor/crypto/copy) reported 47 findings, several of them by both. I verified each one; all were real, and two were real but only partly accurate (marked below). Fixed:

**High (all three were real)**
- **Unsigned correction announced as signed.** Without WebCrypto, a correction was announced as "signed". It now reads "Not signed" everywhere: the announcement, the button help, the history row, the check detail and the agent line.
- **Agent line on an unsigned record.** The agent line ranked "not yet anchored" above "no signature" and counted an unsigned record's signature as passing. Fixed, and the build now tests this case through the page's own functions.
- **What the rewrite proves.** The rewrite story implied that the signature defeats a rewrite. The page, the live announcement and How a record is sealed §5 now say the signature fails only because the demo key was discarded, that a key holder could re-sign, and that only an earlier outside anchor would still disagree.

**Medium**
- **Plate order.** The plate now leads with results and the CTA, and the raw data follows (see Laptop first screen). The results are 15 px with a larger tick.
- **Phone verifier.** A "Record k now" verdict line sits under the payload, with links to the details and the history. The actions moved before the details on narrow screens. Field labels sit beside the inputs from 360 px.
- **Margin leak.** `.sec h3` margin no longer leaks into the verifier, so 1.1 and 1.4 share a top.
- **Symbols.** r/h no longer turn into R/H. The table headers now read "Stored fingerprint" and "Stored link".
- **"N of N".** It is computed from results (both reviewers).
- **Demo key and anchor.** The page says they ship with the records and are not independent evidence. Overview's key id links to Method.
- **How a record is sealed.** It now states that the console builds its batch fingerprint from every three records, and that the alpha app keeps RT but not sample or method.
- **Regulatory map.**
  - §11.10(a) is cited as the validation clause ("not validated").
  - §11.10(e), Annex 11 §9 and 17025 7.5.2 say the reason and time sit beside the seal and that who made the change is not recorded.
  - Annex 11 is cited as the 2011 edition. 7.11.3 now says "tampering and loss".
- **Agent line.** It no longer says "an agent could use this value". A pass means unchanged since sealing, and a corrected original is "superseded".
- **Document control.** Revision "Draft", Updated 2026-10-06, no "Effective", and a revision history.
- **Console link.** The alpha console link is off until the console is cleaned.

**Low**
- Balanced H1.
- Identifiers that never break inside (see No broken identifiers).
- No focus ring on `<main>` after the skip link.
- The menu closes on tab-out.
- Notes and captions in Plex Sans; mono sizes collapsed to 12/13/15; hashes no longer shrink on desktop.
- The record table fits on phones.
- The JSON keeps its indentation and scrolls in a keyboard-reachable box.
- Check page preamble folded into one section, so the value field shows at 1440×900.
- Lab labels lead the plate and the field labels.
- Basis note moved into the figcaption, and the duplicate cross-reference dropped (the plate header now shows on a 390×844 first screen).
- "Simulated · demo data" is a bordered label.
- Rewrite help text and "the chain breaks at record k" wording corrected.
- Preparation is derived from the data, and the injection shows as "06".
- No "WebCrypto" jargon in visible text; the lint catches it.
- The plate's no-WebCrypto status counts passes.
- "Copied." clears when the commands change.
- The one-time public key is shown in the agent JSON.
- The build refuses to re-sign changed data without `--resign`.
- The bundle header is accurate.
- "One changed character gives a completely different fingerprint".
- "Same five fields, order and link rule as the alpha app's HPLC import".
- Irregular injection cycle (422/421/423 s, asserted).
- The Method notes the alpha's "counts" unit.
- "Pass" instead of "verified".
- Typographic apostrophe in the footer; "licenses".

**Partly applied, with reasons**
- **Reason inside or beside the seal.** The auditor review said the reason sits outside the seal. That is true on this site but not in the alpha console, whose `amendPacket` seals the reason inside the record. The regulatory map says exactly that rather than generalising.
- **Revision history.** It has one row, not three: revisions 0.1 and 0.2 never existed, and inventing them would break the "furniture must be true" rule.
- **Value field position.** The aim was above 700 px at 1440×900; it is at 738 px. Getting there would mean dropping the lead sentence or the context line.
- **Agent JSON.** Long values scroll inside the box rather than being elided, so the JSON shown is the real one.
- **17025 sub-clause.** 7.11.3 is still cited without a sub-clause letter until the founder checks his copy (open question 5).
- **"Verified".** The word stays in the roadmap item "verified experiment data", which is the brief's own wording; it is gone from every status word.

## Prototype only, and what the full build adds

| The prototype has | The full build adds |
|---|---|
| Overview and Check a record in full; How a record is sealed, Regulatory map, Roadmap and About as real outline pages (headings and 2–4 lines each) | Full copy for the four outline pages:<br>• a clause-by-clause table: what is shown, what is not, and the evidence<br>• a Today / Alpha / Roadmap table<br>• an FAQ (Does it replace my CDS audit trail? Is it validated? Where is my data?) |
| One synthetic sequence (5 SST + 3 sample injections) | Optionally a second sequence (environmental, TNI) on the How page |
| Demo key pinned in `signed.json`; anchor stored on the page | A key and an anchor published outside the site (a shared registry, named the same way as on joseqc.com); per-analyst keys when they exist |
| Agent JSON shown as a roadmap preview | A documented record schema and a `verify()` reference, once agentic workflows are real |
| A one-row revision history | Real document control: an owner, approvals, and a history that grows with each issue |
| Favicon as an inline SVG data URI; no og image | One mark across favicon, apple-touch-icon and a typeset og card generated at build; a 404 page, robots, sitemap, canonical URLs and CSP headers |
| Measurement scripts in the scratchpad | The same checks (budgets, axe, overflow, rest, URL bar, font-swap CLS, no-JS, insecure context) and the build's lint, run in CI on every push |
| Light theme only | Optional dark theme. The document metaphor is deliberately light, and the plates are already dark |
| Console link switched off | The console cleaned up (no wallet language), restyled with the same tokens, and linked again |

## Open questions for the founder

1. **Status in the header block.** The header block's "Status" cell holds the full status line rather than "Open alpha" alone. Is that acceptable as the single place for the status line?
2. **"Tokenized" in the title.** To keep "tokenized" to once per page, the H1 is the only place it appears, and the `<title>` says "Tamper-evident lab records". Do you want "Tokenized lab data" in the title and search results? That would be a second occurrence.
3. **Naming the network.** The site says "public test network" and does not name Filecoin Calibration, matching joseqc.com. Should both sites name it?
4. **One signature story.** This site's pages use demo ECDSA signatures (audit option A), while the console uses a keyless demo seal. Should the console and joseqc.com tell the same story?
5. **ISO/IEC 17025:2017 sub-clause.** The site cites 7.11.3 without a letter. The auditor reviewer reads "safeguarded against tampering and loss" as item b). Please confirm against your copy; joseqc.com should match.
6. **Correction reason.** It sits beside the seal (context), because the alpha payload has five fields. Should sealing the reason and the "corrects #k" reference join the sealed-metadata roadmap item explicitly?
7. **Document control.** The set is marked "Draft", dated 2026-10-06, with a one-row history. Who approves a first issue, and should issues then carry numbers (1, 2 …) and an effective date?
8. **Contact.** No email is shown, because `hi@immutableqc.com` is unconfirmed. Should one be added on the About page?
9. **Console link.** It is switched off (`consoleLink: false`) until the console's wallet UI is removed. Turn it back on now, or after the clean-up?
10. **Demo date.** The demo date is 2026-09-14. Is a recent date preferable, or a clearly historical one?
