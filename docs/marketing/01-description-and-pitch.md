# Description and pitch

## One-paragraph description

Immutable QC gives automated research labs tamper-evident records. A small agent runs on the instrument PC and seals
every file the instrument software writes: a SHA-256 fingerprint per file, signed and linked in a ledger kept inside the
data folder. Anyone who has the folder can audit it in one click in the browser, or with `iqc audit` on the command
line, and see one verdict: every file matches its seal, or exactly which file does not. Nothing is uploaded, and the
code that runs the check is published, so anyone can recompute it without our software or the instrument vendor's.
Every agent step can record what it read and wrote, so a reviewer can trace an analysis back to the measurements it
came from and sign off on it.

## 3-sentence pitch

Automated labs now run analyses no person has time to check by hand, and most bad data is not malicious: a script,
a sync conflict or a restored backup quietly changes a file. Immutable QC seals every instrument file as it is written
and lets anyone audit the whole folder in one click in the browser, with nothing uploaded. Each agent step is
recorded too, so a reviewer can see what the lab's agents did and trace every result back to what was measured.
