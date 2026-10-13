# Design decision (lead, 2026-10-13)

Base: the **luminous** concept (`luminous/landing.html`, `luminous/app.html` and their screenshots). Judges: luminous
144, hud 143, holo 127. Luminous has the most futuristic, premium and calm system and the best state palette. We graft the
best of hud and holo onto it. Read all three concepts' HTML and screenshots before building; copy their good parts freely.

Rules that hold everywhere:
- Restraint: glow only on the seal, the main action and a pass. No gradient text except the headline. It must read as a
  next-generation lab instrument, never as a web3 launch page.
- State palette: cyan/teal signal = pass and sealed; coral/red = fail, changed, missing; amber = notes only (never a
  failure). Every state also has an icon and a word.
- The demo story is the same everywhere (landing hero, app demo, examples): a sample plate-reader folder with
  `plate-07.csv` (well, abs_450 rows; A01 0.482 becomes 0.428 in the edited copy). Every hash shown is the real SHA-256 of
  the real sample bytes (computed, and tested).
- Honest framing: the edit happens in a **copy** (a shared drive, a sync conflict, a restored backup), not on the watched
  instrument PC: a watching agent would seal that edit as a new version (a note), which the page also says in one line.

## Landing page grafts
1. Eyebrow "Tamper-evident records for automated labs". Headline: "Every instrument file, sealed. Any later change,
   caught." (keep "later": the honest scope). Lead: "Seal every file as your instruments write it. Anyone can audit the
   folder in one click, and your data never leaves your lab." CTAs: "Run the 1-click demo" (primary, → app/#demo) and
   "Get the agent" (→ #install). Under them: "The demo seals sample data in your browser. Nothing to install."
2. Hero visual: luminous's sealing ring with the file inside, four phases as real buttons that jump to a phase:
   1 Written, 2 Sealed, 3 Copy edited, 4 Caught. Phase 1-2 panel header "iqc watch · bio-line-2"; phase 3 header changes
   to "copy · shared drive", caption "Weeks later, a sync conflict rewrites one value in a shared copy. The folder looks
   the same."; phase 4 header "audit · nothing uploaded", caption "One click audits the copy: plate-07.csv changed since it
   was sealed.", and a compact file list (hud): three files MATCH, plate-07.csv CHANGED, with sealed vs now fingerprints.
   The "inside the file" view highlights the edited cell, labeled as what changed in the copy (the audit compares bytes,
   not values: value extraction is Upcoming). Play/Pause always visible; with prefers-reduced-motion, start static on the
   Caught phase and play only on request; pause when off-screen or the tab is hidden. Screen-reader description matches.
   On phones (≤480 px) cap the ring at about 280 px so the Caught state shows within about 1.3 screens.
3. Three steps, then directly under them hud's split block "A pass shows / It does not show": a pass shows each file is
   byte-for-byte the one sealed and the ledger was not edited, reordered or cut; it does not show the file was right when
   written, or a change in the few seconds before the agent reads a new file; someone with the ledger's key could rewrite
   it from the start, which a head pinned elsewhere exposes. Plus the one line: "A change on the instrument PC while the
   agent runs is sealed as a new version, with its time; the audit lists every version."
4. Why it matters: three cards (most bad data is not malicious: scripts, sync conflicts, restored backups; results feed
   models that choose the next experiment, so one wrong value travels; nothing is uploaded: "The ledger holds
   fingerprints, not data. Audits run in your browser, and the app is blocked from connecting anywhere." and "To pin the
   ledger somewhere else, you share only its head: a record number and a 64-character link that reveals none of your
   data."). The founder's line once, with the typographic apostrophe: "In an intelligence explosion, human review can’t
   keep up with every result; records have to verify themselves."
5. Who it is for: automated research labs (biotech, microbiology, chemistry, materials science). Then "Upcoming:
   per-person signatures and the review controls regulated labs ask for."
6. "What works today, and what is Upcoming": works-today list; Upcoming items as compact chips under one visible
   "Upcoming" label, each with a visually hidden "Upcoming:" prefix.
7. Install (#install): two numbered cards. "1 · Download" `iqc.mjs` with its real SHA-256 under the button (an element
   with `data-sha256-of="download/iqc.mjs"` so the build can stamp and check it) and the check commands
   `certutil -hashfile iqc.mjs SHA256` (Windows) / `shasum -a 256 iqc.mjs` (macOS, Linux). "2 · Run one command":
   `node iqc.mjs watch "D:\Results"` (never wraps; scrolls inside its box). "Needs Node.js 20 or later on Windows, macOS
   or Linux." A "What it touches" block: Reads every file in the folder, read-only (skips symlinks and system files).
   Writes only `ImmutableQC/ledger.jsonl`, `README.txt` and `agent.lock` in that folder, and its private key at
   `~/.immutableqc/keys/` (readable only by you). Network: none. Runs as you: no installer, no service. Stops on Ctrl+C,
   and records the stop. A pipeline snippet: `node iqc.mjs seal` for a scheduler, `node iqc.mjs head` to pin,
   `node iqc.mjs audit --expect-head <n>:<h> --json audit.json` with "exit 0 pass, 1 fail, 2 usage or read error".
8. Closing band before the footer: "See a pass and a fail in under a minute." + "Run the 1-click demo".
9. Footer: Docs (Overview, How a record is sealed, Check a record, Regulatory map, Roadmap, About), "The code that checks
   your data" → core/immutableqc.mjs, contact via joseqc.com, the status line with each segment unbreakable, the
   independence line.

## App grafts (on luminous/app.html's design)
1. Same palette rules. Ghost download buttons on FAIL; the cyan primary only on PASS.
2. Problem cards: full sealed and current SHA-256 in 8-character groups, sizes ("1,218,664 bytes instead of
   1,218,661"), and "Matches the version sealed in record n" when it does. Header "Problems · each one fails the audit".
   On a fail, a one-line notes summary ("4 notes (not failures): …").
3. In the fail state: "A fail is a finding, not a verdict on anyone: compare the changed files with your backups, and keep
   the report with the run."
4. File list: filter chips All / Problems / Notes with counts that match the stat tiles, plus search by path or
   fingerprint; problems first.
5. Ledger panel: station, ledger id, key id (copy), records, head (copy), created, signatures, "Agent:
   immutableqc-cli/0.1.0 (not sealed)", "Pinned head: none given. Pin one with `iqc head` to catch a rewrite by the key
   holder.", "Re-run on the command line: `node iqc.mjs audit "D:\Results" --json audit.json` (exit 0 pass, 1 fail, 2
   usage or read error)", and a link "What a seal covers" → ../sealed.html.
6. Watch-session bar with a hatched segment for "no clean stop" and a written legend.
7. Action row at the end of a verdict: "Audit another folder", copy chips for head and key id.
8. Progress: files and bytes, elapsed, time left, read rate, the file being read and its slice. Copy: "Files and bytes
   checked, live. Nothing is written to the folder."
9. Drop target copy: "Any file type. Large files are read in 8 MiB slices, so they never have to fit in memory." (not
   "any size").
10. Docs link visible on phones. A light print stylesheet for the page.
