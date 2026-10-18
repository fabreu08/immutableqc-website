# Re-run of the agent-usability test on the new working tree (role: rerun-usability)

**Verdict:** locally, the new state turns the baseline's failures into passes. An agent that reaches `/llms.txt` or `agents.html` now understands the product in one read. I pasted the MCP config from llms.txt and it worked first time. The Python helper also worked as printed, and a person could audit and sign off a real folder in the app with nothing uploaded. **Publicly, nothing has changed.** Every change is uncommitted in the working tree. `main` is still the old site with the Filecoin contract, and the MCP Registry has no entry. So the three agents fail at discovery exactly as in the baseline until this is merged, deployed and listed.

**Setup**
- I served the deploy allowlist with `node site/tools/serve.mjs 8823 --deploy` (43 files) and stopped it afterwards. Its temporary folder is gone.
- `index.html` is the working-tree copy at the time I assembled the site, because another team is rewriting it.
- Agent keys went to a scratch HOME, not the real `~`. The repo is unchanged.
- `node site/build.mjs --check` passes (3285 assertions).
- `e2e/agent-discovery.test.mjs`: 5 pass, 3 todo (the landing items).

## Scores (1-10), compared with the baseline

The baseline gave no numbers, so its scores below are my reading of its verdicts.

| Scenario | Found | Understood | Would recommend | Could use in under 10 minutes |
|---|---|---|---|---|
| 1 Lab assistant: a person checks what the analysis agent did | 7 (baseline 2) | 8 (3) | 7 (3) | 7 (4) |
| 2 Coding agent: Python plate-reader pipeline | 6 (3) | 8 (5) | 6 (5) | 8 (6) |
| 3 MCP agent: check my inputs were measured | 6 locally, 2 publicly (1) | 9 (5) | 8 (6) | 9 (7, once found) |

The public scores for all three are still about 1-2, because nothing below is published.

## What I actually ran

**MCP server**
- I started it from the llms.txt entry, with `--root <lab>/agent-workspace --search <lab>`.
- Protocol versions 2024-11-05, 2025-03-26, 2025-06-18 and 2025-11-25 all worked. 2026-07-28 worked through `server/discover`. An unknown version is answered with 2025-11-25.
- The instructions now name the root and the search folders. They also say what to do with an untraced input: tell the person, and do not carry on as if it were measured.
- `check_inputs` returned:
  - a copy of a sealed CSV: "measured: sealed by plate-reader-1 (key id fe7d51c172ab5c84)…, Searched 2 ledgers under …"
  - a fabricated CSV: untraced
- A path outside the root and a missing file both come back as `isError` with a reason.
- `record_step` worked with a measured input. With the fabricated input it still recorded the step, and returned the warning.
- `trace` and `audit_summary` both reported "review" for the fabricated step.

**CLI and Python**
- The `help record` example now works when run inside the root.
- The README's Python helper worked verbatim: it recorded the step, and `trace` returned "Derived: it traces to 1 measured file", exit 0.
- On Node 20 the agent refuses to run: "iqc needs Node.js 22 or later".

**App** (Playwright, Chromium)
- I audited the real lab folder: verdict Review, 9 agent steps, the 2 untraced steps listed.
- Review and sign off worked, and I downloaded `j-rivera.ledger.jsonl`. Put back into the folder, `iqc audit` read it (9 approved, exit 3).
- The demo went pass, then review, then fail.
- There were zero requests off the origin, under CSP `connect-src 'none'`.

**Agent Skill**
- I followed `skills/immutableqc-lab-records/SKILL.md`: find the tools, check inputs, record, trace or audit, and never sign off your own steps.
- Every instruction works as written. The description is 659 characters, within the 1024 limit (https://learn.microsoft.com/agent-framework/agents/skills; agentskills.io was blocked by DNS here).

**MCPB bundle**
- `node agent/tools/mcpb.mjs --check` passes.
- The bundle's `server/iqc.mjs` has the same SHA-256 as the download, dc17fd4c…, which matches every printed hash.

## Remaining gaps and untrue statements, ranked

**1. Nothing is public (unchanged from the baseline).**
- All the new files are uncommitted (38 modified, 22 untracked). The branch on GitHub is at d1a6e41, without them.
- `main` is still 775fff39 from 2026-10-08: https://api.github.com/repos/fabreu08/immutableqc-website/commits/main
- On `main`, `llms.txt`, `AGENTS.md`, `SKILL.md`, `server.json` and `LICENSE` all return 404. `contracts/README.md` returns 200, with "Filecoin EVM": https://raw.githubusercontent.com/fabreu08/immutableqc-website/main/contracts/README.md
- The repo's description, homepage, topics and license are all null: https://api.github.com/repos/fabreu08/immutableqc-website
- immutableqc.com is still unreachable from the sandbox (DNS).

**2. Not in the MCP Registry.**
- Searching for "immutableqc" returns 0 results: https://registry.modelcontextprotocol.io/v0/servers?search=immutableqc
- `server.json` names a `releases/download/v0.1.0/...mcpb` URL, but the repo has no releases (https://api.github.com/repos/fabreu08/immutableqc-website/releases), so that URL returns 404 today.
- The name `com.immutableqc/*` needs domain verification: a DNS TXT record on the apex, or `/.well-known/mcp-registry-auth` (https://raw.githubusercontent.com/modelcontextprotocol/registry/main/docs/modelcontextprotocol-io/authentication.mdx). The deploy rule `NEVER` blocks dotfiles, so only the DNS record works unless the allowlist changes.
- The repository URL in `server.json` lands visitors on `main`, which shows the contract from gap 1.
- Web search still finds nothing for Immutable QC. The nearest results are https://github.com/K-Dense-AI/lab-instrument-mcps and https://atlan.com/know/mcp/mcp-for-data-lineage/

**3. Landing page: brief only, not yet applied.** `docs/build-notes/landing-agent-brief.md` covers every item here.
- A plain fetch of `/` shows no mention of agents or MCP, and no link to `agents.html` or `llms.txt`. The route is `/` → Docs → Overview contents → For AI agents.
- It has no JSON-LD.
- It says "Needs Node.js 20 or later", which is untrue: the agent refuses Node 20.
- The pipeline block lists exit codes 0/1/2 with no 3.
- It still lists "Upcoming: Lineage", and its "Works today" leaves out agent steps, MCP and sign-off.

**4. The Overview still contradicts itself.**
- `site/pages/overview.html:63, 79, 81` (§6 and Fig. 4) say "Today, Immutable QC sits beside an HPLC CSV export… Today it imports an HPLC CSV export… Upcoming: agents would check the sealed history before use". That conflicts with §5 and §8 on the same page.
- Fig. 2.7 and §3.7 show "AI agent Upcoming" (`site/build.mjs:670,733`, `site/partials/story.html:57`). It refers to checks on single records, but skimmed it reads as "agents: not built".
- The Regulatory map's legend (`site/pages/regulatory.html:7`) defines "Today" as "these pages or the alpha app (not public)".

**5. In the app, one click approves every step, including fabricated ones.**
- `app/lab.mjs:212` pre-checks every step not yet approved, and "Approve" is the default decision.
- I clicked "Sign with this browser's key" once and it approved all 9 steps, including "Used a fabricated file".
- The verdict stays Review, but the steps line reads "9 approved". This is a rubber-stamp risk for persona 1.

**6. Parallel pipeline steps still fail.**
- Of 4 concurrent `iqc record` calls, 2 exited 1 with "Another agent is already sealing this ledger… Stop that one first" (`agent/src/lock.mjs:74`).
- There is no `--wait` option, and the published Python helper raises on this error.
- It is now documented as "one writer per root". The Skill says "Wait and retry" while the CLI says "Stop that one first".

**7. `trace` follows only the latest step that wrote a file's bytes.**
- I recorded fabricated.csv → x.csv, then plate-07.csv → x.csv (same bytes).
- `trace x.csv` then says "traces to 1 measured file", exit 0. Only the audit still lists the first step.

**8. Untrue: "each result says which folders it searched".** This appears in llms.txt, `site/pages/llms-core.txt:25` and `agents.html:67`. The `record_step` result has no `searched` field and no "Searched" line.

**9. `check_inputs` is all-or-nothing.** One missing path makes the whole call `isError` ("No file at …", `agent/src/steps.mjs:208`), so the agent learns nothing about the other files.

**10. The llms.txt one-liner runs the file before checking it.** `curl … && sha256sum iqc.mjs && node iqc.mjs help` prints the hash and runs the file without comparing. Use `echo "dc17…  iqc.mjs" | sha256sum -c && node iqc.mjs help`.

**11. CLI paths.**
- `--in` and `--out` resolve against the current folder, not `--root` (`steps.mjs:157,160`). Run from another folder, `--in inputs/run-07.csv` fails with "outside the root", which misleads.
- The top-level `iqc help` example (`record … --in raw.csv`, also in llms-full) has no `--search`. I reproduced the result: a sealed copy reads as untraced and the step gets a warning.

**12. The repo and the Skill can't be reached from the site.** No published page links the GitHub repo. llms.txt doesn't mention the Skill, and the Skill isn't published anywhere (not in the allowlist, not on `main`).

**13. Unchanged but now disclosed:**
- No LICENSE. The site says "ask before you copy", which still blocks a coding agent from vendoring `iqc.mjs`.
- Starting the server writes a ledger and a signing key.
- With the default `--search`, the false negative still happens, but each result now shows which folder it searched.
- `check_inputs` returns `keyId` but takes no expected-key argument.

**14. Minor:**
- No page has JSON-LD (`agents.html` included).
- The app page doesn't link `agents.html`.
- There is no MCP tool for review status; `audit_summary` notes "N steps awaiting review".

## Baseline gaps, now

| # | Baseline gap | Status now |
|---|---|---|
| 1 | Nothing public | **Unchanged** |
| 2 | No discovery files | **Fixed locally.** `llms.txt`, `llms-full.txt`, `robots.txt`, `sitemap.xml` (served as application/xml) and `agents.html` all return 200. No JSON-LD; the landing page doesn't link them |
| 3 | Not in the registry | **Prepared, not listed.** `server.json` and a reproducible MCPB bundle exist; no release, no namespace verification |
| 4 | Docs say working features are Upcoming | **Mostly fixed** (Overview §8, Roadmap §1, Sealed §9, Check §2, Regulatory rows). Gap 4 above remains |
| 5 | Agent README unpublished | **Fixed in effect:** `agents.html` and `llms-full` carry the tool table, the config and the Python example |
| 6 | "Measured" claims more than it checks | **Mostly fixed:** `keyId` returned and the limit stated. No expected-key filter |
| 7 | Search scope fails silently | **Mostly fixed:** folders and ledger counts reported; the instructions name root and search folders |
| 8 | Starting writes files | **Documented**, behaviour unchanged |
| 9 | Parallel steps fail | **Documented**, behaviour and message unchanged |
| 10 | `help record` example fails | **Fixed** |
| 11 | Landing page | **Unchanged** (the brief exists) |
| 12 | No license | **Unchanged**, now disclosed |

Files are in /tmp/claude-0/-home-user/fd1ba253-4a3c-520a-8501-a3fefd072ac3/scratchpad/agent-discovery/rerun-usability/:
- scripts/mcpclient.mjs
- scripts/app_review.cjs
- scripts/demo.cjs
- scripts/pipeline_example.py
- scripts/fetchtext.mjs
- fetch/ (the text-only view of every page)
- work/mcp1.out
- work/mcp2.out
- work/lab/ (the sample lab, with `j-rivera.ledger.jsonl`)