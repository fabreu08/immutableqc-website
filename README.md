# Immutable QC

Immutable QC: tamper-evident records for automated research labs. A one-file local agent seals every file an
instrument writes into a signed ledger, records what AI agents read and wrote, and serves check_inputs, record_step,
trace and audit_summary to AI agents over MCP on standard input and output. Nothing is uploaded; it never uses the
network.

Independent project · Open alpha · No customers yet. Site: https://immutableqc.com · For AI agents:
https://immutableqc.com/agents.html · Contact: https://joseqc.com

## What works today

- **The agent**, `download/iqc.mjs` (version 0.1.0): one file you run with Node.js 22 or later on Windows, macOS or
  Linux. No dependencies; it never uses the network.
  - `watch` and `seal` seal every file in a folder by its bytes (SHA-256, size, time), each record signed with ECDSA
    P-256 and linked to the one before, in `<folder>/ImmutableQC/ledger.jsonl`.
  - `record` records an AI agent's step (what it read, wrote and did) in the agent's own ledger; `trace` traces a file
    back to sealed files; `review` signs off steps.
  - `audit` checks every ledger and every file under a lab folder: exit 0 pass, 3 review, 1 fail, 2 usage or read error.
  - `mcp` serves check_inputs, record_step, trace and audit_summary over MCP on standard input and output.
- **The app** at https://immutableqc.com/app/: audits a whole lab folder in the browser with nothing uploaded, traces
  agent outputs back to sealed measurements, sends untraced inputs to review, and has a review mode for sign-off. The
  demo (https://immutableqc.com/app/#demo) shows a pass, a review and a fail.

Upcoming: an npm package; a Windows installer and service; values read from inside files; per-person keys and
signatures; Merkle batches; sealing inside the vendor's software; post-quantum signatures.

## For AI agents and the people who build them

1. Download https://immutableqc.com/download/iqc.mjs and check its SHA-256 against the one printed on
   https://immutableqc.com/agents.html (Linux `sha256sum iqc.mjs`, macOS `shasum -a 256 iqc.mjs`, Windows
   `certutil -hashfile iqc.mjs SHA256`). If the two differ, do not run it.
2. Seal the instruments' folders on the computers that can read them: `node iqc.mjs watch <folder>`.
3. Connect the MCP server from any MCP client that starts local servers over standard input and output. The server
   entry, as JSON:

   ```json
   {"command": "node", "args": ["/path/to/iqc.mjs", "mcp", "--root", "/lab/agent-workspace", "--search", "/lab"]}
   ```

   `--root` is the folder the agent works in (every path must be inside it); `--search` is where the instruments'
   ledgers are: give the lab folder, or a file sealed outside the root reads as untraced. Starting the server creates
   `<root>/ImmutableQC/` and, for a new ledger, a signing key in `~/.immutableqc/keys/`. A root takes one writer at a
   time. Protocol versions: 2026-07-28, 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05.

| Tool | What it does | Writes |
|---|---|---|
| `check_inputs` | For each file: measured (a station's ledger sealed these exact bytes, with its key id), derived (a recorded step wrote them) or untraced, and whether a sealed file changed | nothing |
| `record_step` | Appends one signed record of a step: the files read and written, by SHA-256 and size, and what it did; recorded even when an input is untraced, with a warning | one record |
| `trace` | A file's tree back to sealed files, and whether every branch ends in a measurement | nothing |
| `audit_summary` | Pass, review or fail for every ledger under the search folders | nothing |

The loop: call check_inputs before using lab files; tell the person about an untraced or changed input before relying
on it; call record_step once per step, naming every file read and written; call trace or audit_summary before
reporting. A person signs off steps (`iqc review`, or the app's review mode); there is no review tool over MCP. The
Agent Skill in [`skills/immutableqc-lab-records/`](skills/immutableqc-lab-records/SKILL.md) says the same for agents
that load skills.

From a pipeline, with Python's standard library:

```python
import json
import subprocess

def record_step(action, inputs, outputs, root="/lab/agent-workspace"):
    cmd = ["node", "/opt/iqc/iqc.mjs", "record", "--root", root, "--search", "/lab",
           "--actor", "nightly-pipeline", "--tool", "normalize.py", "--action", action, "--json", "-"]
    for path in inputs:
        cmd += ["--in", path]
    for path in outputs:
        cmd += ["--out", path]
    done = subprocess.run(cmd, cwd=root, capture_output=True, text=True)
    if done.returncode != 0:
        raise RuntimeError(done.stderr.strip())
    step = json.loads(done.stdout)
    for item in step["inputs"]:
        if item["state"] == "untraced":
            print("warning: untraced input", item["path"])
    return step["reference"]

ref = record_step("Normalized plate 07 to well A1",
                  ["inputs/plate-07.csv"], ["analysis/plate-07-normalized.csv"])
print("recorded", ref)
```

**Limits.** A pass does not show that a file was right when it was written, or anything about a change made inside the
settle window (10 s by default) before it was sealed. Whoever holds a ledger's key could rewrite it; a head pinned
somewhere else (`iqc audit --expect-head`, or `--pin-file`) exposes that. Measured means a ledger sealed those bytes:
compare its key id with your instruments' keys (`iqc audit --expect-key`). A step records only the files it names. A key
identifies a computer or a browser, not a person; per-person signatures are upcoming. Values inside files are not read;
reading them is upcoming.

## License and contact

No license is published yet: until one is, ask through https://joseqc.com before you copy or redistribute any of this
code. Contact goes through https://joseqc.com.

## This repository

This repository holds the website (immutableqc.com), the web app, the agent and the one implementation of the ledger
format they share. The spec, and the contract for the code, is [`docs/product-v1.md`](docs/product-v1.md). This file
is not published (the deploy allowlist takes no `.md`).

## What is where

| Path | What | Published |
|---|---|---|
| `core/immutableqc.mjs` | The ledger format: hashing, signing, ledger parse and verify, audit, the HTML report. One ES module, no dependencies, runs in Node.js 22 or later and in current browsers. Tests in `core/test/`. | yes |
| `agent/` | The agent, `iqc` (`agent/bin/iqc.mjs`, `agent/src/`), its tests (`agent/test/`), its README and the MCPB manifest (`agent/mcpb/`, built by `agent/tools/mcpb.mjs`). | no |
| `download/iqc.mjs` | The agent in one file (core inlined), built by `agent/tools/bundle.mjs`. Committed; a test checks it is up to date. | yes |
| `app/` | The web app at `/app/`: audit a folder, seal one in the browser, or try the demo. `app/test/` holds its tests. | yes (not `test/`) |
| `index.html`, `ui/` | The landing page and the design assets it shares with the app (`ui/theme.css`, `ui/landing.*`, `ui/icons.svg`, `ui/sample-data.mjs`). `ui/test/` holds their tests. | yes (not `test/`) |
| `overview.html`, `sealed.html`, `check.html`, `regulatory.html`, `roadmap.html`, `about.html`, `404.html`, `assets/` | The technical docs ("Docs"), generated by `site/build.mjs` from `site/`. | yes |
| `dashboard/index.html` | The alpha console's old address; it sends visitors to `app/`. | yes |
| `agents.html`, `llms.txt`, `llms-full.txt`, `robots.txt`, `sitemap.xml` | The page and the plain-text files for AI agents and crawlers, generated by `site/build.mjs`. | yes |
| `skills/immutableqc-lab-records/` | The Agent Skill for AI agents that use iqc on lab data. | no |
| `AGENTS.md` | For coding agents working in this repository. | no |
| `server.json` | A draft of the MCP Registry entry: the listing is upcoming, and the founder publishes it. `node agent/tools/mcpb.mjs --server-json` keeps its SHA-256 current. | no |
| `site/` | The docs build, its lints, and the tools: `serve.mjs`, `deploy.mjs` (the publish allowlist), `check.mjs` (browser checks). `site/HANDOFF.md` is the running design and decision log. | no |
| `e2e/` | The end-to-end test across implementations: a folder sealed by `download/iqc.mjs`, audited in the app and by `iqc audit`. | no |
| `docs/` | The spec and the briefs. | no |
| `.github/workflows/` | `site-check.yml` (tests and checks on every push) and `pages.yml` (publishes from `main`). | no |

## Run the agent

Node.js 22 or later; nothing to install. The agent refuses to run on an older Node.js.

```
node download/iqc.mjs seal  <folder>     # seal every file once, then exit
node download/iqc.mjs watch <folder>     # seal now, then keep sealing new, changed and removed files until Ctrl+C
node download/iqc.mjs audit <folder>     # check the ledger and every file: exit 0 pass, 3 review, 1 fail, 2 usage or read error
        --report audit.html  --json audit.json  --expect-head <n>:<h>  --expect-key <keyId>  --strict
node download/iqc.mjs head  <folder>     # print the head, to pin somewhere else
node download/iqc.mjs status <folder>
node download/iqc.mjs help
```

`node agent/bin/iqc.mjs` runs the same agent from its sources. The ledger is `<folder>/ImmutableQC/ledger.jsonl`; the
signing key is saved at `~/.immutableqc/keys/<keyId>.jwk` (needed to add records, never to audit). See
[`agent/README.md`](agent/README.md) for every option.

After a change to `agent/` or `core/`, rebuild the download and stamp its SHA-256 into the landing page:

```
node agent/tools/bundle.mjs            # write download/iqc.mjs   (--check: exit 1 if it is out of date)
node agent/tools/bundle.mjs --stamp    # write it, and put its SHA-256 beside the download link in index.html
```

## Look at the site locally

```
node site/tools/serve.mjs 8810            # the repo root, at http://127.0.0.1:8810/
node site/tools/serve.mjs 8810 --deploy   # only what GitHub Pages will publish
```

## Tests and checks

The browser tests need Playwright and Chromium: `cd site && npm ci && npx playwright install chromium` (a machine with
Playwright installed globally under `/opt/node22/lib/node_modules` uses that). Tests that need a browser skip when
Playwright is missing, or with `IQC_SKIP_BROWSER=1`.

| Command | What it checks |
|---|---|
| `node --test core/test agent/test ui/test` | Core (NIST vectors, every tamper case and audit state, the fixtures), the agent end to end in temp folders and the bundle being up to date, the design system and the landing page (its browser test skips without Playwright). |
| `node --test --test-concurrency=1 app/test e2e` | The app in Chromium (audit, seal, demo, hashing past 256 MiB, errors, axe, no request off the origin), the cross-implementation test, the shipped-file and repository wording tests, and the agent-discovery re-test (the site served as published, read as text by an agent; the MCP server entry of `llms.txt` run as printed). `IQC_LARGE=<n>` sets the many-files test (2,000 by default; 0 skips it). |
| `node --test ui/test/landing.test.mjs core/test/browser.test.mjs` | The landing page and core in Chromium (also run by the commands above when Playwright is there). |
| `node site/build.mjs --check` | Rebuilds the docs in memory and compares them with what is committed; every assertion and lint (wording, CSP, present tense, the download's SHA-256, the deploy allowlist, the workflow pins). `node site/build.mjs` writes. |
| `node site/tools/check.mjs` | Browser checks over everything published, served as GitHub Pages will serve it: links, overflow from 320 to 1920 px, tap targets, smallest text, axe, frames at rest, reduced motion, hidden tab, no-JS text, CSP violations, first-load budgets. `--perf` adds CLS, TBT and LCP on a throttled phone; `--only=index.html,app/` checks a subset; `--repo` serves the repo root; `--json=<file>` keeps the results. |
| `node site/tools/deploy.mjs _site` | Assembles what GitHub Pages publishes into `_site/` and checks every link in it resolves. |

CI (`.github/workflows/site-check.yml`) runs the unit tests, the build check, and, with Playwright's Chromium, the
browser checks and the browser tests, on every push and pull request. Every action is pinned to a full commit SHA.
