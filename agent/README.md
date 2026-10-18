# iqc: the Immutable QC agent

`iqc` seals every file in a folder as it is written, records the steps an AI agent (or a script, or a person) takes on
files, and audits a lab folder against its ledgers. It runs on the
instrument PC, or on any computer that can read the folder where the instrument software saves its results. It reads
only bytes, so it works with any instrument software and any file format.

For each file it records the SHA-256 fingerprint, the size and the time it read the file, in a ledger inside the
folder (`ImmutableQC/ledger.jsonl`). Each record is signed and linked to the one before it. An audit re-reads every
file and checks every record: it passes when every file is byte for byte the one that was sealed and the ledger has not
been edited, reordered or cut since it was signed.

What a pass does not show: that a file was right when it was written (a wrong value written by the instrument software
is sealed as written), or anything about a change made between the moment the software writes a file and the moment
the agent reads it. The agent waits for a file to stop changing for a few seconds (`--settle`); that window is the one
gap. Someone who holds the ledger's private key could rewrite the ledger from the start; a head pinned somewhere else
earlier (`iqc head`, then `iqc audit --expect-head`, or a pin file kept on another drive: `--pin-file`) exposes that.

An agent step (`iqc record`, or the `record_step` tool of `iqc mcp`) records which files a step read and wrote, by
SHA-256, in the agent's own ledger. An audit of the lab folder then traces each input back: measured (an instrument's
ledger sealed those exact bytes), derived (a recorded step wrote them) or untraced. What that does not show: that the
step did what its action line says, or that it read nothing else. A step names the files it is given; anything it read
and did not name is not in the record.

Nothing is sent anywhere. `iqc` reads files and writes its own ledgers, README.txt, lock files and the pin file you give
it; it never uses the network. It has no dependencies.

## Before production use

- The agent opens files for reading only, with full sharing, so the instrument software can keep writing, renaming or
  deleting them. Software that later tries to open a file exclusively while the agent is reading it can get a "file in
  use" error. Test with your instrument software before production use; if it happens, raise `--settle` so the agent
  reads a file only after the software is done with it.
- Some vendor software indexes or manages its data folder and may not expect an extra folder in it. Then keep the
  ledger outside that folder with `--ledger <path>` (for example on another drive).
- A full audit re-reads every byte of every sealed file. On a large folder, or over a network share, that takes as long
  as reading the whole folder once.

## Install

1. Install [Node.js](https://nodejs.org) 22 or later (the LTS version is fine; Node.js 20 reached end of life on
   2026-04-30). Check with `node --version`.
2. Download `iqc.mjs` from [immutableqc.com](https://immutableqc.com) (the file is `download/iqc.mjs` on the site).
3. Check its SHA-256 against the one printed beside the download link:

   | System | Command |
   |---|---|
   | Windows (Command Prompt or PowerShell) | `certutil -hashfile iqc.mjs SHA256` |
   | Windows (PowerShell) | `Get-FileHash iqc.mjs -Algorithm SHA256` (prints it in capitals; compare without case) |
   | macOS | `shasum -a 256 iqc.mjs` |
   | Linux | `sha256sum iqc.mjs` |

   If the two differ, do not run the file.
4. Run it: `node iqc.mjs help`.

There is nothing else to install. To remove it, delete `iqc.mjs` (keep `~/.immutableqc/keys/` if a ledger still needs
its key). A Windows installer and service, and an npm package, are Upcoming.

## Commands

```
iqc watch [folder]   Seal everything now, then keep sealing new, changed and removed files until Ctrl+C.
iqc seal  [folder]   Seal once and exit (for a scheduler or a pipeline).
iqc audit [folder]   Check every ledger in the folder and every file. Exit 0 pass, 3 review, 1 fail, 2 usage
                     or read error.
            --report <file.html>  --json <file.json>  --expect-head <n>:<h>  --expect-key <keyId>  --strict
            --allow-changes <glob>...  --pin-file <file>  --ledger <file>...
iqc head  [folder]   Print the current head, to pin somewhere else (an email, an ELN entry, a printout).
iqc status [folder]  Ledger, key, records, last session, and what changed since the last seal.
iqc record --actor <name> --action <text> [--tool <name>] [--in <file>]... --out <file>... [--root <folder>]
                     Record one agent step in <root>/ImmutableQC/ledger.jsonl.
iqc trace <file> [--search <folder>]...      Trace a file's bytes back to measured files.
iqc review <ledgerId>:<n>[:<link>]... --reviewer <name> --decision approved|question|rejected [--note <text>]
iqc mcp [--root <folder>] [--actor <name>] [--tool <name>] [--search <folder>]...   An MCP server on stdio.
iqc help [command] | --version
Common: --ledger <path>  --key <path>  --station <name>  --interval <s> (2)  --settle <s> (10)
        --ignore <glob> (repeatable; * and ?)  --pin-file <file>  --quiet  --no-color (NO_COLOR is honored too)
```

`iqc` stands for `node iqc.mjs` (the download) or `node agent/bin/iqc.mjs` (this repository). The folder defaults to
the current folder. Options can go before or after the folder.

### Examples

Windows (Command Prompt or PowerShell; quote a path that has spaces):

```bat
node C:\ImmutableQC\iqc.mjs watch "D:\Results"
node C:\ImmutableQC\iqc.mjs seal "\\lab-nas\hplc\Results" --quiet
node C:\ImmutableQC\iqc.mjs audit "D:\Results" --report "%USERPROFILE%\Desktop\audit.html"
node C:\ImmutableQC\iqc.mjs head "D:\Results"
```

macOS:

```sh
node ~/iqc/iqc.mjs watch "/Users/lab/Instrument Data"
node ~/iqc/iqc.mjs audit "/Volumes/LabShare/Plate reader" --json audit.json
```

Linux:

```sh
node ~/iqc/iqc.mjs watch /data/plate-reader --ignore '*.bak' --ignore cache
node ~/iqc/iqc.mjs seal /data/plate-reader --settle 30 --pin-file /mnt/pins/plate-reader.pins
node ~/iqc/iqc.mjs audit /data/plate-reader --expect-head 1234:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
```

On Linux and macOS you can also make the file executable (`chmod +x iqc.mjs`) and run `./iqc.mjs watch …`.

### watch

Seals every file in the folder now, then keeps sealing until you press Ctrl+C or the process is stopped (SIGINT,
SIGTERM, SIGHUP, and Ctrl+Break or closing the window on Windows). It writes a `watch-started` record first and a
`watch-stopped` record when it stops, then prints a summary. Output:

```
08:14:02 sealed   QC/run-0914/injection-06.csv  1.2 MB  eb1690bc…
08:15:40 changed  QC/run-0914/injection-06.csv  1.2 MB  0f3c99d2…
08:20:11 removed  QC/run-0914/old.csv
```

### seal

Seals the folder once and exits: a `scan` record first, then every file that is new, changed or removed since the last
seal. A file that is still being written, or is open in a program that locks it, is waited for while other files make
progress, and at most a minute without progress; then it is left for the next run, with a warning.

### audit

Finds every ledger in the folder, by the same rule as the app: the folder's own `ImmutableQC/ledger.jsonl`, the
`ImmutableQC/ledger.jsonl` of every folder under it (up to 6 folders deep), and every reviewer's `*.ledger.jsonl`. Each
ledger's files are those of its folder, without the folders of the other ledgers inside it. Give the folder that holds
your instrument folders, the agent's folder and the reviewers' ledgers, and it audits them together: every ledger
verified whole (every signature, link and record number), every file read and compared with its seal, and every agent
step's inputs traced back to the files instruments sealed. It prints the verdict: pass, review, or exactly what does
not match, then one line per ledger.

A folder that holds one ledger of sealed files and nothing else gets the single-ledger report (the same JSON the app
and earlier versions of `iqc` produce); a lab gets the lab report (`"kind": "many"`). `--report audit.html` writes a self-contained report that prints well on
A4 and Letter; `--json audit.json` writes the machine-readable report (`--json -` writes it to the standard output and
the human lines to the standard error). `--expect-head <n>:<h>` fails unless record n's link is h (a head pinned
earlier; a ledger that has grown since still passes). `--expect-key <keyId>` fails unless the ledger is signed with
that key. `--allow-changes <glob>` (repeatable) marks recorded changes to matching files as expected: they are listed,
not put up for review. `--pin-file <file>` checks every pin line written by `watch` or `seal --pin-file`: each pinned
record must still have its pinned link, or the audit fails. `--ledger <file>` (repeatable) adds a ledger kept outside the
folder (a reviewer's ledger, another agent's); for a folder whose own ledger is kept elsewhere (written with
`--ledger`), the first `--ledger` is that ledger. A file sealed more than once (changed after its first seal) or removed is a recorded change: the verdict is
review (exit 3), with each change listed. `--strict` counts those and the notes (a change found while nothing was
watching, a file not sealed, a watch that did not stop cleanly, gaps between sessions) as failures. An audit writes nothing to the folder or
the ledger, and needs no key.

The same audit runs in a browser: open [immutableqc.com/app/](https://immutableqc.com/app/) and drop the data folder
(or the lab folder).
Every file is read in the browser; nothing is uploaded.

### head

Prints the current head, `n:h` (the last record's number and its link), alone on the standard output; what it is goes
to the standard error. Pin it somewhere the ledger's key holder cannot change (an email, an ELN entry, a printout). A
later `iqc audit --expect-head n:h` shows whether the ledger was rewritten or cut short since.

### status

Shows the ledger (intact or not, records, size), the station, whether the ledger's key is on this computer, the head,
whether an agent is running, the last session, and what changed since the last seal. It writes nothing.

### record

```sh
node iqc.mjs record --root /lab/agent-workspace --actor analyst-bot --tool model-x \
  --action "Normalized plates 07 and 08 to well A1" \
  --in inputs/plate-07.csv --in inputs/plate-08.csv --out analysis/plate-07-normalized.csv
```

Hashes each input and output (each must be a file inside `--root`, which defaults to the current folder; a path that
leaves the root, a symbolic link and a file reached through a linked folder are refused) and appends one signed `step`
record to `<root>/ImmutableQC/ledger.jsonl` (created, with a new key, on first use). Paths are relative to the current
folder, and stored relative to the root. `--in-ref <sha256>:<bytes>:<label>` names an input that is not a file under the
root. It prints the record number and its reference (`<ledgerId>:<n>:<link>`, what `iqc review` takes), then each
input's trace against the ledgers under `--search` (repeatable; default the root): measured, derived or untraced, with a
warning for each untraced input. `--json <file>` (or `-`) writes all of it as JSON. Exit 0 recorded, 1 refused (a broken
ledger, a missing key, another writer), 2 usage or read error.

### trace

`iqc trace <file> [--search <folder>]...` hashes the file and traces its bytes back through the recorded steps to the
files instruments sealed, as a tree (searching the ledgers under the current folder by default). Exit 0 when the file was
measured, or every branch of its tree ends in a measured file; 3 when something on the way is untraced (or the steps
form a cycle); 2 for a usage or read error.

### review

```sh
node iqc.mjs review 5c1f…:3 --reviewer "J. Rivera" --decision approved --note "Curve fits checked" --search /lab
```

Appends a signed `review` record (approved, question or rejected, with an optional note) to the reviewer's own ledger,
`./<reviewer>.ledger.jsonl` by default (for example `j-rivera.ledger.jsonl`; `--ledger` sets another). Each record named
is looked up under `--search` (default the current folder) and its link written into the review; a reference that
carries a link (`<ledgerId>:<n>:<link>`) that no longer matches is refused, so a review always names the exact record it
saw. Keep the reviewer's ledger in the lab folder: an audit finds it and shows each step's review state. The signing key
identifies whoever holds it on that computer, not a person. Exit 0 recorded, 1 refused, 2 usage or read error.

### mcp

`iqc mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server on standard input and output, for an AI
agent: JSON-RPC 2.0, one message per line, no dependencies. Standard output carries protocol messages only; everything
else goes to the standard error. It holds the root's ledger for as long as it runs, between an `mcp-started` and an
`mcp-stopped` record, and stops when its standard input closes (or on Ctrl+C or SIGTERM). Every path a tool takes is
relative to `--root` and confined to it.

| Tool | What it does | Writes |
|---|---|---|
| `check_inputs` {paths} | Each file's SHA-256 and trace state: measured (by which station, when), derived (by which step) or untraced; and whether a sealed file changed since it was sealed. For the agent to call before it uses files. | nothing |
| `record_step` {action, inputs, outputs, input_refs?, actor?, tool?} | Hashes the files and appends a `step` record; returns its number, link and reference, and each input's trace, with a plain warning for an untraced input. For the agent to call after it writes outputs, once per step. | one record |
| `trace` {path} | A file's tree back to measured files. | nothing |
| `audit_summary` {strict?} | The verdict, summary and counts for the ledgers under the search folders. | nothing |

Protocol versions: `2026-07-28` (no handshake: each request carries its version and the client's capabilities in
`_meta`; `server/discover`), and the handshake versions `2025-11-25`, `2025-06-18`, `2025-03-26` and `2024-11-05`
(`initialize`, `notifications/initialized`, `ping`). Tool results carry a plain text summary and the same data as JSON
text; from `2025-06-18` also `structuredContent`, matching each tool's `outputSchema`. A bad argument or a refused path is
a tool error (`isError: true`) with a sentence saying why; an unknown method, an unknown tool and a malformed message are
JSON-RPC errors.

An MCP client starts the server from its configuration. The usual form (the file and its place depend on the client):

```json
{
  "mcpServers": {
    "immutableqc": {
      "command": "node",
      "args": ["/opt/iqc/iqc.mjs", "mcp", "--root", "/lab/agent-workspace", "--search", "/lab", "--actor", "analyst-bot"]
    }
  }
}
```

The signing key is made on first use in the home folder of the user the client runs the server as
(`~/.immutableqc/keys/`); back it up as for any ledger.

### From a pipeline (Python)

A pipeline step can record itself by calling `iqc record` with the standard library's `subprocess` module:

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

With `--json -` the JSON is the standard output and the human lines go to the standard error.

## Options

| Option | Default | What |
|---|---|---|
| `--ledger <path>` | `<folder>/ImmutableQC/ledger.jsonl` | Keep the ledger somewhere else, for example on another drive (an existing folder means `ledger.jsonl` inside it). Its lock is `agent.lock` beside it, or `<ledger>.lock` when the file has another name. |
| `--key <path>` | `~/.immutableqc/keys/<keyId>.jwk` | The signing key file. For a new ledger, use this key instead of making a new one. |
| `--station <name>` | the ledger's station, or this computer's name for a new ledger | The station in new records (1 to 64 characters, no `\|`). |
| `--interval <s>` | 2 | Seconds between scans of the folder. |
| `--settle <s>` | 10 | Seconds a file's size and modification time must stay the same before it is read and sealed. The default is 10 because the Windows client for network shares (SMB) keeps file information (size, times) for up to 10 seconds, and instrument software often writes a file in bursts; raise it if your software pauses longer while writing, lower it on a local disk if you want seals sooner. |
| `--pin-file <file>` | | `watch` and `seal`: after each batch of records, append one line `immutableqc-head <ledgerId> <n>:<h> <time>` to this file. Keep it somewhere else (another drive, a network share, a synced folder): `iqc audit --pin-file <file>` then shows a ledger rewritten or restarted since by anyone with access to the data folder. A pin that cannot be written is a warning; sealing goes on. Its folder must exist. |
| `--ignore <glob>` | | Skip matching files and folders; repeatable. `*` matches any run of characters and `?` one, never `/`; case is ignored. A pattern without `/` matches any file or folder name (a folder's whole content is skipped); with `/` it matches the path from the data folder. Always skipped: `.DS_Store`, `Thumbs.db`, `desktop.ini`, `~$*`, `*.tmp`. Give the same patterns to `audit`, so ignored files are not listed as not sealed. |
| `--quiet` | | Print only problems (warnings and errors). A passing audit prints nothing. |
| `--no-color` | | No colors. Colors are used only on a terminal, and never when `NO_COLOR` is set. |

`IQC_DEBUG=1` adds the stack trace to an unexpected error.

## How it decides what to seal

- The agent scans the folder every `--interval` seconds (polling works on network shares, where file events do not).
  It walks the folder with `lstat`: symbolic links are skipped and never followed, and so are the `ImmutableQC` folder
  at the root of the data folder, the default ignores and `--ignore` matches. A scan is cheap on a local disk (about
  20 ms of processor time for 5,000 files); on a share, where each look is a round trip, it looks at up to 64 files at
  once.
- A file is a candidate when its size or modification time differs from what was last sealed (the record's size and
  its unsealed `ctx.modifiedAt`) or last seen. A file whose size and modification time still match its last seal is
  not read again; a change that keeps both (edited, then its time set back) is not sealed by the agent, and an audit,
  which reads every file, reports it as changed.
- A candidate is read once its size and times have not changed for `--settle` seconds and it can be opened. A file
  that is open in a program that locks it is retried on every scan; after a minute the agent warns once. If the file
  changes while it is being read, it waits again. Files are opened for reading only, and shared, so the instrument
  software can keep writing, renaming or deleting them.
- The SHA-256 is computed streaming (1 MiB at a time), so a file of any size never has to fit in memory. A file is
  sealed only if its SHA-256 differs from its latest sealed version: a touched file with the same bytes is not sealed
  again.
- A sealed file that is gone is recorded removed. During a watch it must stay gone for `--settle` seconds first (a
  program that saves by deleting and renaming does not make a removal). Files inside a folder that cannot be read, or a
  folder that is out of reach (a network share that dropped), are never recorded as removed.
- Events: the first scan a ledger ever makes records `existing`. While a watch runs: `added`, `changed`, `removed`. At
  the start of a later watch, and in `seal`: `added-unwatched`, `changed-unwatched`, `removed-unwatched` (it happened
  while nothing was watching, so its time is unknown).
- Two files whose names differ only in Unicode form (NFC and NFD, possible on Linux) would have the same stored path;
  neither is sealed, and the agent says so.

## What it reads and writes

Reads: every file in the data folder (bytes, size and times), the ledger, its key.

Writes:

- `<folder>/ImmutableQC/ledger.jsonl`: the ledger. One record per line; each record is one write of one complete line
  to the file opened for append, then `fsync`. A new ledger is written to a temporary file, flushed and renamed into
  place. The agent never edits, reorders or removes a line. If a write fails, it cuts the file back to its last complete
  record and stops.
- `<folder>/ImmutableQC/README.txt`: what the folder is, not to edit or delete it, and how to audit it. Written once a
  ledger exists, if missing; never overwritten. It also marks the folder as having had a ledger: if `ledger.jsonl` is
  then missing (moved, renamed or deleted), the agent refuses to start a new one silently. To start a new ledger on
  purpose, delete `README.txt` too.
- `<folder>/ImmutableQC/agent.lock`: while an agent runs (its process id, computer name and start time). A second agent
  on the same ledger refuses to start. A lock whose process is gone is taken over with a warning; a lock from another
  computer is left alone (delete it by hand if no agent runs there). The lock is removed when the agent exits.
- `~/.immutableqc/keys/<keyId>.jwk` (on Windows `%USERPROFILE%\.immutableqc\keys\`): on first use, a new ECDSA P-256
  signing key, as a JWK file created with exclusive create (an existing file is never overwritten), mode 0600 in a
  folder of mode 0700 (on Windows the file inherits the user profile's permissions). The ledger's header carries the
  public key and its key id.
- The pin file you give with `--pin-file`: one line appended (then `fsync`) after each batch.
- For `iqc record` and `iqc mcp`: `<root>/ImmutableQC/ledger.jsonl` (the agent's step ledger), its `README.txt` and
  `agent.lock`. For `iqc review`: the reviewer's `*.ledger.jsonl` and `<ledger>.lock` beside it.
- The reports you ask `audit` for (`--report`, `--json`).

Before it appends anything, the agent verifies the whole ledger. If anything fails it writes nothing and says to run
`iqc audit`: it never extends a broken ledger and never repairs one. While it runs it keeps the verified state in
memory and brings it up to date as it appends, so a scan never verifies the whole ledger again; if the ledger file
changes on disk by anything else, it verifies it again before the next write and stops if it no longer verifies.

**Back up the key.** Without it, nothing more can be added to that ledger (it can still be audited). To seal the same
folder from another computer, copy the key file into that computer's `~/.immutableqc/keys/`, or pass it with `--key`.
Keep it out of the data folder.

## Run it at login, or on a schedule (examples)

These are examples to adapt (paths, folder, user), not an installer. Whatever stops the agent should send it a normal
stop (Ctrl+C, SIGTERM, closing the window), so it records `watch-stopped`; a forced kill leaves a watch without a stop
record, which the next audit shows as a note.

### Windows: at login, with the Startup folder (example)

Create `C:\ImmutableQC\watch.cmd`:

```bat
@echo off
title Immutable QC agent
"C:\Program Files\nodejs\node.exe" "C:\ImmutableQC\iqc.mjs" watch "D:\Results"
```

Press Win+R, type `shell:startup`, and put a shortcut to `watch.cmd` in that folder. The agent starts in its own window
at each login; closing the window stops it cleanly.

### Windows: Task Scheduler (examples)

Watch from logon, in the background:

```bat
schtasks /Create /TN "Immutable QC watch" /SC ONLOGON /RL LIMITED ^
  /TR "\"C:\Program Files\nodejs\node.exe\" \"C:\ImmutableQC\iqc.mjs\" watch \"D:\Results\" --quiet"
```

In the task's properties (Task Scheduler, Settings tab), clear "Stop the task if it runs longer than 3 days". Ending
the task from Task Scheduler is a forced stop (no `watch-stopped` record).

Or seal on a schedule, every 15 minutes (each run writes a `scan` record; changes are recorded with `-unwatched`
events, their time known only to within the interval):

```bat
schtasks /Create /TN "Immutable QC seal" /SC MINUTE /MO 15 ^
  /TR "\"C:\Program Files\nodejs\node.exe\" \"C:\ImmutableQC\iqc.mjs\" seal \"D:\Results\" --quiet"
```

The task's "Last Run Result" is the exit code: 0 done, 1 refused or failed, 2 usage or read error.

### Linux: a systemd user service (example)

`~/.config/systemd/user/iqc-watch.service`:

```ini
[Unit]
Description=Immutable QC agent: seal /data/plate-reader as files are written

[Service]
ExecStart=/usr/bin/node %h/iqc/iqc.mjs watch /data/plate-reader --quiet
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
```

```sh
systemctl --user daemon-reload
systemctl --user enable --now iqc-watch.service
journalctl --user -u iqc-watch.service      # its output
loginctl enable-linger "$USER"              # keep it running when nobody is logged in
```

systemd stops it with SIGTERM, so it records `watch-stopped`.

### macOS: a launchd agent (example)

`~/Library/LaunchAgents/com.immutableqc.watch.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.immutableqc.watch</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/lab/iqc/iqc.mjs</string>
    <string>watch</string>
    <string>/Users/lab/Instrument Data</string>
    <string>--quiet</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardErrorPath</key><string>/Users/lab/Library/Logs/iqc-watch.log</string>
</dict>
</plist>
```

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.immutableqc.watch.plist
launchctl bootout gui/$(id -u)/com.immutableqc.watch     # to stop it (SIGTERM: it records watch-stopped)
```

Use the path `which node` prints. If the folder is in Documents, Desktop or on a network volume, macOS may ask to
allow Node.js to read it (System Settings, Privacy & Security, Files and Folders or Full Disk Access).

## How to audit

- **In a browser:** open [immutableqc.com/app/](https://immutableqc.com/app/) and drop the data folder (the folder that
  holds `ImmutableQC`), or the lab folder. Nothing is uploaded.
- **On the command line:** `node iqc.mjs audit "<data folder>"`, with `--report audit.html` for a report to print or
  keep. In a pipeline, use the exit code.
- **Against a pinned head:** run `iqc head` now and keep its output somewhere else. Later:
  `iqc audit "<data folder>" --expect-head <n>:<h> --expect-key <keyId>`.

Copy or back up the data folder together with its `ImmutableQC` folder: the audit needs both.

## Exit codes

| Command | 0 | 1 | 2 |
|---|---|---|---|
| `audit` | pass | fail (a ledger has a problem, a file changed or is missing, an expectation or a pin does not match, or a note or an item for review with `--strict`) | usage error, or the folder, a ledger or the pin file cannot be read |
| `watch`, `seal` | done (a watch stopped cleanly; a seal finished, warnings or not) | refused or failed: a broken ledger, a missing or wrong key, another agent running, a write error, a seal interrupted | usage error, or the folder cannot be read |
| `head` | printed | the ledger does not verify | usage error, or the folder or ledger cannot be read |
| `status` | printed | the ledger does not verify | usage error, or the folder cannot be read |
| `record`, `review` | recorded | refused: a broken ledger, a missing key, another writer, a review whose link does not match | usage error (a path outside the root, a missing option, a bad field), or a file cannot be read |
| `trace` | measured, or every branch ends in a measured file | | usage error, or the file cannot be read |
| `mcp` | stopped cleanly | refused at start (as `record`), or the stop record could not be written | usage error |

`audit` exits **3** for review: nothing failed, but there is something to look at: a sealed file was changed after its
first seal or was removed (each change is recorded), an agent step used inputs nothing measured, or a reviewer
questioned or rejected a step. `trace` exits **3** when something on the way to the file is untraced.

A second Ctrl+C stops a watch at once (exit 130), without its stop record.

## This repository

- `bin/iqc.mjs` runs the sources; `src/*.mjs` are the agent's modules. They import `../../core/immutableqc.mjs`, the
  one implementation of the ledger format, shared with the web app: the agent uses it to plan what to seal
  (`planSeal`), to ignore files (`ignoreMatcher`), to make and verify the ledger (`createHeader`, `createRecords`,
  `verifyLedger`, `extendVerified`), to find ledgers (`discoverLedgers`), to make step and review records (`planStep`,
  `planReview`), to audit and trace (`audit`, `auditMany`, `renderReportHTML`), to read a head (`parseHead`) and to
  write and read pin lines (`formatPinLine`, `parsePinLines`).
- `tools/bundle.mjs` writes `../download/iqc.mjs`, the one-file download (core inlined): `node agent/tools/bundle.mjs`.
  `--check` exits 1 if the committed file is not up to date; `--stamp` also writes its SHA-256 into every element of
  `index.html` that has `data-sha256-of="download/iqc.mjs"`.
- Tests: `node --test agent/test` (unit tests, the CLI end to end in temporary folders against both `bin/iqc.mjs` and
  `download/iqc.mjs`, record, trace, review and the lab audit on core's lab fixture, a scripted MCP client, and the
  bundle: up to date, and no network API in it).
