// iqc: the command line. run(argv) returns the exit code; it never throws for a mistake a person can fix (those are
// printed as one clear message, with a stack trace only when IQC_DEBUG=1).
import { AGENT_VERSION, UserError, EXIT_OK, EXIT_FAIL, EXIT_USAGE } from './util.mjs'
import { parseArgs } from './args.mjs'
import { Out } from './out.mjs'
import { runSession } from './session.mjs'
import { runAudit } from './audit.mjs'
import { runRecord, runTrace, runReview } from './steps.mjs'
import { runMcp, SUPPORTED_VERSIONS } from './mcp.mjs'
import { runHead, runStatus } from './info.mjs'

export const HELP = `iqc ${AGENT_VERSION}: the Immutable QC agent. It seals every file in a folder as it is written,
records the steps an AI agent takes on files, and audits a lab folder against its ledgers.
Nothing is sent anywhere: iqc reads files and writes its ledgers; it never uses the network.

Usage:  node iqc.mjs <command> [folder] [options]

  watch  [folder]   Seal everything now, then keep sealing new, changed and removed files
                    until Ctrl+C.
  seal   [folder]   Seal once and exit (for a scheduler or a pipeline).
  audit  [folder]   Check every ledger in the folder and every file. Exit 0 pass, 3 review,
                    1 fail, 2 usage or read error.
                    --report <file.html>   write the audit report (one HTML file, prints well)
                    --json <file.json>     write the machine-readable report (- for the output)
                    --expect-head <n>:<h>  fail unless record n's link is h (a head pinned earlier)
                    --expect-key <keyId>   fail unless the ledger is signed with this key id
                    --allow-changes <glob> files whose recorded changes are expected; repeatable
                    --pin-file <file>      check the heads written there by watch or seal
                    --ledger <file>        one more ledger to audit; repeatable
                    --strict               count items for review and notes as failures
  head   [folder]   Print the current head, to pin somewhere else (an email, an ELN entry,
                    a printout).
  status [folder]   Ledger, key, records, last session, and what changed since the last seal.
  record            Record one agent step: --actor, --action, --in <file>..., --out <file>...
  trace  <file>     Trace a file's bytes back to the files instruments sealed.
  review <ref>...   Sign off agent steps: --reviewer <name> --decision approved|question|rejected
  mcp               Serve the agent tools over MCP on standard input and output.
  help [command]    This help, or one command's.  --version prints the version.

The folder defaults to the current folder. Quote a path with spaces: "D:\\Instrument Data".

Options of watch and seal (and, where they apply, the other commands):
  --ledger <path>    the ledger file (default: <folder>/ImmutableQC/ledger.jsonl)
  --key <path>       the signing key (default: ~/.immutableqc/keys/<key id>.jwk)
  --station <name>   the station in new records (default: the ledger's, or this computer's name)
  --interval <s>     seconds between scans (default 2)
  --settle <s>       seconds a file must stay unchanged before it is sealed (default 10)
  --ignore <glob>    skip matching files and folders; repeatable; * and ? (always skipped:
                     .DS_Store, Thumbs.db, desktop.ini, ~$*, *.tmp)
  --pin-file <file>  after each batch, append the new head to this file (keep it on another
                     drive or a share)
  --quiet            print only problems
  --no-color         no colors (NO_COLOR is honored too)

Examples:
  node iqc.mjs watch "D:\\Results"            Windows
  node iqc.mjs seal ~/instrument-data         macOS, Linux
  node iqc.mjs audit . --report audit.html
  node iqc.mjs record --actor analyst-bot --action "Averaged the runs" --in raw.csv --out sum.csv
  node iqc.mjs trace summary.csv

Files: <folder>/ImmutableQC/ holds ledger.jsonl, README.txt and, while an agent runs,
agent.lock. Keys are kept in ~/.immutableqc/keys/. To audit in a browser, drop the folder on
https://immutableqc.com/app/ (nothing is uploaded). Needs Node.js 22 or later.
`

export const COMMAND_HELP = {
  watch: `iqc watch [folder] [options]

Seals every file in the folder now, then keeps sealing new, changed and removed files until you
press Ctrl+C (or the process is stopped). It writes a watch-started record first and a
watch-stopped record when it stops. A file is sealed once its size and modification time have
not changed for --settle seconds (default 10: the Windows network-share client keeps file
details for up to 10 seconds); the folder is scanned every --interval seconds, so it works on
network shares too. Only one agent may write to a ledger at a time.

  --pin-file <file>  after each batch of records, append the head (one line) to this file

Options: --ledger --key --station --interval <s> (2) --settle <s> (10) --ignore <glob>
         --pin-file <file> --quiet --no-color
Example: node iqc.mjs watch "D:\\Results" --pin-file "H:\\pins\\results.pins"`,
  seal: `iqc seal [folder] [options]

Seals the folder once and exits: a scan record, then every file that is new, changed or removed
since the last seal. For a scheduled task or a pipeline. Exit 0 when done, 1 when it refused
(a broken ledger, a missing key, another agent running) or could not write, 2 for a usage or
read error.

Options: --ledger --key --station --settle <s> (10) --ignore <glob> --pin-file <file> --quiet
         --no-color
Example: node iqc.mjs seal /data/plate-reader --quiet`,
  audit: `iqc audit [folder] [options]

Finds every ledger in the folder: its own ImmutableQC/ledger.jsonl, the ImmutableQC/ledger.jsonl
of each folder under it (up to 6 deep), and every reviewer's *.ledger.jsonl. Checks each one
(every signature and link), reads every file to compare it with its seal, and traces each agent
step's inputs back to the files instruments sealed. Prints the verdict; exit 0 pass, 3 review
(recorded changes or steps to look at), 1 fail, 2 usage or read error. Writes nothing unless asked.

  --report <file.html>    the audit report: one self-contained HTML file
  --json <file.json>      the machine-readable report (- writes it to the standard output)
  --expect-head <n>:<h>   fail unless record n's link is h (a head pinned earlier with iqc head)
  --expect-key <keyId>    fail unless the ledger is signed with this key id
  --allow-changes <glob>  recorded changes to files that match are expected (not for review);
                          repeatable
  --pin-file <file>       the heads written by watch or seal --pin-file: fail when a ledger no
                          longer holds one
  --ledger <file>         one more ledger to audit (repeatable); for a folder whose ledger is
                          kept elsewhere, the first --ledger is that ledger
  --strict                count items for review and notes as failures
  --ignore --quiet --no-color

Example: node iqc.mjs audit "D:\\Lab" --report audit.html --pin-file "H:\\pins\\results.pins"`,
  head: `iqc head [folder] [options]

Prints the current head (record number and link, n:h) on its own line, to pin somewhere else:
an email, an ELN entry, a printout. A later audit with --expect-head shows whether the ledger was
rewritten or cut short since. Exit 1 if the ledger does not verify.

Options: --ledger --quiet --no-color
Example: node iqc.mjs head "D:\\Results"`,
  status: `iqc status [folder] [options]

Shows the ledger (records, intact or not), the station, whether the signing key is on this
computer, the head, whether an agent is running, the last session, and what changed since the
last seal (read-only: nothing is written).

Options: --ledger --key --ignore --quiet --no-color
Example: node iqc.mjs status`,
  record: `iqc record --actor <name> --action <text> [--in <file>]... --out <file>... [options]

Records one step an agent (or a person, or a script) took: the files it read and wrote, each by
its SHA-256 fingerprint and size, who took it and what it did. The record is signed and appended
to the ledger of the root folder (<root>/ImmutableQC/ledger.jsonl). Every file must be inside the
root; a path that leaves it, a symbolic link or a file reached through a linked folder is refused.
Then each input is traced: measured (an instrument sealed these bytes), derived (a recorded step
wrote them) or untraced. Exit 0 recorded, 1 refused or could not write, 2 usage or read error.

  --root <folder>    the folder the step works in (default: the current folder)
  --actor <name>     who took the step (1 to 64 characters)
  --action <text>    what it did, on one line (1 to 500 characters)
  --tool <name>      the program or model (default "-")
  --in <file>        a file it read; repeatable
  --in-ref <ref>     an input that is not a file under the root: <sha256>:<bytes>:<label>
  --out <file>       a file it wrote; repeatable, at least one
  --search <folder>  where to look for ledgers to trace the inputs (default: the root); repeatable
  --json <file>      the record and the traces as JSON (- for the output)
  --ledger --key --station --pin-file --quiet --no-color

Example: node iqc.mjs record --root "D:\\Lab\\agent-workspace" --actor analyst-bot \\
           --action "Averaged the six injections" --in ../hplc-3/run-07.csv --out summary.csv`,
  trace: `iqc trace <file> [options]

Traces the file's bytes back through the recorded agent steps to the files instruments sealed,
and prints the tree. Exit 0 when the file was measured, or every branch ends in a measured file;
3 when something on the way is untraced (or the steps form a cycle); 2 for a usage or read error.

  --search <folder>  where to look for ledgers (default: the current folder); repeatable
  --json <file>      the trace as JSON (- for the output)

Example: node iqc.mjs trace summary.csv --search "D:\\Lab"`,
  review: `iqc review <ledger id>:<n>[:<link>]... --reviewer <name> --decision <decision> [options]

Signs off records (usually agent steps): approved, question or rejected, with an optional note.
The review goes in the reviewer's own ledger (default ./<reviewer>.ledger.jsonl), which an audit
of the lab folder finds and reads. Each record is looked up under --search and its link checked;
a reference whose link does not match is refused. The signing key identifies whoever holds it on
this computer, not a person. Exit 0 recorded, 1 refused, 2 usage or read error.

  --reviewer <name>  who reviews (1 to 64 characters)
  --decision <d>     approved, question or rejected
  --note <text>      why (1 to 500 characters)
  --search <folder>  where to look for the ledgers reviewed (default: the current folder)
  --ledger <file>    the reviewer's ledger
  --json <file>      the review as JSON (- for the output)
  --key --station --pin-file --quiet --no-color

Example: node iqc.mjs review 3f2a…:4 --reviewer "J. Rivera" --decision approved --search "D:\\Lab"`,
  mcp: `iqc mcp [options]

A Model Context Protocol server on standard input and output, for an AI agent: the agent calls
check_inputs before it uses files, record_step after it writes files, trace and audit_summary.
Standard output carries protocol messages only; everything else goes to standard error. The
server holds the root's ledger for as long as it runs, between an mcp-started and an mcp-stopped
record, and stops when standard input closes. Paths are relative to the root and confined to it.
Protocol versions: ${SUPPORTED_VERSIONS.join(', ')}.

  --root <folder>    the folder the agent works in (default: the current folder)
  --search <folder>  where to look for ledgers (default: the root); repeatable
  --actor <name>     the actor of each step unless the agent names one (default "agent")
  --tool <name>      the tool of each step unless the agent names one (default "-")
  --ledger --key --station --pin-file --ignore --quiet

Client setup (JSON):
  {"command": "node", "args": ["/path/to/iqc.mjs", "mcp", "--root", "/path/to/workspace"]}`,
  help: 'iqc help [command]\n\nShows the help, or one command\'s.',
}

export async function run(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env, signals = process, stdin = process.stdin } = {}) {
  const major = Number(String(process.versions.node).split('.')[0])
  if (!(major >= 22)) {
    stderr.write(`iqc needs Node.js 22 or later; this is Node.js ${process.versions.node}. Get a current version from https://nodejs.org\n`)
    return EXIT_USAGE
  }
  let out = new Out({ stdout, stderr, env })
  let command = null
  try {
    const a = parseArgs(argv)
    command = a.command
    if (a.version) { stdout.write(`iqc ${AGENT_VERSION}\n`); return EXIT_OK }
    if (a.help || command === null) {
      const topic = a.topic || (command !== 'help' ? command : null)
      stdout.write((topic && COMMAND_HELP[topic] ? COMMAND_HELP[topic] + '\n' : HELP))
      return EXIT_OK
    }
    // with --json -, the JSON is the standard output; the human lines go to standard error
    // (and iqc mcp: the standard output is the protocol)
    const humanOut = command === 'mcp' || a.opts.json === '-' ? stderr : stdout
    out = new Out({ quiet: !!a.opts.quiet, noColor: !!a.opts['no-color'], env, stdout: humanOut, stderr })
    const ctx = { folder: a.folder, file: a.file, subjects: a.subjects, opts: a.opts, out, stdout, signals, stdin }
    if (command === 'watch' || command === 'seal') return await runSession(command, ctx)
    if (command === 'audit') return await runAudit(ctx)
    if (command === 'head') return await runHead(ctx)
    if (command === 'status') return await runStatus(ctx)
    if (command === 'record') return await runRecord(ctx)
    if (command === 'trace') return await runTrace(ctx)
    if (command === 'review') return await runReview(ctx)
    if (command === 'mcp') return await runMcp(ctx)
    return EXIT_USAGE
  } catch (e) {
    if (e instanceof UserError) {
      out.error(e.message)
      return e.exitCode
    }
    out.error(`Something went wrong that iqc did not expect: ${e && e.message ? e.message : e}`)
    if (env.IQC_DEBUG === '1') stderr.write(`${e && e.stack ? e.stack : e}\n`)
    else out.error('Run it again with IQC_DEBUG=1 to see the details.')
    return command === 'audit' || command === 'trace' ? EXIT_USAGE : EXIT_FAIL
  }
}
