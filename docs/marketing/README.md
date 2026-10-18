# Marketing drafts (for review, not published)

Drafts of launch material for Immutable QC, written for the founder and the lead to review. Nothing here is on the
site: the deploy allowlist takes no `.md`, and no page links here.

| File | What |
|---|---|
| [`01-description-and-pitch.md`](01-description-and-pitch.md) | (a) a one-paragraph description and a 3-sentence pitch |
| [`02-posts.md`](02-posts.md) | (b) five short posts, each in an X and a LinkedIn version |
| [`03-explainer-lab-directors.md`](03-explainer-lab-directors.md) | (c) a 300-word explainer for lab directors |
| [`04-explainer-automation-engineers.md`](04-explainer-automation-engineers.md) | (d) a 300-word explainer for automation and AI engineers |
| [`05-lab-questions.md`](05-lab-questions.md) | (e) ten questions a lab will ask, with honest answers |
| [`06-who-to-reach-first.md`](06-who-to-reach-first.md) | (f) the 20 kinds of labs and conferences to reach first |

## Rules these drafts follow

- The site's wording rules (`docs/product-v1.md` section 7, `docs/build-notes/BOT-PROMPTS.md` shared preamble), checked
  with the same banned-word list as `site/build.mjs`, plus the shipped-file rule: no blockchain, chain, network
  anchoring, registry, smart contract or token.
- No patented work (`docs/patent-guardrails.md`): ledgers are local signed files, nothing is hosted, nothing is put on
  a network.
- Present tense only for what works today (as of `8655698`). Everything else says **Upcoming**.
- Contact goes through joseqc.com. No email address, no founder's employer, no vendor or product names.
- The founder's landing headline ("Lab data, tokenized. Records that verify themselves.", `BOT-PROMPTS.md` section 6)
  is the landing page's. "Tokenized" is allowed only in that H1 and its definition, so these drafts don't use it; they
  can quote the headline once the page ships.

## What counts as "works today" in these drafts

Works today:
- The agent (`download/iqc.mjs`, one file, Node.js): `iqc seal`, `iqc watch`, `iqc audit` (one ledger; exit 0 pass,
  3 review, 1 fail, 2 usage or read error), `iqc head`, `iqc status`.
- The app at `immutableqc.com/app/`: audit a dropped folder in the browser with nothing uploaded, seal a folder in the
  browser, and the demo (seal sample data, change one value, audit again). Review shows in amber.
- The ledger format with agent `step` and reviewer `review` records, and the audit across ledgers that traces agent
  outputs back to sealed measurements, in `core/immutableqc.mjs`.

Upcoming (being built now, spec sections D and E):
- `iqc record`, `iqc trace`, `iqc review`, the `iqc mcp` server, and `iqc audit` over a whole lab folder.
- The app's agent activity view, review mode (reviewer sign-off) and the extended demo with an analysis agent.

When the App and Agent CLI pull requests merge, the Upcoming labels on those items can come off. Each file marks the
lines to change with "Upcoming".
