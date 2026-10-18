#!/usr/bin/env node
// Builds download/iqc.mjs: the agent in one file, for people to download and run with `node iqc.mjs <command>`.
//
//   node agent/tools/bundle.mjs           write download/iqc.mjs
//   node agent/tools/bundle.mjs --check   exit 1 unless download/iqc.mjs is exactly what this would write
//   node agent/tools/bundle.mjs --stamp   write it, then put its SHA-256 into every element of index.html that has
//                                         data-sha256-of="download/iqc.mjs" (its text; an <input>'s value)
//
// The file is valid ES module code: a shebang, a header comment, one import line per Node built-in module, then core
// (core/immutableqc.mjs, unchanged but for its export keywords) and each agent module (agent/src/*.mjs, reached from
// cli.mjs) inside its own function scope, so every module's names stay private and only what it exports is passed on.
// A module may only use what this tool understands: top-level `import {…} from` / `import * as … from` lines, and
// `export` on function, class, const and let declarations; anything else is refused. The output is deterministic (no
// time, no absolute path), so --check can compare bytes.
import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve, basename, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const AGENT = dirname(dirname(fileURLToPath(import.meta.url)))
const REPO = dirname(AGENT)
export const CORE = join(REPO, 'core', 'immutableqc.mjs')
export const ENTRY = join(AGENT, 'src', 'cli.mjs')
export const OUT = join(REPO, 'download', 'iqc.mjs')
export const INDEX = join(REPO, 'index.html')
// the Node built-ins the agent may use: files, paths, the computer's name and home folder, hashing. Never a network
// module (http, https, http2, net, tls, dgram, dns), never child_process.
export const ALLOWED_BUILTINS = ['node:fs', 'node:fs/promises', 'node:path', 'node:os', 'node:crypto']

const IMPORT_RE = /^import\s+(\{[^}]*\}|\*\s+as\s+[\w$]+)\s+from\s+(['"])([^'"\n]+)\2;?[ \t]*$/gm
const EXPORT_RE = /^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([\w$]+)/gm

const rel = (f) => relative(REPO, f).split('\\').join('/')
const idOf = (spec, file) => {
  if (spec.startsWith('node:')) return '__node_' + spec.slice(5).replace(/\W/g, '_')
  if (file === CORE) return '__core'
  return '__iqc_' + basename(file, '.mjs').replace(/\W/g, '_')
}

function fail(msg) {
  throw new Error(`bundle: ${msg}`)
}

function readModule(file) {
  const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const imports = [...src.matchAll(IMPORT_RE)].map((m) => ({ text: m[0], clause: m[1], spec: m[3] }))
  const exports = [...src.matchAll(EXPORT_RE)].map((m) => m[1])
  const rest = src.replace(IMPORT_RE, '')
  if (/^\s*import\b/m.test(rest)) fail(`${rel(file)}: an import this tool does not read (use one import {…} from '…' per line group)`)
  if (/\bimport\s*\(/.test(rest) || /\bimport\.meta\b/.test(rest)) fail(`${rel(file)}: dynamic import() or import.meta`)
  if (/^export\b(?!\s+(?:async\s+)?(?:function\*?|const|let|class)\s)/m.test(rest)) fail(`${rel(file)}: an export this tool does not read (default exports and export lists are not allowed)`)
  if (/\brequire\s*\(/.test(rest.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ''))) fail(`${rel(file)}: require()`)
  const deps = []
  for (const im of imports) {
    if (im.spec.startsWith('node:')) {
      if (!ALLOWED_BUILTINS.includes(im.spec)) fail(`${rel(file)} imports ${im.spec}, which the agent may not use (allowed: ${ALLOWED_BUILTINS.join(', ')})`)
      im.id = idOf(im.spec)
    } else if (im.spec.startsWith('.')) {
      im.file = resolve(dirname(file), im.spec)
      if (!existsSync(im.file)) fail(`${rel(file)} imports ${im.spec}, which does not exist`)
      im.id = idOf(im.spec, im.file)
      deps.push(im.file)
    } else fail(`${rel(file)} imports ${im.spec}: only node: built-ins and relative modules`)
  }
  return { file, src, imports, exports, deps }
}

// `{ a, b as c }` -> `{ a, b: c }`;  `* as X` -> `X`
function binding(clause) {
  if (clause.startsWith('*')) return clause.replace(/^\*\s+as\s+/, '')
  const names = clause.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean)
  return `{ ${names.map((n) => { const m = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(n); if (!m) fail(`cannot read the import ${clause}`); return m[2] ? `${m[1]}: ${m[2]}` : m[1] }).join(', ')} }`
}

function wrap(mod) {
  let body = mod.src
  for (const im of mod.imports) body = body.replace(im.text, () => `const ${binding(im.clause)} = ${im.id}`)
  body = body.replace(/^export\s+(?=(?:async\s+)?(?:function\*?|const|let|class)\s)/gm, '')
  const id = idOf('', mod.file)
  const names = [...new Set(mod.exports)]
  return `// ---------------------------------------------------------------------------------------------- ${rel(mod.file)}\n` +
    `const ${id} = (() => {\n${body.replace(/\n+$/, '')}\n\nreturn { ${names.join(', ')} }\n})()\n`
}

export function buildBundle() {
  const mods = new Map()
  const order = []
  const visit = (file, stack) => {
    if (stack.includes(file)) fail(`an import cycle: ${[...stack, file].map(rel).join(' -> ')}`)
    if (mods.has(file)) return
    const m = readModule(file)
    mods.set(file, m)
    for (const d of m.deps) visit(d, [...stack, file])
    order.push(m)
  }
  visit(ENTRY, [])
  if (!mods.has(CORE)) fail('the agent does not import core/immutableqc.mjs')
  if (mods.get(CORE).imports.length) fail('core/immutableqc.mjs must import nothing')
  const cli = mods.get(ENTRY)
  if (!cli.exports.includes('run')) fail('agent/src/cli.mjs must export run')
  const builtins = [...new Set(order.flatMap((m) => m.imports.filter((i) => i.spec.startsWith('node:')).map((i) => i.spec)))].sort()
  const version = /export const VERSION = '([^']+)'/.exec(mods.get(CORE).src)[1]
  const head = [
    '#!/usr/bin/env node',
    `// iqc.mjs: the Immutable QC agent (iqc), version ${version}, in one file. Seals every file in a folder as it is written,`,
    '// records the steps an AI agent takes on files, and audits a lab folder against its ledgers. Run it with Node.js 22 or',
    '// later: node iqc.mjs help',
    '// No dependencies, and it never uses the network: it reads files, and writes its ledgers, README.txt, lock files and',
    '// the pin file it is given.',
    '//',
    '// The SHA-256 of this file is printed on immutableqc.com, beside the download link. Compare it before you run the file:',
    '//   Windows: certutil -hashfile iqc.mjs SHA256    macOS: shasum -a 256 iqc.mjs    Linux: sha256sum iqc.mjs',
    '//',
    '// Built by agent/tools/bundle.mjs from agent/src/*.mjs and core/immutableqc.mjs (the one implementation of the ledger',
    '// format, inlined below, unchanged but for its export keywords). Each module runs in its own scope. Edit those files,',
    '// not this one: a test checks that this file is up to date.',
    '',
    ...builtins.map((s) => `import * as ${idOf(s)} from '${s}'`),
    '',
  ].join('\n')
  const body = order.map(wrap).join('\n')
  return `${head}\n${body}\nprocess.exitCode = await ${idOf('', ENTRY)}.run(process.argv.slice(2))\n`
}

export const sha256 = (b) => createHash('sha256').update(b).digest('hex')

// Puts sha into every element with data-sha256-of="download/iqc.mjs": the text of a normal element, the value of an
// <input>. Returns {html, count}.
export function stampHTML(html, sha) {
  let count = 0
  const attr = /\sdata-sha256-of=(["'])download\/iqc\.mjs\1/
  let out = html.replace(/<input\b([^>]*)>/gi, (m, attrs) => {
    if (!attr.test(attrs)) return m
    count++
    return /\svalue=(["'])[^"']*\1/.test(attrs) ? m.replace(/(\svalue=)(["'])[^"']*\2/, `$1$2${sha}$2`) : m.replace(/\s*\/?>$/, (end) => ` value="${sha}"${end.trim() === '/>' ? ' />' : '>'}`)
  })
  out = out.replace(/<([a-zA-Z][\w-]*)(\s[^>]*)>([^<]*)<\/\1>/g, (m, tag, attrs) => {
    if (!attr.test(attrs) || tag.toLowerCase() === 'input') return m
    count++
    return `<${tag}${attrs}>${sha}</${tag}>`
  })
  return { html: out, count }
}

function main(argv) {
  const check = argv.includes('--check'), stamp = argv.includes('--stamp')
  const unknown = argv.filter((a) => a !== '--check' && a !== '--stamp')
  if (unknown.length || (check && stamp)) {
    console.error('Usage: node agent/tools/bundle.mjs [--check | --stamp]')
    return 2
  }
  const text = buildBundle()
  const sha = sha256(text)
  if (check) {
    const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null
    if (cur !== text) {
      console.error(`${rel(OUT)} is ${cur === null ? 'missing' : 'out of date'}: run node agent/tools/bundle.mjs (and commit the result).`)
      return 1
    }
    console.log(`${rel(OUT)} is up to date (SHA-256 ${sha}).`)
    if (existsSync(INDEX)) {
      const html = readFileSync(INDEX, 'utf8')
      const { count } = stampHTML(html, sha)
      if (count && stampHTML(html, sha).html !== html) console.log(`note: index.html shows another SHA-256 for it; run node agent/tools/bundle.mjs --stamp`)
    }
    return 0
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, text)
  try { chmodSync(OUT, 0o755) } catch { /* a system without modes */ }
  const syntax = spawnSync(process.execPath, ['--check', OUT], { encoding: 'utf8' })
  if (syntax.status !== 0) {
    console.error(`${rel(OUT)} does not parse:\n${syntax.stderr}`)
    return 1
  }
  console.log(`Wrote ${rel(OUT)} (${text.length.toLocaleString('en-US')} bytes, SHA-256 ${sha}).`)
  if (stamp) {
    if (!existsSync(INDEX)) { console.error('index.html is missing; nothing stamped.'); return 1 }
    const { html, count } = stampHTML(readFileSync(INDEX, 'utf8'), sha)
    if (!count) { console.error('index.html has no element with data-sha256-of="download/iqc.mjs"; nothing stamped.'); return 1 }
    writeFileSync(INDEX, html)
    console.log(`Stamped the SHA-256 into ${count} element${count === 1 ? '' : 's'} of index.html.`)
  }
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
}
