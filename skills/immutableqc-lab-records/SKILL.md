---
name: immutableqc-lab-records
description: Check lab instrument files and record AI agent analysis steps with Immutable QC (iqc), a local tool that never uses the network. Use it before you use instrument exports or other lab data files as inputs (it says whether each file's exact bytes were sealed by an instrument station, written by a recorded step, or neither, and whether a sealed file changed), after you write derived files such as summaries, fits, plots or reports (to record what you read, what you wrote and what you did, in a signed local ledger a person can review), and when someone asks where a result came from or wants a lab data folder audited before a report, a deposit or a handoff.
compatibility: Needs Node.js 22 or later and iqc.mjs (one file, no dependencies). Works offline.
metadata:
  homepage: https://immutableqc.com/agents.html
  version: "0.1.0"
---

# Immutable QC: check lab inputs, record your steps

Immutable QC keeps tamper-evident records for automated research labs, on the lab's own computers. A station runs
`iqc watch` or `iqc seal` on an instrument's data folder: every file is sealed by its bytes (SHA-256, size, time) in a
signed ledger, `ImmutableQC/ledger.jsonl`, inside that folder. You, the agent, check your inputs against those ledgers
and record each step you take in your own ledger. A person reviews and signs off your steps. Nothing is uploaded, and
iqc never uses the network.

## 1. Find the tools

- If the MCP tools `check_inputs`, `record_step`, `trace` and `audit_summary` are connected, use them. Their paths are
  relative to the server's root folder; the server's instructions name the root and the folders it searches.
- Otherwise use the command line: `node <path>/iqc.mjs <command>` (see `references/cli.md`).
- If neither is there, ask the person where iqc.mjs is, or to connect the server (`references/mcp.md`). If they give
  you a downloaded iqc.mjs, check its SHA-256 against the one printed on https://immutableqc.com before you run it.

## 2. Check your inputs first

Before you use instrument exports or other lab files, call `check_inputs` with their paths (or run
`node iqc.mjs trace <file> --search <lab folder>` for one file). Each file comes back in one of three states:

- **measured**: a station's ledger sealed these exact bytes. Use it. The result names the station and the ledger's key
  id; if the person gave you their instruments' key ids, compare.
- **derived**: a recorded agent step wrote these bytes. Call `trace` on it to see whether every branch ends in a
  measured file (`tracesToMeasured`).
- **untraced**: no ledger sealed these bytes and no recorded step wrote them. Tell the person before you rely on the
  file. Never carry on quietly as if it were measured.

A measured file that **changed after it was sealed** is flagged too: tell the person, as for an untraced file.

If a file you expect to be measured comes back untraced, the ledger that sealed it may be outside the folders searched.
Each result says which folders it searched; the server needs `--search <lab folder>`.

## 3. Record each step after you write

After you write files (a summary, a fit, a plot, a report), call `record_step` once per step:

- `action`: one line on what you did, in plain words.
- `inputs`: every file you read. `outputs`: every file you wrote (at least one).
- A step records only the files it names: name all of them.
- For an input outside the root, copy it into the root (the same bytes trace the same way), or pass it in
  `input_refs` as `<sha256>:<bytes>:<label>`.

The record is signed and appended to your ledger; it cannot be taken back, only reviewed. The step is recorded even when
an input is untraced: the result carries a warning, and you tell the person.

From a script, the same is `node iqc.mjs record --root <workspace> --search <lab folder> --actor <name> --action
"<what you did>" --in <file> --out <file>` (see `references/cli.md`).

## 4. Before you report or hand off

Call `trace` on each result you report, or `audit_summary` for the whole lab folder (on the command line:
`node iqc.mjs audit <lab folder>`, exit 0 pass, 3 review, 1 fail, 2 usage or read error). Report the verdict with
your result; on review or fail, list what the audit says.

## 5. Never sign off your own steps

Sign-off is for a person: `iqc review` on the command line, or the review mode of the app at
https://immutableqc.com/app/. There is no review tool over MCP. Do not run `iqc review` on steps you recorded.

## 6. What a pass does not show

- That a file was right when it was written: a wrong value written by the instrument software is sealed as written.
- A change made inside the settle window (10 s by default), before the station sealed the file.
- A rewrite by whoever holds a ledger's key: a head pinned somewhere else (`iqc audit --expect-head`, or a pin file)
  exposes that.
- That a measured file came from the lab's instrument: measured means a ledger sealed those bytes; check the key id.
- Anything a step read and did not name.
- A key identifies a computer or a browser, not a person; per-person signatures are upcoming. Values inside files are
  not read; reading them is upcoming.

## 7. The two errors you will meet

- **A path outside the root** is refused: copy the file into the root, or ask the person for a wider `--root`.
- **The ledger is busy**: a root takes one writer at a time (one server or one `iqc record`). Wait and retry, or ask
  the person which process holds it.

## References

- `references/cli.md`: the commands and options for record, trace, audit and review, and the exit codes.
- `references/mcp.md`: connecting the server, the four tools, and the protocol versions.
