# Ten questions a lab will ask, with honest answers

Sources: `docs/product-v1.md` and `docs/patent-guardrails.md` at `8655698`.

**1. Does our data leave the lab?**
No. The ledger is a local file inside your data folder. The audit runs on your own copy, in your browser or on the
command line. The app's security policy blocks network connections, so nothing can be uploaded from it. Only you decide
who gets a copy of the folder.

**2. Do you host our records, or run a service auditors connect to?**
No. Immutable QC runs no service that holds or serves lab records. If an auditor needs the folder, you share it by
your own means.

**3. Which instruments does it work with?**
Any instrument whose software saves files to a folder. The agent reads only file bytes, whatever the format, with no
vendor cooperation and no reverse engineering. It doesn't parse instrument logs or extract values from inside files.
Extracting values is Upcoming.

**4. What does a pass show, and what doesn't it show?**
A pass shows each file is byte-for-byte the one the agent sealed, and that the ledger hasn't been edited, reordered or
cut since it was signed. It doesn't show the file was right when it was written: a wrong value is sealed as written.

**5. Is there any gap?**
Yes, one. The agent waits for a file to stop changing for a few seconds before sealing it, and a change made in that
window isn't caught. Someone holding the ledger's private key could also rewrite the ledger from the start. A head
pinned somewhere else earlier, such as a printout, a note in your electronic lab notebook or an email to yourself,
exposes that.

**6. What if a file is supposed to change?**
The audit says **review**, not fail, and lists each recorded change with its time. Upcoming: `--allow-changes` marks
files you expect to change, such as logs.

**7. Will it interfere with our instrument software?**
The agent opens files read-only and leaves them shared. Software that later tries to open a file exclusively while the
agent is reading it could get a "file in use" error. Test before production use, raise the settle time, and keep the
ledger outside folders the vendor software manages.

**8. Is anything put on a shared or public ledger?**
No. Each ledger is a local, single-writer, append-only file signed by one key. Ledgers are joined only at audit time,
by whoever holds them.

**9. Does this make us meet a regulation?**
No. Immutable QC isn't a validated system and makes no regulatory claim. It gives you evidence anyone can recompute
with published code. Automated research labs come first, and regulated QC labs later.

**10. Can we see what our AI agents did?**
Partly today, fully soon. The ledger format and the core audit already record agent steps and trace outputs back to
sealed measurements. Upcoming: the `iqc record` command, the Model Context Protocol server, and the app's agent
activity view and reviewer sign-off.
