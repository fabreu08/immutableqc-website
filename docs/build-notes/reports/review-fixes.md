# Fixes after the adversarial review (2026-10-30)

Scope (token budget): the 9 critical and 15 high findings of `adversarial-review.md`, plus the critical and high items
the verifiers found (MISSED-1, -2, -3, -4, -6, -7, -9, -10, -13, -15). Medium and low findings stay open (list below).
Rulings: R1-R10 in the lead's brief (summarized here). Workflow run `wf_b11dedc2-edb`: core (main model), agent CLI, app
and copy (Sonnet), one re-test of the critical attacks, one fix round, a second re-test.

## What changed
- **Unchecked files never pass (R1, R2).** A ledger that seals files or step outputs but was audited with no folder is
  the review item `files-not-checked`. A sealed file that could not be read (or an NFC/NFD twin name in the app) is the
  review item `not-checked`. The pass sentence counts only checked files. `--ledger` is paired with the folder by role,
  not by file name. One core helper (`isNeverDataPath`: any `ImmutableQC` segment in any case, `*.ledger.jsonl`) decides
  what is never data, for seal and audit alike; paths sealed earlier and now excluded are a note, not "missing".
- **Pins bind to ledgers (R3).** A pin naming a ledger id that no audited ledger has fails (`pin-ledger-missing`): a
  deleted or restarted ledger no longer passes. Pins and expected heads are checked against every copy of a ledger id.
  An expected head without a ledger id binds to the folder's own ledger, never to "any ledger". `iqc head` prints
  `--expect-head <ledgerId>:<n>:<h>`. With several ledgers, `--expect-key` lists the allowed keys (others fail).
- **Measured inputs (R4).** New `--station-key` (CLI, MCP, app field): only file records signed by listed keys count as
  measurements. Without it, a ledger that holds agent steps never counts as a measurement, and the note
  `station-keys-not-listed` names the keys that did. Derived beats measured when a step produced the same bytes.
- **Steps with no inputs (R5)** are the review item `no-inputs` until a reviewer approves. `iqc trace` and the MCP
  `trace` tool use core's complete lineage summary.
- **Reviews bind to keys (R6).** Decisions are grouped by signing key, not by the typed name; a rejection from any key
  counts. New `--reviewer-key`: with it, approvals count only from listed keys.
- **Cuts (R7).** Every audit without a pinned head carries the note `no-pinned-head`; no text claims a ledger "was not
  cut" unless a pinned head was checked.
- **Re-run command (WS-1, MISSED-5).** A name with any character outside `[A-Za-z0-9._/@%+=:,-]` becomes `<folder>` in a
  copied command, with a line saying what to replace.
- **Copy.** Node.js 22 or later everywhere, exit codes 0 / 3 / 1 / 2, the new measured, reviewer-key and pin rules in
  the README files, AGENTS.md, llms.txt, the Agent Skill and the spec.
- **App size budget** re-pinned (site/tools/check.mjs): core grew 47.4 → 53.5 KB gzipped with these fixes; app first load
  175.3 KB (js 86.9) against 172 / 82, now 179 / 89. Way back down: load core only when an audit starts.
- **Patent check** of the two key lists: `key-allowlist-patent-check.md` (no in-force patent found in six searches; low
  risk; prior art from 2010-2021; an engineering reading, for the attorney's FTO).

## Re-test (Sonnet, two rounds)
Round 1: 12 of 14 critical attacks fixed; HON-1 and MISSED-3 partly (a restarted folder with a planted full copy of the
original passed against `--pin-file`). Fixed in the fix round. Round 2: 13 fixed, HON-2 partly (below).

## Decisions for the founder
1. **HON-2, default mode.** Without `--station-key`, an agent that makes its own separate ledger with a new key can seal
   an invented input and the audit passes, with the note `station-keys-not-listed`. With `--station-key` it is untraced
   (review). Options: keep (pass + note, documented), or make a lab audit with agent steps and no station keys a review.
2. **Approvals without `--reviewer-key`.** Any key's approval clears a `no-inputs` step (same trust question).
3. **`--strict`** fails every audit without a pinned head now (`no-pinned-head` is a note, and strict fails on notes).
4. `untraced-input` stays a review item after a reviewer approves the step (only `no-inputs` is cleared). Conservative.

## Still open
- New, from the re-test: an honest lab with a backup copy of a station ledger fails ("file is missing", INT-9 partly);
  a station ledger named `*.ledger.jsonl` kept elsewhere is rooted at the audited lab folder; an empty `--pin-file`
  passes; a pin file shared by several stations makes a single-station audit fail; a pass sentence overclaims approval
  for downstream steps; a renamed station ledger gives a "missing" list instead of a clear message.
- Not in scope this round (medium/low): INT-9 to INT-13, KEY-3, KEY-4, WS-2 to WS-6, CLI-5, CLI-8 to CLI-15, MCP-2 to
  MCP-9, UX-2 to UX-12, HON-5 to HON-10 (HON-5 and HON-10 partly done by the copy fixes), MISSED-5 (done in core),
  MISSED-8, MISSED-11, MISSED-12, MISSED-14.
