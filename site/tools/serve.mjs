// serve.mjs · a static server for the repo root with gzip for text, as GitHub Pages serves it; 404.html for missing paths.
//   node site/tools/serve.mjs [port]        (also imported by check.mjs)
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const T = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.md': 'text/plain; charset=utf-8' }
export function serve(port = 0, root = ROOT) {
  const srv = createServer(async (req, res) => {
    try {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
      let f = normalize(join(root, p)), code = 200
      if (!f.startsWith(root)) { res.writeHead(403); return res.end() }
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
if (import.meta.url === `file://${process.argv[1]}`) serve(+(process.argv[2] || 8810)).then(({ port }) => console.log(`serving ${ROOT} on http://127.0.0.1:${port}/`))
