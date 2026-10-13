#!/usr/bin/env node
// deploy.mjs · what GitHub Pages publishes, and nothing else. One explicit allowlist, used three ways:
//   node site/tools/deploy.mjs _site         assemble the site into _site/ (the Pages workflow, .github/workflows/pages.yml)
//   node site/tools/check.mjs                assembles it into a temporary folder and runs every browser check against it
//   node site/tools/serve.mjs 8810 --deploy  serves the assembled site locally
// It copies only the files named below. It fails if one is missing, if an allowlisted folder holds a file of a type it
// does not expect, or if anything outside the allowlist (site/, contracts/, .github/, agent/, docs/, e2e/, core/test/, any
// test/ folder, dashboard/registry-*.js, any .md, any dotfile) would be published. Then it reads every assembled page,
// stylesheet and script: each relative href, src and url(), and each relative import in a module, must resolve to a file
// inside the assembled folder, so a published page can never need a file the allowlist leaves out.
// v1 (docs/product-v1.md, section 2) publishes the hand-written landing page (index.html), the app (app/), their design
// assets (ui/), the format's implementation (core/immutableqc.mjs) and the one-file agent (download/iqc.mjs). All of them
// are written now, so each is required: a missing one fails the build, the deploy and the browser checks.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// files, by path from the repo root
export const FILES = [
  // the document set, built by site/build.mjs (GitHub Pages serves 404.html at any missing path by itself)
  'overview.html', 'sealed.html', 'check.html', 'regulatory.html', 'roadmap.html', 'about.html', '404.html',
  // written by hand: the landing page and the app's page (the rest of app/ and ui/ is copied with the folder, below)
  'index.html', 'app/index.html',
  // the format's one implementation, which the app imports, and the one-file agent the landing page offers
  'core/immutableqc.mjs', 'download/iqc.mjs',
  'favicon.svg', 'og.png', 'apple-touch-icon.png', 'CNAME',
  // the alpha console's old address: a small page that sends visitors to the app (never registry-*.js)
  'dashboard/index.html',
]
// folders copied whole, each limited to the file types it is meant to hold; a test/ folder inside one is never published
export const DIRS = { assets: /\.(css|js)$/, fonts: /\.(woff2|txt)$/, app: /\.(html|css|m?js|svg|png|webp|woff2)$/, ui: /\.(css|m?js|svg|png|webp|woff2)$/ }
// never published, whatever the lists above say
const NEVER = [/^site\//, /^contracts\//, /^\.github\//, /^agent\//, /^docs\//, /^e2e\//, /^core\/(?!immutableqc\.mjs$)/, /(^|\/)test\//, /^dashboard\/registry-/, /\.md$/i, /(^|\/)\./, /^_site\//, /node_modules\//]

export function manifest(root = ROOT) {
  const files = [...FILES]
  for (const [d, ok] of Object.entries(DIRS)) {
    if (!existsSync(join(root, d))) throw new Error(`deploy: folder ${d}/ is missing`)
    for (const f of readdirSync(join(root, d)).sort()) {
      if (statSync(join(root, d, f)).isDirectory()) {
        if (f === 'test') continue // tests stay in the repo
        throw new Error(`deploy: ${d}/${f}/ is a folder; only the files directly in ${d}/ are published`)
      }
      if (!ok.test(f)) throw new Error(`deploy: ${d}/${f} is not a file type ${d}/ may publish (${ok})`)
      if (!files.includes(`${d}/${f}`)) files.push(`${d}/${f}`)
    }
  }
  for (const f of files) {
    if (NEVER.some((re) => re.test(f))) throw new Error(`deploy: ${f} must never be published`)
    if (!existsSync(join(root, f)) || !statSync(join(root, f)).isFile()) throw new Error(`deploy: ${f} is missing`)
  }
  return files
}

export function assemble(dest, root = ROOT) {
  const files = manifest(root)
  // only ever replace <repo>/_site; anywhere else the folder must be new or empty, and never the repo or a folder holding it
  const rel = relative(root, dest), inRepo = !rel.startsWith('..') && !isAbsolute(rel)
  if (!relative(dest, root).startsWith('..')) throw new Error(`deploy: refusing to assemble into ${dest}: it is or holds the repo`)
  if (inRepo && rel !== '_site') throw new Error(`deploy: inside the repo, assemble only into _site (not ${rel})`)
  if (rel !== '_site' && existsSync(dest) && readdirSync(dest).length) throw new Error(`deploy: ${dest} is not empty`)
  rmSync(dest, { recursive: true, force: true })
  let bytes = 0
  for (const f of files) {
    mkdirSync(dirname(join(dest, f)), { recursive: true })
    copyFileSync(join(root, f), join(dest, f))
    bytes += statSync(join(dest, f)).size
  }
  const missing = links(dest, files)
  if (missing.length) throw new Error(`deploy: ${missing.length} link(s) in the assembled site resolve to nothing published:\n  ${missing.join('\n  ')}`)
  return { files, bytes }
}

// every relative href, src (pages), url() (stylesheets) and module import (scripts) in the assembled folder, resolved as a
// browser would (the 404 page's <base href="/"> included); returns those that do not name a published file
export function links(dest, files) {
  const out = [], have = new Set(files)
  const check = (from, u0, baseDir) => {
    if (!u0 || /^(?:[a-z][\w+.-]*:|#|\/\/)/i.test(u0)) return // other origins, data:, in-page fragments
    const u = u0.replace(/[?#].*$/, '')
    if (!u) return
    let p = u.startsWith('/') ? u.slice(1) : join(baseDir, u).replace(/\\/g, '/')
    if (p === '.' || p === '' || u.endsWith('/')) p = join(p, 'index.html').replace(/\\/g, '/')
    if (p.startsWith('..') || !have.has(p)) out.push(`${from}: ${u0}`)
  }
  for (const f of files) {
    if (/\.html$/.test(f)) {
      const html = readFileSync(join(dest, f), 'utf8'), base = /<base href="\/">/.test(html)
      const body = html.replace(/<script type="application\/json"[\s\S]*?<\/script>/g, '')
      for (const [, u] of body.matchAll(/\s(?:href|src)="([^"]*)"/g)) check(f, u.replace(/&amp;/g, '&'), base ? '' : dirname(f))
    } else if (/\.css$/.test(f)) {
      for (const [, u] of readFileSync(join(dest, f), 'utf8').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) check(f, u, dirname(f))
    } else if (/\.m?js$/.test(f)) {
      // a module's relative imports (static, dynamic, re-exports) and the files it names with new URL(…, import.meta.url)
      // or new Worker(…); bare names (node:fs) are not files on the site
      const src = readFileSync(join(dest, f), 'utf8')
      const file = (u) => /\.\w+(?:[?#].*)?$/.test(u) // a file, not a folder such as new URL('.', import.meta.url)
      for (const [, , u] of src.matchAll(/\b(?:from|import)\s*\(?\s*(['"])(\.{1,2}\/[^'"\n]+)\1/g)) if (file(u)) check(f, u, dirname(f))
      for (const [, , u] of src.matchAll(/\bnew\s+(?:URL|Worker|SharedWorker)\(\s*(['"])([^'"\n]+)\1/g)) if (file(u)) check(f, u, dirname(f))
    }
  }
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dest = process.argv[2]
  if (!dest) { console.error('usage: node site/tools/deploy.mjs <folder>   (the Pages workflow uses _site)'); process.exit(2) }
  try {
    const { files, bytes } = assemble(resolve(process.cwd(), dest))
    console.log(files.join('\n'))
    console.log(`deploy: ${files.length} files, ${(bytes / 1024).toFixed(1)} KB, assembled in ${dest}/`)
  } catch (e) { console.error(e.message); process.exit(1) }
}
