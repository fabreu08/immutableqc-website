Part A is built and every check you named passes. The landing brief (B) and the approval-ready items (C) are written. Nothing was committed or pushed, and I did nothing outward.

## Check results (final run, after the last rebuild)
- `node --test core/test agent/test ui/test`: 166 of 166 pass.
- `node --test --test-concurrency=1 app/test e2e`: 51 tests, 48 pass, 0 fail, 3 marked todo. The 3 todo tests are the landing page's items from the brief; the next workflow step turns them into plain tests once the landing rewrite lands.
- `node site/build.mjs --check`: 3,285 assertions pass, 8 pages.
- `node agent/tools/bundle.mjs --check`: up to date. The download's SHA-256 is now dc17fd4c6ffa06f107acbfd554747931c8a274f084053647623596375a3c2df0.
- `node agent/tools/mcpb.mjs --check`: `server.json` carries the bundle's SHA-256.
- `node site/tools/check.mjs --only=index.html`: all browser checks pass.
- I also ran the browser checks over all 8 document-set pages, including `agents.html`: all pass (overflow, axe, story, budgets, no third-party requests).

## Decisions you should know about
1. **A9 is on this branch, not on `claude/agent-discovery-mcp`**, because I may not check out branches. The download changed, so I re-stamped it; the stamp changed only the SHA-256 line in `index.html`. After the landing bot's rewrite lands, the next step must run `node agent/tools/bundle.mjs --stamp` and then `node agent/tools/mcpb.mjs --server-json`.
2. **`agents.html` (IQC-AG-01) is a document-set page.** It sits in the nav after About and in the Overview's document list. It uses the status line without "Synthetic demo data", as the landing page and app do, because it describes the agent on real files. It is linted with the hand-written-page rules (7g, 7h, 7f) instead of 7b and 7e. Every page except the 404 now has `<link rel="describedby" href="llms.txt">`.
3. **The document set went from Draft 8 to Draft 9**, with a new history row, because its content changed.
4. **Roadmap:** "Agentic workflows" and "Reviewer sign-off" moved from Upcoming to Today, and the Upcoming items are renumbered 2.1 to 2.9. "Measured and derived records" and "Lineage and recall" stay Upcoming, since they are per-result and at capture; each now says it works today for whole files.
5. **Where "Upcoming" stays:** `check.html` §2 keeps its Upcoming heading, because it is about per-result records. Its text no longer says "Not an API" and now says the MCP server works today for whole files. The Overview's Fig. 4 label about agents is also still Upcoming.
6. **Founder decisions still open:**
   - D1 (license): no file states a license. Each says "No license is published yet: ask through joseqc.com". The MCPB manifest and the skill have no `license` field.
   - D5 (repo link): nothing links the repo from the site.
   - D4 (client names): MCP client and AI vendor names are banned on the site, in the `llms` files and in the repo files.
7. **The wording rules now live in one place,** `site/tools/wording.mjs`, read by `build.mjs` and both wording tests.
8. **New section 7i in `build.mjs`** checks that repeated facts match the agent's sources: version, tool names, protocol versions, the download SHA-256, Node.js 22, the server entry with `--search`, every command-line `--option`, and exit codes. It has its own catch/pass self-tests. It also lints any JSON-LD on a hand-written page; the brief's JSON-LD block passes on a scratch copy of `index.html`.
9. **`server.json`'s `fileSha256` is enforced by a test.** Any change to the agent now needs `node agent/tools/mcpb.mjs --server-json`. The `.mcpb` uses stored zip entries with fixed times, so it is the same bytes every time; `dist/` is gitignored.
10. **The `iqc help record` example** now uses a copy of the sealed file inside the root plus `--search`. A test runs it as printed. Measured results now name the sealing ledger's key id.
11. **`llms.txt` is 6,025 bytes**, close to the 6 KB limit the build enforces.
12. **Not done:** the manual three-persona re-test (plan §6) and every part C item.

## Files changed
- `.gitignore`, `README.md`, `agent/README.md`
- `agent/src/cli.mjs`, `agent/src/lab.mjs`, `agent/src/mcp.mjs`, `agent/src/steps.mjs`, `agent/test/mcp.test.mjs`
- `download/iqc.mjs` (rebuilt), `index.html` (stamp line only)
- `site/build.mjs`, `site/data/site.json`, `site/partials/layout.html`, `site/src/site.css`, `site/HANDOFF.md`
- `site/pages/overview.html`, `site/pages/roadmap.html`, `site/pages/check.html`, `site/pages/sealed.html`, `site/pages/regulatory.html`
- Rebuilt outputs: `overview.html`, `sealed.html`, `check.html`, `regulatory.html`, `roadmap.html`, `about.html`, `404.html`, `assets/site.css`
- `site/tools/deploy.mjs`, `site/tools/serve.mjs`, `site/tools/check.mjs`, `e2e/shipped-wording.test.mjs`
- `docs/marketing/README.md` and drafts `01` to `05`

## Files created
- Published page and its templates: `agents.html`, `site/pages/agents.html`
- Published plain-text files: `llms.txt`, `llms-full.txt`, `robots.txt`, `sitemap.xml`
- Their templates: `site/pages/llms-core.txt`, `site/pages/llms.txt`, `site/pages/llms-full.txt`, `site/pages/robots.txt`
- Shared wording rules: `site/tools/wording.mjs`
- Repository files: `AGENTS.md`, `skills/immutableqc-lab-records/SKILL.md`, `skills/immutableqc-lab-records/references/cli.md`, `skills/immutableqc-lab-records/references/mcp.md`, `server.json`
- MCPB bundle: `agent/mcpb/manifest.json`, `agent/tools/mcpb.mjs`, `agent/test/mcpb.test.mjs`
- New tests: `e2e/repo-wording.test.mjs`, `e2e/agent-discovery.test.mjs`
- `/home/user/immutableqc-website/docs/build-notes/landing-agent-brief.md` (B)
- `/home/user/immutableqc-website/docs/agent-discovery-submissions.md` (C)

The plan file `docs/agent-discovery.md` is untouched.

## External facts I re-checked
- MCPB manifest fields (0.3, `directory` user_config, `${__dirname}`): https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md
- `server.json` limits and the `fileSha256` pattern: https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json
- Registry DNS login and MCPB package rules: https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/authentication.mdx and https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/package-types.mdx
- Agent Skills spec: https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx
- `gh skill install` (gh 2.90.0 or later, preview): https://cli.github.com/manual/gh_skill_install
- Smithery publish command: https://www.smithery.ai/docs/concepts/cli (seen only through search results; that site did not resolve from here)