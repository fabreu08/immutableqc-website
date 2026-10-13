# Resume here (paused 2026-10-13 for a usage limit)

Branch `claude/nifty-gates-h5guqf`. Nothing goes live until it is merged to `main` (Pages deploys only from `main`).

## What the founder asked for
- The website was too verbose and the alpha did nothing. Build what is needed; the UI/UX of the landing page and the app
  should be intuitive and futuristic ("if it's hard to understand, they will not even try").
- "Plug into any analytical instrument software" (the founder suggested Ghidra) and "1 click to check data is legit".
- **The 1-click audit's main objective: human reviewers verify what agents did in automated labs.** The founder gave
  freedom to implement ideas beyond theirs.

## Done (committed)
- `docs/product-v1.md`: the v1 spec (seal every file an instrument writes; audit a folder in one click).
- `core/immutableqc.mjs` + `core/test/`: ledger format 1, verify, audit, report (60+ tests, fixtures, Chromium parity).
- `agent/` + `download/iqc.mjs`: the `iqc` CLI (watch, seal, audit, head, status), one-file bundle, 34 tests.
- `ui/theme.css`, `ui/sample-data.mjs`: the design system (the "luminous" concept won a 3-way competition judged by 3
  personas; see `design-decision.md`) and the shared demo dataset.
- `index.html` + `ui/landing.*`: the new landing page (about 660 words, hero animation of seal → copy edited → caught).
- `app/`: the one-click audit app (audit a folder, seal in the browser, demo), Playwright tests.
- The old document set moved under the landing page (Overview at `overview.html`); the synthetic console is retired
  (`dashboard/` points to `app/`).
- `docs/instrument-integration-and-ghidra.md`: research memo (skeptic-corrected). Verdict: Ghidra is not the connector;
  the format-agnostic file-sealing agent is; AI-assisted format inference on the lab's own files is worth a small test
  later; flags a patent to clear (US11502847) and that Node 20 is end of life.

## Integration: finished (after the pause)
- `node --test core/test agent/test ui/test`: 123/123. `node --test app/test e2e`: 31/31 (incl. the cross-implementation
  test: a folder sealed by `download/iqc.mjs` gives the same verdict, head, key id and file states in the browser).
  `node site/build.mjs --check`: 2,285 assertions. `node site/tools/check.mjs`: all pass except one Overview timing
  check ("story cost" 53.6 ms against a 50 ms limit); `--perf`: Overview LCP 1728 ms against 1692 ms. Both look like this
  container's speed (the same unchanged bytes measured 38.5 ms and 1624 ms earlier); re-measure in CI before changing
  any limit. Reports: `reports/app.md`, `reports/integration.md`.
- Small open items: "Folder read" counts the ledger file and "Files re-read" does not; core's note details show encoded
  paths; the landing page and app use 24 px desktop tap targets and an 11 px text floor (the docs use 44 px and 12 px).

## Next (in order)
1. Check CI on GitHub (the site-check workflow) and re-measure the two Overview timing limits there.
2. Fold `spec-addendum-agents.md` and `changes-after-research.md` into `docs/product-v1.md`, then build them:
   three verdicts (pass / review / fail; exit codes 0 / 3 / 1 / 2), `step` and `review` record kinds, the multi-ledger
   audit with lineage back to measurements, `iqc record` / `trace` / `review` / `mcp` (a dependency-free MCP server so AI
   agents check their inputs and record their steps), `--pin-file`, settle 10 s, Node.js 22+, the app's Agent activity
   view and Review mode (human sign-off), the demo with a real in-page analysis agent, and the landing page repositioned
   around "Verify what your lab's agents did. In one click."
3. Adversarial reviews (security and signatures, data-integrity false passes, first-time-visitor UX with screenshots,
   copy honesty, CLI/MCP robustness on Windows and network shares), verify each finding, fix, re-run everything.
4. Commit, push, report to the founder with screenshots; offer a PR only if asked.

Rules that carry over: `site/HANDOFF.md` (banned wording, present tense only for what works, "Upcoming" for the rest, no
email, contact via joseqc.com, never name the founder's employer, no vendor names on the site).
