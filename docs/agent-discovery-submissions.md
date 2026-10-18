# Agent discovery: outward actions, ready for approval

Part C of `docs/agent-discovery.md`, made ready on 2026-10-18 (branch `claude/nifty-gates-h5guqf`) after part A was
built. **Nothing here has been done.** Each item needs the founder's approval, and most need a decision first (section
1). Every item says what it needs, the exact text or command, and how to check it worked. This file is not published on
immutableqc.com (the deploy allowlist takes no `.md`), but the repository is public: nothing secret goes here, and the
contact email for any form is typed into the form, never written in the repo.

## 1. Decisions that gate these items

| # | Decision | Needed by | Status on 2026-10-18 |
|---|---|---|---|
| D1 | A license for the agent, core and skill (MIT and Apache-2.0 are the usual choices for MCP servers; ask the patent attorney) | C1, C5 to C8, C10 | Open. Until then every file for agents says "No license is published yet: ask through joseqc.com before you copy or redistribute iqc.mjs", the MCPB manifest and the skill have no `license` field, and the JSON-LD has no `license` |
| D2 | Which repository is the public face, and when this branch reaches `main` (merging to `main` also publishes the site: `.github/workflows/pages.yml`) | everything | Open. `server.json` and the skill's install lines assume `fabreu08/immutableqc-website`; change both if the repo is renamed (GitHub redirects old URLs) |
| D3 | A sentence on cost ("Free to use during the open alpha.", if true; "price" stays banned on the site) | C1, C6 | Open; no file says anything about cost |
| D4 | Client brand names outside the site (README, plugin folder, registry text) | C8 | Open. `site/tools/wording.mjs` `CLIENTS` bans them on the site, in `llms*.txt` and, for now, in the repository files (`e2e/repo-wording.test.mjs`) |
| D5 | One "Source code" link to the repo from `agents.html`, `llms*.txt` and the JSON-LD `sameAs` | C1 | Open. Today the doc-set lint allows external links to joseqc.com only |
| D6 | Questions for the patent attorney: whether `docs/patent-guardrails.md` should stay in a public repo; marketing words near claim language | before C1 | Open |
| D7 | The MCP server name `com.immutableqc/laboratory-instrument-provenance` (the registry searches names by substring) | C4, C9, C10 | Drafted in `server.json` |
| D8 | Two agent behaviors: starting `iqc mcp` writes the ledger and a key at once; parallel `iqc record` calls on one root are refused while one holds the lock | none (documented as limits) | Open; `agents.html`, `llms*.txt`, the skill and `iqc help mcp` state both |

## 2. What part A built, that these items point at

- `https://immutableqc.com/agents.html` (IQC-AG-01), `llms.txt`, `llms-full.txt`, `robots.txt`, `sitemap.xml`: built by
  `site/build.mjs`, on the deploy allowlist, published when this branch reaches `main`.
- `skills/immutableqc-lab-records/` (SKILL.md and two references), `AGENTS.md`, the README's section for agents.
- `server.json` (the registry entry, a draft) and `agent/mcpb/manifest.json`; `node agent/tools/mcpb.mjs` writes
  `dist/immutableqc-0.1.0.mcpb` (deterministic) and `--server-json` writes its SHA-256 into `server.json`. The bundle's
  SHA-256 changes whenever `download/iqc.mjs` does (`node agent/tools/mcpb.mjs --check` prints it, and
  `agent/test/mcpb.test.mjs` fails while `server.json` is behind), so rebuild it right before C2.
- The MCP server's instructions and tool descriptions now open with the words an agent searches for, and `iqc help mcp`
  shows `--search`.

## C1. The repository as the public face

Needs D1, D2, D5 (and D6 answered). Merge to `main` (this publishes the site), add `LICENSE`, then:

```
gh repo edit fabreu08/immutableqc-website \
  --description "Tamper-evident records for automated research labs: a one-file local agent seals instrument files, records AI agent steps and serves check, record, trace and audit tools over MCP (stdio). Nothing is uploaded." \
  --homepage https://immutableqc.com \
  --add-topic mcp-server --add-topic model-context-protocol --add-topic lab-automation --add-topic laboratory \
  --add-topic self-driving-lab --add-topic research-data --add-topic data-integrity --add-topic provenance \
  --add-topic tamper-evident --add-topic audit-trail --add-topic agent-skills --add-topic ai-agents \
  --add-topic reproducibility --add-topic sha256 --add-topic nodejs
```

The description is 208 characters. GitHub search uses topics and shows the README first
(https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics);
without a license no one may copy the code
(https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository).
Check: `gh api repos/fabreu08/immutableqc-website --jq '.description, .homepage, .topics, .license'`.

## C2. Release v0.1.0

Needs C1. Build the assets from the merged `main`:

```
node agent/tools/bundle.mjs --check
node agent/tools/mcpb.mjs --server-json
cp download/iqc.mjs dist/iqc.mjs
(cd dist && sha256sum iqc.mjs immutableqc-0.1.0.mcpb > SHA256SUMS.txt)
gh release create v0.1.0 dist/iqc.mjs dist/immutableqc-0.1.0.mcpb dist/SHA256SUMS.txt --title "Immutable QC agent 0.1.0 (open alpha)" --notes-file <the notes below>
```

Commit `server.json` if `--server-json` changed it. Release notes:

```
Immutable QC agent 0.1.0 (open alpha)

iqc.mjs is one file you run with Node.js 22 or later on Windows, macOS or Linux. No dependencies; it never uses the network.

- watch, seal: seal every file in a folder as it is written (SHA-256, size, time), each record signed (ECDSA P-256) and linked to the one before, in ImmutableQC/ledger.jsonl.
- record, trace, review: record an AI agent's steps (what it read, wrote and did), trace a file back to sealed files, and sign off steps.
- audit: check every ledger and file under a lab folder. Exit 0 pass, 3 review, 1 fail, 2 usage or read error.
- mcp: the same for AI agents over MCP on standard input and output: check_inputs, record_step, trace, audit_summary. Protocol versions 2026-07-28, 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05.

immutableqc-0.1.0.mcpb is the MCP server as a bundle, for clients that install .mcpb files.
Check before you run: sha256sum iqc.mjs (macOS: shasum -a 256 iqc.mjs; Windows: certutil -hashfile iqc.mjs SHA256), against SHA256SUMS.txt and immutableqc.com.

A pass does not show that a file was right when it was written, or anything about a change made before the agent read it. A step records only the files it names. Keys identify a computer or a browser, not a person.
Upcoming: an npm package, a Windows installer and service, values read from inside files, per-person signatures.
```

Before release, check two things in an MCP client that installs `.mcpb` files: that the Node.js it bundles is 22 or
later (iqc refuses older versions; the MCPB project says Node.js ships with some desktop clients,
https://github.com/modelcontextprotocol/mcpb), and that a lab folder given as both the workspace and the lab folder works
(it does from the command line: `--search` may be the root).

## C3. DNS records at the apex of immutableqc.com

Needs D7. The registry verifies a `com.immutableqc/*` name by a TXT record at the apex; HTTP verification would need a
`/.well-known/` file, which the deploy allowlist never publishes
(https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/authentication.mdx).

1. The registry key (OpenSSL 3 or later; macOS's default LibreSSL lacks Ed25519):
   ```
   openssl genpkey -algorithm Ed25519 -out key.pem
   PUBLIC_KEY="$(openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64)"
   ```
   TXT record: `immutableqc.com. IN TXT "v=MCPv1; k=ed25519; p=${PUBLIC_KEY}"`. Keep `key.pem` out of the repository.
2. The TXT values Google Search Console and Bing Webmaster Tools give for domain verification.
3. Submit `https://immutableqc.com/sitemap.xml` in both (Bing reads `lastmod`; the sitemap carries one per page).

Check: `dig +short TXT immutableqc.com`.

## C4. The official MCP Registry

Needs C2, C3, D7. The registry lists an MCPB package by a GitHub or GitLab release URL that contains "mcp", with the
file's SHA-256; the registry does not check the hash, clients do
(https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/package-types.mdx).

1. `node agent/tools/mcpb.mjs --check` (server.json carries the bundle's SHA-256; the release asset must be that file).
2. `mcp-publisher login dns --domain immutableqc.com --private-key "${PRIVATE_KEY}"` (after the TXT record has
   propagated), then `mcp-publisher publish` in the repo root, which reads `server.json`
   (https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx).
3. Check: `https://registry.modelcontextprotocol.io/v0/servers?search=laboratory` and `?search=provenance` list it.

The registry is in preview and its data can be reset; descriptions stuffed with marketing copy are removed
(https://modelcontextprotocol.io/registry/moderation-policy). The `server.json` description is 94 characters, the title
53 (limits: 100 each).

## C5. The Agent Skill

Needs C1 and D1 (then add `license:` to the frontmatter of `skills/immutableqc-lab-records/SKILL.md`).

- No submission is needed to install from the repo. Test both, in a clean home folder:
  `npx skills add fabreu08/immutableqc-website` (https://www.skills.sh/) and
  `gh skill install fabreu08/immutableqc-website immutableqc-lab-records` (GitHub CLI 2.90.0 or later, a preview
  feature: https://cli.github.com/manual/gh_skill_install). Preview first: `gh skill preview fabreu08/immutableqc-website immutableqc-lab-records`.
- Then a pull request to Scientific Agent Skills, under "Laboratory Automation"
  (https://github.com/K-Dense-AI/scientific-agent-skills). Read its AGENTS.md and CONTRIBUTING.md first, and run its
  security scanner. The text:

```
Title: Add immutableqc-lab-records (Laboratory Automation): check lab inputs and record agent steps locally

Adds a skill for a research workflow: before an agent analyzes instrument exports, it checks whether each file's exact bytes were sealed by an instrument station, written by a recorded step, or neither; after it writes results, it records the step (inputs, outputs, action) in a signed local ledger that a person reviews; before a report or handoff, it audits the lab folder (pass, review or fail).

The tool is Immutable QC's agent (iqc.mjs): one file, Node.js 22, no dependencies, and it never uses the network. The skill tells the agent to stop and tell the person when an input is untraced, and never to sign off its own steps.

Tested: <client and version>, on a sample folder sealed with iqc seal: check_inputs, record_step, trace and audit_summary. License: <D1>. Project: https://immutableqc.com/agents.html
```

## C6. awesome-mcp-servers

Needs C1 and D1. One line under "Biology, Medicine and Bioinformatics" (or "Research"), in the list's format, with the
list's own icons for JavaScript, local service, macOS, Windows and Linux in place of the placeholders (see its legend;
it takes servers with a public GitHub repo: https://github.com/punkpeye/awesome-mcp-servers/blob/main/CONTRIBUTING.md):

```
- [fabreu08/immutableqc-website](https://github.com/fabreu08/immutableqc-website) <JavaScript> <local> <macOS> <Windows> <Linux> - Tamper-evident records for lab data: check whether input files are sealed instrument output, record each agent step (inputs, outputs, action) in a local signed ledger, trace results back to sealed files, and audit a lab folder. One file, no dependencies, never uses the network.
```

## C7. Lab lists

Needs C1.

- awesome-lab-agents, under "Lab Tooling" (https://github.com/gunkaynar/awesome-lab-agents):
  `- [Immutable QC](https://immutableqc.com/agents.html) - Local MCP server and CLI for lab data: checks whether input files are sealed instrument output, records agent steps in a signed ledger, audits a lab folder. Never uses the network.`
- awesome-self-driving-labs, under Software > "Research data management"
  (https://github.com/AccelerationConsortium/awesome-self-driving-labs; the researchers saw this section only through
  search, so confirm it exists):
  `- [Immutable QC](https://immutableqc.com) - Tamper-evident records for automated labs: seals every file an instrument writes into a local signed ledger, records AI agent steps, and audits a folder in the browser with nothing uploaded.`

## C8. A plugin directory for a local server

Needs D1 and D4. One desktop client's directory no longer takes MCPB submissions, so a local server goes in a plugin
(https://claude.com/docs/connectors/building/mcpb.md, https://claude.com/docs/plugins/submit,
https://github.com/anthropics/claude-plugins-official). Draft the plugin folder only after D4: its manifest, an MCP
configuration that starts the bundled `iqc.mjs mcp`, the skill from C5, a README and the LICENSE; check them against the
current spec when submitting. Data-handling answer for the form: "The plugin sends no data anywhere. The server reads
files under the folder it is given and writes its own ledger there and a signing key in the user's home folder; it never
uses the network." The contact email goes in the form only.

## C9. Other directories

Needs C2.

- Smithery takes a local server as an MCPB upload:
  `smithery mcp publish ./dist/immutableqc-0.1.0.mcpb -n immutableqc/laboratory-instrument-provenance`
  (https://www.smithery.ai/docs/concepts/cli).
- Glama and PulseMCP index GitHub and the registry: a week after C4, check that each has a page for it.
- mcp.so form: name "Immutable QC"; the C6 description; the repo URL; tags "laboratory, lab automation, provenance,
  tamper-evident, local".

## C10. An npm package (optional)

Needs D1 and D7. The registry does not need it, and the site keeps "an npm package" under Upcoming until it is
published (`site/tools/wording.mjs` fails any "npm install <name>" in the present tense). `immutableqc` and `iqc` were
unclaimed on 2026-10-18 (https://registry.npmjs.org/immutableqc and https://registry.npmjs.org/iqc returned 404). The
package: `download/iqc.mjs` as `bin`, with `"mcpName": "com.immutableqc/laboratory-instrument-provenance"`, `license`,
`repository` and `homepage`. Then add a second `packages` entry to `server.json`, and change the site's copy and the
npm lint in the same commit.

## C11. Posts

Needs C1 to C4. Channels are the founder's choice. They follow the site's wording rules and name no firm.

1. "An AI agent wrote your lab's summary table. Which of the files it read were the instruments' own output, unchanged?
   Immutable QC answers locally: a one-file agent seals every file an instrument writes, and an MCP server lets the
   agent check its inputs and record each step (what it read, wrote and did) in a signed ledger a person signs off.
   Nothing is uploaded. Open alpha: immutableqc.com/agents.html"
2. "Building a self-driving lab or an instrument agent? `node iqc.mjs watch <folder>` seals every file your software
   writes, from any vendor, by its bytes. Your agent connects over MCP on standard input and output and calls
   check_inputs before it analyzes, record_step after it writes. One file, Node.js 22, no dependencies, no network.
   immutableqc.com/agents.html"
3. "In April 2026 an FDA warning letter cited a firm whose AI agents drafted specifications and master records without
   review by its quality unit. A record of what each agent read, wrote and did, with a person's sign-off on each step,
   is the part you can set up today, locally: immutableqc.com/agents.html"
   Source: https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/warning-letters/purolea-cosmetics-lab-722591-04022026.
   The researchers read it only through summaries: read the letter itself before posting, and keep the post to what
   the letter says.

## Afterwards: the re-test (plan section 6, parts 2 and 3)

- Registry: searches for `laboratory`, `instrument`, `lab-instrument`, `provenance` and `immutableqc` each list the
  entry.
- Install paths: the `.mcpb`, `npx skills add`, `gh skill install` and the README's server entry each work from a clean
  home folder.
- AI answers: the five questions of plan section 2 plus five generic ones, 20 runs each per assistant with web search
  on; report the share of runs that name Immutable QC or cite immutableqc.com or the repo (today 0).
- Search Console and Bing Webmaster Tools: impressions, clicks and pages indexed. GitHub: views, referrers (kept 14 days:
  export weekly), stars, release downloads. Crawler fetches of `llms.txt` cannot be counted (GitHub Pages gives no
  server logs).
