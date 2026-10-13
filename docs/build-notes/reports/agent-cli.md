I've built the agent CLI and the one-file download, and `node --test agent/test core/test` passes: 94 tests (34 agent, 60 core), about 30 s, green on three runs in a row.

**One thing for whoever owns `index.html`:** `node site/build.mjs --check` fails on one assertion only: the SHA-256 printed on the landing page doesn't match the current bundle. The current SHA-256 is `594c2324af656aedb1d36791392c3ce48e9482da34e07560bc1bbd029e2f6410`. Running `node agent/tools/bundle.mjs --stamp` after the last bundle change fixes it; it already finds their one `<code id="sha-dl">`. I did not run `--stamp`.

**Files**
- `agent/package.json`, `agent/bin/iqc.mjs` (executable), `agent/README.md`.
- `agent/src/`: `cli.mjs` (dispatch and help), `args.mjs`, `out.mjs`, `paths.mjs`, `keys.mjs`, `lock.mjs`, `ledger.mjs` (README.txt text, read and verify, create, append), `scan.mjs` (walk and streaming hash), `session.mjs` (watch and seal), `audit.mjs`, `info.mjs` (head and status), `util.mjs`.
- `agent/tools/bundle.mjs` writes `download/iqc.mjs` (171,734 bytes, executable); `--check` and `--stamp` work as specified.
- `agent/test/`: `package.json`, `index.mjs`, `_helpers.mjs`, `cli.test.mjs`, `unit.test.mjs`, `bundle.test.mjs`.
- Core: I added `extendVerified(verified, records)`, which updates the verified state in place after an append. To share one set of rules I split the private `_state` into `_stateAdd` and `_gapsOf`; existing behavior is unchanged and all existing core tests pass, including the fixtures and the browser test. Its tests are in `core/test/extend.test.mjs`.

**Commands and options as implemented**
- `watch`, `seal`, `audit` (`--report`, `--json` with `-` meaning standard output, `--expect-head`, `--expect-key`, `--strict`), `head`, `status`, `help [command]`, `--help`/`-h`, `--version`/`-v`.
- Common: `--ledger`, `--key`, `--station`, `--interval` (2), `--settle` (3), `--ignore` (repeatable), `--quiet`, `--no-color`, and `NO_COLOR` when set and not empty.
- The folder defaults to the current directory.
- Exit codes: audit 0 pass, 1 fail, 2 usage or read error. Other commands: 0 done, 1 refused or failed, 2 usage or read error.

**How I verified it**
- **Tests:** 34 agent tests: 11 end-to-end tests run against both `agent/bin/iqc.mjs` and `download/iqc.mjs`, 9 unit tests (including the `path.win32` path conversion), and 3 bundle tests (`--check` passes; the bundle imports only `node:fs`, `node:fs/promises`, `node:path`, `node:os` and `node:crypto`, and has no fetch, http, dns or other network calls).
- **Wording lint:** the site's section 7g lint does cover `download/iqc.mjs`. I confirmed that by putting a banned word into it temporarily (the lint caught it), and the real bundle passes.
- **Speed, on 5,000 files:** first seal 3.1 s with an fsync after every record; audit 1.5 s; an idle watch uses about 2.8% of one core. It was about 30% before I made the folder scan adaptive.
- **Manual runs:** a full watch session, SIGINT and SIGHUP stops, and the bundle run directly.

**Decisions where the spec left room**
1. **Exit codes outside audit:** a seal that skips files because they are locked or still changing still exits 0, with warnings. An interrupted seal exits 1. A second Ctrl+C exits 130 at once, without the stop record. Running `iqc` with no command prints help and exits 0. An audit-only option on another command exits 2.
2. **Version and station:**
   - The agent's version is core's `VERSION`; a test checks `package.json` matches. The agent string `immutableqc-cli/0.1.0` goes in the header's `ctx.agent` and in session records.
   - Records use `--station`, else the existing ledger's station, else the computer's name. An invalid computer name is refused with a hint to use `--station`.
3. **Keys:**
   - The key file holds `{kty, crv, x, y, d, kid}`.
   - `--key` must name an existing file; for a new ledger it replaces making a new key.
   - On Linux and macOS the agent warns if the key file is readable by other users.
4. **Lock file:**
   - It holds `{pid, host, startedAt, command, agent}`.
   - A lock from another computer is refused with a "delete it if nothing runs there" hint, since its process can't be checked.
   - An unreadable lock is "starting" if under 10 s old, otherwise taken over with a warning.
   - On exit the agent removes the lock only if it is still its own.
5. **Ledger kept elsewhere (`--ledger`):**
   - An existing folder means `ledger.jsonl` inside it.
   - The lock is `agent.lock` beside a file named `ledger.jsonl`, otherwise `<ledger>.lock`.
   - README.txt is written only in the default `ImmutableQC` location.
   - A ledger and lock placed inside the data folder are never sealed.
6. **A deleted ledger is not replaced silently:** README.txt is written only after a ledger exists. If README.txt is there but `ledger.jsonl` is missing, the agent refuses; deleting README.txt starts a new ledger on purpose.
7. **Writing the ledger:**
   - A new ledger is written to a temporary file, flushed, then renamed into place.
   - If an append fails, the file is cut back to its last complete record and the agent stops.
   - Before each write the agent compares the ledger's size and time with what it last wrote. It re-verifies only if they differ. It carries on only if the ledger still verifies and still contains its head (warning if it grew), and stops otherwise.
8. **Change detection:**
   - At start, a file is compared with its seal's size and recorded modification time (whole milliseconds), so unchanged files aren't re-read on restart. This follows the spec's "last sealed" wording.
   - A consequence: an edit that keeps the size and the modification time while nothing was watching is not re-sealed by the agent, but the audit reports it as changed.
   - During a run, size, modification time and change time are all compared.
9. **Settle time:**
   - A file must be seen unchanged across two looks at least `--settle` apart, including at start, so `seal` always takes at least the settle time.
   - A file that changes while being read waits again.
   - During a watch, a missing file must stay missing for the settle time before it is recorded removed; at start, removal is recorded at once.
10. **Events:** files present at a session's first scan get the start events (`existing` on a new ledger, otherwise the `-unwatched` ones), even if they are sealed later in the session. Files that appear later get `added`, `changed` or `removed`.
11. **Seal waiting:** `seal` handles only the files present when it starts. It keeps waiting while files are still being sealed, and gives up on the rest after the longer of 60 s or twice (settle plus interval) without progress, with a warning per file.
12. **Busy files:** most open errors are retried on the next scan. A watch warns once after a minute of failures, and once if a file keeps changing for 5 minutes.
13. **Never recorded as removed:** files in folders that can't be read, files that can't be looked at, and everything while the folder itself is unreachable.
14. **NFC/NFD names:** two names that differ only in Unicode form are both skipped with a warning, and audit marks them "not checked".
15. **Output:**
   - Watch lines carry a time prefix. It also prints "Every file found at the start is sealed … Watching for changes." once the start pass is done; the tests use that line to synchronize.
   - `-unwatched` events are tagged "(while nothing was watching)". Paths are shown with `%` and `|` decoded.
   - Warnings and errors go to stderr.
   - With `--quiet`, a passing audit prints nothing and a failing one prints its verdict and problems.
   - `head` prints `n:h` alone on stdout and the explanation on stderr.
16. **Audit details:** the JSON is indented with 2 spaces. Ignored files that were never sealed are not hashed. Files are hashed four at a time. `audit`, `head` and `status` re-read a half-written last line if a live agent holds the lock.
17. **Windows arguments:** a stray trailing quote (from `"D:\Results\"`) and wrapping quotes are stripped, on Windows only.
18. **Scanning cost:** the folder scan uses synchronous `lstat` and yields between folders, so a stop request isn't kept waiting. It switches to 64 lookups at once when they are slow (a network share) and tries the fast way again every 30 scans.
19. **Bundle:** each module is wrapped in its own scope; imports are rewritten against an allowlist of five Node built-ins. The bundler refuses dynamic `import()`, `require` and default exports, runs `node --check` on its output, and is deterministic. `--check` only notes, without failing, when `index.html` shows a stale SHA-256.
20. **Unexpected errors:** one friendly line and exit 1 (2 for audit); the stack trace only with `IQC_DEBUG=1`.

**Left open**
- The busy/locked-file path isn't tested end to end: these tests run as root, which can read any file, and Windows file locking can't be reproduced on Linux.
- A second Ctrl+C (exit 130) isn't tested.
- Nothing has been run on Windows or macOS; Windows paths are covered only by the `path.win32` and quote-stripping unit tests.