# Key allowlist patent check (engineering reading, not legal advice)

Date: 2026-10-30. Scope: the two new audit options, "station keys" (only file records signed by a listed key id count
as measurements) and "reviewer keys" (only sign-offs signed by a listed key id count). Both are local lists the auditor
reads; nothing is shared over a network, no blockchain, no escrow, no third-party request (per `docs/patent-guardrails.md`).

## What was searched (6 web searches, standard mode; snippets only, no full claim text read)
1. Claims on a list of authorized/trusted signer public keys for measurement or instrument records.
2. Claims on tamper-evident, hash-chained, signed logs with a whitelist of signing keys.
3. OpenSSH `ssh-keygen -Y` and allowed signers: release date.
4. TUF (trusted root keys, thresholds, 2010 paper).
5. US 8,422,682 (immutable audit logs): dates and status.
6. Git SSH signing (`gpg.ssh.allowedSignersFile`): release date.
Limit: search snippets are not claim charts. No independent claim was read verbatim in this check.

## What was found
Patents that touch the idea (none confirmed in force, none read in full):
- US 8,938,620 (measurement device; server stores a verification key per device id and writes a value only if the
  signature verifies). Closest to "only trusted keys count"; it is a server-side, device-id keyed design. Status unchecked.
- US 8,422,682 "immutable audit logs": keyed-hash chain, signed, verification tied to an authorized auditor's public
  key. Priority 2006-07-14 (PCT); US grant 2013-04-16. 20 years from the PCT date is about 2026-07, so it is likely
  expired or expiring now (plus any term adjustment). The GB counterpart is expired for unpaid fees. Confirm on Patent Center.
- US 9,338,013 / US 11,032,065 (verifiable redactable audit log): verification by recomputing hashes and checking
  "trusted" signatures. Key allowlist not confirmed in claims. Status unchecked.
- US 8,230,228 (IBM, signed overlapping log subsets): no key restriction seen.
- US 6,889,324 (Ricoh, signed measurement data), US 2022/0263668 (signed calibration certificates), US 2004/0093526
  (role-based e-signatures on lab instruments): signing and credentials, not a public-key allowlist.
- No patent found whose independent claim is an allowlist of trusted signer keys for lab or instrument data as such.
  This is absence in six searches, not proof of absence.

Prior art for the allowlist element (dates: first two verified in this session, the rest from general knowledge, not
re-verified here):
- OpenSSH 8.1, 2019-10-09: `ssh-keygen -Y` sign/verify against a list of allowed keys (allowed_signers file format).
- Git 2.34, 2021-11: SSH-signed commits verified against `gpg.ssh.allowedSignersFile` (the exact setting name was not
  confirmed by search; the 2.34 / SSH-signing date was).
- TUF: CCS 2010 paper "Survivable Key Compromise in Software Update Systems"; roles hold keys with a threshold, root
  keys are the trust anchor (confirmed from the TUF specification and security page).
- X.509 trust anchors (RFC 5280, 2008; earlier RFC 3280, 2002; X.509 itself 1988) and GnuPG (first release 1999,
  with its trust database and keyring) are decades-old trust-list designs. Dates are from memory.

## Risk
- Allowlist element alone: Low. Trusted-key lists are long-standing, public, and widely implemented; a claim reading
  on the bare idea would face heavy prior art. No in-force patent surfaced that claims it for lab data.
- Combined with the rest of the product: unchanged from `docs/patent-guardrails.md`. The allowlist adds none of the
  elements those claims need (distributed ledger and third-party request platform for US 11,502,847; independent
  escrow database for US 12,032,554). The rule stays: no network, no escrow, no shared ledger.
- Residual: Medium-low uncertainty from unread claims (US 8,938,620, 9,338,013, 11,032,065) and unchecked status.

## Recommendation
1. Proceed with both options as local, file-based lists; keep key ids as plain config, not a hosted registry.
2. Do not add a remote or shared key directory, a key-distribution service, or any lookup over a network.
3. Before launch, have the patent attorney read the independent claims of US 8,938,620, 9,338,013 and 11,032,065 and
   confirm the status of US 8,422,682 on USPTO Patent Center. Cite OpenSSH 8.1 and TUF in the design note as prior art.
4. Re-run a longer search (Google Patents CPC H04L 9/32, G06F 21/64, plus "allowed signers" terms) if budget allows.
