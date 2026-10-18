# Five short posts

Each post has an X version (at most 280 characters) and a LinkedIn version. Links go to the site or the app. Post 5
waits until the agent features ship.

## 1. The problem

**X**
Most bad lab data isn't fraud. It's a script, a sync conflict, a restored backup. Immutable QC seals every file an
instrument writes, so a quiet change shows up. Try it with sample data, nothing to install: immutableqc.com/app/

**LinkedIn**
Most bad lab data isn't fraud. It's a script that rewrote a column, a sync conflict between two copies, a backup
restored over newer results. Nobody notices, because nothing says the file changed.

Immutable QC seals every file an instrument writes, as it is written, and anyone can audit the folder in one click.
The demo takes a minute and needs no install: immutableqc.com/app/

## 2. One click

**X**
Drop a data folder on immutableqc.com/app/. The browser re-reads every file, recomputes every SHA-256 fingerprint,
checks every signature and shows one verdict. Nothing is uploaded. The page can't open a network connection.

**LinkedIn**
What a one-click audit means here: you drop a data folder on immutableqc.com/app/, and the browser re-reads every
file, recomputes its SHA-256 fingerprint and checks every signature and link in the ledger.

You get one verdict: pass, review (a recorded change worth a look) or fail (a change nobody recorded). Nothing is
uploaded, and the page's security policy blocks network connections, so that isn't a promise, it's enforced.

## 3. Honest limits

**X**
What a pass shows: each file is byte-for-byte the one that was sealed, and the ledger wasn't edited since. What it
doesn't show: that the value was right when the instrument wrote it. We say both.

**LinkedIn**
We try to be exact about what a seal shows.

A pass shows each file is byte-for-byte the one the agent sealed, and that the ledger hasn't been edited, reordered or
cut since it was signed.

It does not show the file was right when it was written. A wrong value from the instrument software is sealed as
written. And there's a short window between the software writing a file and the agent reading it. We name that gap
instead of hiding it.

## 4. Your data stays in your lab

**X**
Immutable QC never hosts your records. The ledger is a local file in your data folder, signed by one key. Audits run
on your own copy. You share files with whoever you choose, your way.

**LinkedIn**
A common question: where does our data go? Nowhere.

The ledger is a local file inside your data folder, signed by one key on your instrument PC. The audit runs on your
own copy, in your browser or on the command line. Immutable QC runs no service that holds or serves lab records. If an
auditor needs the folder, you send it to them, by your own means.

## 5. What did the agents do? (post after the App and Agent CLI work ships)

**X**
Upcoming: every agent step records what it read and wrote. One audit then traces each result back to the measurement
it came from, and flags any input nothing measured. A reviewer signs off in the browser.

**LinkedIn**
Labs are handing analysis to AI agents and pipelines. The hard question for a reviewer is no longer "is this file
intact?" but "what did the agent actually use?"

Upcoming in Immutable QC: each agent step records the files it read and wrote, through a small command or a Model
Context Protocol server the agent calls. One audit traces every output back to sealed measurements, flags any input
nothing measured, and lets a reviewer sign off. Measured values and derived ones stay apart, because each keeps its own
ledger and key.
