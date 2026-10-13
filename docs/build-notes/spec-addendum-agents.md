# Spec addendum: verify what agents did (lead, 2026-10-13)

The founder: "one of the objectives of the 1-click audit is for human reviewers to verify what agents did in automated
labs." This addendum extends ledger format 1 (nothing is released yet, so the format stays version 1) and the audit, the
agent, the app and the landing page. It also folds in the research changes (`CHANGES-AFTER-RESEARCH.md`).

## A. The model: every actor keeps its own ledger and key

| Actor | Writes | With | Kind |
|---|---|---|---|
| Instrument station (instrument PC) | what the instrument software wrote | `iqc watch` / `iqc seal` | `file`, `file-removed`, `session` |
| Agent or pipeline (orchestrator, analysis server, an AI agent's workspace) | what each step read and wrote, and what it did | `iqc record`, or the `iqc mcp` server an AI agent calls | `step` |
| Human reviewer | a sign-off on agent steps or files | the app's Review mode (browser key) or `iqc review` | `review` |

Separate ledgers mean separate keys: an agent cannot write an instrument's `file` records, so a **measured** value (sealed
by an instrument station's ledger) is always distinguishable from a **derived** one (an output of a recorded step). The
audit joins ledgers by content: an input's SHA-256 either matches a sealed measurement, matches the output of a recorded
step, or matches nothing. Identity is the SHA-256; paths are labels.

## B. New record kinds (format 1)

Sealed-field rules as in section 3.2 apply to every field. Lists are encoded as below so no field holds `|`.

**File references** (`ref`): `<sha256>:<bytes>:<path>` where `path` is `encodePath` of the path relative to the actor's
root, with `,` also percent-encoded (`%2C`). A list of refs is the refs joined by `,`, in the order given, without
duplicates; an empty list is `-`. At most 1,000 refs per list.

| kind | sealed fields, in payload order | payload |
|---|---|---|
| `step` | `station, actor, tool, action, inputs, outputs, at` | `iqc-step-v1\|station\|actor\|tool\|action\|inputs\|outputs\|at` |
| `review` | `station, reviewer, subjects, decision, note, at` | `iqc-review-v1\|station\|reviewer\|subjects\|decision\|note\|at` |

- `step`: `actor` 1-64 chars (e.g. `analysis-agent`, `pipeline/normalize`); `tool` 1-128 chars, the model or program and
  its version (e.g. `claude-opus-5-5`, `normalize.py 2.1`), or `-` if unknown; `action` 1-500 chars, one line, what the
  step did; `inputs`, `outputs` ref lists (at least one output); `at` the time the step was recorded.
- `review`: `reviewer` 1-64 chars (a person's name or initials); `subjects` a list of record references
  `<ledgerId>:<n>:<h>` joined by `,` (1-1,000), each naming one record by its link so a rewritten record no longer
  matches; `decision` one of `approved`, `question`, `rejected`; `note` 0-500 chars, `-` when empty; `at` the time.
- Header and signatures unchanged. A `step` ledger may also hold `session` records (an MCP server session: events
  `mcp-started`, `mcp-stopped` join the session events).

## C. Multi-ledger audit (`auditMany` in core)

Input: several verified ledgers, each with its **root** (the folder holding its `ImmutableQC/` folder, or the folder given
for a ledger elsewhere) and optionally the files present under that root; options `expectHeads`, `expectKeyIds`,
`allowChanges` (globs), `pinLines`, `strict`.

1. Each ledger is checked as today (`audit`), files against its own root.
2. **Lineage.** Index every `file` record version by SHA-256 (measured) and every `step` output by SHA-256 (derived).
   For each step and each input ref: `measured` (matches a sealed measurement; say which station, path and time, and
   whether that file was sealed again later: "the file changed after this step used it"), `derived` (matches an output
   of another recorded step; follow it), or `untraced` (matches nothing in the ledgers audited). Each step output that
   exists under the step ledger's root is compared like a file: `match`, `changed`, `missing`, or `not checked`.
   For each output: its trace back to measurements (a tree, cycle-safe, depth-bounded), and whether every leaf is
   measured ("traces to 3 measured files") or some leaf is untraced.
3. **Reviews.** Each review subject resolves to a record in an audited ledger by ledger id, `n` and link `h`. A subject
   whose `h` no longer matches is a problem (the record changed after it was reviewed). A subject in a ledger not
   included is a note. Each step gets a review state: `approved`, `question`, `rejected`, or `awaiting review` (latest
   decision per reviewer; show all).
4. **Verdict** across everything (three levels):
   - **fail**: any ledger problem; a file or a step output changed against its latest seal (an unrecorded change); a
     sealed file or output missing with no removal record; an expectation (head, key id, pin) that does not match; a
     review whose subject no longer matches.
   - **review**: no failure, but at least one of: a sealed file with more than one version (changed after its first
     seal), or removed, unless its path matches `allowChanges`; a step with an `untraced` input; a step whose input file
     was sealed again after the step used it; a step marked `question` or `rejected` by a reviewer.
   - **pass**: neither. Notes stay notes (not sealed, gaps, unclean stops, `added-unwatched`, steps awaiting review).
   - `strict`: review and notes become failures.
   - Every reason is listed with the records it rests on. One sentence per verdict, e.g. "Review: 2 agent steps used
     inputs nothing measured, and 1 file was changed after it was first sealed. Each is recorded below."
5. **Pins.** `pinLines` (from a pin file): `immutableqc-head <ledgerId> <n>:<h> <time>`; for each line whose ledger id is
   audited, record `n` must still have link `h` (else fail); a pin for a ledger id not audited is a note.
6. The single-ledger `audit` keeps working and gains the three-level verdict and `allowChanges`.
7. The report (`renderReportHTML`) gains: the verdict level; an "Agent steps" section (each step: actor, tool, action,
   time, inputs with their trace state, outputs with their state, review state); a lineage section per output; reviews;
   the ledgers audited (one row each: role measured/agent/reviewer by the kinds it holds, station, key id, head, records).

Ledger discovery (CLI and app share one rule in core): under a dropped or given folder, every `ImmutableQC/ledger.jsonl`
(at any depth up to 6, not following symlinks), plus any file named `*.ledger.jsonl` (reviewer ledgers saved from the
app). Each ledger's root is the parent of its `ImmutableQC` folder; a `*.ledger.jsonl` file has no file root.

## D. The agent CLI

- `iqc record --actor <name> --action "<what it did>" [--tool <tool>] --in <path>... --out <path>... [--root <dir>]`
  Hash each input and output (they must exist; `--in-ref <sha256>:<bytes>:<label>` for an input not on disk), append a
  `step` record to the actor's ledger (default `<root>/ImmutableQC/ledger.jsonl`, created with a key on first use;
  `--root` defaults to the current directory), print the record number, its link, and each input's trace state against
  the ledgers found under `--search <dir>` (repeatable; default the root). Warn on any untraced input. Exit 0 recorded,
  1 refused, 2 usage or read error.
- `iqc trace <file> [--search <dir>...]`: the lineage of a file's current bytes back to measurements, as a tree.
- `iqc review --reviewer <name> --decision approved|question|rejected [--note "..."] <ledgerId>:<n>... [--search ...]`:
  append a `review` record to the reviewer's own ledger (default `./<reviewer>.ledger.jsonl`... decide sensibly).
- `iqc audit [folder]`: discovers every ledger under the folder (section C) and runs `auditMany`. New options
  `--allow-changes <glob>` (repeatable), `--pin-file <path>`, `--ledger <path>` (repeatable, adds ledgers outside the
  folder). Exit codes: **0 pass, 3 review, 1 fail, 2 usage or read error**.
- `iqc watch` / `iqc seal`: `--pin-file <path>` appends a pin line after each batch of records; default `--settle` 10 s
  (the Windows SMB client caches file information for 10 s by default).
- `iqc mcp [--root <dir>] [--actor <name>] [--tool <tool>] [--search <dir>...]`: a Model Context Protocol server on stdio
  (JSON-RPC 2.0, one message per line, nothing but protocol on stdout, logs on stderr), with no dependencies. Follow the
  current MCP specification (fetch https://modelcontextprotocol.io/specification/latest and its lifecycle, tools and
  transports pages; negotiate the protocol version as the spec says; implement initialize, notifications/initialized,
  ping, tools/list, tools/call, and proper JSON-RPC errors; tool results as text content plus structuredContent with an
  outputSchema where the negotiated version supports it; tool-level failures as isError results). Tools:
  - `check_inputs` {paths}: for each file, its SHA-256 and trace state (measured: by which station, when; derived: by
    which step; untraced), and whether it changed since sealed. Description: call before using data in an analysis.
  - `record_step` {action, inputs, outputs, tool?}: hashes the files, seals a `step` record, returns the record number,
    link and each input's trace state, and warns plainly if any input is untraced. Description: call after writing
    outputs, once per step.
  - `trace` {path}: lineage back to measurements.
  - `audit_summary` {}: the verdict and counts for the ledgers under the search folders (read only).
  Tool descriptions: plain, specific, say when to call and what comes back. A session record `mcp-started` /
  `mcp-stopped` brackets the server's life. Paths are confined to the root (refuse `..` escapes and absolute paths
  outside it).
- Node.js 22 or later (Node 20 reached end of life on 2026-04-30): engines, messages, README, CI.
- README: the honesty notes from `CHANGES-AFTER-RESEARCH.md` item 5; how to wire `iqc mcp` into an MCP client (a generic
  JSON config example), and a Python example that calls `iqc record` with subprocess for pipelines.

## E. The app

- Audit accepts a whole lab folder (all ledgers found under it, section C) or several folders/ledger files dropped
  together, and runs `auditMany`. Three verdict levels: pass (cyan), review (amber), fail (coral); notes neutral.
- New verdict sections: **Agent activity** (a timeline of steps; each step: actor, tool, action, time, review state; its
  inputs with measured / derived / untraced chips; its outputs with match / changed / missing chips; expand to see the
  lineage tree back to measurements) and **Ledgers** (one row per ledger: role, station, key id, head, records). Filter
  chips gain "Agent steps" and "Needs review".
- **Review mode (the human sign-off):** select steps (or files), choose Approve / Question / Reject with an optional note,
  enter your name once (kept in localStorage), and the browser signs `review` records with its own key (IndexedDB,
  non-extractable); the audit re-runs with the new reviewer ledger included; "Download your review ledger"
  (`<name>.ledger.jsonl`) to keep with the lab folder. Say plainly that a browser key identifies this browser, not a
  person (per-person keys are Upcoming).
- Optional fields: pinned head(s) or a pin file, expected key ids, files expected to change (globs).
- **Demo** (the landing page's "Run the 1-click demo"): build the instrument folder from `ui/sample-data.mjs`, seal it
  with an instrument key; then run a small real "analysis agent" in the page (deterministic code that reads plate-07.csv
  and writes, for example, `analysis/plate-07-normalized.csv` and `analysis/ic50.csv`) and record its steps with a
  separate agent key; audit: **pass**, with the agent activity and lineage shown. Then three buttons, each re-auditing:
  "An agent cites a file nothing measured" (a step whose input is an unsealed file) → **review**; "Change one value in a
  copy" → **fail**; "Sign off as a reviewer" → the steps show approved. "Start over".

## F. The landing page

Reposition around the objective: a human reviewer verifies what the lab's agents did, in one click. Keep the luminous
design system, the restraint rule and every honesty rule. Suggested headline: "Verify what your lab's agents did. In one
click." Lead: instrument files are sealed as they are written; every agent step records what it read and wrote; a
reviewer checks the whole chain in the browser, and nothing is uploaded. The hero story becomes: 1 Measured
(plate-07.csv sealed on bio-line-2) → 2 Agent step (an analysis agent reads it and writes ic50.csv; the step is recorded)
→ 3 Untraced (another step cites a file nothing measured) → 4 Caught (the audit traces ic50.csv to its measurement and
flags the untraced step for review). Steps section: the instrument, the agent (`iqc record` or the MCP server), the
reviewer (one click, then sign off). "A pass shows / It does not show" updated for steps (a recorded step shows what the
agent said it read and wrote, and that those bytes are unchanged; it does not show the analysis was right, or that the
agent reported every file it touched). Install section gains the agent and MCP lines. Upcoming list loses the items now
built (lineage, measured vs derived records, reviewer sign-off) and keeps the rest (per-person keys, anchoring, Merkle
batches, encrypted archive, value extraction, sealing inside vendor software, Windows installer/service, npm package,
post-quantum signatures). Exit codes in copy: 0 pass, 3 review, 1 fail, 2 usage or read error.
