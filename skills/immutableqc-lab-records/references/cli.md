# iqc on the command line

`iqc` is one file, `iqc.mjs`, run with Node.js 22 or later on Windows, macOS or Linux. No dependencies; it never uses
the network. Download it from https://immutableqc.com/download/iqc.mjs and check its SHA-256 against the one printed on
https://immutableqc.com/agents.html before you run it (Linux `echo "<sha256>  iqc.mjs" | sha256sum -c -`, macOS
`echo "<sha256>  iqc.mjs" | shasum -a 256 -c -`, Windows `certutil -hashfile iqc.mjs SHA256`, then compare). `node iqc.mjs help <command>` prints every option.

## Record a step

```
cd /lab/agent-workspace && node iqc.mjs record --root /lab/agent-workspace --search /lab --actor analyst-bot \
  --tool model-x --action "Normalized plate 07 to well A1" --in inputs/plate-07.csv \
  --out analysis/plate-07-normalized.csv --json -
```

- `--root <folder>`: the folder the step works in. Every `--in` and `--out` must be inside it.
- `--in` and `--out` are read from the current folder, not from `--root` (the MCP tools read paths from the root), so
  run it from inside the root, as above.
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

Exit 0 when the file was measured or every branch ends in a measured file, 3 when something on the way is untraced or
a step names no inputs, 2 usage or read error. `--station-key <keyId>` (repeatable) counts a file as measured only when
a ledger signed by a listed key sealed it; `--reviewer-key <keyId>` (repeatable) counts approvals only from listed keys.

## Audit a lab folder

```
node iqc.mjs audit /lab --report audit.html --json audit.json
```

Finds every ledger under the folder, checks each one, re-reads every sealed file and traces every step's inputs.
Exit 0 pass, 3 review, 1 fail, 2 usage or read error. Other options: `--expect-head <ledger id>:<n>:<h>` (a head
pinned earlier, as the head command prints it), `--expect-key <keyId>`, `--pin-file <file>`, `--station-key <keyId>`,
`--reviewer-key <keyId>`, `--allow-changes <glob>`, `--ledger <file>`, `--strict`.
Without `--station-key`, any ledger that holds no agent steps measures, whatever its key, and a note names the keys it
counted. With it (repeatable), only a ledger signed by a listed key measures, and a listed key that signs no audited
ledger fails. Without `--reviewer-key`, an approval counts from any key; with it, only listed keys approve, and a
rejection or question counts from any key. `--expect-key` fails when no audited ledger has that key, and, with several
ledgers, when a ledger is signed by a key not listed. A step that names no inputs goes to review. A ledger cut short
(its last records deleted) shows only against a head pinned earlier (`--expect-head` or `--pin-file`); an audit with
neither says so in a note. A pin file that names a ledger no audited ledger has fails.

## Sign off (for a person, never for the agent that took the step)

```
node iqc.mjs review <ledger id>:<n>[:<link>] --reviewer "J. Rivera" --decision approved --note "Fits checked" --search /lab
```

`iqc record` prints each step's reference (`<ledger id>:<n>:<link>`). The review goes in the reviewer's own ledger
(./<reviewer>.ledger.jsonl in the current folder; keep it in the lab folder, or pass --ledger), so an audit of the lab
finds it. The reviewer's name is whatever is typed: check the review ledger's key id.
Exit 0 recorded, 1 refused, 2 usage or read error.
