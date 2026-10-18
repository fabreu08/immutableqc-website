# Prompts for specialized coding bots

How this works:
- Every bot works on its **own branch** off `claude/nifty-gates-h5guqf`, named `bot/<role>-<topic>`, and opens a pull
  request **into `claude/nifty-gates-h5guqf`**, never into `main`. It touches only the files its role owns.
- Every bot reads the shared preamble below first, then its role.
- The lead (Claude) does the format and integrity core (`core/`), reviews every PR, and merges.
- Order: Docs bot and QA bot can start now. The App, Agent-CLI and Landing bots start after the lead lands the core
  changes (three verdicts, `step` and `review` records, `auditMany` with lineage) and says so in the PR description.

---

## Shared preamble (paste first into every bot)

You work on Immutable QC: tamper-evident records for automated research labs. Its main goal: a human reviewer can check
in one click what the lab's AI agents did. Repository `fabreu08/immutableqc-website`. Base branch
`claude/nifty-gates-h5guqf`. Create your own branch `bot/<role>-<topic>` from it, commit in small steps, push, and open a
pull request into `claude/nifty-gates-h5guqf` (never into `main`, never force-push, never merge your own PR).

Read before you change anything: `docs/patent-guardrails.md` (hard rule: no patented work), `docs/build-notes/RESUME.md`,
`docs/product-v1.md` (the spec), `site/HANDOFF.md` (top section), `README.md`.

Rules:
- No patented work: no blockchain or distributed ledger of any kind, no anchoring on a network, no registry, smart
  contract or token; no hosted service that serves lab records to third parties; no extraction of instrument operating
  logs or operator signatures.
- Banned on the site and in shipped strings (the build checks): "immutable" as a property (the name "Immutable QC" is
  fine), "guarantee", "proof"/"proofs" (no exception), "trustless", "unbreakable", "revolutionary",
  "compliant"/"compliance", "crypto" in any word, token, wallet, stake, mint, NFT, price, pilot, "customers" (except "No
  customers yet"), and any vendor or product name of instruments or lab software. No email address. Contact via
  joseqc.com. Never name the founder's employer. US spelling. Present tense only for what works today; everything else
  is labeled "Upcoming".
- Never loosen a lint or a test to make it pass. Fix the cause or ask in the PR.
- Before every push, run what applies and paste the results in the PR:
  `node --test core/test agent/test ui/test`, `node --test app/test e2e`, `node site/build.mjs --check`,
  `node site/tools/check.mjs`, `node agent/tools/bundle.mjs --check` (Node.js 22; `npm ci` in `site/` once).
- In the PR description: what you changed, what you checked, what is not done. Say plainly if a check fails.

---

## 1. Docs bot (start now)

Owns: `site/` (pages, data, partials, `build.mjs` pins), the generated root pages (`overview.html`, `sealed.html`,
`check.html`, `regulatory.html`, `roadmap.html`, `about.html`, `404.html`), `site/HANDOFF.md`. Not `docs/product-v1.md`.

Task (the patent cleanup is already done): make the document set short and clear. The founder found the old pages too
verbose. Cut each page to what a lab director or auditor needs, roughly half its current length, without losing a true
statement or adding a new claim. Keep the in-browser checks, figures and the walkthrough that work. Plain sentences,
one idea each. Update every pin in `site/build.mjs` to the new wording; never loosen a lint. One PR.

## 2. QA bot (start now)

Owns: `.github/workflows/`, `site/tools/check.mjs`, `e2e/`. Not `core/`, `agent/` or `app/` (the lead is changing
them now): report problems there in the PR instead of editing.

Task: make CI trustworthy. Read the latest `site-check` runs on `claude/nifty-gates-h5guqf` and report each failure with
its cause. Two Overview timing checks failed only on a slow machine ("story cost" 53.6 ms vs 50 ms; LCP 1,728 ms vs
1,692 ms with `--perf`): measure them on CI three times and propose, in the PR, whether to keep the limits; do not change
a limit without numbers. Fix flaky tests by making them deterministic, never by skipping them. Keep every GitHub Action
pinned to a full commit SHA with its version in a comment. Also add a test that fails if any shipped file (`index.html`,
`app/`, `ui/`, `core/immutableqc.mjs`, `download/iqc.mjs`) mentions a blockchain, chain, anchor on a network, registry
contract, smart contract or token. One PR, then a short report of CI health.

## 3. Marketing bot (start now, writes drafts only)

Owns: `docs/marketing/` (new). Does not edit the website.

Task: draft launch material for review, in Markdown: (a) a one-paragraph description and a 3-sentence pitch; (b) five
short posts for X and LinkedIn; (c) a 300-word explainer for lab directors; (d) a 300-word explainer for automation and
AI engineers (the agent, `iqc record`, the MCP server: mark anything not built yet as Upcoming); (e) ten questions a lab
will ask, with honest answers from `docs/product-v1.md` and `docs/patent-guardrails.md`; (f) a list of the 20 kinds of
labs and conferences to reach first (automated research labs: biotech, microbiology, chemistry, materials science; no
company names). Same wording rules as the site. No claims beyond what the code does today. One PR.

## 4. App bot (start after the lead's core PR)

Owns: `app/` only.

Task: build spec section E of `docs/build-notes/spec-addendum-agents.md` on top of the lead's core: whole-lab-folder
audit (all ledgers found under a dropped folder), the three verdict levels (pass cyan, review amber, fail coral), the
Agent activity view with lineage back to measurements, Review mode (human sign-off signed by a browser key, downloadable
reviewer ledger), and the extended demo with a real in-page analysis agent. Keep the design system (`ui/theme.css`), the
CSP with `connect-src 'none'`, accessibility (axe clean, 320 px, keyboard), and extend `app/test/`. Screenshots of each
state at 1440 and 390 px in the PR.

## 5. Agent-CLI bot (start after the lead's core PR)

Owns: `agent/`, `download/`.

Task: build spec section D of `docs/build-notes/spec-addendum-agents.md`: `iqc record`, `iqc trace`, `iqc review`,
`iqc mcp` (a dependency-free Model Context Protocol server on stdio; follow
https://modelcontextprotocol.io/specification/latest; tools `check_inputs`, `record_step`, `trace`, `audit_summary`;
paths confined to the root), multi-ledger `iqc audit` with exit codes 0 pass, 3 review, 1 fail, 2 usage error,
`--allow-changes`, `--pin-file`, default settle 10 s, Node.js 22 or later, and the README notes in
`docs/build-notes/changes-after-research.md` item 5. Use core for every rule; do not reimplement the format. Rebuild
`download/iqc.mjs` with `node agent/tools/bundle.mjs` (the lead re-stamps the landing page). Tests for every command,
including a scripted MCP client.

## 6. Landing bot (start after the App and Agent-CLI PRs merge)

Owns: `index.html`, `ui/landing.css`, `ui/landing.mjs`, `ui/test/landing*.test.mjs`, and the landing-page rules in
section 7g of `site/build.mjs` (only the lines about `index.html`).

Task: spec section F of `docs/build-notes/spec-addendum-agents.md`, with the founder's headline (decided 2026-10-18):
- H1: **"Lab data, tokenized. Records that verify themselves."**
- Directly under it, the definition (keep its meaning; you may tighten the wording): "Every file is tokenized the moment
  it is written: its SHA-256 fingerprint stands in for it, signed and chained to the one before. No blockchain, no
  coins. Anyone can check it, and nothing leaves your lab."
- Lead line: "Verify what your lab's agents did, in one click."
- "Tokenized" appears only in the H1 and the definition; the bare word "token" stays banned. Add a build check that
  `index.html` uses "tokeniz" at most twice and also says "No blockchain".
Keep the luminous design and the restraint rule; update the hero story (measured file sealed → agent step recorded →
an input nothing measured → caught for review), the steps, "A pass shows / It does not show", the install section (the
agent, `iqc record`, the MCP server), and the Upcoming list. About 500 words of copy. Run
`node agent/tools/bundle.mjs --stamp`. Screenshots at 1440 and 390 px in the PR.

## Not a bot role right now: the IQC TOKEN bot

A token, and on-chain commits of instrument data, conflict with the founder's no-patented-work rule (a distributed
ledger record of instrument data is an element of US 11,502,847) and with the site's positioning. Pause that bot, or
give it the Docs, QA or Marketing role instead. The `iqc-token`, `iqc-alpha` and `immutable.polsia.app` repositories
should be archived, not extended.
