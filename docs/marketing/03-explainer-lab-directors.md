# For lab directors: what Immutable QC does, in 300 words

Your lab's results pass through many hands before anyone reads them: instrument software, sync tools, scripts,
pipelines and, more and more, AI agents. Most bad data that gets through isn't malicious. A script rewrites a
column, two copies of a folder collide, a backup is restored over newer results. Nothing tells you a file changed.

Immutable QC adds that signal. A small agent runs on the instrument PC, or on any computer that can read the folder
where the instrument software saves results. It works with any instrument and any file format, because it reads only
bytes: no vendor cooperation and no reverse engineering. Each file gets a SHA-256 fingerprint as soon as it is written,
and the agent signs and links those fingerprints in a ledger kept inside the data folder.

Checking takes one step. Anyone with the folder drops it on the web app, and the browser re-reads every file and shows
one verdict:

- **Pass**: every file matches its seal, and the ledger is intact.
- **Review**: some files changed after they were first sealed, and each change is recorded for someone to look at.
- **Fail**: a file changed and nothing recorded it, or the ledger itself was edited.

Nothing is uploaded. The command line runs the same audit for scheduled checks, and both write a printable report.

A pass shows the files are the ones that were sealed. It doesn't show a value was right when
the instrument wrote it, and it doesn't cover the few seconds between the software writing a file and the agent
reading it.

Agents and pipelines can record each step they take, so a reviewer can trace any result back to the measurements behind
it and sign off in the browser.

Immutable QC is an independent project in open alpha, with no customers yet. Try the demo at immutableqc.com/app/, or
get in touch through joseqc.com.
