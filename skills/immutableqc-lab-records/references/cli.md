# iqc on the command line

`iqc` is one file, `iqc.mjs`, run with Node.js 22 or later on Windows, macOS or Linux. No dependencies; it never uses
the network. Download it from https://immutableqc.com/download/iqc.mjs and check its SHA-256 against the one printed on
https://immutableqc.com (Linux `sha256sum iqc.mjs`, macOS `shasum -a 256 iqc.mjs`, Windows
`certutil -hashfile iqc.mjs SHA256`). `node iqc.mjs help <command>` prints every option.

## Record a step

```
node iqc.mjs record --root /lab/agent-workspace --search /lab --actor analyst-bot --tool model-x \
  --action "Normalized plate 07 to well A1" --in inputs/plate-07.csv --out analysis/plate-07-normalized.csv --json -
```

- `--root <folder>`: the folder the step works in. Every `--in` and `--out` must be inside it.
- `--search <folder>`: where to look for the instruments' ledgers (repeatable; default the root). Give the lab folder.
- `--actor <name>`, `--action <text>` (one line), `--tool <name>`.
- `--in <file>` (repeatable), `--in-ref <sha256>:<bytes>:<label>` for an input that is not a file under the root,
  `--out <file>` (repeatable, at least one).
- `--json -` writes the record and each input's trace as JSON on the standard output.

Exit 0 recorded, 1 refused (a broken ledger, a missing key, another writer), 2 usage or read error (a path outside the
root, a missing option).

## Trace a file

```
node iqc.mjs trace analysis/plate-07-normalized.csv --search /lab --json -
```

Exit 0 when the file was measured or every branch ends in a measured file, 3 when something on the way is untraced,
2 usage or read error.

## Audit a lab folder

```
node iqc.mjs audit /lab --report audit.html --json audit.json
```

Finds every ledger under the folder, checks each one, re-reads every sealed file and traces every step's inputs.
Exit 0 pass, 3 review, 1 fail, 2 usage or read error. Other options: `--expect-head <n>:<h>` (a head pinned earlier),
`--expect-key <keyId>`, `--pin-file <file>`, `--allow-changes <glob>`, `--ledger <file>`, `--strict`.

## Sign off (for a person, never for the agent that took the step)

```
node iqc.mjs review <ledger id>:<n>[:<link>] --reviewer "J. Rivera" --decision approved --note "Fits checked" --search /lab
```

`iqc record` prints each step's reference (`<ledger id>:<n>:<link>`). The review goes in the reviewer's own ledger.
Exit 0 recorded, 1 refused, 2 usage or read error.
