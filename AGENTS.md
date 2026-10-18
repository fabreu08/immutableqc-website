# AGENTS.md

For coding agents working in this repository: what is where, the commands, and the rules. For an AI agent that wants to
use Immutable QC on lab data, see https://immutableqc.com/agents.html, `skills/immutableqc-lab-records/SKILL.md`, and the
snippet at the end of this file.

## What is where

| Path | What | Published |
|---|---|---|
| `core/immutableqc.mjs` | The ledger format: hashing, signing, ledger parse and verify, audit, the HTML report. One module, no dependencies. | yes |
| `agent/` | The agent, `iqc` (`agent/bin/iqc.mjs`, `agent/src/`), its tests, its README and the MCPB manifest (`agent/mcpb/`). | no |
| `download/iqc.mjs` | The agent in one file, built by `agent/tools/bundle.mjs`. Never edit it by hand. | yes |
| `app/` | The web app at `/app/`: audit a lab folder, seal one, review mode, the demo. | yes (not `test/`) |
| `index.html`, `ui/` | The landing page and its design assets. They belong to the landing page's owner: do not edit them. | yes (not `test/`) |
| `site/` | The document set's build (`site/build.mjs`, its sources and lints), `site/tools/` (`serve.mjs`, `deploy.mjs`, the publish allowlist, `check.mjs`, the browser checks, `wording.mjs`, the shared wording rules). | no |
| `agents.html`, `llms.txt`, `llms-full.txt`, `robots.txt`, `sitemap.xml` | The page and the plain-text files for AI agents and crawlers, built by `site/build.mjs`. | yes |
| `skills/immutableqc-lab-records/` | The Agent Skill for AI agents that use iqc on lab data. | no |
| `server.json` | A draft of the MCP Registry entry: the listing is upcoming, and only the founder publishes it. | no |
| `e2e/` | Tests across the agent, the app and the published site. | no |
| `docs/` | The spec, the plans and the briefs. | no |

## Commands

```
node --test core/test agent/test ui/test                 # unit and end-to-end tests of core, the agent and the design system
node --test --test-concurrency=1 app/test e2e            # the app in Chromium, the cross-implementation and published-site tests
node site/build.mjs --check                              # every assertion and lint; node site/build.mjs writes the output
node site/tools/check.mjs                                # browser checks over what GitHub Pages publishes (long; --only=<pages>)
node agent/tools/bundle.mjs                              # rebuild download/iqc.mjs after a change to agent/ or core/
node agent/tools/mcpb.mjs --server-json                  # then rebuild the MCPB bundle and its SHA-256 in server.json
```

`node agent/tools/bundle.mjs --stamp` also writes the download's SHA-256 into `index.html`; leave that to the landing
page's owner. The tools need Node.js 22 or later; the browser tests need Playwright's Chromium.

## Rules

- Never edit `download/iqc.mjs` by hand: change `agent/src/` or `core/`, then rebuild it.
- Every new published file goes on the allowlist (`FILES` or `DIRS` in `site/tools/deploy.mjs`) and under the lints of
  `site/build.mjs` (section 7i for the files for agents). The allowlist never publishes `.md` files or dotfiles.
- The wording rules (`site/tools/wording.mjs`, `site/build.mjs` section 7): none of the banned words listed in
  `BANNED` and `BANNED_SITE` there; no vendor, company or MCP client names on the site; no email address (contact goes
  through joseqc.com); present tense only for what works, and "Upcoming" for everything else.
- The patent guardrails (`docs/patent-guardrails.md`), in short: no blockchain, and no ledger shared over a network;
  nothing anchored or published on a network; no hosted service through which anyone requests records; ledgers stay signed files the lab
  keeps; nothing in the product calls a network.
- `index.html` and `ui/landing.*` belong to the landing page's owner.
- No network API in `app/`, `ui/` or `core/`; every page has a Content-Security-Policy and makes no third-party request.
- Facts repeated across files must agree with the agent's sources (version, the four tools check_inputs, record_step,
  trace and audit_summary, the protocol versions, Node.js 22, exit codes 0 pass, 3 review, 1 fail, 2 usage or read
  error): `node site/build.mjs --check` fails when they drift.

## Using iqc in your own lab repository

For a lab whose agents work in a repository of their own, a snippet for that repository's AGENTS.md. Connect the
server first (any MCP client that starts local servers over standard input and output):

```
{"command": "node", "args": ["/path/to/iqc.mjs", "mcp", "--root", "/lab/agent-workspace", "--search", "/lab"]}
```

```
## Lab data
Before you use files under <lab folder>, call check_inputs on them. After you write files, call record_step once per
step, naming every file you read and wrote. Tell a person about any untraced input, or any file that changed after it
was sealed, before you rely on it. Never sign off your own steps.
```

Protocol versions the server speaks: 2026-07-28, 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05.
