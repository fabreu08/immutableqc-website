I found 17 problems; 1 to 3 are high severity. The three worst all come down to the same thing. The agent-facing files tell an AI agent that "measured", "traces to measured" and an audit pass mean more than the code can show, and I reproduced each one with the shipped `download/iqc.mjs`.

**State of the branch.** HEAD is now 797adb0 "Make the site agent-aware…", committed and pushed to origin by another process during my review, though the build report says nothing was committed or pushed. So the files below are public on GitHub. The site itself only deploys from main. The line numbers below match HEAD.

## 1. HIGH: an agent can make an invented file trace to a measurement, using only MCP
- **Repro** (`lab3`, no shell needed):
  1. `check_inputs inputs/invented.csv` says untraced.
  2. `record_step {action:"Reformatted r.csv", inputs:["inputs/r.csv"], outputs:["inputs/invented.csv"]}`, where `r.csv` is a sealed copy and `invented.csv` already existed.
  3. `record_step` with `invented.csv` as input and `report.csv` as output.
  4. `trace report.csv` says "Derived: it traces to 1 measured file". `audit_summary` says "Pass: … every input traced".
- **Cause:** a step's inputs and outputs are only what the agent says they are. `input_refs <sha256>:<bytes>:<label>` lets it name inputs it never read.
- **Files that overclaim:**
  - `site/pages/agents.html:104`: limits only "what a step read and did not name".
  - `site/pages/overview.html:135`: "an audit traces every agent output back to sealed measurements, and a person signs off each step".
  - `site/pages/roadmap.html:27`: "Today the agent does this for whole files … That would expose an invented or hallucinated value".
  - `site/pages/llms-core.txt:37`, `skills/immutableqc-lab-records/SKILL.md:77`, `README.md:87`.
  - `docs/build-notes/landing-agent-brief.md:36`: featureList "Traces agent outputs back to sealed measurements".
- **Fix, a limit line in all of the above and in the MCP instructions (`agent/src/mcp.mjs:45`):** "A trace follows the steps as the agent recorded them: a step can name inputs it did not use, or outputs it did not compute from them. A person's review checks that."
  - overview:135: replace with "an audit traces each recorded step's named inputs back to sealed files, and a person can sign off each step."
  - roadmap:27: change to "Today the agent does this for whole files, from the steps agents record and with any ledger's key (section 1)", and drop the present-tense reading of "That would expose…".
  - JSON-LD: "Traces agent outputs back through recorded steps to sealed files".
- **Optional code change:** `record_step` warns when an output's bytes were reported untraced earlier in the session, or when the file existed before the server started.

## 2. HIGH: anyone, the agent included, can make a file read as "measured", and the documented check does not catch it
- **Repro:**
  1. `node iqc.mjs seal lab/agent-workspace/inputs --station hplc-3` (a new key and a made-up station name).
  2. `trace inputs/untraced.csv` then says "Measured: sealed by hplc-3 (key id 515ce…)".
  3. `iqc audit lab` gives PASS, exit 0.
- **The suggested check does not help.** In `lab2`, `iqc audit lab2 --expect-key <real station key>` still PASSES with the faked input. `--expect-key` fails only when no audited ledger has that key; it does not check that each measured input traces to it.
- **Where it matters:** `site/pages/llms-core.txt:26` says "Files must be sealed first by iqc watch or iqc seal". So do `site/pages/agents.html:61` and `:112`, and `README.md:33` says "Seal the instruments' folders…". An agent can read these as an instruction to seal untraced inputs itself. The same false remedy appears at `llms-core.txt:36`, `agents.html:103` and `README.md:89` ("compare … (iqc audit --expect-key)").
  - `mcp.mjs:68`: "measured: an instrument station running iqc watch or iqc seal".
  - `SKILL.md:31`: "measured … Use it."
- **Fix:**
  - Replace the "must be sealed" sentences with "Only files a lab station sealed read as measured. Never run iqc seal or iqc watch on files yourself."
  - Replace the key-id limit with: "Measured means some ledger sealed those bytes, whatever its key. Anyone who runs iqc seal, an agent included, makes files read as measured, and the station name is a label the sealer picks. Compare measured.keyId with the lab's station key ids (iqc status on each station prints them)."
  - Drop "(iqc audit --expect-key)" as the remedy.
  - Add "never seal" to `SKILL.md` §5, `AGENTS.md:63-68` and `mcp.mjs:45`.
  - **Possible feature, labeled "Upcoming" until built:** a repeatable `--station-key` on `audit` and `mcp`, so that "measured" counts only for listed keys. It is local only; search patents first, per guardrails rule 5.

## 3. HIGH: "cut" and "cannot be taken back" are false
- **Repro (`t1`):** I sealed two files, deleted the last two ledger lines and the second file. `iqc audit` gives PASS, exit 0, with no key needed. In `lab2`, deleting the agent's last step record also gives PASS.
- `audit_summary` never checks a pinned head: `mcp.mjs:337-339` passes `pinFile: null` and `'expect-head': null`.
- **Files:**
  - `site/pages/agents.html:98`: "no ledger was edited, reordered or cut since it was signed". This contradicts `docs/architecture-and-threat-model.md:26`.
  - "cannot be taken back, only reviewed": `mcp.mjs:76`, `llms-core.txt:27`, `agents.html:62`, `SKILL.md:53`.
  - Limits that blame only "whoever holds a ledger's key": `llms-core.txt:35`, `SKILL.md:74`, `README.md:87`.
- **Fix:**
  - agents.html:98: "…and that no record a ledger still holds was edited or reordered since it was signed."
  - Add a limit: "Records cut from the end of a ledger, with their files. That needs no key, and it shows only against a head pinned elsewhere (iqc head, then iqc audit --expect-head, or --pin-file). audit_summary checks no pinned head."
  - Replace "cannot be taken back" with "the tool cannot remove it; a person reviews it."
  - Update the regex in `e2e/agent-discovery.test.mjs:86`.
  - Add `index.html:185`, which makes the same "cut" claim, to the landing brief.

## 4. MEDIUM: "an agent cannot approve its own steps" is false for an agent with a shell
- **Repro:** I ran `iqc review <ref> --reviewer "J. Rivera" --decision approved` myself and it gave exit 0. The reviewer name is free text.
- **Files:** `site/pages/llms-full.txt:69` (`llms-full.txt:298`) and `site/pages/agents.html:92`.
- **Fix:** "There is no review tool over MCP. An agent with a shell could still run iqc review, and the reviewer's name is whatever is typed: check the review ledger's key id."

## 5. MEDIUM: the one-line install runs the file before checking its hash
- **Files:** `site/pages/llms-core.txt:14` (`curl … && sha256sum iqc.mjs && node iqc.mjs help`; `sha256sum` always exits 0). `agents.html:28-32` puts the run in the same paste block.
- **Fix:** `curl -fsSO https://immutableqc.com/download/iqc.mjs && echo "{{dlSha}}  iqc.mjs" | sha256sum -c - && node iqc.mjs help`. On macOS use `shasum -a 256 -c`. Move `node iqc.mjs help` into a block after the check. The 7i lint allows the same SHA twice.

## 6. MEDIUM: the CLI record example fails unless it is run inside the root
- **Repro:** run from outside the root, `node iqc.mjs record --root $S/lab/agent-workspace … --in inputs/plate-07.csv` gives `"inputs/plate-07.csv" is outside the root`, exit 2. `agent/src/steps.mjs:157,160` resolves `--in` and `--out` against the current folder, while the MCP tools resolve them against the root.
- **Files:** `skills/immutableqc-lab-records/references/cli.md:11-12` and `SKILL.md:56-57`. The error text in `agent/src/paths.mjs:76` is misleading.
- **Fix:** prefix the examples with `cd /lab/agent-workspace &&` and add: "--in and --out are read from the current folder, not from --root (the MCP tools read paths from the root)." Make the error say so too, or resolve against the root.

## 7. MEDIUM: the CLI help still overclaims "instrument"
- **Files:** `agent/src/cli.mjs:35`, `:97` and `:156` ("the files instruments sealed"), and `:136` ("measured (an instrument sealed these bytes)"). These are copied into `llms-full.txt` and contradict "a station's ledger sealed" everywhere else.
- **Fix:** reword, then run `bundle.mjs`, `--stamp` and `mcpb.mjs --server-json`.

## 8. LOW: the Windows record example will not paste on Windows
- **File:** `agent/src/cli.mjs:150-153`. It mixes `D:\…` paths with a POSIX `\` line continuation, which fails in cmd and PowerShell.
- **Fix:** put it on one line.

## 9. LOW: `references/cli.md:50` does not say where the review ledger goes
- The reviewer's ledger is written to the current folder, so an audit of the lab misses it if it is run elsewhere.
- **Fix:** add "(./<reviewer>.ledger.jsonl in the current folder; keep it in the lab folder, or pass --ledger)".

## 10. LOW: the skill points to the SHA-256 on the landing page
- **Files:** `SKILL.md:24` and `references/cli.md:4-5` point to the hash "printed on https://immutableqc.com". That page is being rewritten and 7i does not lint it.
- **Fix:** point to https://immutableqc.com/agents.html.

## 11. LOW: `llms.txt` has no room for these fixes
- It is 6,025 of 6,144 bytes, so the limit lines above will push it over the 6 KB lint.
- **Fix:** shorten the Overview `agentNote` in `site/data/site.json:28` (about 150 bytes), and use the space freed by item 2's rewrite.

## 12. LOW: the landing brief (`docs/build-notes/landing-agent-brief.md`)
- Section 5 cites `index.html` line numbers (284, 328, 254-259, 268) that the rewrite will move. Quote the strings instead.
- It is missing the `index.html:185` fix from item 3 and the featureList fix from item 1.

## 13. LOW: the submission drafts (`docs/agent-discovery-submissions.md`)
- **`:99` and `:114`:** `PRIVATE_KEY` is never set. Add `PRIVATE_KEY="$(openssl pkey -in key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"` (from the registry's authentication doc).
- **`:44`:** the topic `audit-trail` matches claim language in US 11,502,847 element 3 (`docs/patent-guardrails.md:14`). Drop it.
- **D6 (`:18`):** this is not a "before C1" question. `docs/patent-guardrails.md`, which is marked "internal; not published", is already public: the GitHub API returns 200 for it on `bot/patent-claims` and `claude/nifty-gates-h5guqf`, and the repo is public. Flag it to the founder now.

## 14. LOW: `AGENTS.md` contradicts itself
- **`AGENTS.md:30-34`:** "rebuild, and leave --stamp to the owner" makes `node site/build.mjs --check` fail on the `index.html` SHA-256 assertion. Say: run `--stamp` (it changes only that line) or ask the owner.
- **`AGENTS.md:15`:** says all of `ui/` belongs to the landing page's owner, while `:48` says only `ui/landing.*`.

## 15. LOW: nothing on the site leads to the Agent Skill
- `llms.txt` and `agents.html` never mention the skill, and `.md` files are never published. This waits on founder decision D5.

## What I checked and found fine
- `robots.txt` and `sitemap.xml` are valid, and all 9 sitemap URLs are published.
- The deploy list publishes 43 files, the 5 new agent files included. I served it with `--deploy`: `.txt` files come back as text/plain with utf-8, the sitemap as application/xml, and `AGENTS.md`, `server.json`, `skills/`, `README.md` and `.well-known` all return 404.
- **Checks I re-ran:**
  - `node site/build.mjs --check`: 3,285 assertions pass.
  - Unit tests: 166 of 166 pass.
  - The agent-discovery and wording tests: 9 pass and 3 are todo.
  - The bundle and `.mcpb` checks match.
- **The bundle:** the `.mcpb` holds only `manifest.json` and `server/iqc.mjs`, byte for byte the download.
- **Listing fields and lengths:**
  - The manifest fields are valid for MCPB 0.3.
  - The skill's frontmatter fits the Agent Skills spec: name 23, description 659 of 1,024, compatibility 81 of 500.
  - `server.json` fits: description 94, title 53 (limit 100 each).
- **Protocol versions:** all four tools work over protocol versions 2026-07-28 and 2025-06-18. 2026-07-28 is a real MCP revision (no handshake, `server/discover`, `_meta` keys), though some sources still call it a release candidate.
- **Exit codes** match the docs: a second `mcp` on the same root gives 1, a bad option 2, `head` or `status` on a tampered ledger 1, `trace` of an untraced file 3.
- **The Python example** works as printed when run from inside the root.
- **Wording:** no banned words, vendor or client names, or email addresses in the published files.
- **Hosted service:** nothing suggests one. Smithery's `.mcpb` listing is downloaded and run on the user's machine.

Everything to reproduce the issues is in `/tmp/claude-0/-home-user/fd1ba253-4a3c-520a-8501-a3fefd072ac3/scratchpad/agent-discovery/skeptic/`, and the MCP test driver is `/tmp/claude-0/-home-user/fd1ba253-4a3c-520a-8501-a3fefd072ac3/scratchpad/agent-discovery/skeptic/scripts/mcp-drive.mjs`. I edited nothing in the repo, and the server and MCP processes I started are stopped.

## Sources
- https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/authentication.mdx
- https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/package-types.mdx
- https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md
- https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx
- https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
- https://equixly.com/blog/2026/08/05/stateless-mcp/
- https://man.archlinux.org/man/gh-skill-install.1.en
- https://www.smithery.ai/docs/concepts/cli
- https://smithery.ai/docs/build/publish.md
- https://github.com/punkpeye/awesome-mcp-servers/blob/main/CONTRIBUTING.md
- https://github.com/K-Dense-AI/scientific-agent-skills
- https://github.com/gunkaynar/awesome-lab-agents
- https://www.gmp-compliance.org/gmp-news/use-of-ai-agents-leads-to-the-first-fda-warning-letter-relating-to-ai (fda.gov did not resolve from here, so the C11 post 3 claim is still checked only against summaries)