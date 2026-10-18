#!/usr/bin/env node
// Builds the MCP server as an MCPB bundle (a .mcpb file: a zip archive with manifest.json at its root), for MCP clients
// that install .mcpb files and for the MCP Registry, which lists an MCPB package by its release URL and its SHA-256
// (docs/agent-discovery.md, A7 and C4; the manifest format: https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md).
//
//   node agent/tools/mcpb.mjs                 write dist/immutableqc-<version>.mcpb and print its SHA-256
//   node agent/tools/mcpb.mjs --server-json   the same, and write that SHA-256 into server.json (packages[0].fileSha256)
//   node agent/tools/mcpb.mjs --check         write nothing; exit 1 unless server.json carries the SHA-256 of the bundle
//                                             this would write (after a change to the agent, run it with --server-json)
//
// The bundle holds exactly two entries: manifest.json (agent/mcpb/manifest.json) and server/iqc.mjs (download/iqc.mjs,
// byte for byte). No dependencies: the entries are stored (no compression), with fixed times and modes, so the same
// inputs give the same bytes on every machine and the SHA-256 can be checked. dist/ is not committed (.gitignore).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import * as zlib from 'node:zlib'

const AGENT = dirname(dirname(fileURLToPath(import.meta.url)))
const REPO = dirname(AGENT)
export const MANIFEST = join(AGENT, 'mcpb', 'manifest.json')
export const SERVER = join(REPO, 'download', 'iqc.mjs')
export const SERVER_JSON = join(REPO, 'server.json')
export const DIST = join(REPO, 'dist')

// CRC-32 (the zip polynomial): node:zlib's where Node has it (22.2 and later), else the same table computed here
let TABLE = null
export function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0
  if (!TABLE) TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  let c = 0xffffffff
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// a zip archive of stored entries: [{name, data, mode}] -> Buffer. Times are 1980-01-01 00:00 (the earliest a zip can
// say), names are UTF-8 (flag bit 11), and each entry's Unix mode is in its external attributes
export function zipStored(entries) {
  const DOS_TIME = 0, DOS_DATE = (0 << 9) | (1 << 5) | 1
  const locals = [], centrals = []
  let offset = 0
  for (const { name, data, mode = 0o100644 } of entries) {
    const n = Buffer.from(name, 'utf8'), crc = crc32(data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(10, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8)
    lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12); lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26); lh.writeUInt16LE(0, 28)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE((3 << 8) | 20, 4); ch.writeUInt16LE(10, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10)
    ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24)
    ch.writeUInt16LE(n.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36)
    ch.writeUInt32LE((mode << 16) >>> 0, 38); ch.writeUInt32LE(offset, 42)
    locals.push(lh, n, data)
    centrals.push(ch, n)
    offset += lh.length + n.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, cd, end])
}

// the entries of a zip archive as the central directory lists them (for the test): [{name, method, size, crc, data}]
export function readZip(buf) {
  const e = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (e < 0) throw new Error('not a zip archive: no end of central directory')
  const count = buf.readUInt16LE(e + 10), cdOff = buf.readUInt32LE(e + 16)
  const out = []
  let p = cdOff
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry')
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 24)
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nl)
    const lnl = buf.readUInt16LE(lo + 26), lxl = buf.readUInt16LE(lo + 28)
    const data = buf.subarray(lo + 30 + lnl + lxl, lo + 30 + lnl + lxl + size)
    out.push({ name, method, size, crc, data })
    p += 46 + nl + xl + cl
  }
  return out
}

export function manifest() { return JSON.parse(readFileSync(MANIFEST, 'utf8')) }

// -> {bytes, sha256, file, version}
export function buildMcpb() {
  const m = manifest()
  const bytes = zipStored([
    { name: 'manifest.json', data: readFileSync(MANIFEST) },
    { name: 'server/iqc.mjs', data: readFileSync(SERVER), mode: 0o100755 },
  ])
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), file: join(DIST, `immutableqc-${m.version}.mcpb`), version: m.version }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = new Set(process.argv.slice(2))
  const b = buildMcpb()
  const sj = JSON.parse(readFileSync(SERVER_JSON, 'utf8'))
  if (args.has('--check')) {
    const have = sj.packages && sj.packages[0] && sj.packages[0].fileSha256
    if (have === b.sha256) { console.log(`server.json carries the SHA-256 of immutableqc-${b.version}.mcpb (${b.sha256}).`); process.exit(0) }
    console.error(`server.json says ${have || 'no SHA-256'}; the bundle is ${b.sha256}. Run: node agent/tools/mcpb.mjs --server-json`)
    process.exit(1)
  }
  mkdirSync(DIST, { recursive: true })
  writeFileSync(b.file, b.bytes)
  console.log(`Wrote ${b.file.slice(REPO.length + 1)} (${b.bytes.length.toLocaleString('en-US')} bytes, SHA-256 ${b.sha256}).`)
  if (args.has('--server-json')) {
    sj.packages[0].fileSha256 = b.sha256
    writeFileSync(SERVER_JSON, JSON.stringify(sj, null, 2) + '\n')
    console.log('Wrote its SHA-256 into server.json.')
  }
}
