# Baseline agent-usability test of Immutable QC (role: baseline-usability)

**Verdict:** the MCP server works well once an agent has it, but an agent cannot find it, and what an agent can read today tells it the agent features don't exist yet. The word "MCP" is on none of the published pages. All three agents fail at discovery. Persona 1 gets contradictory answers from the site. Persona 2 only finds the step-recording command after downloading and running the agent.

Setup: the deploy allowlist was served on 127.0.0.1:8817 and stopped afterwards; the repo is unchanged.

## Ranked gaps

**1. Nothing agent-aware is public. The default branch `main` is the old site.**
- `main`'s last commit is 2026-10-08. It has no README, no `agent/`, no `app/`, and its `download/iqc.mjs` has no MCP server (`agent/README.md` returns 404 on main).
- `main` still holds `contracts/RootRegistry.sol`. Its README says it "records that root on the Filecoin EVM". That conflicts with docs/patent-guardrails.md and would read as "blockchain project" to anyone opening the repo.
- There are no open PRs. `pages.yml` deploys only from main (asserted at site/build.mjs:1307), so immutableqc.com almost certainly serves the old site. I could not confirm this directly: the sandbox cannot reach immutableqc.com (DNS blocked).
- Repo metadata: description, homepage, topics and license are all empty. https://api.github.com/repos/fabreu08/immutableqc-website and https://raw.githubusercontent.com/fabreu08/immutableqc-website/main/contracts/README.md

**2. There is nothing on the site for an agent to discover.**
- `/llms.txt`, `/llms-full.txt`, `/robots.txt`, `/sitemap.xml`, `/.well-known/*`, `/server.json` and `/agents.md` all return 404.
- No page has JSON-LD, and no page links to the source repo.
- The deploy allowlist (`FILES` in site/tools/deploy.mjs) has no slot for these files. `NEVER` blocks `.md`, so llms.txt has to stay `.txt`. serve.mjs has no `.xml` type, so sitemap.xml would be served as an octet-stream.
- The llms.txt convention (H1, blockquote summary, H2 lists of links): https://www.answer.ai/posts/2024-09-03-llmstxt.md

**3. Not in the official MCP Registry, and nothing else fills this niche.**
- Registry searches for immutable, immutableqc, iqc, provenance, laboratory, instrument, tamper, lineage and "audit trail" return no Immutable QC entry and no server that checks lab inputs: https://registry.modelcontextprotocol.io/v0/servers?search=provenance
- Web search finds nothing from immutableqc.com, even for its own name. It also finds no existing MCP server that checks instrument provenance; the nearest are https://github.com/K-Dense-AI/lab-instrument-mcps and https://lab.qenex.ai/
- A listing needs no npm package. The registry takes an MCPB bundle hosted on a GitHub or GitLab release, with a URL containing "mcp" and a required `fileSha256`: https://raw.githubusercontent.com/modelcontextprotocol/registry/main/docs/modelcontextprotocol-io/package-types.mdx
- **Lint conflict:** V1_FEAT (site/build.mjs:1145) forces any sentence containing "registry" or "lineage" to say Upcoming. Site copy about a registry listing would fail the build unless the lint is narrowed to anchoring registries. Present-tense copy has to say "traces back", not "lineage".

**4. The docs say that what works today is Upcoming (or doesn't exist).**
- site/pages/overview.html:132-136 says "8 Agentic workflows Upcoming … there is no API yet".
- site/pages/roadmap.html:22/26/30/47 label measured and derived records, lineage, agentic workflows and reviewer sign-off as Upcoming.
- The same labels appear in site/pages/sealed.html:106-112, site/pages/check.html:13-15 ("Not an API") and site/pages/regulatory.html:47,79.
- The Overview still describes the old HPLC-import "alpha app" that uses one server key.
- site/build.mjs:1453 asserts the stale check.html label, so fixing the docs also means changing that lint.
- Some of it is honestly still upcoming, for example measured records sealed with a capture key at the orchestrator. The docs need to separate that from what works today: file-level steps, traces, and sign-off in the browser.
- A text-only agent concludes "not built yet". Only app/ says "every agent step traced to the measurements it used".

**5. The only good agent-facing document is unpublished.**
- agent/README.md has the MCP tool table, the client config and the Python example. The deploy allowlist excludes it (agent/ and `.md` are in NEVER), and it is absent from main.
- On the site, the only way to learn about record, trace, review and mcp is to download iqc.mjs and run `node iqc.mjs help`.

**6. "Measured" claims more than it checks.**
- Test: I sealed a fabricated CSV with `iqc seal`, using a fresh key and `--station plate-reader-1`. `check_inputs` then reported it as "measured: sealed by plate-reader-1".
- The result carries ledgerId and station but no keyId, so an agent cannot pin the instrument's key.
- The tool description says "sealed by an instrument". Marketing copy must not promise "really measured". The fix is to return the keyId and accept an expected-key list (agent/src/mcp.mjs, the `check_inputs` description and `fileState`).

**7. The MCP search scope fails silently, and the root confinement isn't explained.**
- Configured exactly as `iqc help mcp` shows (agent/src/cli.mjs:194, no `--search`), a byte-identical copy of a sealed measurement returns "untraced: it matches no sealed measurement" (text from agent/src/lab.mjs:156). That is a false negative. The MCP text never says which ledgers it searched, although the CLI `trace` prints "Searched 2 ledgers under …".
- Instrument folders are usually siblings of the agent's folder, but every path must sit under `--root`. Naming one is refused with "or a wider --root", which the agent cannot change because it is server config.
- No tool or instruction tells the agent its root or search folders, or to copy inputs into the root first.

**8. Starting the server writes files.**
- Just initializing and listing tools in an empty folder created `ImmutableQC/ledger.jsonl`, `README.txt`, a new signing key in `~/.immutableqc/keys/`, and mcp-started/mcp-stopped records.
- The root defaults to the current folder, so a registry inspector or a cautious agent "trying it out" leaves a ledger and an unbacked-up key behind.

**9. Parallel pipeline steps fail.**
- Of 4 concurrent `iqc record` calls on one root, 3 exited 1 with "Another agent is already sealing this ledger … Stop that one first".
- The README's Python helper turns that into a RuntimeError. A running MCP server holds the same lock for its whole life.
- Nothing documents a retry or a root-per-worker pattern.

**10. The built-in `record` example fails as written.**
- agent/src/cli.mjs:151 uses `--in ../hplc-3/run-07.csv` with `--root` set to the workspace. Run as shown, it exits 2 ("outside the root").

**11. Landing page facts (brief only: another team owns index.html and ui/landing.*).**
- It says Node 20 or later; the download header and help say 22.
- The pipeline block lists exit codes 0/1/2 but `audit` returns 3 for review. I confirmed exit 3.
- It has no `record`, `trace` or `mcp` command, no agent section and no MCP mention.
- "Works today" leaves out agent steps and sign-off, and the Upcoming list includes "Lineage".
- The SHA-256 printed beside the download matches the file (27be41cb…).

**12. No LICENSE on any branch.**
- Under default copyright no one may copy or redistribute the code, so a lab's coding agent cannot vendor iqc.mjs: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository
- The repo is also named "-website" while it holds the product code.

## Persona walkthroughs

**1. Lab assistant: "check what our analysis agent did, without sending data anywhere"**
- The discovery files all 404.
- The landing page answers "without sending data": nothing is uploaded and the CSP has `connect-src 'none'` (confirmed in Chromium, no requests off the origin). It says nothing about checking an agent.
- Docs → Overview §8 and Roadmap §2.4 say this is Upcoming with "no API yet", so a text-only agent concludes it isn't built.
- app/ (with JavaScript, `/app/#demo` runs on its own) shows a pass, 2 agent steps traced, 2 needing review, and "Sign off as a reviewer". It does not explain how to sign off a real folder, although app/lab.mjs supports it.
- GitHub `main` shows the Filecoin contract.
- **Verdict:** wouldn't recommend because of the contradictions. It needed one present-tense page, "check what an AI agent did", linking the demo.

**2. Coding agent: Python plate-reader pipeline**
- The site offers only seal, head and audit for pipelines. The download's header and `help` reveal `record`.
- The `help record` example fails. The README's Python example works (I ran it: recorded, then `trace` returned "Derived: it traces to 1 measured file"), but the README is unreachable from the site and from `main`.
- Parallel jobs crash, there is no license, and Python users need Node 22 alongside.
- **Verdict:** recommend only for serial pipelines, with caveats.

**3. MCP agent: "find an MCP server to check my inputs were measured"**
- Not found in the registry, in web search or on the site.
- Given the server, it would recommend it, with the caveats in gaps 6 to 8.

## The MCP server as an agent sees it

**What works:**
- Protocol versions: `initialize` for 2025-11-25 and 2025-06-18; `server/discover` with `_meta` for 2026-07-28, which is a real spec version (https://modelcontextprotocol.io/specification/2026-07-28/changelog).
- `tools/list` gives each tool a title, input and output schemas, and correct read-only annotations.
- The `instructions` string says when to call each tool clearly: `check_inputs` before using files, `record_step` after writing them.
- Results come as plain text plus JSON plus `structuredContent`. Errors are `isError` with a sentence saying why.
- Tested and working:
  - `check_inputs`: measured, untraced, a path outside the root, a missing file.
  - `record_step`: with a measured input, and with an untraced input (the warning is returned).
  - `trace`: returns the tree back to the measured file.
  - `audit_summary`: pass, with notes.

**What's missing:**
- The descriptions don't say what an agent should do with an untraced input: stop, or ask a person. The step is recorded anyway.
- Searched folders and the measured file's key id are not reported.
- The root confinement is not explained.
- There is no tool to see review status or ask for review. `resources/list` and `prompts/list` return method-not-found, which is fine.

The scripts are kept in /tmp/claude-0/-home-user/fd1ba253-4a3c-520a-8501-a3fefd072ac3/scratchpad/agent-discovery/baseline-usability/scripts/ (fetchtext.mjs, mcpclient.mjs, demo2.cjs, pipeline_example.py). The extracted page text is in /tmp/claude-0/-home-user/fd1ba253-4a3c-520a-8501-a3fefd072ac3/scratchpad/agent-discovery/baseline-usability/fetch/.