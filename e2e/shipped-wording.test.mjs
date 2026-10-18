// shipped-wording.test.mjs · no shipped file names a blockchain, a chain or distributed ledger, anchoring on a network, a
// registry, a smart contract or a token (docs/patent-guardrails.md; docs/build-notes/BOT-PROMPTS.md, QA bot).
//
// "Shipped" is what GitHub Pages publishes: every file in the deploy allowlist (site/tools/deploy.mjs manifest()), which
// holds the document set, the landing page (index.html), the app (app/), the design assets (ui/), the site scripts
// (assets/), core/immutableqc.mjs, the one-file agent download/iqc.mjs (the agent bundle) and the alpha console's old
// address. Every text file is read whole: page markup with its attributes and comments, scripts and styles with their
// comments. That is stricter than site/build.mjs (section 7, 7g, 7h), which reads a page's text and a script's string
// literals; both run in CI, so neither can pass while the other fails on the same wording.
//
// The narrow allowances, each the same as site/build.mjs or the founder's decision, and nothing broader:
//   - "blockchain" only in About's question and its answer (build.mjs 7h, BLOCKCHAIN_OK), and on the landing page only
//     as the negation "No blockchain" (BOT-PROMPTS.md section 6, the founder's definition under the H1).
//   - "tokenized": nowhere but index.html, at most twice there (the H1 and its definition), and only while index.html
//     also says "No blockchain" (BOT-PROMPTS.md section 6). The bare word "token" stays banned everywhere.
//   - "coins" only as "No blockchain, no coins." on index.html (the same definition, a sentence of its own).
//   - About's revision history is left out, as build.mjs 7h leaves it out: it records past drafts.
//   - "tokens" in a stylesheet comment means design tokens (CSS custom properties); comments in .css files only.
//   - "crypto": the Web Crypto API in code (crypto.subtle, node:crypto) is not wording, so scripts are read for it as
//     their string literals, as build.mjs does; pages and stylesheets are read whole for any "crypto".
//   - "anchor ... network": a negated clause ("nothing is written to a network") is not a plan to anchor on one, as in
//     build.mjs 7h. "Chain" alone stays allowed: the record history is a hash chain ("chained into a ledger") and the
//     regulatory page cites "chain of custody"; "on-chain", "blockchain" and "chain ID" are banned.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, manifest } from '../site/tools/deploy.mjs'
import { jsStrings } from '../site/tools/jsstrings.mjs'

const TEXT = /\.(?:html|m?js|css|svg|txt)$/

// banned in the whole text of every shipped file (after the allowances below are taken out)
export const RAW = [
  [/\bon[- ]?chain\b|\bchain ?ids?\b|\bdistributed ledgers?\b|\bblock (?:height|explorer)\b|\bgas fees?\b/i, 'a chain or distributed ledger'],
  [/\bregistr(?:y|ies)\b/i, 'a registry'],
  [/\bsmart[- ]contracts?\b/i, 'a smart contract'],
  [/\btokens?\b|\btokenis/i, 'a token'],
  [/\bwallets?\b/i, 'a wallet'],
  [/\bstak(?:e|es|ed|ing)\b/i, 'a stake'],
  [/\bmint(?:s|ed|ing)?\b/i, 'minting'],
  [/\bNFTs?\b/i, 'an NFT'],
  [/\b(?:ethereum|bitcoin|sepolia|metamask|basescan|filecoin|tFIL|testnets?|web3|dapps?)\b/i, 'a chain, network or wallet name'],
]
const ANCHOR = /\banchor\w*\b[^.]{0,80}\bnetworks?\b(?! call)|\bnetworks?\b(?! call)[^.]{0,80}\banchor/i
const unneg = (s) => s.replace(/\b(?:nothing|never|not|no)\b[^,;:.]*/gi, '')
// the landing page's definition (BOT-PROMPTS.md section 6), as site/build.mjs 7h LANDING_OK: a sentence of its own
const LANDING_OK = /^No blockchain(?:, no coins)?\.$/
const BLOCKCHAIN_OK = ['Is my data put on a blockchain?', 'Records never go on a blockchain or a shared ledger: each record history is a signed file the lab keeps.']
const noHistory = (h) => h.replace(/<section class="sec sec--side" id="history"[\s\S]*?<\/section>/g, ' ')
const noSpec = (src) => src.replace(/\b(from|import)(\s*\(?\s*)(['"])[^'"\n]*\3/g, '$1$2$3$3').replace(/\brequire(\s*\(\s*)(['"])[^'"\n]*\2/g, 'require$1$2$2')
const INLINE = /<\/?(?:span|a|b|i|em|strong|code|sub|sup|var|abbr|wbr|nobr)\b[^>]*>/g
const plain = (html) => html.replace(INLINE, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|’/g, "'").replace(/&shy;/g, '').replace(/\s+/g, ' ')
const sentences = (t) => t.split(/(?<=[.!?])\s+/)
const count = (t, re) => (t.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || []).length

// every problem in one shipped file, as "file: what (context)"
export function problems(f, src) {
  const out = []
  const isHTML = /\.(?:html|svg)$/.test(f), isJS = /\.m?js$/.test(f), isCSS = /\.css$/.test(f)
  let raw = f === 'about.html' ? noHistory(src) : src
  if (isCSS) raw = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/\btokens?\b/gi, 'design-vars'))
  const say = (what, re, t) => { const m = t.match(re); const i = m ? m.index : 0; out.push(`${f}: names ${what} (${t.slice(Math.max(0, i - 40), i + 60).replace(/\s+/g, ' ')})`) }
  for (const [re, what] of RAW) if (re.test(raw)) say(what, re, raw)
  // the prose a reader sees: page text, or a script's strings and comments (its code read whole above)
  const prose = isHTML ? plain(raw) : raw
  for (const s of sentences(prose)) if (ANCHOR.test(unneg(s))) out.push(`${f}: names anchoring on a network (${s.slice(0, 120)})`)
  // crypto: pages and stylesheets whole, scripts by their string literals
  const cryptoText = isJS ? jsStrings(noSpec(raw)).join('\n') : raw
  if (isJS ? /\bcrypto\b|cryptocurrenc/i.test(cryptoText) : /crypto/i.test(cryptoText)) say('"crypto"', /crypto/i, cryptoText)
  // blockchain: only in the allowed sentences; every other occurrence (an attribute, a comment, a script) fails
  const nBlock = count(raw, /blockchain/gi)
  let okBlock = 0
  if (f === 'about.html') for (const s of BLOCKCHAIN_OK) okBlock += prose.split(s).length - 1
  const landing = f === 'index.html' ? sentences(prose).map((x) => x.trim()).filter((x) => LANDING_OK.test(x)) : []
  okBlock += landing.length
  if (nBlock > okBlock) say('a blockchain (outside the allowed About question and answer, and "No blockchain" on the landing page)', /blockchain/i, raw)
  // tokenized: index.html only, at most twice, and only beside "No blockchain"
  const nTok = count(raw, /tokeniz/gi)
  if (nTok && f !== 'index.html') say('"tokenized" (allowed on the landing page only)', /tokeniz/i, raw)
  if (f === 'index.html' && nTok > 2) out.push(`${f}: "tokenized" ${nTok} times (at most twice: the H1 and its definition)`)
  if (f === 'index.html' && nTok && !landing.length) out.push(`${f}: "tokenized" without "No blockchain" on the page`)
  // coins: only "no coins", on the landing page
  const nCoin = count(raw, /\bcoins?\b/gi), okCoin = landing.filter((x) => /coins/.test(x)).length
  if (nCoin > okCoin) say('coins (only "no coins" on the landing page)', /\bcoins?\b/i, raw)
  return out
}

test('shipped files: no blockchain, chain or distributed ledger, network anchoring, registry, smart contract or token', () => {
  const files = manifest().filter((f) => TEXT.test(f))
  for (const need of ['index.html', 'app/index.html', 'core/immutableqc.mjs', 'download/iqc.mjs', 'about.html']) assert.ok(files.includes(need), `the deploy allowlist publishes ${need}`)
  assert.ok(files.some((f) => f.startsWith('ui/')) && files.some((f) => f.startsWith('app/') && f.endsWith('.mjs')), 'the deploy allowlist publishes ui/ and the app scripts')
  const found = files.flatMap((f) => problems(f, readFileSync(join(ROOT, f), 'utf8')))
  assert.deepEqual(found, [], `banned wording in ${found.length} place(s) of what GitHub Pages publishes:\n  ${found.join('\n  ')}`)
})

test('shipped-wording lint: catches what it is for, and passes the wording that stays', () => {
  const page = (body) => `<!doctype html><html><head><title>t</title></head><body><p>${body}</p></body></html>`
  const mustFail = [
    ['overview.html', page('Records would go on-chain.')],
    ['overview.html', page('Heads are anchored on a public network every hour.')],
    ['overview.html', page('A shared registry anyone could check.')],
    ['overview.html', page('The smart contract is written.')],
    ['overview.html', page('Each record is a token.')],
    ['overview.html', page('Lab data, tokenized.')],
    ['app/app.mjs', "const s = 'Your data, tokenized.'"],
    ['index.html', page('Lab data, tokenized. Records that verify themselves.')],
    ['index.html', page('Lab data, tokenized. Tokenized again. Tokenized thrice. No blockchain.')],
    ['index.html', page('Built on a blockchain.')],
    ['index.html', page('No blockchain. Earn coins.')],
    ['index.html', page('Lab data, tokenized. There is no blockchain here.')],
    ['index.html', page('No blockchain, no coins, no chain ID.')],
    ['about.html', page('Is my data put on a blockchain? Yes, on a blockchain.')],
    ['index.html', '<!doctype html><html><body><p title="blockchain">No blockchain.</p></body></html>'],
    ['app/app.mjs', '// connect a wallet here\nconst x = 1'],
    ['ui/theme.css', '.a { color: red } /* the stake */'],
    ['ui/theme.css', '.token-sale { color: red }'],
    ['core/immutableqc.mjs', "const m = 'cryptocurrency'"],
    ['overview.html', page('Uses cryptographic signatures.')],
    ['download/iqc.mjs', "const n = 'Mint an NFT on Sepolia'"],
  ]
  for (const [f, src] of mustFail) assert.ok(problems(f, src).length > 0, `caught: ${f}: ${src.slice(0, 120)}`)
  const mustPass = [
    ['index.html', page('Lab data, tokenized. Records that verify themselves.</p><p>Every file is tokenized the moment it is written: its SHA-256 fingerprint stands in for it, signed and chained to the one before. No blockchain, no coins. Anyone can check it, and nothing leaves your lab.')],
    ['index.html', page('Each new or changed file gets a SHA-256 fingerprint and a signature, chained into a ledger inside that folder.')],
    ['regulatory.html', page('Sample receipt, chain of custody and holding times are documented.')],
    ['regulatory.html', page('A simulated anchor on these pages; nothing is written to a network.')],
    ['check.html', page('Anchored fingerprint (simulated, no network call): the link of record 8.')],
    ['about.html', page('<span>5.3</span> Is my data put on a blockchain?</p><p>Records never go on a blockchain or a shared ledger: each record history is a signed file the lab keeps.')],
    ['about.html', page('Now.</p><section class="sec sec--side" id="history"><p>Draft 7 named a registry and a test network.</p></section><p>End.')],
    ['ui/theme.css', '/* tokens and components */ :root { --a: 1px }'],
    ['core/immutableqc.mjs', "import * as c from 'node:crypto'\nconst d = globalThis.crypto.subtle.digest('SHA-256', b)"],
  ]
  for (const [f, src] of mustPass) assert.deepEqual(problems(f, src), [], `passes: ${f}: ${src.slice(0, 120)}`)
})
