// iqc: the command line. run(argv) returns the exit code; it never throws for a mistake a person can fix (those are
// printed as one clear message, with a stack trace only when IQC_DEBUG=1).
import { AGENT_VERSION, UserError, EXIT_OK, EXIT_FAIL, EXIT_USAGE } from './util.mjs'
import { parseArgs } from './args.mjs'
import { Out } from './out.mjs'
import { runSession } from './session.mjs'
import { runAudit } from './audit.mjs'
import { runHead, runStatus } from './info.mjs'

export const HELP = `iqc ${AGENT_VERSION}: the Immutable QC agent. It seals every file in a folder as it is written,
and audits the folder against its seals. Nothing is sent anywhere: iqc reads files and writes
its ledger; it never uses the network.

Usage:  node iqc.mjs <command> [folder] [options]

  watch  [folder]   Seal everything now, then keep sealing new, changed and removed files
                    until Ctrl+C.
  seal   [folder]   Seal once and exit (for a scheduler or a pipeline).
  audit  [folder]   Check the ledger and every file. Exit 0 pass, 1 fail, 2 usage or read error.
                    --report <file.html>   write the audit report (one HTML file, prints well)
                    --json <file.json>     write the machine-readable report (- for the output)
                    --expect-head <n>:<h>  fail unless record n's link is h (a head pinned earlier)
                    --expect-key <keyId>   fail unless the ledger is signed with this key id
                    --strict               count notes as failures
  head   [folder]   Print the current head, to pin somewhere else (an email, an ELN entry,
                    a printout).
  status [folder]   Ledger, key, records, last session, and what changed since the last seal.
  help [command]    This help, or one command's.  --version prints the version.

The folder defaults to the current folder. Quote a path with spaces: "D:\\Instrument Data".

Options for every command:
  --ledger <path>    the ledger file (default: <folder>/ImmutableQC/ledger.jsonl)
  --key <path>       the signing key (default: ~/.immutableqc/keys/<key id>.jwk)
  --station <name>   the station in new records (default: the ledger's, or this computer's name)
  --interval <s>     seconds between scans (default 2)
  --settle <s>       seconds a file must stay unchanged before it is sealed (default 3)
  --ignore <glob>    skip matching files and folders; repeatable; * and ? (always skipped:
                     .DS_Store, Thumbs.db, desktop.ini, ~$*, *.tmp)
  --quiet            print only problems
  --no-color         no colors (NO_COLOR is honored too)

Examples:
  node iqc.mjs watch "D:\\Results"            Windows
  node iqc.mjs seal ~/instrument-data         macOS, Linux
  node iqc.mjs audit . --report audit.html
  node iqc.mjs head

Files: <folder>/ImmutableQC/ holds ledger.jsonl, README.txt and, while an agent runs,
agent.lock. Keys are kept in ~/.immutableqc/keys/. To audit in a browser, drop the folder on
https://immutableqc.com/app/ (nothing is uploaded).
`

const COMMAND_HELP = {
  watch: `iqc watch [folder] [options]

Seals every file in the folder now, then keeps sealing new, changed and removed files until you
press Ctrl+C (or the process is stopped). It writes a watch-started record first and a
watch-stopped record when it stops. A file is sealed once its size and modification time have
not changed for --settle seconds; the folder is scanned every --interval seconds, so it works on
network shares too. Only one agent may write to a ledger at a time.

Options: --ledger --key --station --interval <s> (2) --settle <s> (3) --ignore <glob> --quiet
         --no-color
Example: node iqc.mjs watch "D:\\Results"`,
  seal: `iqc seal [folder] [options]

Seals the folder once and exits: a scan record, then every file that is new, changed or removed
since the last seal. For a scheduled task or a pipeline. Exit 0 when done, 1 when it refused
(a broken ledger, a missing key, another agent running) or could not write, 2 for a usage or
read error.

Options: --ledger --key --station --settle <s> (3) --ignore <glob> --quiet --no-color
Example: node iqc.mjs seal /data/plate-reader --quiet`,
  audit: `iqc audit [folder] [options]

Checks the ledger (every signature and link) and reads every file to compare it with its seal.
Prints the verdict; exit 0 pass, 1 fail, 2 usage or read error. Writes nothing unless asked.

  --report <file.html>   the audit report: one self-contained HTML file
  --json <file.json>     the machine-readable report (- writes it to the standard output)
  --expect-head <n>:<h>  fail unless record n's link is h (a head pinned earlier with iqc head)
  --expect-key <keyId>   fail unless the ledger is signed with this key id
  --strict               count notes as failures
  --ledger --ignore --quiet --no-color

Example: node iqc.mjs audit "D:\\Results" --report audit.html --expect-head 1234:9f86d081…`,
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
  help: 'iqc help [command]\n\nShows the help, or one command\'s.',
}

export async function run(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env, signals = process } = {}) {
  const major = Number(String(process.versions.node).split('.')[0])
  if (!(major >= 20)) {
    stderr.write(`iqc needs Node.js 20 or later; this is Node.js ${process.versions.node}. Get a current version from https://nodejs.org\n`)
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
    const humanOut = command === 'audit' && a.opts.json === '-' ? stderr : stdout
    out = new Out({ quiet: !!a.opts.quiet, noColor: !!a.opts['no-color'], env, stdout: humanOut, stderr })
    const ctx = { folder: a.folder, opts: a.opts, out, stdout, signals }
    if (command === 'watch' || command === 'seal') return await runSession(command, ctx)
    if (command === 'audit') return await runAudit(ctx)
    if (command === 'head') return await runHead(ctx)
    if (command === 'status') return await runStatus(ctx)
    return EXIT_USAGE
  } catch (e) {
    if (e instanceof UserError) {
      out.error(e.message)
      return e.exitCode
    }
    out.error(`Something went wrong that iqc did not expect: ${e && e.message ? e.message : e}`)
    if (env.IQC_DEBUG === '1') stderr.write(`${e && e.stack ? e.stack : e}\n`)
    else out.error('Run it again with IQC_DEBUG=1 to see the details.')
    return command === 'audit' ? EXIT_USAGE : EXIT_FAIL
  }
}
