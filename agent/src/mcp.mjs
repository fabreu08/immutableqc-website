// iqc mcp: a Model Context Protocol server on standard input and output, for an AI agent to call. It records the
// agent's steps (what it read and wrote, by SHA-256) in the agent's own ledger and answers where a file's bytes came
// from. No dependency: JSON-RPC 2.0, one message per line. Standard output carries protocol messages only; every
// human line goes to standard error.
//
// Versions: 2026-07-28 (no handshake: each request names its version and the client's capabilities in _meta;
// server/discover), and the handshake versions 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05 (initialize, then
// notifications/initialized; ping). Structured tool results (structuredContent, outputSchema) from 2025-06-18.
import { AGENT, AGENT_VERSION, UserError, EXIT_OK } from './util.mjs'
import { dataFolder, locate, confinedFile } from './paths.mjs'
import { acquireLock } from './lock.mjs'
import { ensureDir, ensureReadme } from './ledger.mjs'
import { openForWriting, pinFileFor } from './session.mjs'
import { LedgerCache, labLedgers } from './lab.mjs'
import { refOf, inRef, traceFiles, recordStep, traceOne, AGENT_README_TEXT, searchDirsOf } from './steps.mjs'
import { ledgersOf, auditLedgers } from './audit.mjs'
import { planStep } from '../../core/immutableqc.mjs'

export const MODERN_VERSIONS = Object.freeze(['2026-07-28'])
export const LEGACY_VERSIONS = Object.freeze(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'])
export const SUPPORTED_VERSIONS = Object.freeze([...MODERN_VERSIONS, ...LEGACY_VERSIONS])
const META_VERSION = 'io.modelcontextprotocol/protocolVersion'
const META_CAPS = 'io.modelcontextprotocol/clientCapabilities'
const META_SERVER = 'io.modelcontextprotocol/serverInfo'
const SERVER_INFO = Object.freeze({ name: 'iqc', title: 'Immutable QC agent', version: AGENT_VERSION })
const MAX_LINE = 8 * 1024 * 1024
const MAX_PATHS = 1000

export const E = Object.freeze({ PARSE: -32700, INVALID_REQUEST: -32600, METHOD: -32601, PARAMS: -32602, INTERNAL: -32603, VERSION: -32022 })

const INSTRUCTIONS = 'Records the steps you take on files under one folder, and traces where a file\'s bytes came from. ' +
  'Before you use a file, call check_inputs to see whether its bytes were measured by an instrument, written by a recorded step, or neither. ' +
  'After you write files, call record_step with what you read, what you wrote, and one line on what you did. ' +
  'Paths are relative to the server\'s root folder; nothing outside it can be named. Each record is signed and linked to the one before it, in a ledger on this computer.'

const pathList = (what, min) => ({ type: 'array', items: { type: 'string', minLength: 1 }, minItems: min, maxItems: MAX_PATHS, description: what })
const fileState = {
  type: 'object',
  properties: {
    path: { type: 'string' }, sha256: { type: 'string' }, bytes: { type: 'number' },
    state: { type: 'string', enum: ['measured', 'derived', 'untraced'] }, text: { type: 'string' },
    measured: { type: 'object' }, derived: { type: 'object' }, sealedHere: { type: 'object' }, changedAfterSeal: { type: 'boolean' },
  },
  required: ['path', 'sha256', 'bytes', 'state'],
}

export const TOOLS = Object.freeze([
  {
    name: 'check_inputs',
    title: 'Check input files',
    description: 'Say, for each file, whether its exact bytes were sealed by an instrument (measured), written by a recorded agent step (derived), or neither (untraced). Also says when a sealed file has changed since it was sealed. Call it before using files as inputs. Reads only.',
    inputSchema: { type: 'object', properties: { paths: pathList('Files to check, relative to the root folder.', 1) }, required: ['paths'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { files: { type: 'array', items: fileState }, measured: { type: 'number' }, derived: { type: 'number' }, untraced: { type: 'number' } }, required: ['files', 'measured', 'derived', 'untraced'] },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'record_step',
    title: 'Record a step',
    description: 'Record one step you took: the files you read (inputs), the files you wrote (outputs) and one line on what you did. Each file is stored by its SHA-256 fingerprint and size. The record is signed and appended to the agent\'s ledger; it cannot be taken back, only reviewed. Returns the record\'s reference and each input\'s trace.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', minLength: 1, maxLength: 500, description: 'What the step did, in one line (for example: "Averaged the six injections and wrote the summary").' },
        inputs: pathList('Files the step read, relative to the root folder.', 0),
        outputs: pathList('Files the step wrote, relative to the root folder (at least one).', 1),
        input_refs: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: MAX_PATHS, description: 'Inputs that are not files under the root, each written <sha256>:<bytes>:<label>.' },
        actor: { type: 'string', minLength: 1, maxLength: 64, description: 'Who took the step (default: the server\'s --actor).' },
        tool: { type: 'string', minLength: 1, maxLength: 128, description: 'The program or model that took it (default: the server\'s --tool).' },
      },
      required: ['action', 'outputs'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        reference: { type: 'string' }, record: { type: 'number' }, link: { type: 'string' }, ledger: { type: 'object' }, actor: { type: 'string' }, tool: { type: 'string' },
        action: { type: 'string' }, at: { type: 'string' }, inputs: { type: 'array', items: fileState }, outputs: { type: 'array', items: { type: 'object' } }, untracedInputs: { type: 'number' }, warning: { type: 'string' },
      },
      required: ['reference', 'record', 'link', 'inputs', 'outputs', 'untracedInputs'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'trace',
    title: 'Trace a file',
    description: 'Trace one file\'s bytes back through the recorded agent steps to the files instruments sealed, and say whether every branch ends in a measurement. Reads only.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', minLength: 1, description: 'The file, relative to the root folder.' } }, required: ['path'], additionalProperties: false },
    outputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, sha256: { type: 'string' }, bytes: { type: 'number' }, state: { type: 'string' }, tracesToMeasured: { type: 'boolean' }, measuredFiles: { type: 'number' }, untracedInputs: { type: 'number' }, sentence: { type: 'string' }, tree: {} },
      required: ['path', 'sha256', 'state', 'tracesToMeasured', 'sentence'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'audit_summary',
    title: 'Audit summary',
    description: 'Audit every ledger in the folders this server searches: each ledger checked whole, every sealed file read and compared, every step\'s inputs traced. Returns the verdict (pass, review or fail), its sentence, and the problems and items for review. Reads only; it reads every file, so it can take a while on a large folder.',
    inputSchema: { type: 'object', properties: { strict: { type: 'boolean', description: 'Count items for review and notes as failures.' } }, additionalProperties: false },
    outputSchema: {
      type: 'object',
      properties: { verdict: { type: 'string', enum: ['pass', 'review', 'fail'] }, summary: { type: 'string' }, counts: { type: 'object' }, problems: { type: 'array', items: { type: 'string' } }, forReview: { type: 'array', items: { type: 'string' } }, notes: { type: 'array', items: { type: 'string' } }, ledgers: { type: 'array', items: { type: 'object' } } },
      required: ['verdict', 'summary', 'counts', 'problems', 'forReview', 'notes', 'ledgers'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
])

// the tool list as a version shows it: title and outputSchema from 2025-06-18, annotations from 2025-03-26
export function toolsFor(version) {
  return TOOLS.map((t) => {
    const o = { name: t.name, description: t.description, inputSchema: t.inputSchema }
    if (version >= '2025-06-18') { o.title = t.title; o.outputSchema = t.outputSchema }
    if (version >= '2025-03-26') o.annotations = { title: t.title, ...t.annotations }
    return o
  })
}

// A small check of tool arguments against the input schemas above (the subset they use). -> null | a sentence
export function argsProblem(schema, args) {
  if (args === undefined) args = {}
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'The arguments must be a JSON object.'
  for (const k of Object.keys(args)) if (!schema.properties[k]) return `Unknown argument "${k}". This tool takes: ${Object.keys(schema.properties).join(', ')}.`
  for (const k of schema.required || []) if (args[k] === undefined) return `The argument "${k}" is missing.`
  for (const [k, s] of Object.entries(schema.properties)) {
    const v = args[k]
    if (v === undefined) continue
    if (s.type === 'string') {
      if (typeof v !== 'string') return `"${k}" must be text.`
      if (s.minLength && v.length < s.minLength) return `"${k}" is empty.`
      if (s.maxLength && [...v].length > s.maxLength) return `"${k}" is longer than ${s.maxLength} characters.`
    } else if (s.type === 'boolean') {
      if (typeof v !== 'boolean') return `"${k}" must be true or false.`
    } else if (s.type === 'array') {
      if (!Array.isArray(v)) return `"${k}" must be a list.`
      if (s.minItems && v.length < s.minItems) return `"${k}" needs at least ${s.minItems} ${s.minItems === 1 ? 'entry' : 'entries'}.`
      if (s.maxItems && v.length > s.maxItems) return `"${k}" holds more than ${s.maxItems} entries.`
      if (v.some((x) => typeof x !== 'string' || x === '')) return `Every entry of "${k}" must be non-empty text.`
    }
  }
  return null
}

class RpcError extends Error {
  constructor(code, message, data) { super(message); this.code = code; this.data = data }
}

const isId = (id) => typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id))

// The server. `send(obj)` writes one message; `log(s)` a line on standard error.
export class McpServer {
  constructor({ root, loc, searchDirs, open, opts, out, send }) {
    Object.assign(this, { root, loc, searchDirs, open, opts, out, send })
    this.cache = new LedgerCache()
    this.legacy = null // the version agreed by initialize
    this.initialized = false
    this.actor = opts.actor || 'agent'
    this.tool = opts.tool || '-'
  }

  // one parsed message (or a parse error): the response object, or null for none
  async handle(msg) {
    if (Array.isArray(msg)) return this.error(null, E.INVALID_REQUEST, 'Batches are not supported: send one JSON-RPC message per line.')
    if (!msg || typeof msg !== 'object') return this.error(null, E.INVALID_REQUEST, 'A message must be a JSON-RPC 2.0 object.')
    const hasId = Object.prototype.hasOwnProperty.call(msg, 'id')
    const id = hasId && isId(msg.id) ? msg.id : null
    if (msg.jsonrpc !== '2.0') return this.error(id, E.INVALID_REQUEST, 'The message must carry "jsonrpc": "2.0".')
    if (typeof msg.method !== 'string') {
      if (hasId && ('result' in msg || 'error' in msg)) return null // a response: this server sends no requests
      return this.error(id, E.INVALID_REQUEST, 'A request must name its method.')
    }
    if (!hasId) { this.notification(msg); return null }
    if (!isId(msg.id)) return this.error(null, E.INVALID_REQUEST, 'A request id must be a string or a number.')
    if (msg.params !== undefined && (msg.params === null || typeof msg.params !== 'object' || Array.isArray(msg.params))) return this.error(id, E.INVALID_REQUEST, 'params must be an object.')
    try {
      return { jsonrpc: '2.0', id, result: await this.request(msg.method, msg.params || {}) }
    } catch (e) {
      if (e instanceof RpcError) return this.error(id, e.code, e.message, e.data)
      this.out.error(`Unexpected: ${e && e.message ? e.message : e}`)
      return this.error(id, E.INTERNAL, 'The server hit an error it did not expect; the details are on its standard error.')
    }
  }

  error(id, code, message, data) {
    return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } }
  }

  notification(msg) {
    if (msg.method === 'notifications/initialized') { if (this.legacy) this.initialized = true }
    // anything else (notifications/cancelled, progress) needs nothing: requests are answered in order
  }

  // which version a request uses: its _meta version (no handshake), else the one initialize agreed
  versionOf(method, params) {
    const meta = params._meta && typeof params._meta === 'object' ? params._meta : null
    if (meta && meta[META_VERSION] !== undefined) {
      const v = meta[META_VERSION]
      if (typeof v !== 'string' || !SUPPORTED_VERSIONS.includes(v)) throw new RpcError(E.VERSION, 'Unsupported protocol version', { supported: [...SUPPORTED_VERSIONS], requested: v })
      if (MODERN_VERSIONS.includes(v) && (!meta[META_CAPS] || typeof meta[META_CAPS] !== 'object' || Array.isArray(meta[META_CAPS]))) {
        throw new RpcError(E.PARAMS, `The request must carry its client capabilities in _meta["${META_CAPS}"] (an object, {} for none).`)
      }
      return { version: v, modern: MODERN_VERSIONS.includes(v) }
    }
    if (this.legacy) return { version: this.legacy, modern: false }
    if (method === 'ping') return { version: LEGACY_VERSIONS[0], modern: false }
    throw new RpcError(E.PARAMS, `Name the protocol version in _meta["${META_VERSION}"] (with _meta["${META_CAPS}"]), or send initialize first. Supported: ${SUPPORTED_VERSIONS.join(', ')}.`)
  }

  wrap(result, { modern, cache }) {
    if (!modern) return result
    const o = { resultType: 'complete', ...result, _meta: { ...(result._meta || {}), [META_SERVER]: { ...SERVER_INFO } } }
    if (cache) { o.ttlMs = cache; o.cacheScope = 'public' }
    return o
  }

  async request(method, params) {
    if (method === 'initialize') {
      if (this.legacy) throw new RpcError(E.INVALID_REQUEST, 'The server is already initialized; initialize is sent once.')
      const asked = params.protocolVersion
      if (typeof asked !== 'string') throw new RpcError(E.PARAMS, 'initialize needs protocolVersion (text).')
      this.legacy = LEGACY_VERSIONS.includes(asked) ? asked : LEGACY_VERSIONS[0]
      const c = params.clientInfo && typeof params.clientInfo === 'object' ? params.clientInfo : null
      this.out.note(`MCP client ${c && typeof c.name === 'string' ? c.name : 'unnamed'} connected (protocol ${this.legacy}).`)
      const info = this.legacy >= '2025-06-18' ? { ...SERVER_INFO } : { name: SERVER_INFO.name, version: SERVER_INFO.version }
      return { protocolVersion: this.legacy, capabilities: { tools: { listChanged: false } }, serverInfo: info, instructions: INSTRUCTIONS }
    }
    const era = this.versionOf(method, params)
    if (method === 'ping') {
      if (era.modern) throw new RpcError(E.METHOD, 'ping is not a method of protocol 2026-07-28.')
      return {}
    }
    if (method === 'server/discover') {
      return this.wrap({ supportedVersions: [...SUPPORTED_VERSIONS], capabilities: { tools: { listChanged: false } }, instructions: INSTRUCTIONS }, { modern: true, cache: 3600000 })
    }
    if (method === 'tools/list') {
      if (params.cursor !== undefined && typeof params.cursor !== 'string') throw new RpcError(E.PARAMS, 'cursor must be text.')
      if (params.cursor) throw new RpcError(E.PARAMS, 'There is one page of tools; that cursor is not one this server gave.')
      return this.wrap({ tools: toolsFor(era.version) }, { modern: era.modern, cache: 300000 })
    }
    if (method === 'tools/call') {
      const t = TOOLS.find((x) => x.name === params.name)
      if (typeof params.name !== 'string' || !t) throw new RpcError(E.PARAMS, `Unknown tool ${JSON.stringify(params.name)}. The tools are: ${TOOLS.map((x) => x.name).join(', ')}.`)
      return this.wrap(await this.call(t, params.arguments, era.version), { modern: era.modern })
    }
    throw new RpcError(E.METHOD, `Unknown method ${JSON.stringify(method)}.`)
  }

  async call(t, args, version) {
    const structured = version >= '2025-06-18'
    const fail = (text) => ({ content: [{ type: 'text', text }], isError: true })
    const why = argsProblem(t.inputSchema, args)
    if (why) return fail(why)
    let r
    try {
      r = await this[t.name](args || {})
    } catch (e) {
      if (e instanceof UserError) return fail(e.message)
      throw e
    }
    const content = [{ type: 'text', text: r.text }, { type: 'text', text: JSON.stringify(r.data) }]
    return structured ? { content, structuredContent: r.data } : { content }
  }

  file(p, what) { return confinedFile(this.root, p, { base: this.root, what, own: this.loc.own }) }
  ledgers(extra = true) {
    return labLedgers(this.searchDirs, { extra: extra ? [{ abs: this.loc.ledgerPath, rootAbs: this.root, rel: this.loc.shown, root: '' }] : [], cache: this.cache })
  }

  async check_inputs({ paths }) {
    const refs = []
    for (const p of paths) refs.push(await refOf(this.file(p, 'file')))
    const { files } = await traceFiles(await this.ledgers(), refs)
    const n = (s) => files.filter((f) => f.state === s).length
    const changed = files.filter((f) => f.sealedHere && f.sealedHere.state === 'changed since it was sealed').length
    const lines = files.map((f) => `${f.path}: ${f.text}`)
    const head = `${files.length === 1 ? '1 file' : `${files.length} files`}: ${n('measured')} measured, ${n('derived')} derived, ${n('untraced')} untraced${changed ? `; ${changed} changed since sealed` : ''}.`
    return { text: [head, ...lines].join('\n'), data: { files, measured: n('measured'), derived: n('derived'), untraced: n('untraced'), changedSinceSealed: changed } }
  }

  async record_step({ action, inputs = [], outputs, input_refs = [], actor, tool }) {
    const who = actor || this.actor, prog = tool || this.tool
    try {
      planStep({ station: this.open.station, actor: who, tool: prog, action, inputs: [], outputs: [{ path: 'x', sha256: '0'.repeat(64), bytes: 0 }] })
    } catch (e) {
      throw new UserError(e.message.replace(/^Not a valid step record: /, 'The step cannot be recorded: '))
    }
    const ins = []
    for (const p of inputs) ins.push(await refOf(this.file(p, 'input')))
    for (const t of input_refs) ins.push(inRef(t))
    const outs = []
    for (const p of outputs) outs.push(await refOf(this.file(p, 'output')))
    const r = await recordStep({ root: this.root, loc: this.loc, ...this.open, cache: this.cache, searchDirs: this.searchDirs, out: this.out }, { actor: who, tool: prog, action, inputs: ins, outputs: outs })
    this.out.note(`Recorded step ${r.record}: ${r.actor}: ${r.action}`)
    const lines = [`Recorded step ${r.record} (reference ${r.reference}).`, ...r.inputs.map((f) => `input ${f.path}: ${f.text}`), ...r.outputs.map((f) => `output ${f.path}: ${f.sha256}`)]
    if (r.warning) lines.push(r.warning)
    return { text: lines.join('\n'), data: r }
  }

  async trace({ path }) {
    const f = this.file(path, 'file')
    const r = await traceOne(await this.ledgers(), f)
    const { lines, ...data } = r
    return { text: [r.sentence, ...lines.slice(1)].join('\n'), data }
  }

  async audit_summary({ strict = false }) {
    const all = [], seen = new Set()
    for (const d of this.searchDirs) for (const e of await ledgersOf(d, [], { pinFile: null })) if (!seen.has(e.abs)) { seen.add(e.abs); all.push(e) }
    if (!seen.has(this.loc.ledgerPath)) all.push(...(await ledgersOf(this.root, [this.loc.ledgerPath])).filter((e) => !seen.has(e.abs)))
    if (!all.length) throw new UserError('There is no ledger in the folders this server searches.')
    const report = await auditLedgers(all, { ...this.opts, strict, 'expect-head': null, 'expect-key': null }, { folder: this.searchDirs[0] })
    const msg = (x) => x.message
    const data = {
      verdict: report.verdict, summary: report.summary, counts: report.counts, problems: report.problems.map(msg), forReview: report.forReview.map(msg), notes: report.notes.map(msg),
      ledgers: report.ledgers.map((L) => ({ label: L.label, ledgerPath: L.ledgerPath, role: L.role, records: L.records, verdict: L.verdict })),
    }
    const lines = [report.summary, ...data.problems.map((s) => `problem: ${s}`), ...data.forReview.map((s) => `for review: ${s}`)]
    return { text: lines.join('\n'), data }
  }
}

// iqc mcp: holds the ledger's lock for as long as it runs, between an mcp-started and an mcp-stopped record.
export async function runMcp({ opts, out, stdout, stdin = process.stdin, signals = process }) {
  const root = dataFolder(opts.root == null ? '.' : opts.root)
  const loc = locate(root, opts.ledger)
  const pin = pinFileFor(opts, out, loc)
  const searchDirs = searchDirsOf(opts, root)
  ensureDir(loc.dir)
  const lock = acquireLock(loc.lockPath, { command: 'mcp', out })
  let open
  try {
    open = await openForWriting(loc, opts, out, { pin })
    if (loc.isDefault) ensureReadme(loc.readmePath, AGENT_README_TEXT)
    await open.appender.append([{ kind: 'session', f: { station: open.station, event: 'mcp-started', at: new Date().toISOString(), agent: AGENT } }], open.key.privateKey)
  } catch (e) {
    lock.release()
    throw e
  }
  if (open.created) out.note(`New ledger ${loc.ledgerPath} (station ${open.station}).${open.key.created ? ` New signing key ${open.key.keyId}, saved to ${open.key.file}; keep a backup of it.` : ''}`)
  out.note(`iqc mcp: serving on standard input and output. Root ${root}; ledger ${loc.ledgerPath}; protocol versions ${SUPPORTED_VERSIONS.join(', ')}.`)

  let broken = false
  const send = (obj) => {
    if (broken) return
    try { stdout.write(JSON.stringify(obj) + '\n') } catch { broken = true }
  }
  if (stdout.on) stdout.on('error', () => { broken = true })
  const server = new McpServer({ root, loc, searchDirs, open, opts, out, send })

  return await new Promise((resolveRun) => {
    let buf = '', chain = Promise.resolve(), stopping = false, skipping = false
    const enqueue = (line) => {
      chain = chain.then(async () => {
        let msg
        try { msg = JSON.parse(line) } catch { send(server.error(null, E.PARSE, 'Not valid JSON.')); return }
        const res = await server.handle(msg)
        if (res) send(res)
      })
    }
    const onData = (chunk) => {
      buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        let line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (skipping) { skipping = false; continue }
        if (line.endsWith('\r')) line = line.slice(0, -1)
        if (line.trim()) enqueue(line)
      }
      if (buf.length > MAX_LINE) {
        buf = ''
        skipping = true
        chain = chain.then(() => send(server.error(null, E.INVALID_REQUEST, `A message longer than ${MAX_LINE} bytes is not read.`)))
      }
    }
    const stop = async (why) => {
      if (stopping) return
      stopping = true
      stdin.removeListener('data', onData)
      if (buf.trim() && !skipping) enqueue(buf.replace(/\r$/, ''))
      buf = ''
      for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) signals.removeListener(s, onSignal)
      try { await chain } catch { /* answered */ }
      let code = EXIT_OK
      try {
        await open.appender.sync()
        await open.appender.append([{ kind: 'session', f: { station: open.station, event: 'mcp-stopped', at: new Date().toISOString(), agent: AGENT } }], open.key.privateKey)
      } catch (e) {
        out.error(`Could not write the mcp-stopped record: ${e.message}`)
        code = e instanceof UserError ? e.exitCode : 1
      }
      lock.release()
      out.note(`iqc mcp: stopped (${why}).`)
      if (typeof stdin.pause === 'function') stdin.pause()
      resolveRun(code)
    }
    const onSignal = (s) => { stop(s) }
    for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) signals.on(s, onSignal)
    if (typeof stdin.setEncoding === 'function') stdin.setEncoding('utf8')
    stdin.on('data', onData)
    stdin.once('end', () => stop('standard input closed'))
    stdin.once('error', () => stop('standard input failed'))
    if (typeof stdin.resume === 'function') stdin.resume()
  })
}

