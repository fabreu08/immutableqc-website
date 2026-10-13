I've built `ui/theme.css`, `ui/sample-data.mjs`, `ui/icons.svg` and `ui/test/`, plus the style guide and its screenshots. `node --test ui/test` passes 14 of 14, `node site/build.mjs --check` passes (2018 assertions, with the ui files linted), and axe finds no violations on the guide at 1440, 390 and 320. Each file is documented at its top.

## Files
- `/home/user/immutableqc-website/ui/theme.css` (39 KB, 10.7 KB gzipped)
- `/home/user/immutableqc-website/ui/sample-data.mjs`
- `/home/user/immutableqc-website/ui/icons.svg` (21 symbols)
- `/home/user/immutableqc-website/ui/test/` (`package.json`, `index.mjs`, `sample-data.test.mjs`, `theme.test.mjs`)
- Guide: `/tmp/claude-0/-home-user/fd1ba253-4a3c-520a-8501-a3fefd072ac3/scratchpad/v1/design-system/guide.html`
- Screenshots, same folder: `guide-1440-full.png`, `guide-1440-viewport.png`, `guide-390-full.png`, `guide-320-full.png`, `guide-1440-focus.png`, `guide-1440-forced-colors.png`, `guide-1440-print.png`

## Tokens
- **Surfaces:** `--bg --bg-1 --bg-2 --panel --panel-2 --well --glass --glass-flat`
- **Lines:** `--line --line-2 --line-ui --grid`
- **Text:** `--ink --ink-2 --ink-3 --ink-on-signal`
- **Pass and seal (cyan):** `--signal --signal-2 --signal-hover --signal-soft --signal-line --signal-glow`
- **Fail, changed, missing (coral):** `--alert --alert-soft --alert-line`
- **Notes (amber):** `--note --note-soft --note-line`
- **Focus:** `--focus`
- **Type:**
  - `--display --sans --mono --w-display`
  - `--t-hero --t-h1 --t-h2 --t-h3 --t-h4 --t-lead --t-body --t-small --t-micro`
  - `--lh-tight --lh-snug --lh-body --track-label`
- **Space:** `--sp-1` to `--sp-9` (4 to 96 px), `--section-y --wrap --gutter`. The gutter is 16 px on phones.
- **Radii:** `--r-xs --r-s --r-m --r-l --r-pill`
- **Depth:** `--shadow --shadow-s --glow-signal --glow-seal --glow-dot`
- **Motion:** `--ease --dur-1 --dur-2`

**Contrast:** the lowest text ratio is `--ink-3` at 4.78:1, on a hover tint over `--panel-2`. State colors on their own tints are at least 5.58:1, and the primary button text is at least 9.65:1. `--line-ui` is at least 3.2:1, and every print color passes AA on white. `theme.test.mjs` recomputes all of this from the CSS.

## Components (class: usage)
- **Layout:**
  - `.wrap`: centered column with the side gutter.
  - `.section` and `.section-h`: page bands and section headers.
  - `.stack`: vertical rhythm.
  - `.sky`: hero glow and faint grid.
  - `.grid-2` / `.grid-3`: equal columns, one column on phones.
- **Text:**
  - `.eyebrow`, `.label`, `.lead`.
  - `.text-grad`: hero headline only.
  - `.muted`, `.faint`, `.mono`, `.nw`.
  - `.vh`: visually hidden but still read.
  - `.skip`: the skip link.
- **Header:**
  - `.strip > .wrap > .status-line`: the status band.
  - `.site-header > .wrap > a.brand + nav.site-nav`. The brand holds `svg.mark` (`i-mark`) and `span.brand-name`.
  - `li.nav-opt` hides below 720 px; Docs stays visible.
- **Footer:** `.site-footer` holding `.foot-top`, `.foot-nav`, `.foot-meta` and `p.indep`.
- **Status line:** `<p class="status-line"><span>Independent project ·</span> <span>Open alpha ·</span> <span>No customers yet</span></p>`. Segments never break inside, and the build lint's exact text still matches.
- **Buttons:**
  - `.btn` with `.btn-primary` (the one main action; glows), `.btn-ghost` or `.btn-quiet`.
  - Modifiers `.btn-s` and `.btn-block`; the disabled and `aria-disabled` states are styled.
  - `.btn-row`, `.icon-btn` (give it a `.vh` label) and `.copy`; `data-copied` shows the done state on either.
- **Toggles:**
  - `.seg`: segmented control, active via `aria-current` or `aria-pressed`.
  - `.filters > .filter[aria-pressed]` with a count in `.n`.
- **Tags:** `.tag` plus one state class; `.tag-l` is the larger size.
  - Cyan: `-match -pass -sealed`
  - Coral: `-changed -fail -missing` (missing is dashed)
  - Amber: `-note -unsealed -back` (unsealed is dashed)
  - Neutral: `-removed -unchecked`, and `-upcoming` (dashed)
- **Chips and dots:** `.chips > .chip` for sentence-case items, `.chip-upcoming` for the Upcoming list, `.live-dot`.
- **Surfaces:**
  - `.glass`: premium panel. `.panel`: flat inner panel. `.card` with `.card-n` for numbered labels.
  - `.callout` with `-pass`, `-fail` or `-note` (no modifier gives the neutral version).
  - `.verdict` with `-pass` (glows) or `-fail` (no glow); parts are `.verdict-ic`, `.verdict-text`, `.verdict-meta`, `.verdict-actions`.
  - `.stats > .stat` with `-ok`, `-bad`, `-note` or `-zero`; inner `.stat-n` and `.stat-l`.
- **Data:**
  - `.hash`: 8-character groups written as `<span>`s with no whitespace between them, so lines break only between groups and a copy gives the bare hex.
    - Variants: `.hash-sealed`, `.hash-changed`, `.hash-l`, `.hash-short`.
    - `<mark>` inside a group marks a changed character.
  - `.kv` key-value list; `dd.kv-copy` puts a copy button beside the value.
  - `.table`:
    - `.num` cells are right-aligned; `tr.is-problem` and `tr.is-note` get a colored edge.
    - `.table-stack` turns rows into cards below 720 px; each `td` needs a `data-label`.
    - `.table-scroll` scrolls a wide table sideways instead.
  - `.cmd`: the command box, with `.cmd-h` (label and Copy) and `<pre tabindex="0">`. The line never wraps and scrolls inside its box; `.pr` is the prompt and `.cm` a comment.
  - `.meter > span`: set `--p` (0 to 1) from script; inline `style` is blocked by the CSP. `.meter-thin` is the slim version.
  - `.list-check`: list with check marks.
- **Forms:**
  - `.field` and `.hint`.
  - `.input`, also applied to `input[type=text|search]`; `aria-invalid` turns it coral.
  - `.search`: input with a leading icon.
  - `details.fold > summary` with `.fold-body`.
- **Media:**
  - Reduced motion: transitions and animations off.
  - Forced colors: real borders, `Highlight` focus and the active state stay visible.
  - Print: light palette, controls hidden, command boxes wrap.

## Sample-data API
`FOLDER`, `STATION` (both `'bio-line-2'`), `RUN` (`'run-1007'`), `PATHS`, `FILES`, `EDIT`, `EDITED_FILE`, `EDITED_FILES`, `SHA256`, `SHA256_EDITED`, `sampleFiles({edited})`, `sampleFileMap({edited})`, `plateRows({edited})`, `hexGroups(hex, size=8)`.

- Each file is `{path, name, type, description, size, sha256, bytes: Uint8Array}`. The shared objects are frozen; `sampleFiles()` returns copies.
- `EDIT` is `{path, name, well:'A01', column:'abs_450', line:2, offset:17, length:5, before:'0.482', after:'0.428', size, sha256Before, sha256After, where}`.
- The module has no imports and only `export const` / `export function`; internal names start with `_`.

| File | Bytes | SHA-256 |
|---|---|---|
| `run-1007/plate-07.csv` | 973 | `477f09c48ac1a6b4b6230fa65012c0cd11fad2c975954bd840911f219f6f6484` |
| `run-1007/plate-07.csv` (edited copy, A01 0.428) | 973 | `1702711c5ebac75175c67210414bd422537e1069944b5b489fa5dbb3f2e50437` |
| `run-1007/plate-07.raw` | 400 | `abc34ba5e6d90dc01c9df97818e386338a37becc731c32f8a03747f666ff5c7e` |
| `run-1007/plate-08.csv` | 973 | `fd7f57e676ea07c2e07a7c32a9f756517e47c89d395b2168cd738643101ffe47` |
| `run-1007/run.json` | 340 | `70d29db047403429c0f6eaadb4be2b81de1c3f9d2f2f1f1280f78c112e44162c` |
| `run-1007/standards.csv` | 150 | `4d79c05bcc3bcb8e9f26adb4c90a9c242162217cc6a0067ae12d1c68913b801d` |

## Verification
- **`sample-data.test.mjs`:**
  - Recomputes every hash with `node:crypto`, including the copies in the header comment.
  - Checks paths with core's `validatePath` and `encodePath`, and parses the CSV and JSON files.
  - Checks the binary's layout and that it is not text.
  - Checks the edit changes exactly one cell, with the same size and only the bytes in `[offset, offset+5)` differing, and only in that one file.
  - Checks that copies are independent and that the module follows the bundle rules.
- **`theme.test.mjs`:**
  - Every `url()` is an existing `../fonts/*.woff2`; there is no `@import`, `image-set()` or remote address.
  - The documented classes exist.
  - `icons.svg` has no external reference and valid XML.
  - The contrast checks listed above.
- **Guide:** checked with Playwright and the local Chromium at 1440, 390 and 320 px:
  - No horizontal overflow, no console errors, and only same-origin requests (the stylesheet, the sprite and the 4 fonts).
  - No hash group or status segment breaks inside; the command box scrolls.
  - I looked at each section at 1440 and 390, plus print, forced colors and focus. What I fixed from that: the stacked table at 390, which edge the problem-row bar sits on, print inputs and the footer, and the copy-button alignment.

## Decisions
1. **Archivo is not variable here.** `fonts/archivo-c-115-620.woff2` is a static instance with no variation table, so it is declared at weight 620 only, as `'Archivo C'` like `site.css`. The metric-matched fallbacks are copied from `site.css`. `strong` and `b` are allowed a synthesized weight.
2. **Restraint rule:** the status-strip dot is neutral, not cyan; the eyebrow has no glow; the fail verdict has no glow. Glow is used only on `.btn-primary`, `.verdict-pass`, `--glow-seal` and `.live-dot`.
3. **`--line-ui` raised** from #63759A to #6B7EA3, so control outlines stay at 3:1 on the lightest hover surface.
4. **Brand name hidden below 360 px.** The name becomes visually hidden (the link keeps its accessible name), so Docs and "Open the app" fit at 320.
5. **Five sample files:** three CSVs, one JSON and one 400-byte binary, all with `\n` line endings. The data folder is `bio-line-2`, which is also the station name, and paths sit under `run-1007/`. The binary keeps A01 at 0.482 in the copy, because only the CSV was rewritten.
6. **The edit keeps the size** (973 bytes), so the copy "looks the same".
7. **`bytes` means two different things.** In `FILES` it holds the Uint8Array, as you asked; in core's `files` map it means the size. `sampleFileMap()` returns core's shape so the two don't get mixed up.
8. **Extra states and helpers:** I added tags for pass, fail, sealed, "back after removal" and "not checked", plus the `.table-stack`, `.stats` and `.verdict` components, because the app and landing will need them.

## Left open
- **CSP for icons:** a page that uses the external sprite (`<use href="ui/icons.svg#…">`) needs `img-src 'self'` in its CSP; I confirmed Chromium blocks it otherwise. Pages can inline the symbols instead.
- **CI does not run these tests yet:** `.github/workflows/site-check.yml` runs only `core/test agent/test`. Adding `ui/test` to it is outside my paths.
- **Not in the theme:** the hero ring and phases and the "A pass shows / It does not show" split are landing-specific, so they belong in `ui/landing.css`.
- **The guide's hero rows:** the stacked-table and hero examples in the guide use the sample's 5 files; the landing builder chooses how many to show.