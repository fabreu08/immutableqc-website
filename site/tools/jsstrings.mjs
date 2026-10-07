// jsstrings.mjs · every string literal in a JavaScript source, for the copy lint (runtime strings a visitor can see).
// A small scanner, not a parser: it skips comments and regular-expression literals, reads '…' and "…" strings, and
// reads the static parts of `…${…}…` templates (nested templates and braces inside ${…} are tracked). Code, identifiers
// and property names (crypto.subtle, say) are not strings and are never reported.
const REGEX_AFTER = /^(?:[(,=:[!&|?{;+\-*%<>~^]|return|typeof|case|in|of|new|delete|void|throw|else|do|yield|await|)$/

export function jsStrings(src) {
  const out = [], tstack = []
  const N = src.length
  let i = 0, depth = 0, prev = ''
  const readTemplate = () => {
    let s = ''
    while (i < N) {
      const c = src[i]
      if (c === '\\') { s += src[i + 1] || ''; i += 2; continue }
      if (c === '`') { i++; out.push(s); prev = 'str'; return }
      if (c === '$' && src[i + 1] === '{') { out.push(s); i += 2; tstack.push(depth); depth++; prev = '{'; return }
      s += c; i++
    }
    out.push(s)
  }
  while (i < N) {
    const c = src[i], d = src[i + 1]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue }
    if (c === '/' && d === '/') { while (i < N && src[i] !== '\n') i++; continue }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? N : e + 2; continue }
    if (c === "'" || c === '"') {
      let s = ''
      i++
      while (i < N && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') { s += src[i + 1] || ''; i += 2 } else s += src[i++] }
      i++
      out.push(s); prev = 'str'; continue
    }
    if (c === '`') { i++; readTemplate(); continue }
    if (c === '/') {
      if (REGEX_AFTER.test(prev)) {
        i++
        let cls = false
        while (i < N) { const ch = src[i]; if (ch === '\\') { i += 2; continue } if (ch === '[') cls = true; else if (ch === ']') cls = false; else if ((ch === '/' && !cls) || ch === '\n') break; i++ }
        i++
        while (i < N && /[a-z]/i.test(src[i])) i++
        prev = 'regex'; continue
      }
      i++; prev = '/'; continue
    }
    if (c === '{') { depth++; i++; prev = '{'; continue }
    if (c === '}') {
      depth--; i++
      if (tstack.length && depth === tstack[tstack.length - 1]) { tstack.pop(); readTemplate(); continue }
      prev = '}'; continue
    }
    if (/[\w$]/.test(c)) { let w = ''; while (i < N && /[\w$]/.test(src[i])) w += src[i++]; prev = w; continue }
    prev = c; i++
  }
  return out
}
