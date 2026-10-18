# Landing page brief: agent discovery (for the landing page's owner)

From `docs/agent-discovery.md` (plan B), updated 2026-10-18 on branch `claude/nifty-gates-h5guqf` after part A was built.
`index.html` and `ui/landing.*` belong to the landing page's owner; nothing in part A edited them, except one line:
`node agent/tools/bundle.mjs --stamp` rewrote the download's SHA-256 in the `data-sha256-of="download/iqc.mjs"` element,
because the agent changed (MCP instructions, tool descriptions, help text).

Keep the founder's headline and the design. Everything below must be in the static HTML, not written by
`ui/landing.mjs`: the AI crawlers behind AI search do not run JavaScript
(https://vercel.com/blog/the-rise-of-the-ai-crawler). No client brand names, and never the word "registry" (it is
banned on every published file).

## 1. The meta description (146 characters)

Replace line 10's description with:

```html
<meta name="description" content="Tamper-evident records for automated research labs: seal every instrument file, record what AI agents read and wrote, audit a folder in one click.">
```

## 2. In the head

```html
<link rel="describedby" href="llms.txt">
```

Every page of the document set and `agents.html` already carry it (relative, so the lints accept it).

## 3. A JSON-LD block, in the head

Paste as is. `site/build.mjs` (section 7i) already parses any `application/ld+json` block on a hand-written page and
lints its strings with the site's rules; it also checks `softwareVersion`, `softwareRequirements` and `downloadUrl`
against the agent. This exact block was tested against those checks on a scratch copy of `index.html`: it passes.

```html
<script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"Immutable QC","alternateName":"iqc","description":"Tamper-evident records for automated research labs. A one-file local agent seals every file an instrument writes into a signed ledger, records what AI agents read and wrote, and serves check_inputs, record_step, trace and audit_summary to AI agents over MCP on standard input and output. Nothing is uploaded; it never uses the network.","url":"https://immutableqc.com/","applicationCategory":"DeveloperApplication","operatingSystem":"Windows, macOS, Linux","softwareRequirements":"Node.js 22 or later","softwareVersion":"0.1.0","downloadUrl":"https://immutableqc.com/download/iqc.mjs","featureList":["Seals every file in a folder as it is written","Records the steps an AI agent takes on files","Traces agent outputs back through recorded steps to sealed files","Audits a lab folder in the browser; nothing is uploaded","Reviewer sign-off of agent steps"]}</script>
```

Add `"license"` only after the founder picks a license (decision D1), and `"sameAs": ["<repo URL>"]` only after D5. No
`offers`, no price (the build fails on either).

## 4. A short visible section, "For AI agents" (about 80 words)

- "An MCP server on standard input and output: check_inputs, record_step, trace, audit_summary."
- The server entry, exactly as below (the build and the tests compare it, character for character, across files):

  ```
  {"command": "node", "args": ["/path/to/iqc.mjs", "mcp", "--root", "/lab/agent-workspace", "--search", "/lab"]}
  ```

  `--search` matters: without it, a file sealed by a station outside the root reads as untraced.
- Links to `agents.html` ("For AI agents") and `llms.txt`.

## 5. Fixes to what the page says today

- "Needs Node.js 20 or later on Windows, macOS or Linux": "Needs Node.js 20 or later" becomes "Needs Node.js 22 or later" (the agent refuses older versions).
- The pipeline block's comment `# exit 0 pass, 1 fail, 2 usage or read error` becomes
  `# exit 0 pass, 3 review, 1 fail, 2 usage or read error`.
- The install section shows `record`, `trace` and `mcp` beside `watch`, `seal` and `audit`.
- The "Works today" list adds: agent steps traced back through recorded steps to sealed files; reviewer sign-off (in the app's
  review mode, or `iqc review`); the MCP server for AI agents.
- The Upcoming chip "Lineage": drop it. If anything replaces it, say "Values inside files" (already there) or nothing.
- The check line "macOS, Linux: `shasum -a 256 iqc.mjs`" is right as is; Linux also has `sha256sum iqc.mjs`.
- "Each file is byte-for-byte the one the agent sealed, and the ledger has not been edited, reordered or cut since it
  was signed." becomes "Each file is byte for byte the one the agent sealed, and no record the ledger still holds was
  edited or reordered since it was signed." A ledger cut short (its last records deleted) passes an audit; it shows
  only against a head pinned earlier (`iqc head`, then `iqc audit --expect-head`, or `--pin-file`).
- Anywhere the page says an audit traces agent outputs back to sealed measurements, say instead that it traces each
  recorded step's named inputs back to sealed files, and add: "A trace follows the steps as the agent recorded them: a
  step can name inputs it did not use, or outputs it did not compute from them. A person's review checks that."

## 6. Footer

Link "For AI agents" (`agents.html`) and `llms.txt` beside the document links.

## 7. After the rewrite lands

1. `node agent/tools/bundle.mjs --stamp` (the download's SHA-256 beside its link), then
   `node agent/tools/mcpb.mjs --server-json` if `download/iqc.mjs` changed.
2. In `e2e/agent-discovery.test.mjs`, the three tests marked `todo` (the meta description, the describedby link and the
   JSON-LD, the "For AI agents" section with Node.js 22 and no "Lineage") become plain tests: remove `{ todo: LANDING }`.
3. Run `node site/build.mjs --check`, `node --test --test-concurrency=1 app/test e2e` and
   `node site/tools/check.mjs --only=index.html`.

## For the founder, not the bot

"Immutable" plus "tokenized" reads as a token project to search engines and to models, and a blockchain gaming company
shares the name (the researchers' searches for "immutableqc.com Immutable QC" returned that company, for example
https://web3.career/test-automation-lead-immutable/23130). That makes the definition right under the H1 ("No blockchain,
no coins") important. The meta description and the JSON-LD above lead with the category on purpose.
