// The command line: iqc <command> [folder] [options]. Options may come before or after the folder; --name value and
// --name=value both work; "--" ends the options.
import { parseHead, isSealedText } from '../../core/immutableqc.mjs'
import { usageError } from './util.mjs'

export const COMMANDS = ['watch', 'seal', 'audit', 'head', 'status', 'record', 'trace', 'review', 'mcp', 'help']
const VALUE = ['ledger', 'key', 'station', 'interval', 'settle', 'ignore', 'report', 'json', 'expect-head', 'expect-key', 'allow-changes', 'pin-file',
  'root', 'actor', 'action', 'tool', 'in', 'out', 'in-ref', 'search', 'reviewer', 'decision', 'note']
const FLAG = ['quiet', 'no-color', 'strict', 'help', 'version']
// options that may be given more than once (a list); --ledger is a list only for iqc audit
const REPEAT = ['ignore', 'allow-changes', 'in', 'out', 'in-ref', 'search', 'ledger']
const PATHS = ['ledger', 'key', 'report', 'json', 'pin-file', 'root', 'in', 'out', 'search']
// the options of each command (--quiet, --no-color, --help and --version go with every command)
const OLD = ['ledger', 'key', 'station', 'interval', 'settle', 'ignore']
const OPTIONS = {
  watch: [...OLD, 'pin-file'],
  seal: [...OLD, 'pin-file'],
  audit: [...OLD, 'report', 'json', 'expect-head', 'expect-key', 'strict', 'allow-changes', 'pin-file'],
  head: OLD,
  status: OLD,
  record: ['root', 'actor', 'action', 'tool', 'in', 'out', 'in-ref', 'search', 'ledger', 'key', 'station', 'json', 'pin-file'],
  trace: ['search', 'json', 'ignore'],
  review: ['reviewer', 'decision', 'note', 'search', 'ledger', 'key', 'station', 'json', 'pin-file'],
  mcp: ['root', 'actor', 'tool', 'search', 'ledger', 'key', 'station', 'pin-file', 'ignore', 'allow-changes'],
}
const ALWAYS = ['quiet', 'no-color', 'help', 'version']
const owners = (name) => Object.keys(OPTIONS).filter((c) => OPTIONS[c].includes(name))
const orList = (a) => (a.length <= 2 ? a.join(' and ') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`)

// Windows: a quoted folder that ends in a backslash ("D:\Results\") reaches the program as D:\Results" (the backslash
// escapes the quote), and a path quoted with single quotes in cmd.exe keeps its quotes. Both are cleaned up here, on
// Windows only (elsewhere a quote is a legal file name character).
export function cleanPathArg(s, platform = process.platform) {
  if (typeof s !== 'string' || platform !== 'win32') return s
  let t = s.trim()
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) t = t.slice(1, -1)
  else if (t.endsWith('"') && !t.slice(0, -1).includes('"')) t = t.slice(0, -1)
  return t
}

function seconds(name, v, { min, max }) {
  const n = Number(String(v).trim())
  if (String(v).trim() === '' || !Number.isFinite(n) || n < min || n > max) throw usageError(`--${name} takes a number of seconds from ${min} to ${max}, not ${JSON.stringify(v)}.`)
  return n
}

export function stationProblem(s) {
  if (typeof s !== 'string' || s.length === 0) return 'it is empty'
  if (!isSealedText(s)) return 'it holds "|" or a control character'
  if ([...s].length > 64) return 'it is longer than 64 characters'
  return null
}

// -> { command, folder, opts, help, version }
export function parseArgs(argv, { platform = process.platform } = {}) {
  const opts = { ignore: [] }
  const pos = []
  let help = false, version = false, ended = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!ended && a === '--') { ended = true; continue }
    if (!ended && a.startsWith('--')) {
      let name = a.slice(2), val
      const eq = name.indexOf('=')
      if (eq >= 0) { val = name.slice(eq + 1); name = name.slice(0, eq) }
      if (VALUE.includes(name)) {
        if (val === undefined) {
          if (i + 1 >= argv.length) throw usageError(`--${name} needs a value.`)
          val = argv[++i]
        }
        if (name === 'ignore' || name === 'allow-changes') {
          if (val === '') throw usageError(`--${name} needs a pattern, for example --${name} "*.bak".`)
          ;(opts[name] ||= []).push(val)
        } else if (REPEAT.includes(name)) {
          if (val === '') throw usageError(`--${name} needs a value.`)
          ;(opts[name] ||= []).push(PATHS.includes(name) ? cleanPathArg(val, platform) : val)
        } else {
          if (name in opts) throw usageError(`--${name} is given twice.`)
          opts[name] = PATHS.includes(name) ? cleanPathArg(val, platform) : val
        }
      } else if (FLAG.includes(name)) {
        if (val !== undefined) throw usageError(`--${name} takes no value.`)
        if (name === 'help') help = true
        else if (name === 'version') version = true
        else opts[name] = true
      } else {
        throw usageError(`Unknown option --${name}. Run "iqc help" for the options.`)
      }
    } else if (!ended && (a === '-h' || a === '-?')) help = true
    else if (!ended && (a === '-v' || a === '-V')) version = true
    else if (!ended && a.length > 1 && a.startsWith('-')) throw usageError(`Unknown option ${a}. Run "iqc help" for the options.`)
    else pos.push(a)
  }
  const command = pos.length ? pos.shift() : null
  if (command !== null && !COMMANDS.includes(command)) {
    throw usageError(`Unknown command ${JSON.stringify(command)}. The commands are: ${COMMANDS.join(', ')}. Run "iqc help".`)
  }
  let folder = null
  if (command === 'help') {
    if (pos.length > 1) throw usageError('iqc help takes at most one command name.')
    folder = pos.length ? pos[0] : null
    return { command, topic: folder, folder: null, opts, help: true, version }
  }
  if (command !== null) {
    for (const k of Object.keys(opts)) {
      if (ALWAYS.includes(k) || OPTIONS[command].includes(k) || (k === 'ignore' && !opts.ignore.length)) continue
      const o = owners(k)
      throw usageError(`--${k} is an option of ${orList(o.map((c) => `iqc ${c}`))}, not of iqc ${command}.`)
    }
  }
  if (opts.ledger) {
    if (command !== 'audit' && opts.ledger.length > 1) throw usageError(`--ledger is given twice. Only iqc audit takes more than one ledger.`)
    if (command === 'audit') opts.ledgers = opts.ledger
    opts.ledger = opts.ledger[0]
  }
  let subjects = null, file = null
  if (command === 'review') {
    subjects = pos.splice(0)
  } else if (command === 'trace') {
    if (pos.length !== 1) throw usageError(`iqc trace takes one file${pos.length ? `, but got ${pos.length}` : ''}: iqc trace <file> [--search <folder>].`)
    file = cleanPathArg(pos.shift(), platform)
    if (file === '') throw usageError('The file is empty. Give the file to trace.')
  } else if ((command === 'record' || command === 'mcp') && pos.length) {
    throw usageError(`iqc ${command} takes no folder: give it with --root <folder> (the default is the current folder), not ${JSON.stringify(pos[0])}.`)
  }
  if (pos.length > 1) {
    throw usageError(`iqc ${command} takes one folder, but got ${pos.length}: ${pos.map((p) => JSON.stringify(p)).join(' ')}. A path with spaces needs quotes, for example "D:\\Instrument Data".`)
  }
  if (pos.length) folder = cleanPathArg(pos[0], platform)
  if (folder === '') throw usageError('The folder is empty. Give a folder, or leave it out to use the current one.')
  if ('interval' in opts) opts.interval = seconds('interval', opts.interval, { min: 0.05, max: 86400 })
  if ('settle' in opts) opts.settle = seconds('settle', opts.settle, { min: 0, max: 86400 })
  if ('station' in opts) {
    const why = stationProblem(opts.station)
    if (why) throw usageError(`--station ${JSON.stringify(opts.station)} cannot be used: ${why}. A station name is 1 to 64 characters, with no "|" and no control character.`)
  }
  if ('expect-head' in opts) {
    try { opts['expect-head'] = parseHead(opts['expect-head']) } catch {
      throw usageError(`--expect-head ${JSON.stringify(opts['expect-head'])} is not a head. A head is written <record number>:<64 hex link>, as iqc head prints it.`)
    }
  }
  if ('expect-key' in opts) {
    const k = String(opts['expect-key']).trim()
    if (!/^[0-9a-fA-F]{16}$/.test(k)) throw usageError(`--expect-key ${JSON.stringify(opts['expect-key'])} is not a key id. A key id is 16 hex characters, as iqc head and iqc status print it.`)
    opts['expect-key'] = k.toLowerCase()
  }
  for (const k of ['ignore', 'allow-changes']) for (const g of opts[k] || []) if (/[\u0000-\u001f]/.test(g)) throw usageError(`--${k} ${JSON.stringify(g)} holds a control character.`)
  if (command === 'record') {
    for (const k of ['actor', 'action']) if (!(k in opts)) throw usageError(`iqc record needs --${k}. For example: iqc record --actor analysis-agent --action "Normalized plate 07" --in plate-07.csv --out plate-07-normalized.csv`)
    if (!(opts.out || []).length) throw usageError('iqc record needs at least one --out <file>: the file (or files) the step wrote.')
  }
  if (command === 'review') {
    if (!('reviewer' in opts)) throw usageError('iqc review needs --reviewer <name>: your name or initials, as it goes in the record.')
    if (!('decision' in opts)) throw usageError('iqc review needs --decision approved, question or rejected.')
    if (!subjects.length) throw usageError('iqc review needs the records it signs off, as <ledger id>:<record number>, for example 78f00a005a55fdf7162daf82f89fab15:3 (iqc record and iqc audit --json print them).')
  }
  return { command, folder, file, subjects, opts, help, version }
}
