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
- Present tense only for what works today (updated 2026-10-18 on `claude/nifty-gates-h5guqf`, after the App and Agent CLI
  branches merged). Everything else says **Upcoming**.
- Contact goes through joseqc.com. No email address, no founder's employer, no vendor or product names.
- The founder's landing headline ("Lab data, tokenized. Records that verify themselves.", `BOT-PROMPTS.md` section 6)
  is the landing page's. "Tokenized" is allowed only in that H1 and its definition, so these drafts don't use it; they
  can quote the headline once the page ships.

## What counts as "works today" in these drafts

Works today:
- The agent (`download/iqc.mjs` 0.1.0, one file, Node.js 22 or later, no dependencies, never uses the network):
  `iqc seal`, `iqc watch`, `iqc audit` over a whole lab folder (exit 0 pass, 3 review, 1 fail, 2 usage or read error;
  `--allow-changes`, `--expect-head`, `--expect-key`, `--pin-file`), `iqc head`, `iqc status`, `iqc record`,
  `iqc trace`, `iqc review`, and `iqc mcp`, the MCP server on standard input and output with four tools:
  `check_inputs`, `record_step`, `trace`, `audit_summary`.
- The app at `immutableqc.com/app/`: audit a dropped lab folder in the browser with nothing uploaded, the agent steps
  traced back to sealed measurements, untraced inputs sent to review, review mode ("Review and sign off", signed with
  the browser's key), sealing a folder in the browser, and the demo (a pass, a review and a fail).
- The page and files for AI agents: `immutableqc.com/agents.html`, `llms.txt`, `llms-full.txt` (once this branch
  reaches `main`).

Upcoming: an npm package; a Windows installer and service; values read from inside files; per-person keys and
signatures; Merkle batches; sealing inside the vendor's software; post-quantum signatures.

Keys identify a computer or a browser, not a person: no draft may say a person signed. The posts in
`docs/agent-discovery-submissions.md` (C11) are written from the same list.
