# Immutable QC: architecture and threat model

Informational draft · 2026-10-07, revised 2026-10-17 for the patent guardrails · Not a controlled document, and not published on the site. For conversations with labs, the Claude Startups application, and as the source for the Roadmap page.

**Patent guardrails (2026-10-17).** `docs/patent-guardrails.md` rules over this brief: no distributed ledger or blockchain of any kind, no anchoring on a network, no registry or smart contract, no Filecoin archive, no privacy-on-networks commitments or zero-knowledge proofs, no hosted service through which third parties request records. Those items are removed below. An anchor here means a head (or a Merkle root) the lab pins outside its own system by non-ledger means: a pin file on another drive or share, a printout, an ELN entry, an email the lab sends itself.

Independent project · Open alpha · Synthetic demo data · No customers yet. Immutable QC is built on the founder's own time and is not affiliated with or endorsed by any employer. The present tense describes only what works today; everything else is labeled Upcoming.

## 1. Who it is for and why now

Immutable QC is for automated research labs first: self-driving labs, robotic workcells, cloud labs, AI-first research companies, and CROs that hand automated data to clients, in biotechnology, microbiology, chemistry and materials science, the founder's own fields. Regulated QC labs (21 CFR Part 11, EU Annex 11, ISO/IEC 17025:2017) are the expansion path, not the opening.

In an automated lab, results arrive faster than anyone can read them, and models train on them and choose the next experiment. So one wrong value does not stay put. A script writes a concentration in mg/mL where the pipeline expects µg/mL; the value feeds a dose-response fit, the fit feeds the model, the model picks tomorrow's plates, and by next week the error is in the training set. The question becomes "what did it touch", and few labs can answer it quickly.

In an intelligence explosion, human review can't keep up with every result; records have to verify themselves.

Today, each result becomes a sealed record: a SHA-256 fingerprint of five of its recorded fields, signed and linked to the record before it, so a later change shows. Upcoming: sealing at capture, measured and derived records, and lineage.

## 2. Failure modes, malicious and not

Most bad data is not malicious: a script that "fixed" units, a sync conflict, a crash halfway through a write, a backup restored from last week, a migration that rounded values, an outage, or a model that filled in a blank. Sabotage and espionage are the minority case. The same checks cover sabotage, within the limits below; espionage is limited, not detected.

| What happens | What catches it | Status |
|---|---|---|
| A sealed value is changed by a script, a sync conflict, a migration or an agent writing back, without the key. | Fingerprint and signature fail; the next link breaks. | Works today on the site and in the console; the alpha app seals at import but does not yet check. |
| A crash or outage truncates or drops records. | A truncated record fails its fingerprint; one missing from the middle breaks the next link; records lost from the end show only against an anchor. | Works today, except the end: a head pinned earlier (simulated on the site). |
| A stale backup is restored over the live records. | It agrees with itself, but not with the heads the lab pinned since. | A pinned head (simulated on the site); upcoming: chained Merkle roots; lineage. |
| A model or agent invents a value or fills a blank. | Not a hash alone. A derived value with nothing measured under it would be flagged, if agents cannot use the capture key. | Upcoming: sealing at capture; measured and derived records. |
| An agent cites real measurements but reports a wrong number. | Only re-running the derivation from its cited inputs. | Upcoming, where the analysis is deterministic. |
| A result is re-attached to the wrong sample or well after sealing. | Not today: sample and position sit outside the seal. | Upcoming: metadata in the seal, needed by the first adapter. |
| One wrong value spreads: analysis, model, next experiment. | Lineage: a corrected measurement's reach, as far as derived records cite it, in one step. | Upcoming: lineage and recall. |
| Sabotage, or an insider: sealed results deliberately altered, deleted, reordered or duplicated. | A change without the key shows at once; a rewrite with the key, only against an earlier anchor. A deletion, move or copy with relinking needs no key; it would also show through signatures that cover position, if made without the key. Not shown: who did it. | Works today without the key. Upcoming for the rest. |
| Espionage: results, methods or models copied out. | Not detected: a seal shows a change, not a copy. Limited: nothing readable leaves the lab. | Out of scope for detection. |
| Tampering before sealing: a swapped sample, a miscalibrated instrument, compromised robot software; today, a CSV edited before import. | Not detected; sealing at capture would shrink the window. | Out of scope. |

For a US research organization under NSPM-33, Immutable QC would be one part of its cybersecurity measures, not its research-security program.

## 3. What is sealed where

**Capture.** Today the alpha app imports an HPLC CSV export and seals each peak area (instrument, measurement type, value, unit, capture time) under one server key. Upcoming, sealing would move to the orchestrator or the SiLA 2 or OPC UA LADS driver, with the sample, the well or position and the method inside the seal.

**Measured and derived signers (Upcoming).** Only a record sealed at capture under a capture key would count as measured, and only if agents and scripts cannot use that key: it would live only in the driver or adapter process (in a hardware key store where possible), sign only device responses, and seal the device's identity (the SiLA server's UUID and certificate fingerprint, or the LADS device), so "measured" means "received from this device". Anything an agent, script or analysis produces would be a derived record under its own key, citing its inputs' fingerprints. A number either traces back to a measurement or it does not; one that does not would be flagged. That would catch a value with nothing measured under it, which hashing alone cannot; a wrong number that cites real inputs would still pass, so a checker would re-run deterministic analyses.

**Lineage (Upcoming).** The citations would form a graph down to the measurements; a model's derived record would cite the Merkle root of its training set. A recall would walk it the other way, from a corrected measurement to everything recorded as citing it and the agents that must re-check: an out-of-specification impact assessment, but automatic. It would need an index of derived records; work outside the sealing library would stay invisible to it.

**Corrections (today on the site and in the console; not in the alpha app).** A correction is a new record appended after the newest, with its own fingerprint, link and signature; its reason and the record it corrects sit beside the seal (sealing them is Upcoming), and the original stays as sealed.

**Pinned heads (simulated on the site).** A batch fingerprint would be kept where the lab's own system cannot rewrite it, by non-ledger means only: a pin file on another drive or share, a printout, an ELN entry, an email the lab sends itself. Today it is the head (the newest link, replayed from 64 zeros), which commits to everything before it. With Merkle batches it would be the root, and each root would commit to the one before it, so a dropped batch or a restored backup would break the sequence. No network, ledger, registry or outside service is involved. Every anchor on the site is simulated.

**Storage.** The records stay in the lab's own systems; Immutable QC hosts no records and offers no archive. A lab shares files with whomever it chooses, by its own means.

## 4. Cryptography

**Fingerprint (today).** SHA-256 (FIPS 180-4) over the UTF-8 payload: five fields joined by a vertical bar in a fixed order; a field holding the bar or a control character fails, so two records cannot give one payload. Records must carry the fields verbatim: no round trip through floating-point numbers (1.50 stays 1.50), times in one form (UTC, "Z", seconds); a pipeline that re-serializes them would raise false alarms. Does not show: that the value was right, who recorded it, or that it was ever measured.

**Chain (today).** Each link is the SHA-256 of the previous link, the record's fingerprint and its position; the first links to 64 zeros. Shows: a changed record (only the link into the next record breaks), or one missing from the middle. Does not show: a record removed, moved or copied with every later link rewritten (which needs no key), or records lost from the end; only an anchor would show those.

**Merkle batches with salted leaves and inclusion checks (Upcoming).** Each leaf would be SHA-256 over a random 32-byte salt the lab keeps, the record's fingerprint and its signature. The tree would use the tree hash of RFC 6962, kept in RFC 9162, as Certificate Transparency logs and Sigstore's Rekor do: domain separation between leaf and node hashes and no duplicated leaf (an earlier console's odd-leaf duplication let two batches share a root). One 32-byte root would commit to a whole run. An inclusion check, a short path of hashes, would show one record is in the batch without revealing the others' contents (only how many there are, and this one's place): selective disclosure, when a lab chooses to hand one record to someone. Without its salt, a leaf cannot be matched to a guess.

**Signatures (today, demo).** ECDSA P-256 with SHA-256 over the 32 bytes of the fingerprint (FIPS 186-5), IEEE P1363 encoding, low-S form only; a record with no signature fails. Keys today: a discarded build key (the site), a browser key (the console), one server key (the alpha app): the method, not independent evidence. Upcoming: per-analyst keys; per-signer keys for the orchestrator, each agent and each pipeline; signatures that cover each record's position (signing its link), so a record removed, moved or copied fails without an anchor unless whoever did it holds the key (records dropped from the end still need one); an algorithm id on every signature. A signature made with a system key is neither an electronic signature nor a digital signature as 21 CFR Part 11 uses those terms: both identify a person.

**Post-quantum path (Upcoming, long term).** SHA-256 and Merkle trees hold up; a quantum computer would break ECDSA P-256 signatures. In order: algorithm agility; then hybrid signatures, ECDSA P-256 plus ML-DSA (FIPS 204), both required, or SLH-DSA (FIPS 205), hash-based, with larger signatures; then re-sealing old records under stronger algorithms in time, as RFC 4998 archive timestamps do. Because each leaf would cover the signature, a signature made today would keep its value after P-256 falls if its record was re-sealed first.

## 5. Confidentiality principle

Nothing readable leaves the lab.

What stays in the lab: every value, sample, method, name, reason and review note, the record history, the salts and every key. Nothing leaves, and Immutable QC runs no service that receives records. A pinned head is a 64-character code the lab keeps where it chooses.

What a head reveals. A plain fingerprint of a few guessable fields can be matched by trying likely values, and two heads one record apart expose the record between them. That is one more reason the pinned heads stay with the lab, or with whomever it hands them to.

Keys stay in the lab. An Immutable QC service would hold no key that can read or sign a lab's records. Every check recomputes from the record and a public key; once public keys are published outside the lab and heads are pinned where the lab's own system cannot rewrite them, you would not have to trust us, or any single party.

## 6. In and out of the threat model

In:

- Every row of the table in section 2 marked Works today or Upcoming; also what a head reveals, and quantum forgery, for records re-sealed in time (Upcoming).

Out:

- Anything before sealing (before import today; before capture, with sealing at capture).
- Whether a value was right, or computed rightly from real inputs, unless a deterministic analysis can be re-run.
- Whether the capture time is right: the seal keeps the time it is given; a pinned head shows only that a record existed by the time it was pinned.
- Who a person was: a key is not an identity.
- A signing key or salt leaked from the lab.
- Copying of readable data by someone inside the lab, or by an agent that holds the values.
- Availability: a fingerprint cannot bring back a lost record.
- Computerized-system validation, SOPs and the lab's quality system.
- Where the lab keeps its pinned heads: a pin is only as durable as the place it is kept.

## 7. Integrations

**SiLA 2 (Upcoming).** Devices are SiLA servers exposing commands and properties; the orchestrator is the SiLA client. The adapter would sit in that client, sealing each response that carries a result, under the capture key, then handing it on; as a proxy between client and device, it would terminate SiLA 2's TLS connection and sign under its own key.

**OPC UA LADS (Upcoming).** For analytical instruments, the adapter would subscribe to result variables and hash each result file as it is written.

**Data formats (Upcoming).** Once metadata is in the seal, a record would carry the hash of its AnIML or Allotrope Simple Model (ASM) result document, as written, before any parser touches it.

**ELN and LIMS (Upcoming).** A record's id and fingerprint would go into the entry, so a reviewer can run the checks from there.

**Data lakes and pipelines (Upcoming).** A sealing library (Python first) would sign each analysis output as a derived record under the pipeline's key, citing its inputs: the source of lineage.

**The first adapter (Upcoming)** would seal the results of one SiLA 2 device through the orchestrator's SiLA client: SiLA 2 is supported by a growing number of devices and schedulers, and its reference implementations are open source, so no instrument vendor is needed. OPC UA LADS would follow. A lab with neither would start with the CSV import and the pipeline library.

## 8. The pitch and the first conversation

The pitch, in three sentences: In an automated lab, results arrive faster than people can review them, and one wrong value feeds an analysis, a model and the next experiment before anyone looks. Immutable QC seals each result so that a later change shows; upcoming, it would seal at capture and record every analysis or agent output as a derived record citing its inputs, so a number either traces back to a measurement or it does not, and a corrected measurement's reach would be found in one step. Nothing leaves the lab: the records, the ledger and the pinned heads stay where the lab keeps them, and you would not have to trust us, or any single party, to check it.

Talking points:

- Most bad data is not malicious. Ask about their last unit bug, sync conflict or restored backup before sabotage.
- Today: the five-field fingerprint, the chain from 64 zeros, demo signatures, corrections with a reason, checks recomputed in the browser, and the alpha app's HPLC CSV import under one server key. Everything else is Upcoming, the automated-lab items first.
- Not claimed: no capture at the instrument or orchestrator, no electronic signatures, no validation, nothing in production use. It replaces no orchestrator, ELN, LIMS or audit trail.
- A hash shows that a record has not changed since sealing, not that it was ever measured. Say it first.
- Toward GMP or accreditation: built toward the audit-trail expectations of 21 CFR Part 11, EU Annex 11 and ISO/IEC 17025:2017; not validated; not a substitute for validation or SOPs.

Five questions to ask a lab:

1. What sits between your instruments and your records (a scheduler, SiLA 2, OPC UA LADS, custom drivers), and where does a result first become a row?
2. When a value turned out wrong in the last year, how did you find out, and how did you work out what it had touched?
3. Which results do models train on or agents act on, and how do you tell a measured value from one an analysis or an agent produced?
4. Where may results be stored, and where would you keep a pinned head (another drive or share, a printout, the ELN)?
5. Who needs to check a record from outside your system: a client, a collaborator, a funder, a regulator, or an agent?

Contact goes through joseqc.com.
