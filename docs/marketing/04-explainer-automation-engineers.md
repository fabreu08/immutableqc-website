# For automation and AI engineers, in 300 words

Immutable QC is a small set of tools around one ledger format. Everything is local: no service, no account, and no
dependencies.

**What runs today.** The agent is a single file, `iqc.mjs`, run with Node.js 22 or later.

```
node iqc.mjs watch <folder>   # seal every file now, then each new, changed or removed file
node iqc.mjs audit <folder>   # exit 0 pass, 3 review, 1 fail, 2 usage or read error
```

Each file gets a SHA-256 fingerprint. Each record is signed with ECDSA P-256 over its link to the record before it, so
removing, reordering or inserting a record breaks a signature. The ledger is JSON Lines in
`<folder>/ImmutableQC/ledger.jsonl`. `iqc head` prints the head to pin elsewhere, and `--expect-head` checks it later. `--json` gives a
machine-readable report.

The format already has two more record kinds, in the published core module: `step` (what an agent or pipeline read,
wrote and did, as file references) and `review` (a human sign-off on specific records). The core can audit several
ledgers at once and trace each step output back to sealed measurements by SHA-256, flagging any input that nothing
measured. Each actor has its own ledger and key.

**Upcoming** (being built now):

- `iqc record --actor <name> --action "<what it did>" --in <file> --out <file>`, one call per pipeline step.
- `iqc trace <file>`, which traces a file back to the sealed measurements behind it.
- `iqc mcp`, a dependency-free Model Context Protocol server on stdio with four tools: `check_inputs`, `record_step`,
  `trace` and `audit_summary`. Paths stay inside the root you give it.
- `iqc audit` over a whole lab folder, with `--allow-changes` for files you expect to change.
- `iqc review` and the app's review mode, for human sign-off.

What a recorded step shows: what the agent said it read and wrote, and that those bytes are unchanged. It doesn't
show the analysis was right, or that the agent reported every file it touched.

Questions: joseqc.com.
