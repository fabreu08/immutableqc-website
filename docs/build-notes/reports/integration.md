The integration is finished, with one exception: two timing checks on the Overview page fail on this container. Everything else passes. Those two failures come from this machine, not the code. The Overview's files are byte-for-byte unchanged, and the story check already failed before I changed anything.

Someone else committed `162f25e` ("WIP: integration in progress") at 11:13, while my final runs were going. It contains all my files, but its `site/HANDOFF.md` still has two placeholders (`__INTEGRATION__` and `__OPEN__`). The finished `site/HANDOFF.md` is in the working tree, uncommitted, and it is the only file that differs from that commit.

## Results
Each command was run on its own, one after another, on the final code.

| Command | Result |
|---|---|
| `node --test core/test agent/test ui/test` | 123 of 123 pass, 36.6 s |
| `node --test app/test e2e` | 31 of 31 pass, 40.8 s, exits by itself |
| CI browser line: `node --test --test-concurrency=1 app/test e2e ui/test/landing.test.mjs core/test/browser.test.mjs` | 47 of 47 pass, 75 s |
| `node site/build.mjs` (writes, no output changed), then `--check` | 2,285 assertions pass |
| `node site/tools/check.mjs` | everything passes except 1 check (below), 17.5 min |
| `node site/tools/check.mjs --perf --only=overview.html,index.html` | 2 checks fail (below) |

**What `check.mjs` covered and passed:**
- Links: 373 references on 11 pages, plus 6 states of the landing page and the app.
- Overflow: 242 runs. Axe: 40 runs. Frames at rest: 44 idle windows.
- Reduced motion, hidden tab, no-JS text for the landing page (99.4% of its words without JavaScript).
- No CSP violation, no third-party request.

**First-load budgets (measured at 390×844):**

| Page | Measured | Budget now |
|---|---|---|
| `index.html` | 9 requests, 99.8 KB | 10 requests, 110 KB |
| `app/` | 12 requests, 151.0 KB | 13 requests, 166 KB |

The budgets also cap HTML, CSS, JS and fonts separately, each about 10% over what was measured.

**The failures:**
- **Story cost:** a step change in the Overview story costs 53.6 ms in the full run and 67.3 ms in the perf run; the limit is 50 ms.
- **Overview load time (LCP) at 390×844:** 1728 ms; the limit is 1692 ms.

**Why I put them down to the machine:**
- The story check failed at 58.3 ms in my first run, before I had changed anything.
- Three runs of that check on its own gave 57.9, 51.1 and 51.3 ms.
- An earlier agent ran these checks at 04:22–04:35 on the same Overview bytes and got 38.5 ms and 1624 ms; this container was restarted at 09:49.

I left both limits and the Overview's code alone.

**Landing page `--perf` numbers** (Slow 4G, CPU 4×, median of 3):

| Size | LCP | TBT | CLS |
|---|---|---|---|
| 390×844 | 1772 ms | 78 ms | 0.0009 |
| 320×568 | 1772 ms | 66 ms | 0 |
| 412×915 | 1776 ms | 88 ms | 0.0014 |
| 320×568, Android fonts | 1136 ms | 324 ms | 0.0751 |

The landing page also kept its layout when the phone URL bar resized it (2 of 2 runs).

## What I did, task by task
1. **Download hash:** `bundle.mjs`, then `--stamp`. The bundle was already current; its SHA-256 is `594c2324…6410`, and the build check that it matches the link on `index.html` passes.
2. **No "pending" left:** in `site/build.mjs` and `site/tools/deploy.mjs`, every v1 file is now required instead of skipped. I removed `LATER`, `LATER_DIRS` and `pending()`, and added `e2e/` to the never-published list. I checked that removing `download/iqc.mjs` makes three assertions fail.
3. **Browser checks:** `site/tools/check.mjs` now gives `index.html` and `app/` every check that applies, and the existing checks are unchanged:
   - Each page is also checked in several states: the hero's other three steps on the landing page; the demo's pass and fail and the Seal screen in the app.
   - Frames at rest on the landing page: hero off-screen while playing, paused, after its story ends, and after a scroll through the page.
   - Reduced motion and a hidden tab: no animation frames and no animations.
   - No-JS on the landing page: the hero rests on Caught with the same values, its controls are off, and the download's SHA-256 is shown.
4. **End-to-end test:** `e2e/agent-app.test.mjs` passes in 2.8 s and skips without Playwright. It also compares the pinned head from `iqc head` and the fingerprints computed by Node. I checked that it fails when an expected file state is wrong.
5. **CI:** `.github/workflows/site-check.yml` and its pins in `site/build.mjs` are updated. Action SHAs are unchanged. I checked that the new pins fail when the workflow is changed.
6. **Docs:** added `README.md`, updated the v1 section of `site/HANDOFF.md`, and updated sections 2 and 8 of `docs/product-v1.md` to match the code (they did not list `engine.mjs`, `boot.js` or `e2e/`).

To pass the new checks I also changed other agents' files:
- `app/app.css`: controls are 44 px on screens 720 px wide and narrower, as on the landing page; the demo tree's tags are 11 px (they were 10 px).
- `ui/theme.css`: added `.foot-meta>a{padding:4px 0}`.
- `site/tools/check.mjs` probes: they now skip the design system's visually hidden `.vh` class, and the tap-target probe skips elements inside a closed `<details>`.

## Decisions
- **Tap targets:** 44 px at 320 and 390 on every page. At 1280, the landing page and the app keep their compact desktop controls, held to 24 px (the WCAG 2.5.8 minimum) rather than the document set's 44, matching the landing builder's choice.
- **Smallest text:** 11 px at 320 on the landing page and the app, the design system's floor; the document set keeps 12 px.
- **The app gets no no-JS text check**, because it is a script.
- **`--perf` runs the landing page but not the app.**
- **CI runs the browser tests one file at a time**, and also runs `core/test/browser.test.mjs`, which needs a browser and so skipped in CI before.

## Left open
- The two Overview timing limits need re-measuring in CI or on one fixed machine.
- Bringing the landing page and the app up to the document set's 44 px and 12 px would be a change to `ui/theme.css`.
- The landing page's CLS of 0.0751 with Android fonts is reported but not gated.
- From the app's builder, still open: "Folder read" counts 408 files while "Files re-read" counts 406, and core's note details still show encoded paths.
- CI has not run on GitHub yet.
- The folder `/tmp/iqc-pages-CFbMQv` and two Playwright folders from 06:05–06:26 belong to other agents' runs; I left them.
- No node or Chromium process is running.

## Screenshots
In `/tmp/claude-0/-home-user/fd1ba253-4a3c-520a-8501-a3fefd072ac3/scratchpad/v1/final-shots/`, 18 files; the script is `…/scratchpad/v1/integration/tools/shoot.mjs`. The pass and fail screens use a folder sealed by the downloadable agent. While taking them, the script found no overflow, no CSP violation and no console error.
- **Landing page:** `landing-1440x900.png`, `landing-1440x900-full.png`, `landing-390x844.png`, `landing-390x844-full.png`
- **App, empty:** `app-empty-1440.png`, `app-empty-1440-full.png`, `app-empty-390.png`, `app-empty-390-full.png`
- **App, auditing:** `app-auditing-1440.png`, `app-auditing-390.png`
- **App, pass:** `app-pass-1440.png`, `app-pass-1440-full.png`, `app-pass-390.png`, `app-pass-390-full.png`
- **App, fail:** `app-fail-1440.png`, `app-fail-1440-full.png`, `app-fail-390.png`, `app-fail-390-full.png`

Run logs and JSON results are in `…/scratchpad/v1/integration/final/`.