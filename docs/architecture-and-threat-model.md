# Immutable QC: architecture and threat model

Informational draft · 2026-10-07 · Not a controlled document, and not published on the site. For conversations with labs, the Claude Startups application, and as the source for the Roadmap page.

Independent project · Open alpha · Synthetic demo data · No customers yet. Immutable QC is built on the founder's own time and is not affiliated with or endorsed by any employer. The present tense describes only what works today; everything else is Upcoming.

## 1. Who it is for and why now

Immutable QC is for automated research labs first: self-driving labs, robotic workcells, cloud labs, AI-first research companies, and CROs that hand automated data to clients, in biotechnology, microbiology, chemistry and materials science. The founder's own background is materials science, chemistry and microbiology. Regulated QC labs, where the same construction meets the audit-trail expectations of 21 CFR Part 11, EU Annex 11 and ISO/IEC 17025:2017, are the expansion path, not the opening.

In an automated lab, results arrive faster than anyone can read them: a workcell produces thousands of measurements a day, a pipeline turns them into analyses, and models train on the analyses and choose the next experiment.

So one wrong value does not stay in one place. A script writes a concentration in mg/mL where the pipeline expects µg/mL. The value feeds a dose-response fit, the fit feeds the model, the model picks tomorrow's plates, and by next week the error is in the training set and in the results those plates produced. The question is no longer "which value was wrong" but "what did it touch", and few labs can answer it quickly.

In an intelligence explosion, human review can't keep up with every result; records have to verify themselves.

Today, each result becomes a sealed record: a SHA-256 fingerprint of five of its recorded fields, signed and linked to the record before it, so a later change shows. Upcoming, three things build on that: sealing at capture, a distinction between measured and derived records, and lineage from every derived record back to the measurements under it.

## 2. Failure modes, malicious and not

Most bad data is not malicious. It comes from a script that "fixed" units, a sync conflict, a crash halfway through a write, a backup restored from last week, a migration that rounded values, an outage, or a model that filled in a blank. Sabotage and espionage are the minority case; the same machinery covers them, with the limits below.

| What happens | What catches it | Status |
|---|---|---|
| A sealed value is changed after capture by a script, a sync conflict, a migration, or an agent writing back over the measured value. | The fingerprint no longer matches, the signature fails and the link into the next record breaks; later records still pass. | Works today: site, console, and rows the alpha app imports (checking in the app is upcoming). |
| A sealed value is changed by an insider with the signing key, who rewrites every later link. | The history is consistent again; only a batch fingerprint anchored outside the lab beforehand would disagree. Per-signer keys would narrow who can do this. | Upcoming: anchoring; per-signer signatures. |
| A crash or outage truncates a record or drops records. | A truncated record fails its fingerprint; a record missing from the middle breaks the next link. Records lost from the end leave no trace in the chain; only the next anchor, or a derived record citing a missing fingerprint, would show them. | Works today for the first two. Upcoming for the end: anchoring; lineage. |
| A stale backup is restored over the live records. | The restored history agrees with itself. It would disagree with every batch fingerprint anchored since the backup, and later derived records would cite sealed records now gone. | Upcoming: anchoring; lineage. |
| A model or agent fills in a blank or invents a value, and it enters the pipeline as if measured. | A hash shows a record has not changed since sealing, not that it was ever measured. Only a record sealed at capture under the instrument's or orchestrator's key would count as measured; anything an agent, script or analysis produces would be a derived record under a different signer, citing the sealed records it came from. A number that traces back to no measurement would be flagged. | Upcoming: sealing at capture; measured vs. derived records. |
| One wrong value spreads: analysis, then model, then the next experiment. | Derived records cite their inputs, so they would form a lineage graph. When a measurement is corrected, its reach would be computed in one step: every analysis, model and decision that used it, and which agents must re-check. A data recall, like an out-of-specification impact assessment, but automatic. | Upcoming: lineage and recall. |
| Sabotage: someone deliberately alters, deletes or reorders sealed results. | A change without the key shows at once. A change with the key, a deletion with later links rewritten, or a reordering would show against an earlier anchor, or through signatures that cover position. Not shown: who did it, or a change before capture. | Works today without the key. Upcoming for the rest: anchoring; signatures that cover position. |
| Espionage: results, methods or models are copied out of the lab. | Not detected; a seal makes a change show, not a copy. Instead: nothing readable leaves the lab through Immutable QC, a salted anchor would reveal nothing, and an archive would be encrypted in the lab with keys that stay there. | Out of scope for detection. Upcoming: salted leaves; encrypted archive. |
| Tampering before capture: a swapped sample, a miscalibrated instrument, compromised robot software reporting a value never produced. | Not detected; a seal covers a result from the moment it is sealed. Sealing at capture, in the orchestrator or driver, would narrow the window between measurement and seal; it cannot reach into the instrument. | Out of scope. Sealing at capture (Upcoming) narrows the window. |

Plainly, once: sabotage of sealed records is covered, and with anchoring a rewrite with the key is too; sabotage before capture is not; espionage is not detected, only kept from passing through Immutable QC. Under NSPM-33 (US research security), a tamper-evident record history is one piece of a program, not the program.

## 3. What is sealed where

**Capture.** Today, sealing happens beside the CDS export: the alpha app imports an HPLC CSV file and seals each peak area as a record of instrument, measurement type, value, unit and capture time, signed by one server key. Upcoming, sealing moves to the point of capture: the orchestrator, the SiLA 2 or OPC UA LADS device driver, or the data pipeline, which already sit between instrument and record. Each result would be sealed there, when produced, with sample and method metadata inside the seal (also upcoming).

**Measured and derived signers (Upcoming).** Keys would be tied to roles. Only a record sealed at capture under the instrument's or orchestrator's key would count as measured. Anything an agent, script or analysis produces would be a derived record under its own key, citing the fingerprints of the sealed records it came from. A number an agent gives either traces back to a measurement or it does not. This is the defense against a hallucinated or invented value, which hashing alone cannot catch.

**Lineage (Upcoming).** The citations form a graph from every derived record down to the measurements under it. A recall is a walk the other way, from a corrected measurement forward through everything that used it, naming the agents that must re-check.

**Corrections (today).** A record is never edited in place. A correction is a new record appended after the newest one, with the corrected value, its own fingerprint, link and signature, a reason of at least three words, and the number of the record it corrects. The original stays as sealed. With lineage, a correction would trigger the recall.

**Anchoring (Upcoming).** A batch fingerprint with a time would be written somewhere the lab does not control, so that a later rewrite shows. Today the batch fingerprint is the head, the link of the newest record replayed from 64 zeros; with Merkle batches it would be the root. The first network would be Filecoin Calibration, a public test network, which can be reset; Filecoin itself would follow. Only a fingerprint would go on the network, never the values. On the site and in the console every anchor is simulated.

**Storage tiers (Upcoming).** Anchor only, the default: the lab keeps its records where it keeps them, and only the batch fingerprint leaves. An encrypted archive on Filecoin: encrypted in the lab before upload, with keys that stay in the lab; content addressing (an address computed from the bytes) lets anyone who fetches a copy check it is the one captured; storage deals must be renewed, so it is not permanent storage and the lab's own copy stays primary; Filecoin would never hold readable results. Or the lab's own storage: the same encrypted archive, in its object store or data lake.

## 4. Cryptography

**Fingerprint (today).** SHA-256 (FIPS 180-4) over the UTF-8 payload: five fields joined by a vertical bar in a fixed order; a field holding the bar or a control character fails, so two records cannot give one payload. Shows: the five fields are unchanged since sealing. Does not show: that the value was right, who recorded it, or that it was ever measured.

**Chain (today).** Each record stores a link: the SHA-256 of the previous link, its own fingerprint and its position; the first links to 64 zeros. Shows: order and completeness between any two records a checker holds; a changed value breaks only the link into the next record. Does not show: a record removed with every later link rewritten (which needs no key), or records lost from the end; only an anchor shows those.

**Merkle batches with salted leaves and inclusion checks (Upcoming).** Each leaf would be a salted commitment: SHA-256 over a random 32-byte salt the lab keeps and the record's fingerprint (the existing "salted commitments" item). The tree would follow RFC 9162 (Certificate Transparency), with domain separation between leaf and node hashes and an unbalanced split for odd counts, not the odd-leaf duplication an earlier version of the console used, which lets two different batches give the same root. One 32-byte root commits to a whole run. An inclusion check is a short path of hashes that shows one record is in the anchored batch without revealing the others: selective disclosure. Prior art: Certificate Transparency and Sigstore's Rekor. Shows: this record was in that batch. Does not show: anything about the other records, and nothing at all without the salt. Later, zero-knowledge proofs would let a lab show a property, such as "within specification", without disclosing the value.

**Signatures (today, demo).** ECDSA P-256 over the 32 bytes of the fingerprint (FIPS 186-5), IEEE P1363 encoding, low-S form only; a record with no signature fails. Keys today: a build key discarded after signing (the site), a browser key (the console), one server key (the alpha app): the method, not independent evidence. Upcoming: per-analyst signatures; per-signer keys for the orchestrator, each agent and each pipeline; signatures that cover position, by signing the record's link rather than its fingerprint, so a removed or moved record fails without an anchor; and an algorithm id on every signature. Shows: the holder of the key signed that fingerprint. Does not show: who the holder was, unless keys are per person and managed; a digital signature on bytes is not an electronic signature by a person under 21 CFR Part 11.

**Anchoring (Upcoming).** A batch fingerprint with a time on a public network. Shows: the fingerprint existed by that time, so a later rewrite disagrees. Does not show: who the lab is, any value, or anything about records sealed after the last anchor.

**Encryption of archives (Upcoming).** AES-256 for the data, with the data keys wrapped by ML-KEM (FIPS 203) from the first encrypted archive, because anything on a public network can be harvested now and decrypted later. Keys would stay in the lab. Shows nothing to the network; does not cover a key leaked from the lab.

**Post-quantum path (Upcoming, long term).** SHA-256 and Merkle trees hold up; ECDSA P-256 is the part a future quantum computer breaks, since anyone with one could forge a signature under any public key. In order: algorithm agility now (an algorithm id on every signature, so a new algorithm can be added without changing the record); then hybrid signatures, ECDSA P-256 plus ML-DSA (FIPS 204), both of which must pass, or SLH-DSA (FIPS 205), hash-based and a natural fit for a system built on hashes, with larger signatures; then re-anchoring old records under stronger algorithms before the old ones weaken, as long-term archive standards do (RFC 4998). A record sealed today stays checkable after P-256 is broken only if it was re-anchored in time.

## 5. Confidentiality principle

Nothing readable leaves the lab.

What stays in the lab: every value, sample, method and sequence record, names, reasons, review notes, the record history itself, the salts, and every key. What leaves: one batch fingerprint per batch, with a time; and, only if the lab chooses the archive tier, ciphertext.

What a public anchor reveals. Today's plain fingerprint hides nothing that can be guessed: a few guessable fields (an instrument id, a measurement type, a value in a known range, a time to the second) can be matched by trying likely values, and two anchors one record apart let the record between them be tried the same way. Once leaves are salted (Upcoming), a public anchor reveals nothing: without the salts no one can confirm a guess.

Keys stay in the lab: signing keys, salts and archive keys. An Immutable QC service would hold no key that can read or sign a lab's records. You do not have to trust us, or any single party: every check recomputes from the record, a public key published outside the lab, and an anchor the lab does not control.

Not covered: a copy made inside the lab, or an agent that holds the values and sends them elsewhere.

## 6. In and out of the threat model

In:

- A sealed field changed after sealing by anyone without the signing key, whatever the cause. Works today.
- A record truncated, or missing from the middle of a history. Works today.
- A rewrite with the key, a removal with relinking, a stale backup restored, or records lost from the end, against an earlier anchor. Upcoming.
- A derived value with no measured record under it. Upcoming.
- The reach of a wrong value through analyses, models and decisions. Upcoming.
- What a public anchor can reveal: nothing, once leaves are salted. Upcoming.
- An archive copy that is not the one captured, or that has lapsed. Upcoming.
- Harvest-now-decrypt-later against an archive. Upcoming.
- Signature forgery by a future quantum computer, for records re-anchored in time. Upcoming.

Out:

- Anything before capture: a swapped sample, a miscalibrated instrument, the wrong method, or compromised robot or instrument software reporting a value never measured.
- Whether a value was right.
- Who a person was: a key is not an identity, and an electronic signature under 21 CFR Part 11 needs more than a key.
- A signing key, salt or archive key leaked from the lab.
- Copying of readable data by someone inside the lab, or by an agent that holds the values.
- Availability: a fingerprint cannot bring back a record the lab lost and never archived.
- Computerized-system validation, SOPs and the lab's quality system.
- The public network itself: a test network can be reset, and an anchor is only as durable as its network.

## 7. Integrations

**SiLA 2.** Devices expose features, commands and observable properties; the orchestrator is a SiLA client. The sealing adapter would be a client beside it that receives each result as the device reports it, seals it under the orchestrator's key as measured, and hands it on. No change to the device.

**OPC UA LADS.** Analytical instruments expose runs and results as OPC UA nodes. The adapter would subscribe to result nodes and seal each result the same way.

**Data formats.** AnIML and Allotrope Simple Model (ASM) documents carry a result with its context. The sealed record would carry the hash of the result document as a field once sample and method metadata are in the seal (Upcoming); the five fields keep the record small enough to check by hand.

**ELN and LIMS.** Today the CSV export is the integration. Upcoming, a record's id and fingerprint would be written into the ELN or LIMS entry so a reviewer can run the checks from there. Nothing is sent back to the CDS.

**Data lakes and pipelines.** A sealing library in the pipeline (Python first) would sign each analysis output as derived under the pipeline's key and attach the fingerprints of its inputs. This is where lineage comes from.

**The first adapter** would be the SiLA 2 client: SiLA 2 is where robotic workcells and self-driving labs in biology and chemistry already are, and its reference implementations are open, so the adapter can be built and tried without an instrument vendor. OPC UA LADS would follow, for analytical instruments. A lab with neither starts with the CSV import, as today, plus the pipeline library.

## 8. The pitch and the first conversation

The pitch, in three sentences: In an automated lab, results arrive faster than people can review them, and one wrong value feeds an analysis, a model and the next experiment before anyone looks. Immutable QC seals each result so that a later change shows; upcoming, it seals at capture, so a number an agent reports either traces back to a measurement or it does not, and when a measurement is corrected everything that used it is found in one step. Nothing readable leaves the lab: only a fingerprint goes on a public network, and you do not have to trust us, or any single party, to check it.

Talking points:

- Most bad data is not malicious. Ask about their last unit bug, sync conflict or restored backup before mentioning sabotage.
- What works today: a five-field SHA-256 fingerprint, the chain from 64 zeros, demo ECDSA P-256 signatures, corrections appended with a reason, every check recomputed in the browser, and the alpha app's HPLC CSV import signed by one server key. No customers yet.
- Upcoming, in the order an automated lab would want it: sealing at capture (SiLA 2, OPC UA LADS), measured vs. derived records, lineage and recall, Merkle batches with inclusion checks, anchoring, an encrypted archive on Filecoin, post-quantum signatures and encryption.
- Not claimed: no instrument capture, no electronic signatures, no validation, nothing in production use.
- It sits beside the orchestrator, ELN, LIMS and audit trail and replaces none of them.
- A hash shows a record has not changed since sealing, not that it was ever measured. Say it before they ask.
- For labs heading toward GMP or accreditation: built toward the audit-trail expectations of 21 CFR Part 11, EU Annex 11 and ISO/IEC 17025:2017; not validated; not a substitute for validation or SOPs.
- For US labs with federal funding: one piece of what NSPM-33 asks of a research-security program.

Five questions to ask a lab:

1. What sits between your instruments and your records today (a scheduler, SiLA 2, OPC UA LADS, custom drivers), and at which point does a result first become a row?
2. When a value turned out wrong in the last year, how did you find out, and how did you work out what it had touched?
3. Which of your results do models train on or agents act on, and how do you tell a measured value from one an analysis or an agent produced?
4. Where may results be stored, and what may leave the building: a fingerprint, ciphertext, or nothing?
5. Who needs to check a record from outside your system: a client, a collaborator, a funder, a regulator, or an agent?

Contact goes through joseqc.com.
