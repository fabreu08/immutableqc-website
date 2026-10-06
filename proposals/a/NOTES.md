# Path A: "Instrument panel"

## Concept, in five lines

1. You land on the instrument. The H1 "Tokenized lab data." sits beside a live record history for one simulated HPLC sequence: 5 system-suitability injections and 3 samples on HPLC-02.
2. The panel is the argument. Every fingerprint, link and signature on it is real: computed and signed at build, then checked again in your browser.
3. Change a peak area and the panel shows exactly what breaks. Then choose: rewrite history to hide the change, or append a correction instead.
4. The rest of the page is short and plain: what works today, where it fits beside the CDS, what goes public, ALCOA+ without claims, the roadmap, an FAQ and the footer.
5. It is dark, quiet and tabular, like a CDS sequence table: no grid backdrop, no glow, no pulsing pills and no decorative hashes.

## Files

| File | What it is |
|---|---|
| `index.html` | Hand-authored. The build writes only between `<!--gen:name-->` and `<!--/gen:name-->` markers (table rows, caption, page data, recipe, anchor, public key, sequence header). |
| `styles.css` | The only stylesheet. Tokens and the type scale are at the top. |
| `app.js` | The only script: an ES module with no dependencies (27 KB raw, 9.6 KB gzip). It includes joseqc's pure-JS SHA-256 as a fallback. |
| `build/build.mjs` | Computes, signs, asserts and prerenders the demo. Run `node build/build.mjs`; add `--resign` to use a fresh key. |
| `fonts/` | Archivo 620 (wdth 115) and IBM Plex Mono 400/500 are byte-for-byte copies from joseqc. IBM Plex Sans 400 comes from `@fontsource/ibm-plex-sans` 5.3.0. The OFL texts are next to them. |

## Decisions

**Demo semantics.** On every check, the verifier reads from the page the instrument ID (sequence header), each peak area and each capture time (`<time datetime>`). Measurement type and unit are the alpha's fixed `hplc` and `counts`. For each record it checks three things:
- **Fingerprint:** the recomputed `r` against the stored `r`.
- **Link:** the stored previous link against `SHA-256(prev of the record before ‖ its recomputed r ‖ n)`.
- **Signature:** ECDSA P-256 over `r`, verified with WebCrypto against the public key shipped on the page.

Separately, it replays the head from 64 zeros and compares it at record 08 with the anchor. The behaviours follow from that:
- **Edit:** the edited record shows "changed" and "fails", and only the link into the next record breaks.
- **Rewrite:** every link checks again ("linked", with "rewritten" under each recomputed link), but the signature still fails and the replayed head no longer matches.
- **Correction:** the result is 9 of 9. Records 01–08 still match the anchor, and the new head is labelled "not yet anchored".

Every word on the panel is chosen from the verifier's output, never from the button that was pressed.

**Corrections.**
- A correction is its own record, numbered 09 or later, with "Corr. of 03" in the Sample column and no retention time (it was not measured again).
- It keeps the alpha's 5-field payload, sealed with the time the correction was made, so it can never be mistaken for a second capture of injection 03, and the record history stays in time order.
- It is signed in the browser with a one-time P-256 key whose private half is non-extractable.
- The reason and the "corrects 03" reference sit beside the sealed fields, and the note row says so in plain words.
- The default reason is neutral ("Wrong export imported; corrected to the result reported in the CDS (simulated)"), with one line under the field: in practice a corrected result comes from the CDS, with its own audit trail.
- Up to 4 corrections per session; Reset clears them.

**Signatures shown honestly.**
- The column is "Demo signature" ("Demo sig." on phones), and the word is "verifies", "fails", "unsigned" or "unchecked".
- Without `crypto.subtle`, or if the demo key cannot be imported, the panel never shows a green verdict. It reads "Checked in your browser, fingerprints and links only", the rows keep their neutral rings, and the rewrite note says the rewrite shows only against the anchored fingerprint.
- Key fingerprint: the first 16 hex of SHA-256 over the 65 raw key bytes (`f2284b31faf86ad1`), the same derivation for the one-time key. The full public key is printed in "Check it yourself".

**Build.**
- The build signs only when the data changes or on `--resign`. Otherwise it re-verifies the signatures already on the page, so rebuilding gives byte-identical output.
- The private key is never serialised.
- It runs 238 checks:
  - every `r` and `h`, plus the exact `printf '%s' '…' | sha256sum` recipe for all 8 records and their chain steps, run in a real shell
  - signatures checked with the public key only; the key fingerprint is over the raw bytes
  - the anchor equals `h_8`; records 01–08 are injections 01–08
  - the data is plausible (SST area RSD 0.19 %, retention times, times 8 minutes apart); the caption is generated from the data
  - the fixed copy blocks are present verbatim
  - a banned-word lint over the page text and, through a small literal scanner, over every string in `app.js`
  - "tokenized" appears exactly once
  - relative paths only, and no third-party URLs
  - no viewport-height units and no `infinite` in the CSS
  - no `requestAnimationFrame`, `setInterval` or network calls in the JS

**States use form and words; colour comes last.**
- **Words:** linked / broken (+ "rewritten"), verifies / fails / unsigned / unchecked, changed / rewritten, all verify / n fail, matches / no longer matches / not yet anchored.
- **Marks:** a check, a cross, an open dashed ring (not checked by this browser yet, or not anchored).
- **Forms:**
  - an altered record's seal becomes a dashed ring with a cross
  - a record with a broken link becomes an open ring
  - the spine above a broken link becomes a dashed red segment
  - an altered row gets a faint tint
  - the changed digits are underlined

**Motion.**
- The rows are prerendered "checked at build", with neutral open rings and visible text.
- The first time at least a quarter of the rows are on screen, there is one WAAPI pass. Each row's seal ring draws in, then the row turns "verified": a 140 ms stagger and 300 ms each, about 1.3 s in total. On a desktop that is at load; on a phone it is when the visitor scrolls to the rows.
- The pass is skipped when reduced motion is on or the tab is hidden, and it is settled at once if the rows were scrolled past unseen (for example after a deep link to `#faq`).
- It is cut short by an edit, by the tab becoming hidden, by the rows leaving the viewport, or by reduced motion switching on.
- After that nothing animates; even the status colours change without a transition.

**No JavaScript, or a script that fails.**
- All text is readable, and the panel says "Checked at build" and that live checking needs JavaScript. The edit controls are hidden, and the peak-area buttons are rendered `disabled`.
- If `app.js` cannot load (module `onerror`, or `nomodule` in an old engine) or throws while starting, the page drops its `js` class and shows exactly that no-JS rendering, so no control is left dead.

**No `crypto.subtle` (insecure context).**
- Hashes and links are replayed with the pure-JS SHA-256.
- The signature column says "unchecked", the panel explains why, and corrections are appended unsigned.

**Fonts.**
- There are four faces. I dropped Plex Sans 500: body text never needs bold.
- Plex Mono is for values, IDs, hashes, status words, labels and buttons. Every sentence (state line, legend, notes, recipe comparisons) is Plex Sans. FAQ questions are set in Archivo, as small headings.
- **No preloads.** With three preloads, Chrome held first paint until the fonts arrived.
- **Fallbacks:** the Plex Sans and Plex Mono fallbacks use the audit's metric overrides; the Archivo fallback is re-derived against Arial Bold (`size-adjust:112.06%`).
- **Type scale:** five text steps as tokens (12, 13, 15, 16, 17 px) plus the H1 and section-H2 display sizes; colours only as tokens (`--acc-hover` included).

**Layout.**
- **Phones:** H1, definition, status line, the two CTAs and the regulatory line come first, then the panel. Each record is a two-line row on tracks shared by every row and by a two-line column key above them, so columns never drift and a fingerprint is never cut. The table keeps its roles explicitly. The section links sit behind a Menu button (`aria-controls`, `aria-expanded`, closes on Escape).
- **640–1199 px:** a full-width sequence table.
- **1200 px and up:** two columns, with the panel as the hero.
- **The capture-time column** appears only where the panel is wide enough. It is always in the recipe, and a correction's note row is re-spanned to the columns actually shown.
- **Keyboard:** the peak-area column is one tab stop; Up, Down, Home and End move between records, and Enter edits.

**Regulatory line.** It sits right after the CTAs: in the left column on desktop, and before the panel on phones, so a QA reader meets "No electronic signatures yet" before any "Demo signature" column. The ALCOA+ section restates it with clause references and "not a compliance claim".

**Other choices.**
- The favicon is the seal as an inline data-URI SVG, which saves a request.
- No WebGL and no `content-visibility`: nothing on this page earns them.
- "Open the alpha console" is the one non-local link: `../../dashboard/`, as the brief allows. Everything else is relative to this folder.

## Measured

Setup:
- Served locally with gzip for text, as GitHub Pages does.
- Playwright 1.56 with Chromium.
- "Slow" means CPU 4× plus Slow 4G (150 ms RTT, 1.6 Mbps).
- The scripts and logs are in `scratchpad/paths/a-work/`, outside the repo (`load.js`, `latecls.js`, `idle.js`, `intro.js`, `checks.js`, `nojsaxe.js`, `drive.cjs`, `badkey.js`, `geo.js`).

| Measure | Result | Budget |
|---|---|---|
| Requests, first load | **7**: html, css, js and 4 fonts. The favicon is inline. | ≤ 8 |
| Transfer, first load | **92.7 KB**: html 10.1, css 6.8, js 9.8, fonts 65.9 | ≤ 160 KB |
| Fonts | 65.9 KB transferred | ≤ 100 KB |
| Eager JS | 9.8 KB gzip transferred (app.js 27.3 KB raw) | ≤ 22 KB |
| LCP, 390×844 slow | **596 ms** median of 5 runs (560–948). The LCP element is the definition paragraph, painted at FCP. | as low as possible |
| LCP, 1440×900 slow | 584 ms median of 3 (580–640) | — |
| CLS, 390×844 slow | **0.0001** in 5 of 5 runs | ≤ 0.02 |
| CLS, 1440×900 slow | 0.0020 (status-line rewrap at the font swap) | ≤ 0.02 |
| CLS, fonts 2.5 s late, 10 sizes from 320 to 1920 | worst 0.0020 at 1440×900; 0 at 320, 360, 375 and 1280 | ≤ 0.02 |
| TBT, slow | **9–38 ms** at 390×844; 1–39 ms at 1440×900 | < 200 ms |
| Frames at rest, 3 s traces (390, 390 reduced motion, 1440) | **0** DrawFrame, 0 main frames, 0 paints, 0 rAF, 0 timers: idle with the rows in view after the intro, idle mid-page, idle after edit → rewrite → reset → correction, idle with the phone menu open. `getAnimations()` is 0. | 0 |
| Intro | about 1.3 s, once, when a quarter of the rows are on screen. 1440: at load. 390×844: the rows start at y = 912, so it waits (0 `animate()` calls after 2.4 s) and plays when they are scrolled into view. Reduced motion: 0 `animate()` calls. | ~1.2 s |
| Intro cut short (390 and 1440) | hidden tab, rows scrolled away, reduced motion switched on, or an edit, each 200 ms in: 16 animations → 0, final state painted. Loaded at `#faq`: settled, 0 calls. | paused |
| Hidden tab | loaded hidden (emulated, see note): 0 `animate()` calls, final state at once | paused |
| axe-core 4.14 | **0 violations** at 375 (rest, tampered, corrected, rewritten, reason form, menu open) and 1280 (the same, without the menu). Also 0 on the no-JS rendering at 375 and 1280. | 0 |
| Overflow sweep | No horizontal scroll at 320, 360, 375, 390, 412, 480, 600, 768, 1024, 1280, 1440 and 1920, in 7 states each: rest, recipe and FAQ open, editing a 9-digit value, tampered, reason form, corrected, rewritten. | none |
| Table integrity | At all 12 widths in 5 states: every fingerprint shows 8 hex characters and no text leaves its cell. After a correction the table's right edge equals its last column's at every width from 640 up (no ghost column). On phones every row uses the same column tracks. | — |
| Text size | No visible text under 12 px at any of the 12 widths (rest, tampered, corrected). The recipe commands render at 13 px. | ≥ 12 px |
| Tap targets | All ≥ 44×44 at 320, 390 and 1440, with the reason form, recipe and FAQ open. The peak-area editor is 44 px tall; the joseqc.com link is 47 px. | ≥ 44×44 |
| Keyboard | Skip link, brand, 4 nav links, 2 CTAs, **1** peak-area stop (arrows move it), the 3 demo actions, the recipe, the FAQ, the footer. Enter edits, Escape cancels, the reason form submits on Enter and closes on Escape. `:focus-visible` on every stop. | operable |
| No-JS text diff, 390 | Every other text node is identical. Only with JS: the Menu button, the edit hint, the 3 demo actions, the record picker label and the 2 copy buttons. Only without JS: the section links (behind the menu with JS), "As recorded and checked at build…" and "Live checking … needs JavaScript". | all text prerendered |
| Script failure | `app.js` blocked, or throwing at start: the page falls back to the no-JS rendering (no dead buttons, notes shown). Demo key not importable: "fingerprints and links only", no green verdict. | — |
| First screen, 390×844 | H1, definition and status line visible (status line ends at y = 406), CTAs at 532, regulatory line at 634, panel header from 658; rows from 912 | H1, definition, status visible |
| URL bar, 390×664 ↔ 390×745, at the top and at y = 1400 | Stable: no layout shift; document height, scroll position and panel position unchanged | stable |
| Recipe and crypto | In the driven browser at 1440 and in an emulated insecure context at 390, every fingerprint, link, head and recipe output on screen matches Node and a real shell, through edit, rewrite, reset, correction and a rewrite after a correction. The one-time key's signature verifies in Node, and its fingerprint in the note is SHA-256 of its raw bytes. | exact |

**Hidden-tab note.** Playwright's Chromium kept `visibilityState` "visible" for background tabs and minimised windows, so the hidden-tab code paths were tested with an emulated Page Visibility API (`intro.js`). At rest nothing runs, so there is nothing to pause.

## Review fixes (second round)

Two adversarial reviews (design, mobile and performance; auditor, crypto and copy). What changed:

**High**
- **Ghost column after a correction** at 640–759 and 1200–1359 px: the note row's `colspan` is now computed from the columns actually shown and re-spanned when the media query changes. Checked at every width.
- **Phone rows**: shared column tracks for every row plus a two-line column key; no `overflow:hidden` on fingerprints; samples wrap. At 320 every fingerprint shows all 8 characters.
- **FAQ "edits the database directly"**: now says what signatures cover (each record's fields, not its place), that only an earlier anchor shows a rewrite or a removed record, and that in the alpha whoever holds the one server key could re-sign.
- **"Where it fits"**: sealing starts at import ("changes made before import are not covered"); the app's verification is said not to work yet; the link to QA review is dashed and labelled planned.
- **Default correction reason**: neutral wording plus a line saying a corrected result comes from the CDS, with its own audit trail.

**Medium**
- Corrections are records 09+ with their own capture time, "Corr. of 03" and no RT.
- Insecure context and unloadable key: no green verdict, neutral rings, honest rewrite note.
- Meta description, "What goes public" note (the console's batch construction differs), the Filecoin roadmap card and the ALCOA+ "Complete" row now stay within the product truth.
- The regulatory line moved into the intro, before the panel on phones.
- "Signature" became "Demo signature", and "valid" became "verifies".
- The cryptocurrency answer names free test-network credit with no value, and no shared place.
- Sentences in the panel and FAQ moved from Plex Mono to Plex Sans (FAQ questions to Archivo).
- The peak-area editor and the joseqc.com link are ≥ 44 px; the recipe text is 13 px.
- The intro now starts when the rows are seen, not at load; on phones it no longer plays off screen.

**Low (all taken)**
- Neutral open rings in place of hidden icons (no stray gaps without JS); the state line's minimum height applies only with JS.
- `SHA-256` never breaks at its hyphen; the H1 breaks "Tokenized / lab data."; balanced headings; the sealed payload breaks only between fields.
- A phone Menu button.
- Control outlines at 3.6:1 (`--rule #5A7088`), and enabled demo buttons filled.
- Hover styles only under `(hover:hover)`.
- Peak areas at 13 px and right-aligned, with RT; 16 px end padding.
- The phone column key replaces the "sig" labels.
- Generic kickers removed; the section headings name the section and stick at 1024 px and up.
- Type scale and colour tokens (`--acc-hover`).
- Roving tabindex on the peak-area column.
- The key fingerprint is over raw bytes, and the full public key is shown.
- The recipe explains a broken incoming link (step 2 names the previous record's replayed link).
- A correction rewritten later shows "rewritten" under its link; the anchor row is a neutral fact, so the cross sits only on the head.
- ALCOA+ intro, Attributable and Enduring reworded.
- Head and anchored fingerprint defined in the legend.
- Copy nits: "Select a peak area", "the console runs in your browser", "QA approval and release", "license", the reset sentence, and fewer "X, not Y" sentences.
- `app.js` strings linted; caption generated and asserted.
- The comment and these notes say what the verifier reads from the page.
- Script-failure fallback.
- The "only batch fingerprints are published" line.

**Partly taken, with reasons**
- **Rows above the fold on phones (design, medium).** Not achieved at 390×844: the rows start at y = 912. The auditor asked, also at medium, for the regulatory line to come before the panel, and the brief requires it high on the page; on a phone both cannot fit above the rows. What was taken: the intro now plays when the rows are seen; the sequence header is 3 lines (Sequence and Instrument share one); padding is tighter. The caption stays visible because it now carries the record-to-injection mapping. Open question 1 asks which order you prefer.
- **"Collapse to 12/13/15/17" (design, low).** Five steps, keeping 16 px for body text.
- **"Move the 'Demo signatures…' line into the panel header" (auditor, alternative fix).** The rename to "Demo signature" plus the regulatory line's new place covers the risk; the line stays in the panel footer, so the header stays short on phones.
- **An `openssl` signature recipe (auditor, optional).** Not added: it needs a PEM key and a DER signature, which would double the recipe. The full public key, the curve, the hash and the bytes signed are stated, so anyone can verify with their own tool.
- **The console the primary CTA links to (auditor, medium).** It sits outside this prototype's folder, so I did not change it. It is now listed as a launch blocker below.

## Prototype only, and what the full build adds

**Launch blocker:** the alpha console (`W/dashboard/`) still uses wallet, faucet and keyless-seal wording (audit §3). It must carry the same footer, status line, signature story and vocabulary before "Open the alpha console" points at it.

**Prototype only:**
- One page and synthetic data.
- The anchor is simulated (no network call).
- The demo key is made at build and its private key discarded.
- The console link is relative to `proposals/a/`.
- The favicon is a data URI.
- No og card, apple-touch-icon, 404, sitemap, robots or JSON-LD.
- No hashed asset names or inline critical CSS.
- The checks run by hand.

**The full build adds:**
- One token file shared by the site and the console.
- A typeset og card generated at build from the same seal and tokens.
- An apple-touch-icon and favicon file.
- Hashed assets.
- The build checks plus the Playwright harness (sweep, clip, axe, frames, intro, URL bar, late fonts, script failure) running in CI.
- If the founder deploys one, a real registry address in place of "simulated".

## Open questions for the founder

1. **Phone order.** On phones the regulatory line now comes before the panel, so at 390×844 the panel header shows but its rows start just below the fold (the seal-in plays when they are scrolled to). The alternative puts the panel straight after the status line and the regulatory line after the panel. Which matters more on a phone: the disclaimer first, or the instrument first?
2. **The cryptocurrency question.** "Is this a cryptocurrency?" is the only place the word appears, and the build lint allows exactly that one use. The answer now mentions free test-network credit in the console. Keep it, or ask "Do I need to buy or hold anything?" instead?
3. **Naming the network.** "What it does today" names Filecoin Calibration once. joseqc.com leaves the test network unnamed. Should both sites name it, or should neither?
4. **Signature story.** The demo uses a build-time demo key plus a one-time key made in the browser for corrections (audit §8, option A). Should joseqc.com tell the same story?
5. **Sealing the reason.** The correction's reason and reference sit beside the sealed fields, to match the alpha's 5-field payload; its capture time is the correction time. Should the demo seal the reason too, ahead of "metadata in the seal"?
6. **Clause references.** The ALCOA+ intro cites 21 CFR 11.10(e), EU Annex 11 clause 9 and ISO/IEC 17025:2017 clauses 7.5 and 7.11. Keep those, or keep only the regulatory line?
7. **Fictional names.** The demo uses "Product 200 mg tablets", lot "L26031" and method "Assay". Are those acceptable, or is another fictional product preferred?
8. **Dark or light.** This path is dark (#060D14). Most lab software is light and document-like. Is dark the right signal for QA readers?
