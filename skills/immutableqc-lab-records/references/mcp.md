# The iqc MCP server

`node iqc.mjs mcp` is a Model Context Protocol server on standard input and output (Node.js 22 or later, no
dependencies; it never uses the network). Any MCP client that starts local servers over standard input and output can
run it. The server entry, as JSON:

```
{"command": "node", "args": ["/path/to/iqc.mjs", "mcp", "--root", "/lab/agent-workspace", "--search", "/lab"]}
```

- `--root`: the folder the agent works in; every path a tool takes is relative to it and must be inside it.
- `--search` (repeatable): where the instruments' ledgers are. Give the lab folder; without it a file sealed by a
  station outside the root reads as untraced.
- Starting the server writes `<root>/ImmutableQC/` (the agent's ledger, `README.txt`, `agent.lock` while it runs) and,
  for a new ledger, a signing key in `~/.immutableqc/keys/`.
- A root takes one writer at a time: one server or one `iqc record`.
- `--actor <name>` and `--tool <name>` set the defaults for each step.

## The four tools

| Tool | Arguments | Returns | Writes |
|---|---|---|---|
| `check_inputs` | `paths` | Per file: measured (with the sealing station and key id), derived or untraced, and whether a sealed file changed | nothing |
| `record_step` | `action`, `inputs`, `outputs`, `input_refs?`, `actor?`, `tool?` | The step's reference, each file's SHA-256 and size, each input's trace, a warning for an untraced input | one signed record |
| `trace` | `path` | The tree back to sealed files, and `tracesToMeasured` | nothing |
| `audit_summary` | `strict?` | Pass, review or fail, with the problems and items for review | nothing |

Every result also says which folders it searched and how many ledgers it found. `audit_summary` checks no pinned
head, so a ledger cut short (its last records deleted) can still pass it. A trace follows the steps as the agent recorded them: a step can name inputs it did not use, or outputs it did not compute from them. A person's review checks that.

## Versions and errors

Protocol versions 2026-07-28, 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05. From 2025-06-18 results carry
`structuredContent` matching each tool's output schema. A bad argument or a refused path is a tool error
(`isError: true`) with a sentence saying why.
