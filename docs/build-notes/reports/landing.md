I've built the landing page: `index.html`, `ui/landing.css`, `ui/landing.mjs` and `ui/test/landing.test.mjs`. My tests pass, and `node site/build.mjs --check` passes every assertion about `index.html` and `ui/landing.*`. The one build failure, and the one browser-check failure, come from the app, which is still being written. The copy runs about 660 words of prose, over the spec's 400–600.

**Verification**
- **Unit tests:** `node --test ui/test` passes 29/29, the design system's tests included. `ui/test/landing.test.mjs` has four static tests and a Playwright test with 11 subtests. It is skipped when Playwright is missing or `IQC_SKIP_BROWSER` is set. It covers:
  - the four phase buttons, Play/Pause and live captions;
  - reduced motion starting static on Caught;
  - no animation frames while the hero is off-screen;
  - no-JS rendering;
  - the hero's hashes, ticks, sizes and values equal `ui/sample-data.mjs`, both in the HTML and after the script runs;
  - inline icons identical to `ui/icons.svg`;
  - the CSP has no inline code and `connect-src 'none'`;
  - clipboard contents;
  - CLS below 0.01;
  - page weight under 150 KB;
  - no other-origin requests, console errors or CSP violations;
  - axe with no violations in every phase at 1440 and 390;
  - no overflow at 320, 390, 768, 1024, 1440 and 1920 in three phases;
  - tap targets of at least 44 px and text of at least 11 px at 320 and 390.
- **Build lint:** all `index.html` and `ui/landing.*` assertions pass. The one failure is `deploy: app/index.html links app/app.mjs`, from the app, which is still being written.
- **Browser checks:** `node site/tools/check.mjs --only=index.html --repo` shows no overflow, no axe violations and no frames at rest. Its only failure is `app/#demo → no id="demo" in app/`; the app needs to add `id="demo"`.
- **Screenshots:** I iterated through 8 rounds and looked at each, including forced colors, focus and print.

**Numbers**
- **Words:** 662 of prose in `main` (hero 54, hero caption and steps 24, sections 584). That is 734 with the header and footer, and 981 counting all visible text including the hero's data labels and code. The decision's required blocks are what push it past 600: what a pass shows and does not show, the 10 Upcoming items, and what the agent touches plus the pipeline commands.
- **Page weight:** 9 requests. 119 KB without fonts (33.5 KB gzipped); 100 KB transferred in total with fonts.
- **Layout and load:** CLS is 0.0009 at 390×844 and 0 at 1440×900. LCP is about 130–190 ms on localhost. The script is a deferred module that imports `sample-data.mjs`.

**Decisions**
1. **Icons:** the symbols are copied into the page instead of using `<use href="ui/icons.svg#…">`, which needs no `img-src` and no extra request. The mark's `style` attribute became `class="mark-dot"` (defined in `landing.css`), because the CSP blocks style attributes.
2. **Hero start:** it opens on Caught, the same as the page without JavaScript, holds about 3 s, then plays from Written. It plays twice and rests on Caught. It pauses below 20 % visibility or when the tab is hidden.
3. **Without JavaScript:** the phase buttons are disabled and the Play button is hidden.
4. **Under reduced motion,** Play steps through the phases every 3.2 s with no streaming characters and no sweep.
5. **Audit list:** it shows all five sample files (plate-07.csv Changed, four Match), not three, because the sample folder has five.
6. **Lower panel by phase:** in phases 1–2 it is an agent log ("Ledger · ImmutableQC/ledger.jsonl"). In phases 3–4 it is the copy's file list, which goes from "Not checked" to Match/Changed.
7. **Record number:** the fingerprint rows are labelled "Sealed" and "Now". No record number is shown, so it can't contradict the app's demo.
8. **Panel height:** every phase-dependent layer shares one grid cell, so the panel keeps one height in all phases.
9. **Download hash:** it is a single 64-character text node, because the build lint needs it unbroken. It displays as 2×32 characters, or 4×16 at 380 px and below.
10. **Additions from hud:** each step card has a one-line readout, and the "Who it is for" cards sit side by side.
11. **Founder's line:** it appears once, attributed to "José A. Fernández Abreu, founder", as on the placeholder page.
12. **No `og:image`:** the existing `og.png` still says "Synthetic demo data".
13. **Copy buttons** leave out the `>` prompt and the `#` comment lines.
14. **Layout:** the hero is 1240 px wide (other sections stay at 1180). Tap targets are 44 px at 720 px and below.

**Left open**
- The app needs `id="demo"` for the `app/#demo` link.
- The download hash is currently `594c2324…`, the hash of the present `download/iqc.mjs`. The stamping agent needs to update it whenever the file is rebuilt; the build lint enforces that.
- CI does not run `ui/test` yet.
- Nothing was missing from `theme.css`, and I did not edit it or `sample-data.mjs`.
- The hero's static values were produced once by a scratch generator (`…/scratchpad/v1/landing/tools/gen.mjs`, from `index.src.html`). The test guards that they stay in sync with the sample data.

**Screenshots** (in `/tmp/claude-0/-home-user/fd1ba253-4a3c-520a-8501-a3fefd072ac3/scratchpad/v1/landing/`)
- `landing-1440-viewport.png`, `landing-1440-full.png`
- `landing-390-viewport.png`, `landing-390-full.png`, `landing-320-full.png`
- `landing-hero-1-written-1440.png`, `landing-hero-2-sealed-1440.png`, `landing-hero-3-copy-edited-1440.png`, `landing-hero-4-caught-1440.png`, `landing-hero-phases-1440.png`
- `landing-1440-focus.png`, `landing-1440-forced-colors.png`, `landing-1440-print.png`
- `compare-luminous-vs-landing-1440.png`

Files are in `/home/user/immutableqc-website`:
- `index.html`
- `ui/landing.css`
- `ui/landing.mjs`
- `ui/test/landing.test.mjs`