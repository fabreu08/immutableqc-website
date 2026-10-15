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

## Other patents found in the same space (claims not yet read; titles from a search, 2026-10-15)
All describe blockchains for instrument or equipment data. Read their claims before building anything near them.
- US 12,032,554: "Utilizing independently stored validation keys to enable auditing of instrument measurement data
  maintained in a blockchain".
- US 11,178,157, US 11,777,951, US 12,659,167: "Data and source validation for equipment output data or equipment failure
  prediction using blockchains".
- US 11,399,031, US 11,722,496: "Tracking or storing of equipment configuration data using immutable ledger
  functionality of blockchains".

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

## What this changes
- Removed from the plans: "anchoring heads on a public network", the registry contract (`contracts/RootRegistry.sol`,
  `dashboard/registry-*.js`), the encrypted archive on Filecoin, "privacy on public networks" (salted commitments,
  zero-knowledge proofs on a network), and the old blockchain components in other repositories (`iqc-alpha`,
  `iqc-token`, `immutable.polsia.app`: on-chain commits, staking, token). Those repositories should be archived, not
  extended.
- The landing page, the app, the spec and the document set must stop listing those items as Upcoming.
