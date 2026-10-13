import test from 'node:test'
import assert from 'node:assert/strict'
import * as IQC from '../immutableqc.mjs'
import { build, fullItems, fullFiles, sha, sessionItem, fileItem, T } from './_helpers.mjs'

const XSS = '<img src=x onerror=alert(1)>'
const L = await build([...fullItems(), fileItem(IQC.encodePath(`${XSS}.csv`), 'x', 'added-unwatched', 200), fileItem(IQC.encodePath('a|b "quoted" & \'single\'\n.csv'), 'y', 'added-unwatched', 201)], { station: 'PC <b>bold</b> & "q"' })
const V = await IQC.verifyLedger(L.text)
const files = fullFiles()
files.set(IQC.encodePath(`${XSS}.csv`), { sha256: sha('changed'), bytes: 7 })
files.set(IQC.encodePath(`not sealed ${XSS}`), { sha256: sha('n'), bytes: 1 })
const R = IQC.audit(V, files, { auditedAt: T(5000), where: 'browser', tool: 'immutableqc-app/0.1.0', folder: 'My <data> folder' })
const H = IQC.renderReportHTML(R)

test('report HTML: self-contained, no script, no external request, a CSP that forbids both', () => {
  assert.match(H, /^<!doctype html><html lang="en"><head><meta charset="utf-8">/)
  assert.ok(!/<script/i.test(H), 'no <script')
  assert.ok(!/\son[a-z]+\s*=/i.test(H.replace(/onerror=alert\(1\)&gt;/g, '')), 'no inline event handler attributes')
  assert.ok(!/(?:src|href|action|srcset|poster|data)\s*=\s*["']?\s*(?:https?:|\/\/)/i.test(H), 'no external URL in an attribute')
  assert.ok(!/@import|url\(/i.test(H), 'no CSS import or url()')
  assert.ok(!/<(?:link|img|iframe|object|embed|video|audio|source|form|base)\b/i.test(H), 'no element that loads anything')
  assert.ok(H.includes(`content="default-src 'none'; style-src 'unsafe-inline'"`))
  assert.ok(H.includes('@media print'))
})

test('report HTML: every string is escaped (a path like <img src=x onerror=alert(1)>)', () => {
  assert.ok(!H.includes(XSS))
  assert.ok(H.includes('&lt;img src=x onerror=alert(1)&gt;.csv'))
  assert.ok(H.includes('not sealed &lt;img src=x onerror=alert(1)&gt;'))
  assert.ok(H.includes('PC &lt;b&gt;bold&lt;/b&gt; &amp; &quot;q&quot;'))
  assert.ok(!H.includes('<b>bold</b>'))
  assert.ok(H.includes('a%7Cb &quot;quoted&quot; &amp; &#39;single&#39;%0A.csv'), 'paths are shown encoded, then escaped')
  assert.ok(H.includes('node iqc.mjs audit &#39;My &lt;data&gt; folder&#39;'))
})

test('report HTML: the sections, in the order of the spec', () => {
  assert.equal(R.verdict, 'fail')
  const order = ['class="verdict fail"', '<h2>Counts</h2>', '<h2>Problems</h2>', '<h2>Notes</h2>', '<h2>Ledger</h2>', '<h2>Watch sessions</h2>', '<h2>Files</h2>', '<h2>Method</h2>', '<h2>How to re-run this audit</h2>']
  const at = order.map((s) => H.indexOf(s))
  assert.ok(at.every((x) => x > 0), JSON.stringify(at))
  assert.deepEqual(at, at.slice().sort((a, b) => a - b))
  assert.match(R.summary, /^Fail: /)
  assert.ok(H.includes(`<span class="word">Fail</span><span class="sentence">${IQC.escapeHTML(R.summary.slice(6, 7).toUpperCase() + R.summary.slice(7))}</span>`), 'the verdict word, then the sentence')
  assert.ok(H.includes('Fail'), 'the verdict in words, not color alone')
  assert.ok(H.includes(V.keyId) && H.includes(V.head.h) && H.includes(L.header.ledgerId))
  assert.ok(H.includes('not sealed</span>'), 'the header context is labeled not sealed')
  assert.ok(H.includes('in a browser') && H.includes('immutableqc-app/0.1.0') && H.includes('immutableqc-ledger version 1'))
  assert.ok(H.includes('matches record 2') === false)
  // every file is listed with its state, size, SHA-256 and version count
  for (const f of R.files) assert.ok(H.includes(IQC.escapeHTML(f.path)), f.path)
  assert.ok(H.includes(`sealed <code>${sha('x')}</code><br>now <code>${sha('changed')}</code>`))
})

test('report HTML: a pass, and a report on the ledger only', async () => {
  const B = await build([sessionItem('watch-started', 1), fileItem('a.csv', 'a', 'existing', 2), sessionItem('watch-stopped', 3)])
  const v = await IQC.verifyLedger(B.text)
  const pass = IQC.renderReportHTML(IQC.audit(v, new Map([['a.csv', { sha256: sha('a'), bytes: 1 }]])))
  assert.ok(pass.includes('class="verdict pass"') && pass.includes('<span class="word">Pass</span><span class="sentence">1 file matches its seal, and the ledger is intact.</span>'))
  assert.ok(pass.includes('<p class="none">None.</p>'))
  const only = IQC.renderReportHTML(IQC.audit(v, null))
  assert.ok(only.includes('The files were not checked: this audit covers the ledger only.'))
})

test('report HTML: no banned wording in what the report says', () => {
  const text = H.replace(/<style>[\s\S]*?<\/style>/, ' ').replace(/<[^>]+>/g, ' ').replace(/Immutable QC|immutableqc/gi, '')
  for (const re of [/\bimmutab(le|ility)\b/i, /guarantee/i, /\bproofs?\b/i, /crypto/i, /complian/i, /trustless/i, /unbreakable/i, /\btokens?\b/i, /cannot be (changed|altered)/i, /labelled/i]) assert.ok(!re.test(text), String(re))
})

test('formatting helpers', () => {
  assert.equal(IQC.formatBytes(0), '0 B')
  assert.equal(IQC.formatBytes(999), '999 B')
  assert.equal(IQC.formatBytes(1000), '1.0 KB')
  assert.equal(IQC.formatBytes('1234567'), '1.2 MB')
  assert.equal(IQC.formatBytes(123456789), '123 MB')
  assert.equal(IQC.formatBytes(999_960_000), '1.0 GB')
  assert.equal(IQC.formatCount(1284), '1,284')
  assert.equal(IQC.formatCount(1234567), '1,234,567')
  assert.equal(IQC.formatDuration(59_000), '59 s')
  assert.equal(IQC.formatDuration(3_540_000), '59 min')
  assert.equal(IQC.formatDuration(86_400_000 + 7_200_000), '1 d 2 h')
  assert.equal(IQC.escapeHTML(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
})
