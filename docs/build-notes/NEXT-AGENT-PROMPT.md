# Prompt for the next coding agent

Copy everything below the line into the agent.

---

You are continuing work on **Immutable QC**, a tamper-evident record system for automated research labs (biotech,
microbiology, chemistry, materials science), built by a solo founder. Previous work was done by another AI agent; your
job is to pick it up and carry it forward to a high standard.

## Repository and branch
- GitHub: `fabreu08/immutableqc-website`. Work on branch `claude/nifty-gates-h5guqf` (it holds all the new work; `main`
  is the live site immutableqc.com and deploys automatically through GitHub Pages).
- **Never push to `main`, never merge into it, and never force-push.** Commit in small, clear steps on the branch and
  push after the checks pass. Open a pull request into `main` only when the founder asks for one.

## Read these first, in this order
0. `docs/patent-guardrails.md`: **the founder's hard rule: no patented work.** It applies to everything below.
1. `docs/build-notes/RESUME.md`: what is done, what is open, and the next steps.
2. `docs/product-v1.md`: the spec and the contract (ledger format, the agent CLI, the app, the landing page, the rules).
3. `docs/build-notes/spec-addendum-agents.md` and `docs/build-notes/changes-after-research.md`: the decided next
   features (not built yet).
4. `site/HANDOFF.md` (top section "v1 (Draft 7)" first) and the root `README.md`: layout, commands, and the standing
   copy rules.
5. `docs/build-notes/design-decision.md` and `docs/build-notes/reports/*.md`: design rules and the builders' notes.
   (The design concept files they mention lived in a temporary folder and are gone; `ui/theme.css` is the design system.)
6. `docs/instrument-integration-and-ghidra.md`: research behind the "plug into any instrument" approach.

## What the founder wants
- The website had been too verbose and the alpha did nothing. Both are rebuilt: a short, futuristic landing page
  (`index.html`, `ui/`), a working one-click audit app (`app/`), and an agent (`agent/`, one-file download
  `download/iqc.mjs`) that seals every file an instrument writes, with any vendor's software and any file format.
- **The main objective of the one-click audit: a human reviewer verifies what the AI agents in an automated lab did.**
- The UI must be intuitive and futuristic: "if it's hard to understand, people will not even try."
- The founder gave freedom to implement good ideas beyond theirs. Use judgment, but stay honest (rules below).

## Your tasks, in order
0. **Patent cleanup first** (`docs/patent-guardrails.md`). Remove from every plan and every page the items that would put
   instrument data or its records on a distributed ledger, or serve records to third parties: "Anchoring heads on a
   public network" and any other anchoring, the registry contract and its scripts (`contracts/`, `dashboard/registry-*.js`;
   delete them, git history keeps them), the encrypted archive on Filecoin, privacy on public networks (salted
   commitments and zero-knowledge proofs on a network), and any hosted sharing service. That covers the landing page's
   Upcoming list (`index.html`), the app, `docs/product-v1.md`, `README.md`, `site/HANDOFF.md`, and the document set's
   sources (`site/data/site.json`, `site/pages/*.html`: the Roadmap, Overview, How a record is sealed, Regulatory map and
   About pages mention anchoring, a registry and Filecoin). Rewrite the affected copy truthfully and update the build's
   pins and lints to match; never loosen a banned-wording or honesty lint. Do not touch the other repositories
   (`iqc-alpha`, `iqc-token`, `immutable.polsia.app`): tell the founder they should be archived.
1. **CI.** Check the latest `site-check` workflow run on the branch. Fix real failures. Two Overview timing limits
   failed only on the previous agent's slow machine (`site/tools/check.mjs`: "story cost" 53.6 ms vs 50 ms; Overview LCP
   1,728 ms vs 1,692 ms with `--perf`); if CI passes them, leave them; if not, investigate before touching any limit.
2. **Fold the addendum into the spec, then build it** (`spec-addendum-agents.md` + `changes-after-research.md`):
   - Three verdicts: pass / review / fail (an edit sealed during a watch must put the audit in review, not pass
     quietly); CLI exit codes 0 pass, 3 review, 1 fail, 2 usage or read error; `--allow-changes <glob>`.
   - New record kinds `step` (what an agent read, wrote and did) and `review` (a human sign-off), each actor keeping its
     own ledger and key; a multi-ledger audit (`auditMany` in `core/immutableqc.mjs`) that traces every agent output
     back to sealed measurements by SHA-256 and flags untraced inputs ("a value with nothing measured under it").
   - Agent CLI: `iqc record`, `iqc trace`, `iqc review`, `iqc mcp` (a dependency-free Model Context Protocol server on
     stdio so AI agents check their inputs and record their steps; follow the current spec at
     https://modelcontextprotocol.io/specification/latest), `--pin-file`, default settle 10 s, Node.js 22 or later.
   - App: whole-lab-folder audit, an Agent activity view with lineage, Review mode (human sign-off signed by a browser
     key), and the demo extended with a real in-page analysis agent (pass → untraced step → review; edited copy → fail;
     sign-off → approved).
   - Landing page repositioned around "Verify what your lab's agents did. In one click." (keep the design system and the
     restraint rule; update the hero story, steps, "A pass shows / It does not show", install, and the Upcoming list).
   - `core/immutableqc.mjs` stays the single implementation of the format for both the CLI and the browser; keep it
     dependency-free and bundle-friendly (only `export function/const/class` declarations; see the note at its top), then
     rebuild the download with `node agent/tools/bundle.mjs` and `node agent/tools/bundle.mjs --stamp` (the landing page
     prints the download's SHA-256, and the build checks it).
3. **Adversarial review, then fix.** Review your own work and the existing code as a skeptic from five angles:
   signatures and security (keys, CSP, XSS in reports, path traversal, symlinks, lock races, huge or hostile ledgers);
   data integrity (try hard to make a tampered folder pass); a first-time visitor (screenshots of the landing page and
   app at 1440 and 390 px: is it obvious in five seconds?); copy honesty (every claim true today); the CLI and MCP
   server on Windows, network shares and large folders. Verify each finding before fixing it.
4. Update `docs/build-notes/RESUME.md`, `site/HANDOFF.md` and the spec so the next person can continue. Report to the
   founder in plain words: what works now, what you checked, what is still open.

## Rules that must hold (the build enforces most of them; never loosen a lint to pass)
- **No patented work** (`docs/patent-guardrails.md`): no distributed ledger or blockchain of any kind, no anchoring on a
  network, no registry or smart contract, no token; no hosted platform through which third parties request records;
  no extraction or presentation of instrument operating logs or operator signatures. Ledgers stay local, single-writer,
  signed files joined only at audit time. Before building any new feature, search for patents on it and read their
  independent claims; if in doubt, do not build it and ask the founder.
- Banned on the site and in shipped strings: "immutable"/"immutability" as a property (the name "Immutable QC" is
  fine), "can't be changed/altered", "guarantee", "proof"/"proofs" (except "zero-knowledge proofs"), "trustless",
  "unbreakable", "revolutionary", "compliant"/"compliance", "crypto" in any word on the pages (so not
  "cryptographic"), token, wallet, stake, mint, NFT, price, pilot, "customers" (except "No customers yet"), and any
  instrument or lab-software vendor or product name.
- Present tense only for what works today; everything else carries the one label "Upcoming".
- No email address on the site; contact goes through joseqc.com. Never name the founder's employer. US spelling.
- The founder's line appears exactly once on the whole site (on the landing page).
- No third-party requests on any page; a Content-Security-Policy on every page; the app keeps `connect-src 'none'`, so
  nothing a lab audits is ever uploaded.

## Checks to run before every push (all must pass)
```
node --test core/test agent/test ui/test
node --test app/test e2e            # needs Playwright with Chromium (npm ci in site/ installs it)
node site/build.mjs --check
node site/tools/check.mjs           # browser checks; add --perf for the timing gates
node agent/tools/bundle.mjs --check
```
Use Node.js 22. In `site/`, run `npm ci` once (it installs Playwright and axe-core for the browser checks; install
Chromium for Playwright if your environment does not have it).

Work carefully: read the code before changing it, keep changes minimal and tested, and say plainly when something is not
done or not verified.
