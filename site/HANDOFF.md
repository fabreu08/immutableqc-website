# Redesign handoff (branch claude/new-session-wut618)

Status: step 3a is built at 3a4723c. The step 3b founder decisions below are applied, and so are the fixes from the five step 3b reviews (see "Step 3b review fixes"). `node site/build.mjs --check` and `node site/tools/check.mjs` pass. Nothing is live.

## Founder decisions
- Path B (controlled document) with three things from A: the Fig. 2 record history, the ring-and-dot mark, and the rule that a changed value breaks only the link into the next record.
- The console is an in-browser demo with publishing removed.
- Filecoin Calibration is named once, on sealed.html. The FAQ asks "Do I need to buy or hold anything?". Contact goes through joseqc.com. The demo names stay.
- Privacy on public networks (salted commitments, then zero-knowledge proofs) is upcoming. The intelligence-explosion line appears exactly once.
- **Anything that does not work yet is an upcoming feature** (applied in 3b).
  - Present tense only for what works today on the site and in the console: the SHA-256 fingerprint of the five sealed fields, the chain from 64 zeros, the demo signatures (a build key on the pages, a browser key in the console), corrections appended with a reason, every check recomputed in the browser, and the alpha app's HPLC CSV import with one server key signing rows.
  - Everything else carries one label, "Upcoming" (the Roadmap page keeps its name): anchoring on a public test network, a shared registry, reviewer sign-off, server-side verification in the app, per-analyst signatures, sample and method metadata in the seal, privacy on public networks, agentic workflows, Filecoin integration. The anchor shown stays labelled "simulated".
  - No sentence calls the product broken or "not working yet".
  - Scope definition: "Each result becomes a sealed record: a SHA-256 fingerprint of five of its recorded fields, signed and linked to the record before it, so a later change shows. Anchoring batches on a public network is an upcoming feature; only a fingerprint will go on the network, never the values." ("five of its" since the review: injection, sample and retention time are recorded but not sealed.)
  - Status line: "Independent project · Open alpha · Synthetic demo data · No customers yet" (pages, og.png, About). The console keeps its own line, which adds "Runs only in your browser".
  - `site/build.mjs` lints this mechanically (section 7b): present-tense anchoring or publishing claims, any sentence about a network, registry or blockchain that is not upcoming, simulated or absent, "do not work" or "not working" wording, "broken" outside the demo's own verdicts, the old labels ("on the roadmap", "planned"), the exact status line, and the tags.
- **Unconfirmed clause numbers removed** (applied in 3b): ISO/IEC 17025:2017 7.11.3 a), b), d); EU GMP Chapter 4, 4.9; TNI 2016 V1M2 4.13 and 5.8, and the Module 4 reference.
  - The decision also says to keep a clause number only if it is 21 CFR 11.10(e), 11.10(a), 11.50, 11.70, or EU Annex 11 clauses 9 and 14. After the review this is applied everywhere, the Regulatory map included: the map now shows only those six numbers, each on its own subject, as a suffix after the title. Every other expectation names its standard (for example "Laboratory records (21 CFR Part 211)") and says what it expects in plain words.
  - `site/build.mjs` (section 7c) fails if a removed number returns, pins the map's clause ids to exactly those six, and allows no other clause number on any page, the og card or the console.
  - If you want any of the other numbers back (Part 11 §11.10(c), (d), §11.30, Subpart C; Annex 11 §4, §7.1, §12, §17; ISO/IEC 17025 7.5.1, 7.5.2, 7.11.2; 21 CFR 211.68(b), 211.194(a)), confirm each against the text and add it to `KEPT` and `OUTSIDE` in section 7c.
- **GitHub Pages publishes only the built site, through GitHub Actions** (applied in 3b): `.github/workflows/pages.yml`, from the allowlist in `site/tools/deploy.mjs`. See "Deploying".

## Deploying
- `.github/workflows/pages.yml` runs on every push to main, and by hand (Actions → pages → Run workflow). Both jobs run only on main: a run by hand from another branch does nothing.
  - Job 1 runs `node site/build.mjs --check`, assembles `_site/` with `node site/tools/deploy.mjs _site` and uploads it. It has read access only.
  - `deploy.mjs` also reads every assembled page and stylesheet: each relative `href`, `src` and `url()` must resolve to a file in `_site/`, so a page can never need a file the allowlist leaves out. (The browser checks in `site-check.yml` run separately and do not hold up a deploy.)
  - Job 2 deploys it with `actions/deploy-pages`. Only this job has `pages: write` and `id-token: write`.
  - Every action in both workflows is pinned to a full commit SHA, with its version in a comment; `actions/checkout` keeps no token (`persist-credentials: false`). To update an action, resolve the new tag's commit (`git ls-remote --tags https://github.com/actions/<name>`) and change the SHA and the comment together; `build.mjs` section 7d checks the form.
- The allowlist, in `site/tools/deploy.mjs`, is the only thing published:
  - the 7 root pages
  - `assets/`, `fonts/`, `favicon.svg`, `og.png`, `apple-touch-icon.png`, `CNAME`
  - `dashboard/index.html`, `console.js`, `console.css`
  - Never `site/`, `contracts/`, `.github/`, `dashboard/registry-*.js` or any `.md`.
- `node site/tools/check.mjs` serves that same allowlist, so the browser checks test what will deploy (`--repo` serves the whole repo instead). It also checks that sources such as `site/build.mjs` and `dashboard/registry-abi.js` answer 404. To look at it locally, run `node site/tools/serve.mjs 8810 --deploy`.
- **At go-live, after merging to main:** the founder sets Settings → Pages → Build and deployment → Source to "GitHub Actions", then runs the workflow once (or pushes to main).
  - Also check Settings → Environments → github-pages → Deployment branches and tags: main only. The workflow's own guard does the same, but the environment rule holds even if the workflow is edited.
  - Switching earlier changes nothing live until a build on main runs.
  - Until the switch, Pages keeps serving the branch as before, including `site/`.
- Check that Settings → Pages still shows the custom domain immutableqc.com after the switch. A workflow deploy takes the domain from that setting, not from the `CNAME` file; the file is still published, which does no harm.
- GitHub Pages serves `404.html` at any missing path by itself.

## Step 3b review fixes
Five reviews (design, mobile and performance, data-integrity auditor, security and crypto, copy) reported 83 findings. What changed:
- **Checks that could be fooled.** Where the browser can check signatures, a record with no signature now fails (it used to pass as "not signed here"). A field holding the payload's separator `|` or a control character fails its fingerprint check, so two different records can no longer give the same bytes; a correction with such a field is refused. Signatures are accepted only in their low-S form (the two build signatures that were high-S were normalized; no key was needed). The console now checks the newest record's stored link, and anchors the replayed head.
- **One rule on the site and in the console.** The console flags a broken link on the changed record's row, as Check a record does, and uses the same words. Its corrections keep the original capture time, as on the pages; the time a correction was made sits beside the seal. A reason needs at least three words on both.
- **What the pages claim.** The alpha app's capture time is described as it is (an injection time typed at import, or the server's clock). A removed record whose later links are rewritten needs no key and shows only against an anchor; the Regulatory map, How a record is sealed §4.1 and §8, Check a record's Method and About 5.6 now say so. Two anchors one record apart can reveal that record; §9 and Roadmap 2.2 say so. Roadmap 2.4 no longer mentions Filecoin storage. "Nothing writes to a network" is scoped to this site and the console.
- **One label.** The Regulatory map's "Not yet" is "Not covered"; items from the nine upcoming features carry the same dashed Upcoming tag, linked to their Roadmap section; permanent limits carry none. Status lines say "simulated anchor".
- **Document control.** Draft 3 (2026-10-07) with its own history row; every page header says "Informational draft. Not a controlled document"; printed pages carry that line and page numbers (Chrome).
- **Hardening.** A Content-Security-Policy on every page and the console (inline script by hash only, no network calls). The Contents menu works before, and without, `assets/iqc.js`. The console loads its CSS and JS by content hash, stamped by `build.mjs`; its demo key can be renewed with Reset. `serve.mjs` is contained by path. The recipe never puts a stored link that is not hex into a shell command.
- **Layout and copy.** Commands break after a bar, never inside a value; a long word in a correction reason no longer widens the page; the console shows the result of a simulated change under its buttons; Android-matched fallback fonts and font preloads on the console; the og card's status line fits on one line; US spelling, no "ships", one name per value ("head", "batch fingerprint", "from 64 zeros").
- **Checks.** `check.mjs` runs every page under its CSP and fails on any violation; it adds a 64-character correction reason on both demos and checks the appended chip's accessible name. `--perf` now uses DevTools' Slow 4G (562.5 ms, 1.44 Mbps), counts every layout shift, measures 320×568, 390×844 and 412×915, and adds a run with the Arial-, Liberation- and Courier-based fallbacks unmatched.

## Still open
- `contracts/README.md` still says the console's publishing UI is "paused". It is not published, but the wording predates the "upcoming" decision.
- joseqc.com: the founder pastes the updated copy from the step 3b notes (`joseqc-copy.md`, updated after the review); that repo is not edited from here.
- Signatures cover each record's own fingerprint, as in the alpha app, not its position: a removed or moved record with every later link rewritten passes every check but the anchor. The pages say so. Signing the link instead (or a domain-separated message with the position) would make that fail without an anchor, but it would no longer match the alpha app's construction; that is a product decision.
- The console's "Simulate a problem" has no "delete a record" action yet; it would show the case above.

## Next, step 3b
1. ~~Apply the new decision above.~~ Done, with the two later decisions (clause numbers, Pages through Actions).
2. Run five adversarial reviews: design/mobile/performance, a data-integrity auditor, a security and crypto engineer, a copy editor, and the audience (lab director and AI-agent builder).
3. Fix what they find, re-run `--check` and `site/tools/check.mjs --perf`, and push.
4. Ask the founder before anything goes live.
