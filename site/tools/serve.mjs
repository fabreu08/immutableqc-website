// serve.mjs · a static server with gzip for text, as GitHub Pages serves it; 404.html for missing paths.
//   node site/tools/serve.mjs [port]            the repo root, as it is on disk
//   node site/tools/serve.mjs [port] --deploy   only what GitHub Pages will publish: the allowlist in deploy.mjs,
//                                               assembled into a temporary folder (check.mjs serves this by default)
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, extname, normalize, dirname, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const T = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.md': 'text/plain; charset=utf-8' }
export function serve(port = 0, root = ROOT) {
  const srv = createServer(async (req, res) => {
    try {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
      let f = normalize(join(root, p)), code = 200
      // contained by path, not by string prefix: /..%2froot-other/ must not reach a sibling folder named like the root
      const rel = relative(root, f)
      if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) { res.writeHead(403); return res.end() }
      let s = await stat(f).catch(() => null)
      // a folder without its trailing slash redirects, as GitHub Pages does, so relative links inside it resolve
      if (s && s.isDirectory() && !p.endsWith('/')) { const u = new URL(req.url, 'http://x'); res.writeHead(301, { location: u.pathname + '/' + u.search }); return res.end() }
      if (s && s.isDirectory()) { f = join(f, 'index.html'); s = await stat(f).catch(() => null) }
      if (!s) { f = join(root, '404.html'); code = 404; s = await stat(f).catch(() => null); if (!s) { res.writeHead(404); return res.end() } }
      let body = await readFile(f)
      const type = T[extname(f)] || 'application/octet-stream'
      const h = { 'content-type': type, 'cache-control': 'no-store' }
      if (/text|javascript|json|svg/.test(type) && /gzip/.test(req.headers['accept-encoding'] || '')) { body = gzipSync(body, { level: 9 }); h['content-encoding'] = 'gzip' }
      h['content-length'] = body.length
      res.writeHead(code, h); res.end(body)
    } catch (e) { res.writeHead(500); res.end(String(e)) }
  })
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r({ srv, port: srv.address().port, close: () => new Promise((c) => srv.close(c)) })))
}
// the deploy view: the allowlisted files only, in a fresh temporary folder; close() removes it
export async function serveDeploy(port = 0) {
  const { assemble } = await import('./deploy.mjs')
  const dir = mkdtempSync(join(tmpdir(), 'iqc-pages-'))
  const { files } = assemble(dir)
  const s = await serve(port, dir)
  return { ...s, root: dir, files, close: async () => { await s.close(); rmSync(dir, { recursive: true, force: true }) } }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), port = +(args.find((a) => /^\d+$/.test(a)) || 8810)
  const s = args.includes('--deploy') ? await serveDeploy(port) : await serve(port)
  console.log(`serving ${s.root ? `the deploy allowlist (${s.files.length} files, assembled in ${s.root})` : ROOT} on http://127.0.0.1:${s.port}/`)
  const stop = () => s.close().then(() => process.exit(0))
  process.on('SIGINT', stop); process.on('SIGTERM', stop)
}
