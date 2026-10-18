# Patent guardrails (internal; not published; not legal advice)

The founder's rule (2026-10-15): **no patented work.** Build nothing that practices a known patent's claims. Before a
launch, get a freedom-to-operate opinion from a patent attorney; this note is an engineer's reading, not a legal one.

## US 11,502,847 B2 (read from the granted patent, supplied by the founder)
- "Techniques for managing analytical information using distributed ledger technology". Assignee: Waters Technologies
  Ireland Limited. Filed 2019-07-12 (provisional 2018-07-13), granted 2022-11-15, term extended by 512 days, so in force
  until about late 2040 unless it lapses earlier. 22 claims; independent claims 1 (apparatus), 16 (system), 22 (method).
- Every independent claim needs **all** of these together:
  1. receiving analytical information from at least one analytical instrument;
  2. generating at least one record **in a distributed ledger** with a transaction associated with that information;
  3. the information comprising the instrument's **operating information**: an operating log (operation before, during
     or after an analysis), an audit trail (compliance with a regulatory protocol or chain of custody), or a digital
     signature recording the identity of an operator performing a function on the instrument;
  4. **receiving a request for the record from a third party through an analytical information exchange platform**, and
     providing the record to the third party in response.
  Claim 16 adds providing the distributed ledger, a producer node and a third-party consumer node. Dependent claims add
  spectra or chromatograms, compliance checks against ledger records, audit trails, chain of custody, smart contracts,
  verifying part of the information, comparing records, retrieval by criteria, and a chemical-fingerprint identifier.

## Claims of five more patents (read 2026-10-17)
Engineering reading only, not legal advice. Source for every claim below: the granted text on Google Patents
(`patents.google.com/patent/<number>B2/en`), fetched 2026-10-17. Independent claims are copied verbatim, including
the source's own typos; dependent claims are summarized. Dates and status are Google Patents' data (its "Active" and
expiration dates are estimates, not a legal status); confirm them on USPTO Patent Center before relying on them.

How to read the comparisons: a claim is practiced only if a product does **every** element of one independent claim.
"Absent" below means the element is not in what we build per `docs/product-v1.md` and
`docs/build-notes/spec-addendum-agents.md` (branch `claude/nifty-gates-h5guqf`). "Close" means part of our design
resembles the element and an attorney should look.

### Summary
| Patent | Assignee | Closest part of our design | Engineering risk | Attorney should look |
|---|---|---|---|---|
| US 12,032,554 B2 | Thermo Electron Scientific Instruments LLC | Hash-chained ledger plus head pinning and `expectHead` / `--pin-file` audits | **Medium**, the most relevant of the five | Yes: "blockchain" vs our hash-chained signed log; pin file / ELN / RFC 3161 vs "data escrow database system"; parent US 11,321,305 unread |
| US 11,178,157 B2 | CenturyLink Intellectual Property LLC | Nothing close; claims need failure prediction and rerouting data traffic | Low | Only as part of the family review |
| US 11,777,951 B2 | CenturyLink Intellectual Property LLC | `iqc mcp` `check_inputs` (a trust check on request), if it ever served data | Low | Family review; keep MCP tools returning fingerprints only |
| US 12,659,167 B2 | CenturyLink Intellectual Property LLC | Same as US 11,777,951, broadest claims of the family | Low | Family review; pending or later continuations |
| US 11,399,031 B2 | CenturyLink Intellectual Property LLC | Nothing close; we do not serve equipment configuration data | Low | Pending continuation US 2023/0379339 A1 and US 11,722,496 (unread) |

### US 12,032,554 B2
- "Utilizing independently stored validation keys to enable auditing of instrument measurement data maintained in a
  blockchain". Assignee: Thermo Electron Scientific Instruments LLC. Inventor: Mark C. Grandau. Application
  US 17/726,649, filed 2022-04-22, a continuation of US 16/710,003 (filed 2019-12-11, now US 11,321,305), which claims
  the provisional US 62/778,510 filed 2018-12-12. Published as US 2022/0245128 A1, granted 2024-07-09. Google Patents:
  Active, anticipated expiration 2039-12-11. 15 claims; independent claims 1 and 7 (computer-readable media) and 12
  (system).
- Independent claims, verbatim:

> **Claim 1.** One or more non-transitory computer-readable media storing instructions that, when executed by one or more processors, cause the one or more processors to perform steps comprising: receiving, via a communication interface of a computing platform and from a first block generator, a first data block comprising first measurement data, wherein the first data block is associated with a sample, wherein the first block generator is a separate device from the computing platform; generating, at the computing platform or at a second block generator, a first validation key calculated, using a key calculation algorithm, from contents of the first measurement data, wherein the first validation key does not include the contents of the first measurement data, wherein the second block generator is different from the computing platform and the first block generator, wherein the first validation key is calculated, using the key calculation algorithm, from the contents of the first data block and contents of a previous block in the blockchain or a second validation key corresponding to the previous block in the blockchain; before generating the first validation key, providing the first data block and the previous block in the blockchain or the second validation key corresponding to the previous block in the blockchain as arguments to the key calculation algorithm; storing the first data block and the first validation key in a blockchain at the computing platform; and providing, via the communication interface of the computing platform, the first validation key from the computing platform to a data escrow database system configured to store the first validation key in a validation keys database, wherein the validation keys database is independent of the blockchain, wherein the data escrow database system is a separate platform from the computing platform, the computing platform, the first block generator, and the second block generator, wherein the first measurement data is not sent to the data escrow database system, and wherein the data escrow database system securely stores the first validation key in an immutable list of validation keys to allow for verification of the first data block without requiring access to contents of the first measurement data.

> **Claim 7.** One or more non-transitory computer-readable media storing instructions that, when executed by one or more processors, cause the one or more processors to perform steps comprising: receiving, at a computing platform and from a first block generator, a first data block comprising first measurement data, wherein the first measurement data is associated with a sample, wherein the first block generator is a separate device from the computing platform; generating, at the computing platform or at a second block generator, a first validation key calculated, using a key calculation algorithm, from contents of the first data block, wherein the first validation key does not include the contents of the first measurement data, wherein the second block generator is different from the computing platform and the first block generator, wherein the first validation key is calculated, using the key calculation algorithm, from the contents of the first data block and contents of a previous block in the blockchain or a second validation key corresponding to the previous block in the blockchain; before generating the first validation key, providing the first data block and the previous block in the blockchain or the second validation key corresponding to the previous block in the blockchain as arguments to the key calculation algorithm; storing the first data block and the first validation key in a blockchain at the computing platform; and providing, via a communication interface of the computing platform, the first validation key from the computing platform to an auditor computing device, the first validation key and the first data block for validation of the first data block, wherein the auditor computing device is configured to validate the first data block by comparing the first validation key with a first validation record stored in a validation keys database via a data escrow database system, wherein the validation keys database is independent of the blockchain, wherein the data escrow database system is a separate device from the computing platform, the auditor computing device, the first block generator, and the second block generator, and wherein the data escrow database system securely stores, as part of the first validation record, the first validation key in an immutable list of validation keys to allow for verification of the first data block without requiring access to contents of the first measurement data.

> **Claim 12.** A system for generating and auditing instrument data comprising: a first block generator, configured to: measure a sample and generate first measurement data associated with the sample; and broadcast a first data block comprising the first measurement data, a second block generator, a data escrow database system, and a computing platform comprising an electronic processor configured to: receive, from the first block generator, the first data block; receive, a first validation key calculated at the computing platform or at the second block generator, using a key calculation algorithm, from contents of the first data block, wherein the first validation key does not include the contents of the first measurement data, wherein the first validation key is calculated, using the key calculation algorithm, from the contents of the first data block and contents of a previous block in the blockchain or a second validation key corresponding to the previous block in the blockchain; before generating the first validation key, provide the first data block and the previous block in the blockchain or the second validation key corresponding to the previous block in the blockchain as arguments to the key calculation algorithm; store the first data block and the first validation key in a blockchain at the computing platform; provide the first validation key to the data escrow database system configured to store the first validation key in a validation keys database, wherein the validation keys database is independent of the blockchain; and provide, from the computing platform to an auditor computing device, the first validation key from the blockchain for validation of the first data block, wherein the data escrow database system securely stores the first validation key in the validation keys database in an immutable list of validation keys to allow for the auditor computing device to verify the first data block by comparing the first validation key received from the computing platform with a validation record, including the first validation key, stored in the validation keys database without requiring access to the contents of the first measurement data.


- Dependent claims add: an auditor device that compares keys, with the platform and block generators on a private
  network and the escrow and auditor on a public network behind a firewall (2); a second, independent block generator
  whose key must match before the block is stored (3, 10); location, custody or weight data (4, 9); the block generator
  inside the instrument (5); a second data block per sample (8).
- Element by element, claim 1 (claims 7 and 12 have the same core plus the auditor):

| Element | What we build | Reading |
|---|---|---|
| A computing platform receives, from a **separate** block generator, a data block comprising measurement data associated with a sample | The agent (`iqc watch` / `iqc seal`) reads file bytes and writes its own records; no separate device sends it blocks. The `step` and `review` records come from other actors but go into their own ledgers, not a central platform. | Mostly absent; close if a central machine ever collected records from instrument PCs |
| A validation key computed from the block's contents that does not include the measurement data | `r_n` = SHA-256 of the payload; the `file` record holds the file's SHA-256, size and path, not the file. | Present in kind |
| The key is computed from the block and the previous block or its key | `h_n` = SHA-256(`h_(n-1)` + `r_n` + `n`) (product-v1 3.5). | Present in kind |
| Storing the data block and the key "in a blockchain at the computing platform" | A local, single-writer, signed JSON Lines ledger. Our `file` records hold fingerprints, not measurement data; the legacy `reading` kind (verified, never produced by v1) holds a value and unit. | Close: depends on whether a hash-chained signed log is a "blockchain" (attorney) |
| Providing the key to a **separate data escrow database system** that keeps an **immutable list** of keys, independent of the blockchain, without the measurement data | Head pinning: `iqc head` printed for an email, ELN entry, printout or a pin file on another drive; `--pin-file` appends `immutableqc-head <ledgerId> <n>:<h> <time>` after each batch. No hosted escrow service. | **Close**: a pin file of heads kept on another system, or an ELN entry, resembles this element; we never send per-record keys to a service |
| (Claim 7, 12) An auditor device validates the block by comparing the key with the escrow's stored record | The app and `iqc audit` check `expectHead` and `pinLines` against record `n`'s link. | **Close**, in combination with the row above |

- Features we should not build:
  1. Any escrow, notary or "key vault" service (ours or a third party's) that receives per-record fingerprints or links
     and keeps them as a list for auditors to compare against.
  2. Automatic sending of heads or links to an outside database (an ELN API integration, a shared database, a cloud
     table, a timestamping service called per record or per batch) without an attorney's review first.
  3. Multiple stations or generators computing the same record's link and storing it only when they agree (claims 3, 10).
  4. A central platform that collects records from several instrument PCs into one chain.
  5. Producing `reading` records (measurement values inside a chained record) in new code.
- For a patent attorney: whether a single-writer, hash-chained, signed log is a "blockchain" under these claims;
  whether a pin file on another drive, an ELN entry or an RFC 3161 timestamp authority is a "data escrow database system"
  storing "an immutable list of validation keys", given that `--pin-file` appends a head after every batch; and the
  claims of the parent, US 11,321,305, which we have not read.

#### Design-around options for `--pin-file` (engineering reading, 2026-10-18)
**Engineering reading only, not legal advice. No code was changed for this note; every option below is a proposal, and
the founder decides.** The founder chose on 2026-10-18 to keep `--pin-file` (see "Founder decisions" below), so any
option here that changes how it behaves needs his explicit go-ahead first. Words such as "arguably absent" describe how an
engineer reads the claim text; whether an element is in fact absent is a question for a patent attorney.

**What must survive.** A whole-ledger rewrite by someone who holds the signing key must still show up in an audit. The
key holder can re-sign every record, so signatures alone never catch this; only a head recorded earlier, somewhere the key
holder cannot quietly change, does. Each option says whether that property survives.

**How `--pin-file` works today** (read from the code on `claude/nifty-gates-h5guqf` at `9b7c4df`):
- Who writes: `watch`, `seal`, `record`, `review` and `mcp` all take `--pin-file` (`agent/src/args.mjs`).
  `pinFileFor()` in `agent/src/session.mjs` checks that the file's folder exists (the help text suggests another drive
  or a share) and builds a `PinFile`.
- When: automatically. `Appender.append()` in `agent/src/ledger.mjs` calls `PinFile.pin()` in its `finally` block after
  every batch that wrote at least one record. No person is involved.
- What: one line, `immutableqc-head <ledgerId> <n>:<h> <time>` (`formatPinLine()` in `core/immutableqc.mjs`). `h` is
  record `n`'s link, the same value stored in the ledger. The line carries no signature, no file data and no fingerprint
  of a file.
- How: `openSync(file, 'a')`, one write, `fsyncSync`. It is an **append-only list**: every batch adds a line, nothing is
  replaced, and one pin file can hold lines for several ledgers. A failed write is a warning; sealing goes on.
- Checked by: `iqc audit --pin-file` reads the file (`readPinFile()` in `agent/src/audit.mjs`), and the app takes a
  chosen pin file (`app/app.mjs`, "choose-pins"). Both hand the text to `auditMany()` as `pinLines`. `parsePinLines()`
  reads each line and `_headCheck()` checks that record `n` still has link `h` (a grown ledger still matches); a
  mismatch, a pinned record past the end, or an unreadable line fails the audit. `--expect-head n:h` (from `iqc head`)
  goes through the same `_headCheck()`.
- `iqc head` (`runHead()` in `agent/src/info.mjs`) prints `n:h` for a person to pin by hand and suggests "an email, an
  ELN entry, a printout". It sends nothing anywhere.
- The legacy `reading` kind (`KINDS.reading` in core; product-v1 3.4): sealed fields `instrumentId, sensorType, value,
  unit, capturedAt`, so it **does hold a measured value and its unit**. v1 never produces it (no producer in `agent/src`
  or `app/`), but `verifyLedger()` accepts it, `createRecords()` would build one if asked, the core tests use it
  (`readingItem()` in `core/test/_helpers.mjs`), and **the published docs pages are built on it**: `site/src/iqc.js`
  (`FIELDS`, `replay()`), `site/pages/check.html`, `site/pages/sealed.html` and `site/partials/plate-record.html` show
  hash-chained records holding measured values and recompute their links in the visitor's browser.

**Claim words used below.** Every quote is copied from the claims above. Where the task's wording of an element is not
the claims' wording, the note says so. In particular, "storing the first data block [comprising measurement data] ... in
a blockchain" is not a single passage: the claims say "storing the first data block and the first validation key in a
blockchain at the computing platform" (claims 1, 7; claim 12 says "store ..."), and the measurement data comes from the
earlier words "a first data block comprising first measurement data" (claims 1, 7) and "broadcast a first data block
comprising the first measurement data" (claim 12).

##### Option A: retire the `reading` kind entirely
- Elements it targets:
  - Claim 1: "receiving, via a communication interface of a computing platform and from a first block generator, a first
    data block comprising first measurement data", and "a first validation key calculated, using a key calculation
    algorithm, from contents of the first measurement data".
  - Claim 7: "receiving, at a computing platform and from a first block generator, a first data block comprising first
    measurement data".
  - Claim 12: "a first block generator, configured to: measure a sample and generate first measurement data associated
    with the sample; and broadcast a first data block comprising the first measurement data".
- How clearly: **unclear.** With `reading` gone, every record holds fingerprints, sizes, paths, times, events, agent step
  refs or review decisions, never a measured value. The claims themselves set a key that "does not include the contents
  of the first measurement data" apart from the data, which supports reading a fingerprint as not being measurement
  data. Against that: a `file` record's `sha256` is computed from the bytes of a results file, which do hold measurement
  data, so one could argue the record is "associated with a sample" data and the key is still calculated "from contents
  of the first measurement data" at one remove. Paths can also carry sample names. An attorney has to say.
- Rewrite detection: unaffected. Pins and links work the same for `file` records.
- Security cost: none for v1 ledgers. Old docs-page and alpha ledgers with `reading` records would no longer verify
  (reported as an unknown kind), unless a separate read-only legacy checker is kept, which would keep the kind in the
  code.
- Convenience cost: **high for the website.** The docs pages (`overview`, `sealed`, `check`, the record plate) explain the
  format with hash-chained measured values; they would need a new worked example built on `file` records (a results
  file's SHA-256, size and path), and the build's cross-checks in `site/build.mjs` (sections 3b and on, `IQC.replay`)
  would change with them. Core tests that use `readingItem()` would move to `file` items.
- Sketch: remove `reading` from `KINDS` and from `_ROLE_OF` and the `kinds` counters in `core/immutableqc.mjs`; drop its
  row from product-v1 3.4 (or bump the format version if old ledgers must be refused by name); rebuild the docs-page
  example in `site/src/iqc.js`, `site/data/` and the three page templates on the `file` payload
  (`iqc-file-v1|station|path|sha256|bytes|observedAt|event`); replace `readingItem()` in the core tests; add a build or
  unit check that no shipped file and no test fixture writes a `reading` record. A smaller first step that keeps old
  ledgers verifying: make `createRecords()` refuse `kind: 'reading'` (verify-only), which matches guardrail item 5 above
  but leaves the kind in the format.

##### Option B: the agent and its ledger stay on the machine that reads the files; no central collector
- Elements it targets:
  - Claims 1 and 7: "wherein the first block generator is a separate device from the computing platform", together with
    "receiving, via a communication interface of a computing platform and from a first block generator" (claim 1) and
    "receiving, at a computing platform and from a first block generator" (claim 7).
  - Claim 12: "a first block generator, configured to: measure a sample ...; and broadcast a first data block", and
    "receive, from the first block generator, the first data block". Claim 12 has no "separate device" words.
- How clearly: **fairly clear for claims 1 and 7, unclear for claim 12.** In our design the process that builds a record
  (the agent) is the same process, on the same machine, that stores it; nothing receives blocks from another device. The
  instrument writes files, not blocks, and computes no key. For claim 12 the angle is different: our block builder
  never measures a sample and never broadcasts; but if the agent runs on the instrument's own PC, an attorney may ask
  whether "instrument plus its PC" is one block generator that measures (dependent claim 5 puts the block generator
  inside the instrument).
- Two setups to watch: (1) `--ledger` lets the ledger live on another drive, which can be a file server; then a second
  machine holds the chain and arguably "receives" records over a network. (2) The agent can watch a share that several
  instrument PCs write to; that is still files, not blocks, but it is the nearest thing to a collector. `auditMany()`
  joins ledgers from several actors, but only at audit time, on the auditor's copy, and stores nothing.
- Rewrite detection: unaffected.
- Security cost: small. A ledger on the same disk as the data is no weaker against a key holder than one on a server;
  the pin is what protects against a rewrite. Keeping the ledger on a share protects against the loss of one PC, which
  backups also do.
- Convenience cost: low for v1 (it is how v1 works). It closes off a future "lab server that gathers every station's
  records into one chain", which guardrail item 4 already rules out.
- Sketch: a written rule here and in product-v1 section 4; optionally `openForWriting()` in `agent/src/session.mjs`
  notes (not refuses) when `--ledger` resolves to a network path (a UNC path `\\server\...` or a mapped drive on Windows;
  an NFS or SMB mount elsewhere); nothing in `agent/` or `app/` ever accepts records sent from another machine.

##### Option C: the pin file holds only the latest head, replaced atomically
- Elements it targets: "an immutable list of validation keys" (claim 1: "securely stores the first validation key in an
  immutable list of validation keys"; claim 7: "the first validation key in an immutable list of validation keys";
  claim 12: "securely stores the first validation key in the validation keys database in an immutable list of validation
  keys").
- How clearly: **unclear.** A file that holds one line per ledger and is overwritten on each write is by design neither a
  growing list nor immutable. But: a pin file shared by several ledgers still holds several lines; a synced folder
  (OneDrive, Dropbox), a share with previous versions, or a backup keeps old copies, which an attorney could read as the
  list; and an auditor still compares against what was stored.
- Rewrite detection: **survives for the records up to the latest pin**, because record `n`'s link commits to every record
  before it. One latest head proves as much about records 1 to `n` as the whole append-only list does. What is lost, and
  must be put back: today a key holder who rewrites the ledger offline and restarts the agent leaves the old lines in
  place, so the next audit fails. With replace-only, the restarted agent would overwrite the old head with the forged
  ledger's head and the rewrite would no longer show. The fix is a check before each replace: the agent reads the
  current line for its ledger id and replaces it only if record `n` of the ledger it is extending still has that link
  (the same `_headCheck()` the audit uses); otherwise it stops without writing, as `Appender.sync()` does for a replaced
  ledger. A key holder could still delete or edit the pin file itself, which is equally true of today's list, so the pin
  file's protection still comes from where it is kept.
- Security cost: lost history of when each head was pinned (a timeline an investigator might use); the check above is
  needed or the property is lost. Atomic replace on a share is not as robust as an append: two agents replacing one
  shared pin file at the same moment can drop each other's line.
- Convenience cost: low if each ledger gets its own pin file; otherwise read-modify-write of a shared file.
- Sketch: in `PinFile.pin()` (`agent/src/ledger.mjs`), write `${file}.${process.pid}.tmp` with `openSync(tmp, 'wx')`,
  `writeAll`, `fsyncSync`, then `renameSync(tmp, file)` and `syncDir(dirname(file))`, the same pattern `createLedger()`
  uses for a new ledger. Before writing, `parsePinLines()` the current file and compare its line for this ledger id with
  the agent's verified ledger. Make the pin file per ledger (for example `--pin-file` names a folder and the file is
  `<ledgerId>.pin`) so no two agents share one file. `parsePinLines()` and `auditMany()` need no change: one line is a
  valid pin file.

##### Option D: pins only to plain files or human channels, never a database or a service
- Elements it targets: "a data escrow database system configured to store the first validation key in a validation keys
  database" (claim 1; claim 12: "provide the first validation key to the data escrow database system configured to store
  the first validation key in a validation keys database"), and in claim 7 "comparing the first validation key with a
  first validation record stored in a validation keys database via a data escrow database system".
- How clearly: **depends on the channel.** A printout or a handwritten lab book entry: arguably absent, fairly clear (no
  database, no system). A plain text file on another drive or a share: unclear (a file on a file server is stored by a
  system, but it is not a database configured for keys). An email the lab sends itself: unclear (a mail server is a
  storage system). **An ELN entry: arguably not removed**, because an ELN is a database system run apart from the
  computing platform; this is the channel closest to the element, and `iqc head` names it today.
- Rewrite detection: survives, as long as the channel is out of the key holder's reach.
- Security cost: none in principle; in practice a printout or a lab book is harder to audit and easier to lose.
- Convenience cost: low; this is today's rule 4. Dropping the ELN suggestion costs labs a channel many of them use daily.
- Sketch: keep `--pin-file` writing only a local or shared plain file (no URL, no API, no database driver: today's code
  already does only `openSync`); add a unit test that `agent/src` opens no network connection (no `net`, `http`, `https`,
  `fetch` import); change the wording of `runHead()` in `agent/src/info.mjs` and the `head` help in `agent/src/cli.mjs`
  from "an email, an ELN entry, a printout" to channels the founder approves after the attorney's view.

##### Option E: pins only when a person runs `iqc head`; nothing automatic
- Elements it targets:
  - Claim 1: "providing, via the communication interface of the computing platform, the first validation key from the
    computing platform to a data escrow database system configured to store the first validation key in a validation
    keys database".
  - Claim 7: "comparing the first validation key with a first validation record stored in a validation keys database via
    a data escrow database system" (the auditor compares with a value a person typed, not a record kept by an escrow
    system).
  - Claim 12: "provide the first validation key to the data escrow database system".
- How clearly: **fairly clear for the "providing" step of claims 1 and 12; unclear for claim 7's auditor step.** Claims 1
  and 7 are media storing instructions that make processors perform the steps, and claim 12 a processor "configured to"
  provide; if our program only prints the head and a person decides where to put it, the program does not perform the
  providing. Claim 7's own providing step is to "an auditor computing device", which our audit still does (the auditor
  reads the ledger), so for claim 7 E only touches the comparison "via a data escrow database system".
- Rewrite detection: **survives only up to the last manual pin.** Records sealed after it can be rewritten by the key
  holder without an audit noticing, so the protection depends on discipline (for example a pin at the end of every run
  or every day).
- Security cost: high in practice: gaps between pins, and pins forgotten.
- Convenience cost: high: a person must act on each pin; `--pin-file` as built goes away. **This option reverses the
  founder's 2026-10-18 decision and needs his explicit choice.**
- Sketch: remove `pin-file` from the `watch`, `seal`, `record`, `review` and `mcp` lists in `agent/src/args.mjs`, delete
  `PinFile` and `pinFileFor()`, keep `iqc audit --pin-file` and the app's pin file input for checking files people
  keep by hand, and keep `iqc head` and `--expect-head` as they are. A softer form: `iqc head --append <file>`, run by a
  person, which appends one line in the same format.

##### Option F (added): the pin is a value never stored in the ledger
- Elements it targets: the identity of "the first validation key" across steps. Claim 1 needs the same key both in
  "storing the first data block and the first validation key in a blockchain at the computing platform" and in
  "providing ... the first validation key from the computing platform to a data escrow database system"; claim 12 says
  "store the first data block and the first validation key in a blockchain at the computing platform" and "provide the
  first validation key to the data escrow database system"; claim 7 stores it and compares "the first validation key with
  a first validation record stored in a validation keys database".
- How clearly: **unclear.** Today the pinned `h` is exactly record `n`'s stored link. If the pin were instead
  `p = SHA-256("immutableqc-pin-v1|" + ledgerId + "|" + n + "|" + h)`, the escrowed value would not be stored in the
  ledger, and the stored link itself would never be written to the pin file. An attorney may still treat `p` as the same key
  in another form, or as a validation key in its own right.
- Rewrite detection: unaffected: the audit recomputes `p` from record `n`'s link and compares.
- Security cost: none (SHA-256 of the link; the link still commits to every earlier record).
- Convenience cost: a pin no longer equals the `h` a person sees in a report, so by-eye comparison needs both values
  shown; old pin files need reading for a while.
- Sketch: in core add `pinValueOf(ledgerId, n, h)`; `formatPinLine()` writes `immutableqc-pin <ledgerId> <n>:<p>
  <time>`; `parsePinLines()` accepts both the new form and old `immutableqc-head` lines; `auditMany()` calls a
  `_pinCheck()` that recomputes `p` from record `n` where it now calls `_headCheck()`; `iqc head` prints the pin form for
  pinning and the plain head for reading.

##### Option G (added): the pin goes to a medium on the same computer, not to a separate platform
- Elements it targets: claim 1 "wherein the data escrow database system is a separate platform from the computing
  platform", claim 7 "wherein the data escrow database system is a separate device from the computing platform, the
  auditor computing device, the first block generator, and the second block generator". Claim 12 has no such words.
- How clearly: **fairly clear for claims 1 and 7, not removed for claim 12.** A pin file on a second local disk, a USB
  stick or write-once media attached to the same PC is not a separate platform or device in the ordinary sense.
- Rewrite detection: **survives only if the medium is out of the key holder's reach** (write-once media, or a stick that a
  second person takes away and keeps). A second disk in the same PC, writable by the same user, gives little protection.
- Security cost: high unless write-once or physically removed; this is weaker than today's "another drive or a share".
- Convenience cost: medium: someone has to handle media.
- Sketch: no code change needed beyond help text in `agent/src/cli.mjs`; optionally `pinFileFor()` notes when the pin
  file is on the same volume as the ledger (`statSync().dev` equal), since that protects nothing.

##### Options considered and not recommended
- **Drop the link chaining** (sign each record alone, pin a hash of the whole file or a Merkle root instead). Targets the
  claim words "calculated, using the key calculation algorithm, from the contents of the first data block and contents
  of a previous block in the blockchain or a second validation key corresponding to the previous block in the
  blockchain". Not removed: any value that lets a later audit catch a whole-ledger rewrite has to be computed from the
  newest record and everything before it, which is what those words describe. It also changes the v1 format. This
  element looks inherent to the property we keep.
- **Add or remove signatures on pins.** No independent claim mentions signatures, so this touches no element. Pins carry
  none today; keep it that way for simplicity.
- **Pin less often (per session, per day).** The claims need only one block and one key, so pinning less often removes no
  element; it only widens the window an audit cannot cover.
- **Drop the auditor's comparison.** Claims 7 and 12 need an auditor device; but comparing against a stored head is the
  whole point of the feature, so this defeats the goal.

##### Matrix: claim by option
"Absent, fairly clear" and "absent, unclear" are engineering readings of the claim words, not conclusions.

| Option | Claim 1 | Claim 7 | Claim 12 | Rewrite still detected |
|---|---|---|---|---|
| A. Retire `reading` | Absent, unclear ("a first data block comprising first measurement data"; key "from contents of the first measurement data") | Absent, unclear ("a first data block comprising first measurement data") | Absent, unclear ("generate first measurement data ... broadcast a first data block comprising the first measurement data") | Yes |
| B. Local agent and ledger, no collector | Absent, fairly clear ("a separate device from the computing platform") | Absent, fairly clear (same words) | Absent, unclear ("measure a sample ... broadcast"; "receive, from the first block generator") | Yes |
| C. Latest head, atomic replace | Absent, unclear ("an immutable list of validation keys") | Absent, unclear (same) | Absent, unclear (same) | Yes, with the check before each replace |
| D. Plain files and human channels | Printout: absent, fairly clear. File or email: unclear. ELN: not removed ("data escrow database system") | Same, for "via a data escrow database system" | Same as claim 1 | Yes |
| E. Manual `iqc head` only | Absent, fairly clear (the "providing ... to a data escrow database system" step) | Absent, unclear (comparison "via a data escrow database system") | Absent, fairly clear ("provide the first validation key to the data escrow database system") | Only up to the last manual pin |
| F. Pin a value not stored in the ledger | Absent, unclear (same "first validation key" stored and provided) | Absent, unclear | Absent, unclear | Yes |
| G. Same-computer medium | Absent, fairly clear ("a separate platform from the computing platform") | Absent, fairly clear ("a separate device from the computing platform") | Not removed (no such words) | Only with write-once or removed media |
| Drop chaining | Not removed | Not removed | Not removed | Weaker or lost |

##### Recommended combination (for the founder to decide)
1. **Keep `--pin-file` automatic, as the founder decided, and change three things about it: C + F + D.** One pin file per
   ledger holding only the latest pin, replaced atomically after a check that the old pin still matches the ledger
   (C); the pin is the derived value `p`, never stored in the ledger (F); plain files only, no service, with a test that
   the agent opens no network connection (D). Rewrite detection survives in full: the latest pin commits to every
   earlier record, and the check before replace stops a restarted agent from covering a rewrite.
2. **Make B and the safe half of A written rules now**: the agent and its ledger stay on the machine that reads the
   files, no collector ever; `createRecords()` refuses `reading` so nothing can produce it. These cost nothing.
3. **Plan the full A** (remove `reading`, rebuild the docs-page example on `file` records) as its own piece of work,
   because it touches the published pages and the build's cross-checks.
4. **Keep E and G in reserve.** E is the cleanest way to take out the providing step of claims 1 and 12, but it reverses
   the founder's decision and weakens protection between pins; G helps only claims 1 and 7 and only with write-once or
   removed media.

What this gives per claim, in the engineering reading:
- Claim 1: B (fairly clear) plus C, F and A (each unclear). Two elements read as absent, one of them fairly clearly.
- Claim 7: B (fairly clear) plus C, F and A (each unclear). Same shape as claim 1.
- Claim 12: no "separate device" words, so B is only unclear; C, F and A are unclear too. **Claim 12 is the weak spot of
  this combination**: it has several unclear elements and none that reads as fairly clearly absent. Only E gives claim 12
  a fairly clear one. If the attorney sees claim 12 as the risk, E (or `iqc head --append` run by a person) is the option
  to weigh against the founder's decision.

##### Questions for a patent attorney
1. Is a single-writer, hash-chained, signed log on one machine (no consensus, no network, no blocks of several entries) a
   "blockchain" as these claims and the specification use the word?
2. Is a record holding a file's SHA-256, size and path "measurement data", or a "data block comprising first measurement
   data", when the file it describes holds measurements? Does a path that names a sample make the record "associated
   with a sample"?
3. Our link is computed from the previous link and the record's fingerprint `r_n`, not from the record itself. Does that
   meet "providing the first data block and the previous block in the blockchain or the second validation key ... as
   arguments to the key calculation algorithm"?
4. Is the agent, running on the PC that reads the instrument's files, a "first block generator" separate from a
   "computing platform", or both at once? Does that change if the ledger is on a file server (`--ledger`), or if the agent
   runs on the instrument's own PC (claim 5)? Does claim 12's "measure a sample ... and broadcast" read on a program that
   only reads files?
5. Is a file that holds only the latest pin, atomically replaced, an "immutable list of validation keys"? Does a synced
   folder's version history, a share's previous versions or a backup make it one?
6. Can a plain text file on another drive or a network share be a "data escrow database system" with a "validation keys
   database"? An email to the lab's own mailbox? An ELN entry? A printout?
7. If the pinned value is a hash of the stored link (option F), is it still "the first validation key" that was stored in
   the blockchain, either literally or as an equivalent?
8. For claims 1 and 7 (media storing instructions) and claim 12 (a processor "configured to" provide): if the program only
   prints the head and a person pins it, is the providing step performed by the claimed instructions or processor? Does
   an automatic `--pin-file` write to a share count as "providing, via the communication interface"?
9. The parent, US 11,321,305, is still unread; are its claims broader on any of these points?

### US 11,178,157 B2
- "Data and source validation for equipment output data or equipment failure prediction using blockchains". Assignee:
  CenturyLink Intellectual Property LLC. Inventors: Steven M. Casey, Kevin M. McBride, William O'Brien, Jr., Stephen
  Opferman. Application US 16/774,974, filed 2020-01-28, claiming provisionals US 62/801,235 (2019-02-05),
  US 62/818,539 (2019-03-14) and US 62/957,065 (2020-01-03). Published as US 2020/0252410 A1, granted 2021-11-16.
  Google Patents: Active, adjusted expiration 2040-08-08. 16 claims; independent claims 1 (method), 10 (apparatus),
  16 (system). The examples are telecom network equipment (routers, optical network devices, IoT sensors).
- Independent claims, verbatim:

> **Claim 1.** A method, comprising: receiving, with a computing system and from a requesting device, a first request for first data that is output by first equipment; in response to receiving the first request for the first data, retrieving, with the computing system, the first data that is output by the first equipment; analyzing, with the computing system, the first data to determine whether the first data as output by the first equipment can be trusted; based on a determination that the first data as output by the first equipment is deemed to be trusted data, sending, with the computing system, the first data to the requesting device; based on a determination that the first data is deemed to require further data validation, sending, with the computing system and to a blockchain system, a second request for identifying a blockchain containing a block containing a copy of the first data that is output by the first equipment; and in response to the blockchain system identifying the blockchain containing a copy of the first data that is output by the first equipment, performing the following: receiving, with the computing system, a copy of the identified blockchain from the blockchain system; abstracting, with the computing system and from the identified blockchain, the block containing the copy of the first data; abstracting, with the computing system and from the block, the copy of the first data that is output by the first equipment; sending, with the computing system, the first data to the requesting device; analyzing, with at least one of the computing system or the blockchain system, the first data; validating, with at least one of the computing system or the blockchain system, source identification information contained in the first data; analyzing, with the computing system, the first data to predict equipment failure of the first equipment, based on analysis of the first data; and based on a determination that the first equipment is predicted to encounter equipment failure, rerouting data traffic around the first equipment.

> **Claim 10.** An apparatus, comprising: at least one processor; and a non-transitory computer readable medium communicatively coupled to the at least one processor, the non-transitory computer readable medium having stored thereon computer software comprising a set of instructions that, when executed by the at least one processor, causes the apparatus to: receive, from a requesting device, a first request for first data that is output by first equipment; in response to receiving the first request for the first data, retrieve the first data that is output by the first equipment; analyze the first data to determine whether the first data as output by the first equipment can be trusted; based on a determination that the first data as output by the first equipment is deemed to be trusted data, send the first data to the requesting device; based on a determination that the first data is deemed to require further data validation, send, to a blockchain system, a second request for identifying a blockchain containing a block containing a copy of the first data that is output by the first equipment; and in response to the blockchain system identifying the blockchain containing a copy of the first data that is output by the first equipment, perform the following: receiving a copy of the identified blockchain from the blockchain system; abstracting, from the identified blockchain, the block containing the copy of the first data; abstracting, from the block, the copy of the first data that is output by the first equipment; sending the first data to the requesting device; analyzing, with at least one of the computing system or the blockchain system, the first data; validating, with at least one of the computing system or the blockchain system, source identification information contained in the first data; analyzing, with the computing system, the first data to predict equipment failure of the first equipment, based on analysis of the first data; and based on a determination that the first equipment is predicted to encounter equipment failure, rerouting data traffic around the first equipment.

> **Claim 16.** A system, comprising: a computing system, comprising: at least one first processor; and a first non-transitory computer readable medium communicatively coupled to the at least one first processor, the first non-transitory computer readable medium having stored thereon computer software comprising a first set of instructions that, when executed by the at least one first processor, causes the computing system to: receive, from a requesting device, a first request for first data that is output by first equipment; in response to receiving the first request for the first data, retrieve the first data that is output by the first equipment; analyze the first data to determine whether the first data as output by the first equipment can be trusted; based on a determination that the first data as output by the first equipment is deemed to be trusted data, send the first data to the requesting device; based on a determination that the first data is deemed to require further data validation, send, to a blockchain system, a second request for identifying a blockchain containing a block containing a copy of the first data that is output by the first equipment; and in response to the blockchain system identifying the blockchain containing a copy of the first data that is output by the first equipment, perform the following: receiving a copy of the identified blockchain from the blockchain system; abstracting, from the identified blockchain, the block containing the copy of the first data; abstracting, from the block, the copy of the first data that is output by the first equipment; sending the first data to the requesting device; analyzing, with at least one of the computing system or the blockchain system, the first data; validating, with at least one of the computing system or the blockchain system, source identification information contained in the first data; analyzing, with the computing system, the first data to predict equipment failure of the first equipment, based on analysis of the first data; and based on a determination that the first equipment is predicted to encounter equipment failure, rerouting data traffic around the first equipment.


- Dependent claims add: kinds of computing system and requesting device (2, 3, 11, 12); physical or virtual equipment
  (4, 5); real-time analysis (6); trust decided by a range of thresholds (7, 13); equipment status, alerts, source id and
  time stamps (8, 14); customer interaction logs and public data such as weather or news (9, 15).
- Element by element, claim 1 (claims 10 and 16 are the same steps as an apparatus and a system):

| Element | What we build | Reading |
|---|---|---|
| A computing system receives a request from a requesting device for data output by equipment, retrieves it, and decides whether it can be trusted | No service answers requests for data (guardrail rule 2). The audit runs on the lab's own copy. `iqc mcp` `check_inputs` returns fingerprints and trace states for paths an AI agent names, not the data. | Absent; `check_inputs` is the nearest shape |
| If trusted, sends the data; if not, asks a blockchain system for the blockchain holding a copy, receives the chain, extracts the block and the data, sends the data | No blockchain system; ledgers hold fingerprints, never copies of data. | Absent |
| Validates source identification information in the data | The audit checks signatures and key ids of ledgers, not a source field inside the data. | Absent as claimed |
| Predicts equipment failure and reroutes data traffic around the equipment | Nothing of the kind. | Absent |

- Features we should not build: equipment failure prediction combined with ledger-backed data validation; any service
  that returns equipment data to requesters and falls back to a ledger-held copy when the data looks wrong.
- For a patent attorney: nothing specific beyond the family review below.

### US 11,777,951 B2
- Same title as US 11,178,157. Assignee: CenturyLink Intellectual Property LLC; same inventors. Application
  US 17/517,334, filed 2021-11-02; Google Patents lists it as claiming priority through US 16/774,974 (US 11,178,157),
  so the 2019-02-05 provisional priority applies. Published as US 2022/0060483 A1, granted 2023-10-03. Google Patents:
  Active, adjusted expiration 2040-05-01. 14 claims; independent claims 1 (method), 9 (apparatus), 14 (system).
- Independent claims, verbatim:

> **Claim 1.** A method, comprising: receiving, with a computing system and from a requesting device, a first request for first data that is output by first equipment; in response to receiving the first request for the first data, retrieving, with the computing system, the first data that is output by the first equipment; analyzing, with the computing system, the first data to determine whether the first data as output by the first equipment can be trusted; based on a determination that the first data as output by the first equipment is deemed to be trusted data, sending, with the computing system, the first data to the requesting device; based on a determination that the first data is deemed to require further data validation, sending, with the computing system and to a blockchain system, a second request for identifying a blockchain containing a block containing a copy of the first data that is output by the first equipment; and in response to the blockchain system identifying the blockchain containing a copy of the first data that is output by the first equipment, performing the following: receiving, with the computing system, a copy of the identified blockchain from the blockchain system; abstracting, with the computing system and from the identified blockchain, the block containing the copy of the first data; abstracting, with the computing system and from the block, the copy of the first data that is output by the first equipment; and sending, with the computing system, the first data to the requesting device, wherein the determination that the first data as output by the first equipment being deemed to be trusted data is based on a determination that the first data as output by the first equipment is within a predetermined range of threshold values or parameters, wherein the determination that the first data is deemed to require further data validation is based on a determination that the first data exceeds the predetermined range of threshold values or parameters.

> **Claim 9.** An apparatus, comprising: at least one processor; and a non-transitory computer readable medium communicatively coupled to the at least one processor, the non-transitory computer readable medium having stored thereon computer software comprising a set of instructions that, when executed by the at least one processor, causes the apparatus to: receive, from a requesting device, a first request for first data that is output by first equipment; in response to receiving the first request for the first data, retrieve the first data that is output by the first equipment; analyze the first data to determine whether the first data as output by the first equipment can be trusted; based on a determination that the first data as output by the first equipment is deemed to be trusted data, send the first data to the requesting device; based on a determination that the first data is deemed to require further data validation, send, to a blockchain system, a second request for identifying a blockchain containing a block containing a copy of the first data that is output by the first equipment; and in response to the blockchain system identifying the blockchain containing a copy of the first data that is output by the first equipment, perform the following: receiving a copy of the identified blockchain from the blockchain system; abstracting, from the identified blockchain, the block containing the copy of the first data; abstracting, from the block, the copy of the first data that is output by the first equipment; and sending the first data to the requesting device, wherein the determination that the first data as output by the first equipment being deemed to be trusted data is based on a determination that the first data as output by the first equipment is within a predetermined range of threshold values or parameters, wherein the determination that the first data is deemed to require further data validation is based on a determination that the first data exceeds the predetermined range of threshold values or parameters.

> **Claim 14.** A system, comprising: a computing system, comprising: at least one first processor; and a first non-transitory computer readable medium communicatively coupled to the at least one first processor, the first non-transitory computer readable medium having stored thereon computer software comprising a first set of instructions that, when executed by the at least one first processor, causes the computing system to: receive, from a requesting device, a first request for first data that is output by first equipment; in response to receiving the first request for the first data, retrieve the first data that is output by the first equipment; analyze the first data to determine whether the first data as output by the first equipment can be trusted; based on a determination that the first data as output by the first equipment is deemed to be trusted data, send the first data to the requesting device; based on a determination that the first data is deemed to require further data validation, send, to a blockchain system, a second request for identifying a blockchain containing a block containing a copy of the first data that is output by the first equipment; and in response to the blockchain system identifying the blockchain containing a copy of the first data that is output by the first equipment, perform the following: receiving a copy of the identified blockchain from the blockchain system; abstracting, from the identified blockchain, the block containing the copy of the first data; abstracting, from the block, the copy of the first data that is output by the first equipment; and sending the first data to the requesting device, wherein the determination that the first data as output by the first equipment being deemed to be trusted data is based on a determination that the first data as output by the first equipment is within a predetermined range of threshold values or parameters, wherein the determination that the first data is deemed to require further data validation is based on a determination that the first data exceeds the predetermined range of threshold values or parameters.


- Dependent claims add: kinds of computing system and requesting device (2, 3, 10, 11); physical or virtual equipment
  (4, 5); real-time analysis (6); failure prediction from status, alerts, source id and time stamps (7, 12); customer
  interaction logs and public data (8, 13).
- Element by element: the same request, trust check, blockchain lookup and send steps as US 11,178,157 claim 1, without
  failure prediction or rerouting, plus trust decided by whether the data is within a predetermined range of thresholds.

| Element | What we build | Reading |
|---|---|---|
| Request for equipment output data, retrieval, trust analysis | No data-serving service. `check_inputs` answers with SHA-256 and measured / derived / untraced, never the file. | Absent |
| Trusted means within a predetermined range of threshold values; out of range means further validation | We do not read values inside files (value extraction is Upcoming) and set no thresholds. | Absent |
| Blockchain system lookup, copy of the chain, extract the block and data, send the data | No blockchain system; no data copies in ledgers. | Absent |

- Features we should not build: value range checks on instrument data that trigger a lookup of a ledger-held copy; an
  MCP tool or API that returns instrument data only after a trust check. Keep in mind when "extracting values from
  inside files" leaves Upcoming.
- For a patent attorney: family review; whether the threshold limitation matters if value extraction is ever built.

### US 12,659,167 B2
- Same title as US 11,178,157. Assignee: CenturyLink Intellectual Property LLC; same inventors. Application
  US 19/027,938, filed 2025-01-17, in the US 16/774,974 family per Google Patents (it also lists US 12,206,679 B2,
  application US 18/375,023, filed 2023-09-29, in between). Published as US 2025/0168010 A1, granted 2026-06-16.
  Google Patents: Active, adjusted expiration 2040-03-13. 14 claims; independent claims 1 (method), 9 (apparatus),
  14 (system). These are the broadest claims of the family: no threshold, no failure prediction, no rerouting.
- Independent claims, verbatim:

> **Claim 1.** A method, comprising: receiving, with a computing system and from a requesting device, a first request for first data that is output by first equipment; in response to receiving the first request for the first data, retrieving, with the computing system, the first data that is output by the first equipment; analyzing, with the computing system, the first data to determine whether the first data as output by the first equipment can be trusted; based on a determination that the first data as output by the first equipment is deemed to be trusted data, sending, with the computing system, the first data to the requesting device; based on a determination that the first data is deemed to require further data validation, sending, with the computing system and to a blockchain system, a second request for identifying a blockchain containing a block containing a copy of the first data that is output by the first equipment; and in response to the blockchain system identifying the blockchain containing a copy of the first data that is output by the first equipment, performing the following: receiving, with the computing system, a copy of the identified blockchain from the blockchain system; abstracting, with the computing system and from the identified blockchain, the block containing the copy of the first data; abstracting, with the computing system and from the block, the copy of the first data that is output by the first equipment; and sending, with the computing system, the first data to the requesting device.

> **Claim 9.** An apparatus, comprising: at least one processor; and a non-transitory computer readable medium communicatively coupled to the at least one processor, the non-transitory computer readable medium having stored thereon computer software comprising a set of instructions that, when executed by the at least one processor, causes the apparatus to: receive, from a requesting device, a first request for first data that is output by first equipment; in response to receiving the first request for the first data, retrieve the first data that is output by the first equipment; analyze the first data to determine whether the first data as output by the first equipment can be trusted; based on a determination that the first data as output by the first equipment is deemed to be trusted data, send the first data to the requesting device; based on a determination that the first data is deemed to require further data validation, send, to a blockchain system, a second request for identifying a blockchain containing a block containing a copy of the first data that is output by the first equipment; and in response to the blockchain system identifying the blockchain containing a copy of the first data that is output by the first equipment, perform the following: receiving a copy of the identified blockchain from the blockchain system; abstracting, from the identified blockchain, the block containing the copy of the first data; abstracting, from the block, the copy of the first data that is output by the first equipment; and sending the first data to the requesting device.

> **Claim 14.** A system, comprising: a computing system, comprising: at least one first processor; and a first non-transitory computer readable medium communicatively coupled to the at least one first processor, the first non-transitory computer readable medium having stored thereon computer software comprising a first set of instructions that, when executed by the at least one first processor, causes the computing system to: receive, from a requesting device, a first request for first data that is output by first equipment; in response to receiving the first request for the first data, retrieve the first data that is output by the first equipment; analyze the first data to determine whether the first data as output by the first equipment can be trusted; based on a determination that the first data as output by the first equipment is deemed to be trusted data, send the first data to the requesting device; based on a determination that the first data is deemed to require further data validation, send, to a blockchain system, a second request for identifying a blockchain containing a block containing a copy of the first data that is output by the first equipment; and in response to the blockchain system identifying the blockchain containing a copy of the first data that is output by the first equipment, perform the following: receiving a copy of the identified blockchain from the blockchain system; abstracting, from the identified blockchain, the block containing the copy of the first data; abstracting, from the block, the copy of the first data that is output by the first equipment; and sending the first data to the requesting device.


- Dependent claims add: kinds of computing system and requesting device (2, 3, 10, 11); physical or virtual equipment
  (4, 5); real-time analysis (6); failure prediction (7, 12); third-party, public-service or public data (8, 13).
- Element by element:

| Element | What we build | Reading |
|---|---|---|
| A computing system receives a request for equipment output data and retrieves it | No such service. `iqc mcp` takes requests from an AI agent but returns fingerprints and trace states, not the data. | Absent; nearest shape is `iqc mcp` |
| Analyzes whether the data can be trusted; sends it if trusted | `check_inputs` reports measured / derived / untraced, which is a trust signal, but it does not send the data. | Close only if a tool ever returned the data based on that signal |
| If not trusted, asks a blockchain system for the chain holding a copy, extracts the block and the data, sends the data | No blockchain system; no copies of data in ledgers. | Absent |

- Features we should not build: an `iqc mcp` tool, API or app feature that reads and returns file contents gated on a
  trust check, or that fetches a stored copy from any ledger or chain when a file fails its check (for example, a
  "restore the sealed version" feature backed by a ledger of copies).
- For a patent attorney: the family has several members and a 2025 filing, so more continuations may be pending; we have
  not read US 12,206,679 B2.

### US 11,399,031 B2
- "Tracking or storing of equipment configuration data using immutable ledger functionality of blockchains". Assignee:
  CenturyLink Intellectual Property LLC. Inventors: Kevin M. McBride, Hunter Rudd, James E. Sutherland, Steven M. Casey.
  Application US 16/774,989, filed 2020-01-28, claiming the same three provisionals (earliest 2019-02-05). Published as
  US 2020/0250175 A1, granted 2022-07-26. Google Patents: Active, adjusted expiration 2041-01-03. Continuations listed:
  US 11,722,496 B2 (US 17/813,115) and US 2023/0379339 A1 (US 18/229,397). 18 claims; independent claims 1 (method)
  and 12 (system).
- Independent claims, verbatim:

> **Claim 1.** A method, comprising: receiving, with a computing system and from a requesting device, a first request for first configuration data that is output by first equipment, the first configuration data being used to configure operation of the first equipment; determining, with the computing system, whether a data repository that is communicatively coupled to the computing system contains the first configuration data that is responsive to the received first request; based on a determination that the data repository contains the first configuration data that is responsive to the received first request, retrieving, with the computing system, the first configuration data that is responsive to the received first request, and sending, with the computing system, the retrieved first configuration data to the requesting device; based on a determination that the data repository does not contain the first configuration data that is responsive to the received first request, sending, with the computing system and to a blockchain system, a second request for identifying a blockchain containing a block containing the first configuration data responsive to the received first request; and in response to the blockchain system identifying a blockchain containing a block containing the first configuration data responsive to the received first request, performing the following: receiving, with the computing system, a copy of the identified blockchain from the blockchain system; abstracting, with the computing system and from the identified blockchain, the block containing the first configuration data responsive to the received first request; abstracting, with the computing system and from the identified block, the first configuration data responsive to the received first request; and sending, with the computing system, the first configuration data to the requesting device.

> **Claim 12.** A system, comprising: a computing system, comprising: at least one first processor; and a first non-transitory computer readable medium communicatively coupled to the at least one first processor, the first non-transitory computer readable medium having stored thereon computer software comprising a first set of instructions that, when executed by the at least one first processor, causes the computing system to: receive, from a requesting device, a first request for first configuration data that is output by first equipment, the first configuration data being used to configure operation of the first equipment; determine whether a data repository that is communicatively coupled to the computing system contains the first configuration data that is responsive to the received first request; based on a determination that the data repository contains the first configuration data that is responsive to the received first request, retrieve the first configuration data that is responsive to the received first request, and send the retrieved first configuration data to the requesting device; based on a determination that the data repository does not contain the first configuration data that is responsive to the received first request, send, to a blockchain system, a second request for identifying a blockchain containing a block containing the first configuration data responsive to the received first request; and in response to the blockchain system identifying a blockchain containing a block containing the first configuration data responsive to the received first request, perform the following: receiving a copy of the identified blockchain from the blockchain system; abstracting, from the identified blockchain, the block containing the first configuration data responsive to the received first request; abstracting, from the identified block, the first configuration data responsive to the received first request; and sending the first configuration data to the requesting device.


- Dependent claims add: kinds of computing system and requesting device (2, 3, 13, 14); physical or virtual equipment
  (4, 5, 15, 16); BIOS, OS, firmware, network and other configuration data (6, 17); who and when created, changed or
  accessed it (7, 18); a unique identifier (8); the equipment sending configuration data to the repository or the
  blockchain, periodically, on change, or as beacon data (9 to 11).
- Element by element, claim 1 (claim 12 is the same as a system):

| Element | What we build | Reading |
|---|---|---|
| Request for configuration data used to configure the equipment | We serve no data on request. The agent may seal an instrument method or settings file like any other file, by bytes only. | Absent |
| Check a data repository; if found, send it | No repository service. | Absent |
| If not found, ask a blockchain system for the chain holding the data, extract the block and the data, send it | No blockchain system; ledgers hold fingerprints, not configuration data. | Absent |

- Features we should not build: a configuration backup or restore service for instruments, or any lookup that returns
  stored configuration (methods, settings, firmware) from a ledger or chain.
- For a patent attorney: the claims of US 11,722,496 B2 and of pending US 2023/0379339 A1, which we have not read.

### Still unread in these families
US 11,321,305 (parent of US 12,032,554), US 12,206,679 B2 (CenturyLink equipment output family), US 11,722,496 B2 and
US 2023/0379339 A1 (CenturyLink configuration family), and US 16/774,962 ("Utilizing Blockchains to Implement Named Data
Networking", same provisionals; status not checked). Read their independent claims before building anything near them.

## Rules for everything we build
1. **No distributed ledger and no blockchain** for instrument data, its fingerprints, or any record about it: no public
   or private chain, no anchoring heads or roots on a network, no registry contract, no smart contract, no token, no
   on-chain commits, no ledger replicated across nodes by consensus. Ledgers are local, single-writer, append-only
   files signed by one key (the long-known hash-chained, signed log), joined only at audit time by whoever holds them.
2. **No analytical information exchange platform.** Immutable QC never hosts lab records and runs no service or API
   through which third parties request and receive records. Audits run on the lab's own copy (in the browser or the
   CLI); a lab shares files with whomever it chooses, by its own means.
3. **No instrument operating information as a product feature** (operating logs of the instrument, operator identity
   signatures for functions performed on the instrument). The agent seals file bytes whatever they contain; it does not
   parse, extract or present instrument operating logs, and reviewer sign-offs are about agent steps and files, not an
   operator's functions on an instrument.
4. Pinning a ledger's head uses non-ledger means only: a pin file on another drive or share, a printout, an ELN entry,
   an email the lab sends itself. (A third-party timestamping authority, RFC 3161, would also be a non-ledger option;
   check it like any other feature before building it.)
5. Before building any new feature in this space, search for patents on it (Google Patents, USPTO) and read the
   independent claims; record the result here. If in doubt, do not build it, and ask the founder.

## Founder decisions on specific features
- **`--pin-file` stays (2026-10-18).** The founder weighed the US 12,032,554 reading above (automatic pinning of heads
  to a file on another system is the feature closest to its "data escrow database system" element) and chose to keep
  `--pin-file` as built, accepting that risk on business grounds. Do not remove or weaken it on patent grounds without
  asking the founder. It must stay within the rules above: a plain file the lab chooses, written by the lab's own
  agent; no hosted escrow service, no network call, no per-record keys sent anywhere. Revisit it with a patent
  attorney before a launch or a fundraise.

## What this changes
- Removed from the plans: "anchoring heads on a public network", the registry contract (`contracts/RootRegistry.sol`,
  `dashboard/registry-*.js`), the encrypted archive on Filecoin, "privacy on public networks" (salted commitments,
  zero-knowledge proofs on a network), and the old blockchain components in other repositories (`iqc-alpha`,
  `iqc-token`, `immutable.polsia.app`: on-chain commits, staking, token). Those repositories should be archived, not
  extended.
- The landing page, the app, the spec and the document set must stop listing those items as Upcoming.
