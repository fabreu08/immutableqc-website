# Agent discovery plan (internal; not published)

Revision 1, 2026-10-18, branch `claude/nifty-gates-h5guqf`. Written from three reports: channels research, ecosystem
research and the baseline agent test (working files under the session scratchpad, `agent-discovery/`). Every repo fact
below was checked in this branch on 2026-10-18, by the baseline test or again for this plan. Every outside fact carries
its URL; the ones the researchers could only read through search summaries or vendor data are marked "(secondary)".

The deploy allowlist never publishes `docs/`, so this file is not on immutableqc.com. **It is still public:** the
GitHub repo `fabreu08/immutableqc-website` is public (`gh api repos/fabreu08/immutableqc-website`: `"visibility":
"public"`), and this branch is pushed. Write nothing here that should not be read by anyone.

## 1. The goal

The founder: "I want our marketing to be AI-agent aware: AI agents working at labs should find our platform and
consider it." That takes three things, in this order:

1. **Found.** Immutable QC turns up where lab agents and the people who build them look for tools: MCP registries and
   directories, GitHub, Agent Skills, and the answers of AI assistants that search the web.
2. **Considered.** Everything an agent can read (the site as static text, `llms.txt`, the README, the registry entry,
   the tool descriptions) says the same true thing: what works today, what is Upcoming, how to try it in one command,
   how to connect it, and its limits. Today it does not (section 1.1).
3. **Chosen and used well.** Once installed, the server's instructions and tool descriptions make an agent call
   `check_inputs` before it uses lab files and `record_step` after it writes, and tell it what to do when an input is
   untraced.

Hard limits on every deliverable (unchanged by this plan):
- `docs/patent-guardrails.md`: no blockchain or distributed ledger, no anchoring on a network, no hosted service through
  which anyone requests records. So no remote MCP server, no hosted MCP, no hosted-server directory listings.
- `site/build.mjs` section 7 and `e2e/shipped-wording.test.mjs`: no proof, guarantee, immutable as a property,
  crypto (any word containing it, on pages), token(s), trustless, compliant or compliance, registry, blockchain (outside
  About's question and the landing page's "No blockchain"), customers (but "no customers yet"), pilots, prices; no vendor
  or company names; no email address (contact through joseqc.com); present tense only for what works, otherwise
  "Upcoming"; never the founder's employer.
- The site is static GitHub Pages; `site/tools/deploy.mjs` is an explicit allowlist (never `.md`, never a dotfile, so no
  `/.well-known/`); every page has a CSP and makes no third-party request.
- `index.html` and `ui/landing.*` belong to the landing bot. Changes there go in the brief (section 5).

### 1.1 Where we are (2026-10-18)

| What an agent meets | Today |
|---|---|
| Web search for "immutableqc.com Immutable QC" | Nothing from the site; results are a blockchain gaming company also called "Immutable" (ecosystem report; e.g. https://web3.career/test-automation-lead-immutable/23130) |
| Official MCP Registry, name search | No entry. `laboratory` 1 unrelated result, `lab-instrument` 0, `instrument` 6 unrelated, `provenance` 12 unrelated, `tamper` 2 unrelated, `audit` 100+ (queried 2026-10-18: https://registry.modelcontextprotocol.io/v0/servers?search=laboratory) |
| GitHub default branch `main` | Last commit 2026-10-08: the old site, `contracts/RootRegistry.sol` (Filecoin), no README, no `agent/`, no MCP server. Description, homepage, topics and license all empty |
| Published pages, read as text | "MCP" appears on none. `overview.html` §8 and `roadmap.html` §2.4 call "Agentic workflows" Upcoming ("there is no API yet"); `check.html` says "Not an API"; `sealed.html` lists "Agentic workflows: Upcoming" |
| `/llms.txt`, `/llms-full.txt`, `/robots.txt`, `/sitemap.xml` | All 404; the allowlist has no slot for them; `site/tools/serve.mjs` has no `.xml` type |
| The one good agent document | `agent/README.md` (MCP tool table, client config, Python example): never published (`agent/` and `.md` are in `NEVER`), absent from `main` |
| License | None on any branch, so no one may copy or vendor `iqc.mjs` (https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository) |
| The MCP server, once connected | Works: 4 tools, input and output schemas, read-only annotations correct, errors as sentences, protocol versions 2026-07-28 to 2024-11-05. Gaps: section 5, A9 |

What works today (checked in this branch; the only things any copy may state in the present tense):
- `download/iqc.mjs` (version 0.1.0, one file, no dependencies, Node.js 22 or later, refuses to run on older Node; it
  never uses the network): `watch` and `seal` seal every file in a folder by its bytes (SHA-256, size, time; each record
  signed with ECDSA P-256 and linked to the one before, in `<folder>/ImmutableQC/ledger.jsonl`); `record` records an
  agent step (inputs, outputs, action) in the agent's own ledger; `trace` traces a file back to sealed files; `review`
  signs off steps; `audit` checks every ledger and file under a folder (exit 0 pass, 3 review, 1 fail, 2 usage or read
  error); `head`, `status`; `mcp` serves `check_inputs`, `record_step`, `trace` and `audit_summary` over MCP on
  standard input and output.
- `app/` audits a whole lab folder in the browser with nothing uploaded (CSP `connect-src 'none'`), shows agent steps
  traced back to sealed measurements with untraced inputs sent to review, and has a review mode ("Review and sign off")
  that signs `review` records with the browser's key; the demo at `/app/#demo` shows a pass, a review and a fail.

Upcoming (label every mention): an npm package, a Windows installer or service, extracting values from inside files,
per-person keys and signatures, Merkle batches, sealing inside the vendor's software, post-quantum signatures. A
`.mcpb` bundle and a skill install command are Upcoming on the site until they are released; the site never mentions a
registry listing at all (the word is banned on every published file).

## 2. Five situations in which a lab agent looks for us

From the ecosystem report, section 5. "Asks" is what the agent types into a web search, a registry search or a client's
tool search; "Must find" is what decides whether it considers us; "Where" is the deliverable that puts it there.

| # | Situation | Asks | Must find | Where |
|---|---|---|---|---|
| 1 | An analysis agent is about to use instrument exports | "How can I verify this instrument export is the original, unmodified file before I analyze it?"; tool search "check input provenance measured" | `check_inputs` answers measured, derived or untraced per file and flags a sealed file that changed; files must already be sealed by `iqc watch`/`iqc seal`; paths under `--root`; reads only; never uses the network | Server instructions (A9), skill (A4), `agents.html` and `llms.txt` (A1, A2) |
| 2 | A regulated lab governs its agent's outputs | "MCP server to record AI agent analysis steps (inputs, outputs, action) as a signed record for human review" | `record_step` stores SHA-256 and size, appends a signed record that "cannot be taken back, only reviewed", warns on untraced inputs; a person signs off with `iqc review` or the app; no review tool over MCP, so an agent cannot approve its own step; a step records only the files it names; a key identifies a computer or browser, not a person (per-person keys Upcoming) | Registry entry (C4), README (A6), `agents.html` (A2), posts (C11) |
| 3 | A reviewer or PI asks where a number came from | "Trace this AI-generated result back to the raw instrument files" | `trace` returns the tree and `tracesToMeasured`; the app audits the folder in one click, nothing uploaded; values inside files are not extracted (Upcoming) | `agents.html`, landing page (B), app |
| 4 | A builder of a self-driving lab or instrument agent | "Vendor-agnostic, local, open, tamper-evident capture of instrument output files and agent steps, no cloud"; registry search "laboratory", "instrument" | `iqc watch` seals any file from any software by its bytes; settle window (10 s default); `--ledger` keeps the ledger outside a vendor-managed folder; one file, Node 22, no dependencies, SHA-256 published; not a network service; the exact MCP config JSON; license | GitHub repo and release (C1, C2), registry (C4), awesome lists (C6, C7), `llms-full.txt` |
| 5 | A pre-submission or handoff check | "Audit a lab data folder for changed or missing files and untraced AI outputs before I report or deposit the data" | `audit_summary` and `iqc audit`: pass, review or fail (exit 0, 3, 1); what a pass does not show (a value wrong when written; a change inside the settle window; a rewrite by whoever holds the key, which `--expect-head`/`--pin-file` exposes) | Skill (A4), `agents.html`, `llms-full.txt` |

Facts that must be in static published text (not built by JavaScript: the major AI crawlers do not run it,
https://vercel.com/blog/the-rise-of-the-ai-crawler) for all five: a one-sentence description built from the search
words (lab, instrument files, AI agent steps, tamper-evident, provenance, local); the four tool names with one line each
and whether they only read; the protocol versions; the run command and the config block; requirements and systems;
"never uses the network"; the format (JSON Lines, SHA-256, ECDSA P-256); the limits and the Upcoming list; the license
(D1); contact through joseqc.com.

## 3. Channels, ranked by impact

Ranked for a small, pre-customer product whose server runs only locally. Impact = how many lab agents or builders the
channel reaches times how much it decides whether they consider us.

1. **A public, current, licensed GitHub repo with releases.** Every channel below reads it: the MCP Registry's MCPB
   packages must be GitHub or GitLab release assets
   (https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/package-types.mdx);
   awesome-mcp-servers takes only servers with a public GitHub repo
   (https://github.com/punkpeye/awesome-mcp-servers/blob/main/CONTRIBUTING.md); Agent Skills install from `owner/repo`
   (https://www.skills.sh/, https://github.blog/changelog/2026-04-16-manage-agent-skills-with-github-cli/); the
   plugin directory needs a README and a license (https://claude.com/docs/plugins/submit). GitHub search uses topics and
   shows the README first (https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics).
   Today `main` shows a Filecoin contract and no README: a builder who opens it reads "blockchain project".
2. **The official MCP Registry, through an MCPB bundle on a GitHub release.** It is the upstream feed for aggregators
   and clients' galleries (https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/about.mdx;
   GitHub's curated registry has synced from it, https://github.com/github/github-mcp-server/discussions/1257, not
   verified as current). It needs **no npm
   package**: `registryType: mcpb`, a release URL containing "mcp", and `fileSha256` (package-types, above). Search
   matches names only, by substring ("Search servers by name (substring match)",
   https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/openapi.yaml), and the lab words are
   empty today (section 1.1), so a descriptive name would stand almost alone. Domain namespace `com.immutableqc/*`
   by a DNS TXT record at the apex
   (https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/authentication.mdx); HTTP
   verification would need `/.well-known/`, which the allowlist forbids. Description at most 100 characters, title at
   most 100 (openapi.yaml). Still "preview"; data resets possible. Stuffed marketing descriptions are removed
   (https://modelcontextprotocol.io/registry/moderation-policy).
3. **An Agent Skill (SKILL.md), plus the lab skill collections.** The name and description load at startup in every
   client that supports skills; the body loads when a task matches
   (https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx). 46 clients are listed, coding agents
   and research agents among them (https://github.com/agentskills/agentskills/blob/main/docs/snippets/clients.jsx). The
   lab-specific route: Scientific Agent Skills, 177 skills with a "Laboratory Automation" category, community pull
   requests after review and a security scan (https://github.com/K-Dense-AI/scientific-agent-skills,
   https://arxiv.org/abs/2609.00065); its scope is "a scientific package, database, platform, or research workflow".
   Life-sciences assistants ship skills and MCP connectors together (https://www.anthropic.com/news/claude-for-life-sciences).
4. **Site text that is static, current and agent-readable.** It decides "considered" for every channel above, because
   each one links to immutableqc.com. Fix the pages that call working features Upcoming; one page for agents; `llms.txt`
   and `llms-full.txt`; `robots.txt` and `sitemap.xml`; verify the domain with the search engines. Evidence on
   `llms.txt` is mixed: Google Search ignores it (https://developers.google.com/search/docs/fundamentals/ai-optimization-guide);
   97% of 137k domains' files got no AI requests in May 2026 (https://ppc.land/llms-txt-adoption-rises-8-8x-but-97-of-files-get-zero-ai-requests/,
   secondary); but coding agents do fetch it (33.6% of sampled sessions of one coding agent, by curl:
   https://www.withgauge.com/blog/does-codex-read-llms-txt/, vendor data), and Lighthouse 13.3 checks it
   (https://searchengineland.com/google-llms-txt-chrome-lighthouse-478246, secondary). AI search answers come from search
   indexes (ChatGPT search: `OAI-SearchBot`, https://developers.openai.com/api/docs/bots; Claude: `Claude-SearchBot`,
   `Claude-User`, https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler;
   Google AI features: Googlebot, https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers).
   Bing uses sitemap `lastmod` as a recrawl signal (https://www.searchenginejournal.com/bing-recommends-lastmod-tags-for-ai-search-indexing/552642/, secondary).
5. **Selection inside the client: server instructions and tool descriptions.** One client loads only tool names and
   server instructions at session start, tells authors to "put the words Claude would search for near the start", and
   cuts instructions at 4,096 characters (https://code.claude.com/docs/en/mcp). Edited descriptions got more than 10
   times the usage (https://arxiv.org/abs/2505.18135), and assertive wording is manipulation
   (https://arxiv.org/abs/2510.02554): keep them factual. Our instructions start "Records the steps you take on files
   under one folder", never say lab, provenance or tamper-evident, and reach "instrument" only in the second sentence.
6. **The Claude plugin directory.** The only reviewed route for a local server in that client: the desktop directory
   "no longer accepts MCPB submissions"; a local server goes in a plugin (https://claude.com/docs/connectors/building/mcpb.md,
   https://claude.com/docs/plugins/submit, https://github.com/anthropics/claude-plugins-official). Needs vendor-specific
   files (D4).
7. **Directory and list entries.** awesome-mcp-servers (a one-line pull request; most entries carry a Glama score badge,
   whose quality score is mostly tool-definition quality, https://glama.ai/mcp/servers/sidclawhq/platform/score);
   awesome-lab-agents "Lab Tooling" (https://github.com/gunkaynar/awesome-lab-agents, small); awesome-self-driving-labs
   "Research data management" (https://github.com/AccelerationConsortium/awesome-self-driving-labs, seen through search);
   Smithery takes local servers as an MCPB upload (https://smithery.ai/docs/build/publish); Glama, PulseMCP and mcp.so
   index GitHub or the registry (https://unyly.org/mcp-directories, secondary).
8. **Mentions elsewhere (GEO).** Citations, quotations and statistics raised generative-engine visibility by up to 40%
   (https://arxiv.org/abs/2311.09735); branded web mentions correlate 0.66 to 0.71 with AI visibility
   (https://ahrefs.com/blog/ai-brand-visibility-correlations/, correlation only); AI brand lists repeat under 1% of the
   time, so measure over many runs (https://www.mediapost.com/publications/article/412364/ai-brand-recommendations-chaotic-inconsistent.html,
   secondary). Slow, compounding: posts, community answers, a methods note or preprint.
9. **schema.org JSON-LD.** Cheap, weak: Google has no special schema for AI features
   (https://developers.google.com/search/docs/appearance/ai-features); Bing said schema helps Copilot (secondhand,
   https://searchengineland.com/schema-markup-ai-search-no-hype-472339). Landing page only, through the brief.
10. **AGENTS.md.** Helps agents working in our repo, and gives labs a snippet for theirs (https://github.com/agentsmd/agents.md;
    adoption reported at 60,000+ projects, https://openai.com/index/agentic-ai-foundation/). Does not help anyone find us.

Not doing: remote or hosted MCP servers, hosted directory deployments, Hugging Face Spaces (all hosted: patent
guardrails rule 2 and the no-network design); the Docker MCP Catalog (a container is a poor fit for sealing local lab
folders, https://github.com/docker/mcp-registry); `/.well-known/` files; per-page `.md` copies (the allowlist bans `.md`;
`llms-full.txt` carries the long text instead).

## 4. Founder decisions that gate the outward steps

| # | Decision | Why it matters | Recommendation |
|---|---|---|---|
| D1 | A license for the agent, core and skill | No license: no one may copy or vendor `iqc.mjs`; awesome lists, the plugin directory and Glama's score look for one | Pick one with the patent attorney (MIT or Apache-2.0 are the common choices for MCP servers); add `LICENSE` |
| D2 | Which repo is the public face | `main` is stale and shows the Filecoin contract; merging this branch into `main` also publishes the site (`pages.yml` deploys from `main`) | Bring `main` up to date from this branch once A lands and the checks pass; consider renaming the repo (it holds the product, not only a website; GitHub redirects old URLs). Decide before any submission: every listing records the repo URL |
| D3 | A sentence on cost | Builders look for it; "price" is a banned word on the site | If true, "Free to use during the open alpha." Otherwise say nothing |
| D4 | Client brand names outside the site | Client-specific setup lines (a coding agent's one-line `mcp add` command, a plugin folder) help agents match us but name vendors | Allow them in the README, the plugin folder and the registry text only; keep the site and `llms*.txt` client-neutral ("any MCP client that starts local servers over standard input and output") |
| D5 | Link the source repo from the site | Agents verify code before they recommend it; the doc-set lint allows external links only to joseqc.com | Allow one "Source code" link to the repo URL on `agents.html`, `llms*.txt` and in JSON-LD `sameAs`, without naming the company in prose |
| D6 | Ask the patent attorney | `docs/patent-guardrails.md` (claim readings, "Close" findings) is publicly readable on GitHub today; marketing words near claim language | Ask whether internal patent readings should stay in a public repo; keep marketing off "audit trail of the instrument" and "operating logs" (rule 3); describe what we seal as "every file, by its bytes" |
| D7 | The MCP server name | Registry search is by name substring | `com.immutableqc/laboratory-instrument-provenance` (matches laboratory, lab, instrument, provenance, immutableqc) |
| D8 | Two agent behaviors | Starting `iqc mcp` writes `ImmutableQC/ledger.jsonl`, `README.txt` and a new key in `~/.immutableqc/keys/` (checked 2026-10-18); 3 of 4 parallel `iqc record` calls on one root fail on the lock (baseline) | Until decided, document both as limits (A1, A2, A4). Options: create the ledger lazily on the first `record_step`; a `--wait <s>` retry for `record` |

## 5. Deliverables

Owners: **Builder** = the next step of this workflow; **Lead** = the session that integrates branches; **Landing bot** =
the team rewriting `index.html` and `ui/landing.*`; **Founder**. "Approval: none" means internal and reversible: it
reaches immutableqc.com only when the founder merges to `main` (D2), though anything pushed is readable on GitHub.

### (A) Built now in this repo, in files nobody else is editing

Order of work: A1, A2, A3, A8 and A11 together (the site text and its checks), then A4 to A7, then A9 on its own branch.

| # | Deliverable | Files | Owner | Approval |
|---|---|---|---|---|
| A1 | `robots.txt`, `sitemap.xml`, `llms.txt`, `llms-full.txt` | `site/pages/llms.txt`, `site/pages/llms-full.txt` (templates), `robots.txt`, build output `sitemap.xml`, `llms.txt`, `llms-full.txt`; `site/build.mjs`, `site/tools/deploy.mjs` `FILES`, `site/tools/serve.mjs` (`.xml`) | Builder | none |
| A2 | `agents.html`, "For AI agents", a document-set page (IQC-AG-01) | `site/pages/agents.html`, `site/data/site.json`, nav, `site/tools/check.mjs` `DOCS` | Builder | none (D5 for the repo link) |
| A3 | The document set stops calling working features Upcoming | `site/pages/overview.html` §8, `roadmap.html` §1 and §2.4, `check.html` (line 15), `sealed.html` (line 108), `regulatory.html` (47, 79); the lints that pin the old wording (`site/build.mjs`, e.g. the `check.html` "Upcoming" agent-JSON assertion) | Builder | none |
| A4 | Agent Skill | `skills/immutableqc-lab-records/SKILL.md`, `skills/immutableqc-lab-records/references/` | Builder | none (D1 for `license:`) |
| A5 | `AGENTS.md` at the repo root | `AGENTS.md` | Builder | none |
| A6 | README for agents and their builders | `README.md`, `agent/README.md` (fixes only) | Builder | none (D4 for client lines) |
| A7 | Registry metadata and an MCPB bundle, drafted | `server.json`, `agent/mcpb/manifest.json`, `agent/tools/mcpb.mjs`, `agent/test/mcpb.test.mjs`, `.gitignore` (`dist/`) | Builder | none to draft; publishing is C2 to C4 |
| A8 | Lints for every new text | `site/build.mjs` (new section 7i), `e2e/shipped-wording.test.mjs` (`.xml`), new `e2e/repo-wording.test.mjs` | Builder | none |
| A9 | Server instructions, tool descriptions, CLI help (agent/src) | `agent/src/mcp.mjs`, `agent/src/cli.mjs`, `agent/src/lab.mjs`, `agent/test/mcp.test.mjs`, `download/iqc.mjs` (rebuilt) | Builder, on branch `claude/agent-discovery-mcp`; Lead merges | none; the Lead re-stamps `index.html` after the landing bot's work lands |
| A10 | Marketing drafts' "works today" | `docs/marketing/README.md` and the "Upcoming" lines its files mark | Builder | none |
| A11 | The automated re-test | `e2e/agent-discovery.test.mjs` | Builder | none |

**A1. Site files for agents.**
- `robots.txt`, exactly:
  ```
  # immutableqc.com: every page is open to people, search engines and AI agents.
  User-agent: *
  Allow: /

  Sitemap: https://immutableqc.com/sitemap.xml
  ```
  One open group covers every crawler; named groups are only needed to block (channels report). `dashboard/` keeps its
  `noindex` meta and stays crawlable, so crawlers can read that.
- `sitemap.xml`, written by `site/build.mjs`: `https://immutableqc.com/`, `/app/`, `/agents.html` and the six documents
  (not `404.html`, not `dashboard/`), each with a true `lastmod` (the date its content last changed; keep it in
  `site/data/site.json`, a build check that each page listed is published and each published page but 404 and the
  redirect is listed). No `changefreq` or `priority` (Bing ignores them, source above). Add `'.xml':
  'application/xml; charset=utf-8'` to `serve.mjs`.
- `llms.txt`, written by the build from `site/pages/llms.txt` with placeholders for the download's SHA-256, the version
  and the protocol versions (from `agent/src/mcp.mjs` `SUPPORTED_VERSIONS`), so it cannot drift. Follow the spec: H1,
  blockquote, then paragraphs and lists without headings, then H2 sections of links
  (https://github.com/AnswerDotAI/llms-txt/blob/main/nbs/index.qmd). Under 6 KB. Absolute URLs. Content:
  - H1 `Immutable QC`; blockquote: "Tamper-evident records for automated research labs. A one-file local agent seals
    every file an instrument writes into a signed ledger, records what AI agents read and wrote, and serves
    check_inputs, record_step, trace and audit_summary to AI agents over MCP on standard input and output. Nothing is
    uploaded; it never uses the network."
  - Status line "Independent project · Open alpha · No customers yet"; a "Works today" list and an "Upcoming" list
    (section 1.1).
  - Try it: one click, `https://immutableqc.com/app/#demo`; one command, after the download:
    `curl -fsSO https://immutableqc.com/download/iqc.mjs && sha256sum iqc.mjs && node iqc.mjs help` with the SHA-256
    to compare (and the macOS and Windows commands).
  - Connect it: the client config JSON **with `--search`** (the baseline's false negative came from leaving it out):
    `{"command": "node", "args": ["/path/to/iqc.mjs", "mcp", "--root", "/lab/agent-workspace", "--search", "/lab"]}`,
    and one line each: the root is the folder the agent works in, every path must sit under it; the search folders
    are where instrument ledgers are; starting the server creates `ImmutableQC/` in the root and a signing key in
    `~/.immutableqc/keys/` if none exists; one server or one `iqc record` at a time per root.
  - The four tools, one line each, with "reads only" or "appends one signed record".
  - Limits: a pass does not show a file was right when written, or a change inside the settle window; whoever holds a
    ledger's key could rewrite it (a head pinned elsewhere exposes that); "measured" means a ledger sealed those bytes,
    so check the sealing key against your instruments' keys (`iqc audit --expect-key`); a step records only the files it
    names; a key identifies a computer or browser, not a person (per-person keys Upcoming); values inside files are not
    read (Upcoming).
  - H2 "Start here": `agents.html`, `llms-full.txt`, `download/iqc.mjs`, `app/`, `app/#demo`. H2 "Docs": the six
    documents. H2 "Optional": joseqc.com (contact); the source repo if D5.
- `llms-full.txt`, from `site/pages/llms-full.txt`: everything an agent needs on one page, in plain text: the `llms.txt`
  content, then per command the options that matter (from `iqc help <command>`), the MCP section of `agent/README.md`
  (versions, results, errors), the Python `subprocess` example, how sign-off works (CLI `iqc review`, the app's review
  mode and its downloaded review ledger; no review tool over MCP), what the agent reads and writes, exit codes, the
  ledger format in brief, and a short "When it is not the right tool" (you need values checked inside files; you need a
  hosted service; you need per-person signatures today). Client-neutral (D4).
- Add `robots.txt`, `sitemap.xml`, `llms.txt`, `llms-full.txt` to `FILES` in `deploy.mjs`.

**A2. `agents.html`, "For AI agents".** One static page an agent or its builder can read with JavaScript off; the URL
every listing points to as `websiteUrl` or documentation. Sections: what it is (the blockquote sentence); works today and
Upcoming; run it (download, SHA-256, Node 22, Windows, macOS, Linux, one file, no dependencies); connect the MCP server
(the config block, root and search, what starting it writes, one writer per root); the four tools (a table: name, what it
returns, reads or writes); the loop an agent follows (check inputs; if an input is untraced or changed, tell the person
before relying on it; work; `record_step` once per step naming every file read and written; `trace` or `audit_summary`
before reporting); from a pipeline (`iqc record`, the Python example); sign-off by a person; what a pass shows and does
not show; data handling (never uses the network, nothing uploaded, what it writes); format and protocol versions;
questions, visible on the page (no FAQ markup needed: FAQ rich results ended, https://inblog.ai/blog/google-faq-schema-rich-result-deprecation,
secondary); contact through joseqc.com. In the page head: `<link rel="describedby" href="llms.txt">` (relative: the
doc-set lint bans root-relative paths). Build changes: a `site.json` page entry (IQC-AG-01), the nav lint (it expects
exactly six documents and the app), `check.mjs` `DOCS`, the 7d count of root pages. Lint it with the v1 rules
(`lintV1` and the 7h guard, as for the hand-written pages), not 7b/7e, which were written for the old five-field
construction and would flag true v1 sentences ("derived", "flags"); keep the doc-set status line rule or give this page
the v1 line ("Independent project · Open alpha · No customers yet") with a stated exception. The repo link needs D5 and
a change to the doc-set rule "external links only to joseqc.com".

**A3. The document set stops contradicting the product.** Change only the sentences about agent steps, traces back to
sealed measurements, reviewer sign-off and the MCP server: they work today. `overview.html` §8 becomes present tense and
links `agents.html`; `roadmap.html` moves "Agentic workflows" from §2.4 Upcoming to §1 "Today", and §1's app line
(today only "a demo shows a pass and a fail") adds the agent view and review mode; `check.html` line 15 and
`sealed.html` line 108 follow. `regulatory.html` lines 47 and 79 list "Reviewer sign-off: Upcoming" under Not covered:
sign-off works today, but it is signed by a computer's or browser's key, so for "signer" and "who made the change" the
honest line is "Reviewer sign-off works; it identifies a computer or browser, not a person. Per-person signatures:
Upcoming." Leave Upcoming what is: sealing at capture inside the orchestrator or driver, values
inside files, per-person signatures, Merkle batches, post-quantum. Use "traces back to sealed measurements", never
"lineage" (7e and V1 lints). Update the lints that pin the old sentences in the same commit.

**A4. Agent Skill `skills/immutableqc-lab-records/`.** Per the spec (name at most 64 characters, lowercase and hyphens,
equal to the folder; description at most 1024; body under 500 lines; references one level deep). Frontmatter:
```yaml
---
name: immutableqc-lab-records
description: Check lab instrument files and record AI agent analysis steps with Immutable QC (iqc), a local tool that never uses the network. Use it before you use instrument exports or other lab data files as inputs (it says whether each file's exact bytes were sealed by an instrument station, written by a recorded step, or neither, and whether a sealed file changed), after you write derived files such as summaries, fits, plots or reports (to record what you read, what you wrote and what you did, in a signed local ledger a person can review), and when someone asks where a result came from or wants a lab data folder audited before a report, a deposit or a handoff.
license: <D1>
compatibility: Needs Node.js 22 or later and iqc.mjs (one file, no dependencies). Works offline.
metadata:
  homepage: https://immutableqc.com/agents.html
  version: "0.1.0"
---
```
(659 characters of description.) Body: find the tools (the MCP tools if connected, else `node <path>/iqc.mjs`; if
neither, ask the person, and verify a downloaded `iqc.mjs` against the SHA-256 on immutableqc.com); check inputs first;
what to do per state (measured: use; derived: `trace` it; untraced or changed after seal: tell the person before you rely
on it, never quietly continue); record each step after writing, naming every file read and written, `input_refs` for
inputs outside the root; audit before reporting; never sign off your own steps (`iqc review` is for a person); the
limits; the two errors agents meet (path outside the root: copy the file in or ask for a wider root; ledger busy: one
writer per root, retry later). `references/cli.md` (record, trace, audit, review options; exit codes) and
`references/mcp.md` (config, tools, versions). No copy of `iqc.mjs` in the skill until D1; then an optional
`scripts/iqc.mjs` kept equal to `download/iqc.mjs` by a test.

**A5. `AGENTS.md`.** For coding agents in this repo: what is where (from README's table); the commands (`node --test core/test
agent/test ui/test`, `node --test app/test e2e`, `node site/build.mjs --check`, `node site/tools/check.mjs`, `node
agent/tools/bundle.mjs`); the rules (never edit `download/iqc.mjs` by hand; any new published file goes in the allowlist
and the lints; the wording rules; the patent guardrails in five lines; `index.html` and `ui/landing.*` belong to the
landing page owner; no network API in `app/`, `ui/`, `core/`). Then "Using iqc in your own lab repo": a snippet to paste
into a lab's AGENTS.md ("Before you use files under `<lab folder>`, call `check_inputs`; after you write files, call
`record_step`; tell a person about any untraced input").

**A6. README.** First line names the entity and category: "Immutable QC: tamper-evident records for automated research
labs." Then, before the developer content: what works today and Upcoming; for AI agents and their builders (download,
SHA-256, the MCP config JSON with `--search`, the four tools, the Python example, limits); license (D1); contact through
joseqc.com. Client-specific lines only after D4. Fix in `agent/README.md` and README: "Node.js 20 or later" (README "Run
the agent") becomes 22; the `help record` example (A9). Note: GitHub shows the README of `main` only (D2).

**A7. `server.json` and the MCPB bundle (drafts).**
- `agent/mcpb/manifest.json` (MCPB manifest 0.3, https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md):
  ```json
  {
    "manifest_version": "0.3",
    "name": "immutableqc",
    "display_name": "Immutable QC",
    "version": "0.1.0",
    "description": "Check lab input files against sealed instrument files, and record AI agent steps in a local ledger.",
    "long_description": "Tamper-evident records for automated research labs. check_inputs says whether each file's exact bytes were sealed by an instrument station (measured), written by a recorded step (derived), or neither (untraced). record_step appends a signed record of what the agent read, wrote and did. trace follows a file back to sealed files; audit_summary checks every ledger under the lab folder. Nothing is uploaded; the server never uses the network.",
    "author": { "name": "Immutable QC", "url": "https://immutableqc.com" },
    "homepage": "https://immutableqc.com",
    "documentation": "https://immutableqc.com/agents.html",
    "support": "https://joseqc.com",
    "server": {
      "type": "node",
      "entry_point": "server/iqc.mjs",
      "mcp_config": {
        "command": "node",
        "args": ["${__dirname}/server/iqc.mjs", "mcp", "--root", "${user_config.workspace}", "--search", "${user_config.lab_folder}"]
      }
    },
    "tools": [
      { "name": "check_inputs", "description": "Whether each file was measured, derived or untraced; reads only." },
      { "name": "record_step", "description": "Appends a signed record of one step: inputs, outputs, action." },
      { "name": "trace", "description": "Traces a file back to sealed files; reads only." },
      { "name": "audit_summary", "description": "Pass, review or fail for every ledger under the lab folder; reads only." }
    ],
    "keywords": ["laboratory", "lab-automation", "instrument-data", "provenance", "tamper-evident", "audit", "research-data", "ai-agents"],
    "license": "<D1>",
    "compatibility": { "platforms": ["darwin", "win32", "linux"], "runtimes": { "node": ">=22.0.0" } },
    "user_config": {
      "workspace": { "type": "directory", "title": "Agent workspace", "description": "The folder the agent reads and writes in. Every path a tool takes must be inside it.", "required": true },
      "lab_folder": { "type": "directory", "title": "Lab data folder", "description": "The folder that holds the instruments' sealed folders (searched for ledgers). It can be the workspace or a folder above it.", "required": true }
    }
  }
  ```
  (The description is 99 characters.) Check before release: the client's bundled Node.js is 22 or later (iqc refuses
  older; "Node.js ships with Claude for macOS and Windows", https://github.com/modelcontextprotocol/mcpb), and the
  `--search` folder may be the same as the root.
- `agent/tools/mcpb.mjs`: no dependencies (stored zip entries, `node:zlib` `crc32`, present in Node 22); packs
  `manifest.json` and `server/iqc.mjs` (byte-equal to `download/iqc.mjs`) into `dist/immutableqc-<version>.mcpb`,
  deterministic (fixed timestamps), prints its SHA-256 and, with `--server-json`, writes it into `server.json`. Test:
  version equals `AGENT_VERSION`; every `${user_config.x}` exists; the tools list equals `TOOLS` names; the archive's
  two entries; same input, same bytes.
- `server.json` at the repo root (never published: not in the allowlist), schema
  https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json:
  ```json
  {
    "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    "name": "com.immutableqc/laboratory-instrument-provenance",
    "title": "Immutable QC: lab instrument files and AI agent steps",
    "description": "Checks lab inputs against sealed instrument files; records and traces AI agent steps, locally.",
    "version": "0.1.0",
    "websiteUrl": "https://immutableqc.com/agents.html",
    "repository": { "url": "https://github.com/fabreu08/immutableqc-website", "source": "github" },
    "packages": [
      {
        "registryType": "mcpb",
        "identifier": "https://github.com/fabreu08/immutableqc-website/releases/download/v0.1.0/immutableqc-0.1.0.mcpb",
        "fileSha256": "<written by agent/tools/mcpb.mjs --server-json>",
        "transport": { "type": "stdio" }
      }
    ]
  }
  ```
  (Description 94 characters, title 53. Repo URL per D2; name per D7.) A test checks the lengths, the name pattern
  `^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$`, the version, and that the identifier contains "mcp".

**A8. Lints for every new text.**
- `site/build.mjs`, new section 7i, over `robots.txt`, `llms.txt`, `llms-full.txt`, `agents.html` and the sitemap: the
  hand-written-page rules (`BANNED` and `BANNED_SITE`, `EMAIL`, `US_SPELL`, `lintV1`, the 7h guard) read as plain-text
  sentences (code lines included: "crypto" and "registry" are banned there too); no MCP client brand names (a short
  list added beside the vendor names); drift checks: the four tool names equal `TOOLS`, the protocol versions equal
  `SUPPORTED_VERSIONS`, the SHA-256 equals the download's, "Node.js 22", every `--option` named exists in that
  command's `iqc help`, exit codes 0, 3, 1, 2.
- `e2e/shipped-wording.test.mjs`: add `xml` to `TEXT` (`.txt` is already read, as files of the manifest).
- New `e2e/repo-wording.test.mjs` over `README.md`, `AGENTS.md`, `skills/**`, `server.json`, `agent/mcpb/manifest.json`,
  `agent/README.md`: `BANNED` (vendor names only until D4), the shipped-wording `RAW` list with one allowance (the
  phrase "MCP Registry"), no email address, present tense per `lintV1`. These are public on GitHub and are our
  marketing too.
- Watch the rules that bite this text: "registry" is banned on every published file (so the site never says we are
  listed anywhere); "token(s)" is banned (MCP writing often says "tokens"); "cryptographic" fails on pages;
  "installer" and "npm package" must say Upcoming; "npm install x" is a present-tense claim; "lineage" must say
  Upcoming; "price", "customers", "pilots" are banned.

**A9. The MCP server as agents see it (branch `claude/agent-discovery-mcp`).** It changes `download/iqc.mjs`, whose
SHA-256 `index.html` prints (a build check), and `index.html` belongs to the landing bot; so build it on its own branch
with tests, and merge after the landing page's rewrite lands, when the Lead runs `node agent/tools/bundle.mjs --stamp`
(`llms.txt` regenerates from the build). Factual wording only (ToolTweak, above).
- Server instructions start with the search words: "Immutable QC: tamper-evident records for lab instrument files
  and AI agent steps, kept on this computer; it never uses the network." Then the loop; what to do with an untraced or
  changed input (tell the person before relying on it); the root and the search folders as configured (built at start);
  how to name a file outside the root (copy it in, or `input_refs` as `<sha256>:<bytes>:<label>`).
- `check_inputs`: "sealed by an instrument" becomes "sealed by a station's ledger"; the `measured` object adds the
  sealing ledger's `keyId` (baseline gap 6: a fabricated CSV sealed with a fresh key read "measured: sealed by
  plate-reader-1"); results of `check_inputs`, `trace` and `audit_summary` say which folders and how many ledgers were
  searched (gap 7). `record_step`: say the step is recorded even with an untraced input, and that the agent should tell
  the person.
- `iqc help mcp`: the client JSON shows `--search`; it says what starting the server writes, and one writer per root.
  `iqc help record`: the example names an input inside the root (`--in hplc-3/run-07.csv`), since `../hplc-3/run-07.csv`
  is refused with exit 2 as written (`agent/src/cli.mjs`).
- Tests in `agent/test/mcp.test.mjs` for each change; `node agent/tools/bundle.mjs` rebuilds the download.
- Not here (D8): lazy ledger creation, a lock retry, an expected-keys argument.

**A10. Marketing drafts.** `docs/marketing/README.md` still lists `iqc record`, `iqc trace`, `iqc review`, `iqc mcp`
and the app's review mode as Upcoming; they are merged and work. Update "What counts as works today" and the lines each
draft marks "Upcoming". C11's posts are written from section 1.1, not from those drafts.

**A11. The automated re-test, `e2e/agent-discovery.test.mjs`.** Serves the deploy allowlist (`serveDeploy`), reads
pages as text with no JavaScript, and asserts section 6, part 1. No network.

### (B) Brief for the landing bot (paste as is)

> **Agent discovery: landing page changes (from docs/agent-discovery.md).** Keep the founder's headline and design. All
> of this must be in the static HTML, not written by `ui/landing.mjs` (AI crawlers do not run JavaScript).
> 1. Meta description: `Tamper-evident records for automated research labs: seal every instrument file, record what
>    AI agents read and wrote, audit a folder in one click.` (146 characters.)
> 2. In the head: `<link rel="describedby" href="llms.txt">`.
> 3. A JSON-LD block (lint its strings with the 7g rules; `textOf` drops scripts today, so add that check):
>    ```html
>    <script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"Immutable QC","alternateName":"iqc","description":"Tamper-evident records for automated research labs. A one-file local agent seals every file an instrument writes into a signed ledger, records what AI agents read and wrote, and serves check_inputs, record_step, trace and audit_summary to AI agents over MCP on standard input and output. Nothing is uploaded; it never uses the network.","url":"https://immutableqc.com/","applicationCategory":"DeveloperApplication","operatingSystem":"Windows, macOS, Linux","softwareRequirements":"Node.js 22 or later","softwareVersion":"0.1.0","downloadUrl":"https://immutableqc.com/download/iqc.mjs","featureList":["Seals every file in a folder as it is written","Records the steps an AI agent takes on files","Traces agent outputs back to sealed measurements","Audits a lab folder in the browser; nothing is uploaded","Reviewer sign-off of agent steps"]}</script>
>    ```
>    Add `"license"` after D1 and `"sameAs": ["<repo URL>"]` after D5. No `offers` or price.
> 4. A short visible section "For AI agents" (about 80 words): "An MCP server on standard input and output:
>    check_inputs, record_step, trace, audit_summary." The config block
>    `{"command": "node", "args": ["/path/to/iqc.mjs", "mcp", "--root", "/lab/agent-workspace", "--search", "/lab"]}`,
>    and links to `agents.html` and `llms.txt`. No client brand names; never the word "registry".
> 5. Fix: "Needs Node.js 20 or later" becomes 22 (line 284 today); the pipeline block's exit codes are 0 pass, 3 review,
>    1 fail, 2 usage or read error; the install section shows `record`, `trace` and `mcp`; "Works today" includes agent
>    steps traced back to sealed measurements and reviewer sign-off; drop "Lineage" from Upcoming (say "values inside
>    files" if anything).
> 6. Footer: links "For AI agents" (`agents.html`) and `llms.txt`.
> 7. When the agent branch merges, `download/iqc.mjs` changes: run `node agent/tools/bundle.mjs --stamp`.
>
> For the founder, not the bot: "Immutable" plus "tokenized" reads as a crypto project to search engines and models (a
> blockchain company shares the name); the definition's "No blockchain, no coins" right under the H1 matters, and the
> meta description and JSON-LD above deliberately lead with the category instead.

### (C) Outward actions: founder approval before anyone does them

Order: C1 and C2 first (everything else points at them); C3 and C4 the same day; then C5 to C10; C11 last.

**C1. The repo as the public face** (Founder; needs D1, D2, D5). Merge to `main` (this publishes the site), add
`LICENSE`, then:
```
gh repo edit fabreu08/immutableqc-website \
  --description "Tamper-evident records for automated research labs: a one-file local agent seals instrument files, records AI agent steps and serves check, record, trace and audit tools over MCP (stdio). Nothing is uploaded." \
  --homepage https://immutableqc.com \
  --add-topic mcp-server --add-topic model-context-protocol --add-topic lab-automation --add-topic laboratory \
  --add-topic self-driving-lab --add-topic research-data --add-topic data-integrity --add-topic provenance \
  --add-topic tamper-evident --add-topic audit-trail --add-topic agent-skills --add-topic ai-agents \
  --add-topic reproducibility --add-topic sha256 --add-topic nodejs
```
(Description 208 characters.)

**C2. Release v0.1.0** (Founder). Assets: `iqc.mjs`, `immutableqc-0.1.0.mcpb`, `SHA256SUMS.txt`. Notes:
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

**C3. DNS records at the apex of immutableqc.com** (Founder). (a) The registry key:
`openssl genpkey -algorithm Ed25519 -out key.pem`, then the TXT record
`immutableqc.com. IN TXT "v=MCPv1; k=ed25519; p=<public key>"` (authentication doc, above; macOS needs OpenSSL 3 for
Ed25519). Keep `key.pem` off the repo. (b) The TXT values Google Search Console and Bing Webmaster Tools give for domain
verification; then submit `https://immutableqc.com/sitemap.xml` in both.

**C4. MCP Registry** (Founder; needs C2, C3, D7). Run `node agent/tools/mcpb.mjs --server-json`, upload the `.mcpb` to the
release, then `mcp-publisher login dns --domain immutableqc.com --private-key <key>` and `mcp-publisher publish`
(https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx). The metadata is
`server.json` in A7. Check: `https://registry.modelcontextprotocol.io/v0/servers?search=laboratory` lists it.

**C5. Agent Skill distribution** (Founder; needs C1). Nothing to submit for `npx skills add <owner>/<repo>` or
`gh skill install <owner>/<repo>`: test both in a clean home folder. Then a pull request to Scientific Agent Skills,
under Laboratory Automation, after reading its AGENTS.md and CONTRIBUTING.md and running its scanner:
```
Title: Add immutableqc-lab-records (Laboratory Automation): check lab inputs and record agent steps locally

Adds a skill for a research workflow: before an agent analyzes instrument exports, it checks whether each file's exact bytes were sealed by an instrument station, written by a recorded step, or neither; after it writes results, it records the step (inputs, outputs, action) in a signed local ledger that a person reviews; before a report or handoff, it audits the lab folder (pass, review or fail).

The tool is Immutable QC's agent (iqc.mjs): one file, Node.js 22, no dependencies, and it never uses the network. The skill tells the agent to stop and tell the person when an input is untraced, and never to sign off its own steps.

Tested: <client and version>, on a sample folder sealed with iqc seal: check_inputs, record_step, trace and audit_summary. License: <D1>. Project: https://immutableqc.com/agents.html
```

**C6. awesome-mcp-servers** (Founder; needs C1, D1). One line under "Biology, Medicine and Bioinformatics" (alternative:
"Research"), in the list's format, with the list's own icons for JavaScript, local service, macOS, Windows and Linux
from its legend:
```
- [fabreu08/immutableqc-website](https://github.com/fabreu08/immutableqc-website) <JavaScript> <local> <macOS> <Windows> <Linux> - Tamper-evident records for lab data: check whether input files are sealed instrument output, record each agent step (inputs, outputs, action) in a local signed ledger, trace results back to sealed files, and audit a lab folder. One file, no dependencies, never uses the network.
```

**C7. Lab lists** (Founder; needs C1).
- awesome-lab-agents, "Lab Tooling":
  `- [Immutable QC](https://immutableqc.com/agents.html) - Local MCP server and CLI for lab data: checks whether input files are sealed instrument output, records agent steps in a signed ledger, audits a lab folder. Never uses the network.`
- awesome-self-driving-labs, Software > "Research data management":
  `- [Immutable QC](https://immutableqc.com) - Tamper-evident records for automated labs: seals every file an instrument writes into a local signed ledger, records AI agent steps, and audits a folder in the browser with nothing uploaded.`

**C8. Claude plugin directory** (Founder; needs D1, D4). A plugin folder (`.claude-plugin/plugin.json`, `.mcp.json`
starting the bundled `iqc.mjs mcp`, the A4 skill, README, LICENSE), drafted only after D4, checked against the current
spec at submission. Data-handling answers: "The plugin sends no data anywhere. The server reads files under the folder
it is given and writes its own ledger there and a signing key in the user's home folder; it never uses the network."
The contact email is entered by the founder in the form, never written in the repo or on the site.

**C9. Other directories** (Founder; needs C2). Smithery: `smithery mcp publish ./immutableqc-0.1.0.mcpb -n
immutableqc/laboratory-instrument-provenance` (docs above). Glama and PulseMCP: check a week after C4 that they list it.
mcp.so form: name "Immutable QC", the C6 description, the repo URL, tags "laboratory, lab automation, provenance,
tamper-evident, local".

**C10. npm package** (Founder; optional, not needed for the registry; stays "Upcoming" until published). `immutableqc`
and `iqc` are unclaimed today (`https://registry.npmjs.org/immutableqc` and `/iqc` return 404, 2026-10-18). A package of
`download/iqc.mjs` as `bin`, with `"mcpName": "com.immutableqc/laboratory-instrument-provenance"`, `license`,
`repository`, `homepage`; then a second `packages` entry in `server.json`; then site copy and the `npm install` lint
change in the same commit.

**C11. Posts** (Founder; after C1 to C4). On channels the founder picks. Rules: the site's wording rules; no firm names.
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
   is the part you can set up today, locally: immutableqc.com/agents.html" (source:
   https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/warning-letters/purolea-cosmetics-lab-722591-04022026;
   the researchers read it only through summaries, so read the letter before posting).

## 6. Measures of success: the re-test

**Part 1, before any outward step (A11, automated; plus a manual run).** Pass when, on the deploy allowlist served
locally with JavaScript off:
- `robots.txt` allows all and names the sitemap; every sitemap URL is a published page; `sitemap.xml` is served as XML.
- `llms.txt` has an H1, a blockquote and H2 link lists, every link resolves to a published file, and it is under 6 KB.
- For each of the five situations (section 2), every "Must find" fact is in `agents.html` and `llms-full.txt`, and the
  one-sentence description is in `index.html` (after B).
- No published page calls agent steps, traces back to sealed measurements, reviewer sign-off or the MCP server
  Upcoming, and none says "no API yet" or "Not an API".
- The config JSON printed in `llms.txt`, run as printed (temp folders, temp home): `check_inputs` on a byte-identical
  copy of a file sealed in the search folder returns `measured` (the baseline got `untraced`).
- All checks green: `node site/build.mjs --check`, `node --test core/test agent/test ui/test`, `node --test app/test e2e`,
  `node site/tools/check.mjs`.
- Manual: rerun the baseline's three personas (lab assistant, Python pipeline agent, MCP agent) with the baseline
  scripts against the served site. Pass when all three find the MCP server and its config from text alone and none meets
  a contradiction. Today: 0 of 3.

**Part 2, after C1 to C4 (Lead, then monthly).**
- Registry: `search=laboratory`, `instrument`, `lab-instrument`, `provenance` and `immutableqc` each list our entry
  (today none).
- Install paths work from a clean home folder: the `.mcpb`, `npx skills add`, `gh skill install`, the README's config.
- Tool selection: in a client with tool search and several servers loaded, each situation's question leads the agent to
  the iqc tools (5 questions, 5 runs each); record the hit rate.
- Lists: C5 to C7 pull requests merged; Glama and PulseMCP pages exist.

**Part 3, AI answers and traffic (monthly, from C1).**
- A fixed set of prompts (the five "Asks" plus five generic ones, e.g. "a local tool to check lab instrument files
  before an AI agent uses them"), 20 runs each per assistant with web search on; metric: share of runs that name
  Immutable QC or cite immutableqc.com or the repo. Today 0. Report the rate, not single answers (lists repeat under 1%
  of the time, source above).
- Search Console and Bing Webmaster Tools: impressions and clicks for those queries; pages indexed.
- GitHub: views, unique visitors and referrers (kept 14 days, so export weekly), stars, release asset downloads.
- GitHub Pages gives us no server logs, so fetches of `llms.txt` by crawlers cannot be counted; do not report them.
