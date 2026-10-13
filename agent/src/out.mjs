// What the agent prints: short human lines on standard output, warnings and errors on standard error. Colors only on a
// terminal, and never with --no-color or NO_COLOR (https://no-color.org: set and not empty). --quiet prints only
// problems (warnings and errors).
import { clock } from './util.mjs'

const SGR = { red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, gray: 90, bold: 1, dim: 2 }

export function colorWanted(stream, { noColor = false, env = process.env } = {}) {
  if (noColor) return false
  if (typeof env.NO_COLOR === 'string' && env.NO_COLOR !== '') return false
  return !!(stream && stream.isTTY)
}

const _guarded = new WeakSet()
function guard(stream) {
  // a closed pipe (iqc watch | head) is not an error worth a crash
  if (stream && typeof stream.on === 'function' && !_guarded.has(stream)) {
    _guarded.add(stream)
    stream.on('error', (e) => { if (e && e.code !== 'EPIPE') throw e })
  }
}

export class Out {
  constructor({ quiet = false, noColor = false, env = process.env, stdout = process.stdout, stderr = process.stderr, stamp = false } = {}) {
    this.quiet = quiet
    this.stdout = stdout
    this.stderr = stderr
    this.color = colorWanted(stdout, { noColor, env })
    this.ecolor = colorWanted(stderr, { noColor, env })
    this.stamp = stamp
    this.warnings = 0
    this.progressShown = false
    this.progressAt = 0
    guard(stdout)
    guard(stderr)
  }

  paint(name, s) { return this.color ? `\x1b[${SGR[name]}m${s}\x1b[0m` : s }
  epaint(name, s) { return this.ecolor ? `\x1b[${SGR[name]}m${s}\x1b[0m` : s }

  _out(s) { this.clearProgress(); this.stdout.write(s + '\n') }
  _err(s) { this.clearProgress(); this.stderr.write(s + '\n') }

  // a line of normal output (not with --quiet)
  print(s = '') { if (!this.quiet) this._out(s) }
  // output that is the point of the command (iqc head), printed even with --quiet
  result(s) { this._out(s) }
  // a detail on standard error (not with --quiet), for commands whose standard output is meant for a program
  note(s) { if (!this.quiet) this._err(s) }
  warn(s) {
    this.warnings++
    this._err(`${this.epaint('yellow', 'warning')}  ${s}`)
  }
  error(s) { this._err(`${this.epaint('red', 'error')}  ${s}`) }

  // one record or event: "sealed  QC/run-0914/injection-06.csv  1.2 MB  eb1690bc…"
  event(word, color, text, { problem = false } = {}) {
    const line = `${this.stamp ? this.paint('dim', clock()) + ' ' : ''}${this.paint(color, word.padEnd(9))}${text}`
    if (problem) this._err(line)
    else this.print(line)
  }

  // a progress line on a terminal's standard error, rewritten in place (at most 10 times a second)
  progress(s) {
    if (this.quiet || !this.stderr.isTTY) return
    const now = Date.now()
    if (now - this.progressAt < 100) return
    this.progressAt = now
    const cols = this.stderr.columns || 80
    this.stderr.write(`\r${s.length >= cols ? s.slice(0, cols - 2) + '…' : s}\x1b[K`)
    this.progressShown = true
  }

  clearProgress() {
    if (this.progressShown) { this.stderr.write('\r\x1b[K'); this.progressShown = false }
  }
}
