## Web app (`app/`): report

The app is finished. The stall is fixed, and `node --test app/test` passes 30 of 30 twice in a row on the final code (40 s and 39 s) and exits by itself. Core, agent and ui tests pass 123 of 123 (37 s), and `node site/build.mjs --check` passes (2,283 assertions). No node or Chromium process is left running.

### Why `node --test app/test` stalled, and the fix
- **Main cause:** `yieldNow()` in `app/engine.mjs` used a `MessageChannel`. In Node, a message port with a listener keeps the process alive forever. All tests finished, but the process never exited. I confirmed it: a 3-line script that calls `await yieldNow()` once never ends.
  - Fix: on Node it now uses `setImmediate`; browsers keep the channel.
  - A new engine test starts a separate Node process that yields and checks that it exits within 20 s.
- **Second cause:** the scale test defaulted to 100,000 files, which takes minutes.
  - Default is now 2,000 files (about 3.5 s). `IQC_LARGE=100000` is opt-in and `0` skips it; its timeouts grow with the size.
  - I ran the 100,000-file test once: it passed in 137 s, with the page never blocked for more than 672 ms.
- **Other hardening:** every test and hook now has a timeout, and the `after` hook closes every browser context, the browser and the server even when a test fails halfway. All tests run one at a time in one process, so only one Chromium is ever open.

### Spec section 5, item by item
- **Audit (default):** works.
  - Drop target "Drop a data folder to audit it", or "Choose a folder"; the app finds `ImmutableQC/ledger.jsonl` and starts at once.
  - If there is no ledger, it asks for the ledger file. "Pinned head" and "Expected key id" are optional and folded away.
  - Progress shows files and bytes, elapsed time, time left, read rate, and the file being read with its slice.
  - Hashing runs in Web Workers: `crypto.subtle.digest` up to 256 MiB, core's incremental SHA-256 in 8 MiB slices above that (tested past 256 MiB).
- **Verdict:** works. Pass or fail with icon, color and words; then problems (full sealed and current fingerprints, sizes), notes, the watch timeline, a searchable file list, the ledger panel with copy buttons, and "Download report (HTML)" and "(JSON)".
- **Seal in the browser:** works. The key is kept in IndexedDB and cannot be exported. The app downloads `ledger.jsonl` with instructions, adds to a ledger whose key this browser holds, refuses one it does not hold, and says the agent is the real tool.
- **Demo:** works. The demo section now has `id="demo"`, and opening `app/#demo` starts it at once: seal, pass, "Change one value", fail on `plate-07.csv`, start over.
- **Accessibility and errors:** works. axe reports no violations in 14 states. There is no horizontal overflow from 320 to 1920 px, reduced motion is respected, and errors are shown as readable messages.
  - New: if the app's code fails to load at all, a small new file `app/boot.js` says so in words instead of leaving a dead page.

### Other changes
- **New test (spec section 8):** a folder sealed by the downloadable agent (`download/iqc.mjs`) gives the same verdict, head, key id, file states, problems and notes in the browser as `iqc audit`, for both a pass and a fail. It was not tested before; the old tests used core's fixtures.
- **Fixes found in the screenshots:**
  - The "Folder read" step showed a stale count ("48 files: sizes read for 18"). The cancel test now catches this; I checked that it fails when the bug is put back.
  - Paths showed their encoded ledger form (`50%25.txt`); the page now shows the real name (`50%.txt`), and the reports keep the encoded form.
  - In the demo, "Change one value" was scrolled out of view when focus moved to the verdict. It now also sits on the pass verdict, and "Start over" is at the end of the fail result.
  - The demo no longer shows a command to re-run on a folder that exists only in memory.
  - A recorded removal no longer shows in the amber note color.
  - Wording: the head advice on the seal result, the ask-for-ledger text.
  - Phone layout: progress stats are now two per row.
  - The cancel test raced the hashing and lost; it now uses a 3 GiB sparse file plus 600 small files.

### Decisions
1. The three mode sections are now `id="audit"`, `id="seal"` and `id="demo"`, matching the tab links. A CSS `scroll-margin-top` keeps the page at its top when a link jumps to them.
2. Added `app/boot.js`. The deploy allowlist already publishes it, and the build lints it.
3. Paths are shown decoded on the page and stay encoded in the reports.
4. The demo hides the "Re-run on the command line" panel.

### Screenshots
36 files in `/tmp/claude-0/-home-user/fd1ba253-4a3c-520a-8501-a3fefd072ac3/scratchpad/v1/app/final/`. They cover empty, auditing, pass, fail, fail (broken ledger), ask for ledger, seal ready, seal result, demo pass and demo fail, at 1440 and 390. Each has a viewport shot and a `-full` page shot, except auditing and ask (viewport only). I reviewed them over three rounds. The script is `work2/shoot.mjs` in the same folder.

### Left open
- **Spec section 2:** the table lists the app's files without `engine.mjs` and `boot.js`; `docs/product-v1.md` needs that line updated (not my file).
- **Download-hash assertion:** the one check about the download hash is "index.html: the SHA-256 of download/iqc.mjs is printed beside its link" (`site/build.mjs`, line 1239). It passes now and has to be re-run whenever `download/iqc.mjs` is rebuilt, in the integration step.
- **Not run:** the spec's browser checks in `site/tools/check.mjs` (not my area).
- **Minor wording:** during an audit, "Folder read" counts the ledger file and "Files re-read" does not (48 against 47).
- **Note text from core:** the notes' detail lines (written by core) still show encoded paths.
- **Cleanup:**
  - I deleted two temporary folders (852 MB) left by the previous agent's interrupted runs.
  - `/tmp/iqc-pages-CFbMQv` (06:05) may belong to another role's run, so I left it.
  - About 2.3 GB of test folders remain in `scratchpad/v1/app/work/` and can be deleted once screenshots are no longer needed.

### Files changed
- `/home/user/immutableqc-website/app/engine.mjs`
- `/home/user/immutableqc-website/app/app.mjs`
- `/home/user/immutableqc-website/app/app.css`
- `/home/user/immutableqc-website/app/index.html`
- `/home/user/immutableqc-website/app/boot.js` (new)
- `/home/user/immutableqc-website/app/test/browser.test.mjs`
- `/home/user/immutableqc-website/app/test/engine.test.mjs`