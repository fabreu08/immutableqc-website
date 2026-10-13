# Spec changes decided after the Ghidra / instrument-integration research (lead, 2026-10-13)

Source: docs/instrument-integration-and-ghidra.md (skeptic-corrected memo), items B15-B21, A13.

1. **Three verdicts: pass, review, fail** (fixes "an edited file passes").
   - fail: any ledger problem; a file changed against its latest seal (an unrecorded change); a sealed file missing with no
     removal record; an expectation (head, key id) that does not match.
   - review: no failure, but at least one sealed file has more than one sealed version (changed after its first seal:
     `changed` or `changed-unwatched`), or was removed (`removed`, `removed-unwatched`), unless its path matches an
     `allowChanges` glob given to the audit (files the lab expects to change: logs, project files). Every such change is
     listed with its record number, time and event. Wording: "Review: 3 files were changed after they were first sealed.
     Each change is recorded."
   - pass: neither. Notes (not sealed, gaps, unclean stops, added-unwatched) stay notes.
   - `strict`: review and notes both become failures.
   - CLI exit codes: 0 pass, 3 review, 1 fail, 2 usage or read error. Option `--allow-changes <glob>` (repeatable) on
     `audit`; the app gets an optional "Files expected to change" field (globs), folded with the other options.
   - UI palette: cyan/teal pass, amber review, coral fail; notes neutral (not amber).
   - Landing: "Any later change, caught." stays true: an unrecorded change fails, a recorded one puts the audit in review.
2. **Settle time** default 10 s (the Windows SMB client caches file information for 10 s by default; files written in
   bursts). Docs say why and how to change it.
3. **Node.js 22 or later** everywhere (Node 20 reached end of life on 2026-04-30): engines, copy, README, CI.
4. **`--pin-file <path>`** on watch/seal: after each batch of records, append one line
   `immutableqc-head <ledgerId> <n>:<h> <time>` to a file at another location (a network share, a synced folder), so a
   rewrite or restart of the ledger by someone with access to the data folder shows. `audit --pin-file <path>` checks the
   ledger against every pin line for its ledger id (each pinned record must still have that link) and reports a pin for a
   different ledger id at the same station as a note ("another ledger was pinned from this station").
5. **Agent README honesty** (acquisition safety): the agent opens files read-only with full sharing; software that later
   opens a file exclusively while the agent is reading it can get a "file in use" error; test before production use, raise
   `--settle`, and keep the ledger outside vendor-managed folders with `--ledger` when the vendor software indexes its data
   folder. Large folders: a full audit re-reads every byte.
6. **Founder-facing flags (not code):** patent US11502847 (ledger records of analytical instrument data; listed as
   active) needs a freedom-to-operate check by a patent attorney; SDMS file-capture agents and lab data platforms already
   capture folders, so the differentiator to say is "anyone can recompute the check with published code, without the
   vendor's software or ours".
