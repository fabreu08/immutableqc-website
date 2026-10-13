// The command line: iqc <command> [folder] [options]. Options may come before or after the folder; --name value and
// --name=value both work; "--" ends the options.
import { parseHead, isSealedText } from '../../core/immutableqc.mjs'
import { usageError } from './util.mjs'

export const COMMANDS = ['watch', 'seal', 'audit', 'head', 'status', 'help']
const VALUE = ['ledger', 'key', 'station', 'interval', 'settle', 'ignore', 'report', 'json', 'expect-head', 'expect-key']
const FLAG = ['quiet', 'no-color', 'strict', 'help', 'version']
const AUDIT_ONLY = ['report', 'json', 'expect-head', 'expect-key', 'strict']
const PATHS = ['ledger', 'key', 'report', 'json']

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
        if (name === 'ignore') {
          if (val === '') throw usageError('--ignore needs a pattern, for example --ignore "*.bak".')
          opts.ignore.push(val)
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
  if (pos.length > 1) {
    throw usageError(`iqc ${command} takes one folder, but got ${pos.length}: ${pos.map((p) => JSON.stringify(p)).join(' ')}. A path with spaces needs quotes, for example "D:\\Instrument Data".`)
  }
  if (pos.length) folder = cleanPathArg(pos[0], platform)
  if (folder === '') throw usageError('The folder is empty. Give a folder, or leave it out to use the current one.')
  for (const k of AUDIT_ONLY) if (k in opts && command !== 'audit' && command !== null) throw usageError(`--${k} is an option of iqc audit, not of iqc ${command}.`)
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
  for (const g of opts.ignore) if (/[\u0000-\u001f]/.test(g)) throw usageError(`--ignore ${JSON.stringify(g)} holds a control character.`)
  return { command, folder, opts, help, version }
}
