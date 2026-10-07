/* console.js · Immutable QC alpha console (demo).
   Runs only in this browser, on synthetic data, and makes no network calls. One classic deferred script, no
   dependencies. The page's shell, status line and disclaimer are plain HTML; this script renders the demo lab.

   Record construction (the same as the site, and the alpha app's payload for an imported HPLC peak):
     payload  instrumentId|sensorType|value|unit|capturedAt, as UTF-8
     r_n      SHA-256(payload), lowercase hex
     h_n      SHA-256 of the text: h_(n-1) in hex, r_n in hex, n in decimal. h_0 is 64 zeros
     sig_n    ECDSA P-256 with SHA-256 over the 32 bytes of r_n, IEEE P1363 hex. The key pair is generated in this
              browser (private key not extractable) and kept in IndexedDB; a new pair if that storage is unavailable.
   Checks, run after every change, with the same rule as the site's pages: each record's fingerprint (a field holding
   "|" or a control character fails it); its signature over the recomputed fingerprint (where this browser holds a key,
   a missing signature, or one not in its low-S form, fails); and its link: SHA-256 of the previous link it stores, its
   recomputed fingerprint and n, against the link it stores, which the next record carries as its previous link. A
   changed value therefore fails its own fingerprint, signature and link, and the next record still passes its own
   checks. Anchors are compared with a full replay from 64 zeros.
   Motion: none. No animation frames, no repeating timers, nothing that runs at rest. */
(function () {
  'use strict'
  var D = document, W = window
  var ZERO = '0000000000000000000000000000000000000000000000000000000000000000'
  var FIELDS = ['instrumentId', 'sensorType', 'value', 'unit', 'capturedAt']
  var MAX = 40

  // The site's demo sequence SEQ-0914-02 (synthetic, vendor-neutral): five system-suitability injections of the
  // reference standard, then three sample injections of a fictional product, on HPLC-02. Same values and capture
  // times as the site's Check a record page. [injection, kind, sample, description, peak area, RT (min), captured]
  var SEQ = [
    ['01', 'SST', 'STD-A', 'Reference standard, 0.20 mg/mL, replicate 1', '1523847', '4.82', '2026-09-14T08:12:41Z'],
    ['02', 'SST', 'STD-A', 'Reference standard, 0.20 mg/mL, replicate 2', '1519962', '4.81', '2026-09-14T08:19:43Z'],
    ['03', 'SST', 'STD-A', 'Reference standard, 0.20 mg/mL, replicate 3', '1527410', '4.82', '2026-09-14T08:26:44Z'],
    ['04', 'SST', 'STD-A', 'Reference standard, 0.20 mg/mL, replicate 4', '1521188', '4.83', '2026-09-14T08:33:47Z'],
    ['05', 'SST', 'STD-A', 'Reference standard, 0.20 mg/mL, replicate 5', '1525603', '4.82', '2026-09-14T08:40:49Z'],
    ['06', 'Sample', 'P200-S1', 'Product 200 mg tablets, preparation 1', '1508811', '4.82', '2026-09-14T08:47:50Z'],
    ['07', 'Sample', 'P200-S2', 'Product 200 mg tablets, preparation 2', '1531274', '4.81', '2026-09-14T08:54:52Z'],
    ['08', 'Sample', 'P200-S3', 'Product 200 mg tablets, preparation 3', '1516039', '4.82', '2026-09-14T09:01:55Z']
  ]
  var SEQ_ID = 'SEQ-0914-02'
  // h_8 of that sequence: the site's anchored fingerprint (simulated). The demo lab starts with it as its first
  // anchor, so if this browser's replay of records 1 to 8 did not reach it, the page would say so at once.
  var SITE_ANCHOR = '0a35688a4c3ec82a5e621cede1f173a6d436ade0e20f159dca92c2a3711e3dc1'
  // Demo instruments. cal: [days since the last calibration, days until the next], always relative to today.
  var INST = [
    { id: 'HPLC-02', name: 'HPLC', type: 'hplc', unit: 'counts', what: 'Peak area, main peak', cal: [12, 18] },
    { id: 'LCMS-01', name: 'LC-MS', type: 'lcms', unit: 'counts', what: 'Peak area, quantifier ion', cal: [40, 50] },
    { id: 'PH-01', name: 'Bench pH meter', type: 'ph', unit: 'pH', what: 'Buffer pH at 25 °C', cal: [0, 1] },
    { id: 'TEMP-01', name: 'Room temperature monitor', type: 'temperature', unit: '°C', what: 'Lab room temperature', cal: [100, 265] }
  ]
  var NUM = /^-?\d{1,12}(\.\d{1,6})?$/
  // a sealed field never holds the payload's separator or a control character (two records could then give one payload)
  var SEP = /[|\u0000-\u001f\u007f]/
  function sepIn (f) { return FIELDS.some(function (k) { return SEP.test(String(f[k])) }) }
  // ECDSA signatures in their one low-S form: the high-S twin of any signature also verifies, so it is refused
  var P256_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551')
  function sigForm (h) { return typeof h === 'string' && /^[0-9a-f]{128}$/.test(h) && BigInt('0x' + h.slice(64)) * BigInt(2) < P256_N && BigInt('0x' + h.slice(64)) > BigInt(0) }
  function lowS (h) { var s = BigInt('0x' + h.slice(64)); return s * BigInt(2) < P256_N ? h : h.slice(0, 64) + (P256_N - s).toString(16).padStart(64, '0') }

  // ---------------------------------------------------------------- hashing and signing
  var C = W.crypto
  var S = C && C.subtle && W.isSecureContext !== false ? C.subtle : null
  var enc = new TextEncoder()
  var GEN = { name: 'ECDSA', namedCurve: 'P-256' }
  var SIG = { name: 'ECDSA', hash: 'SHA-256' }
  function hex (buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16); return s }
  function bytes (h) { var b = new Uint8Array(h.length >> 1); for (var i = 0; i < b.length; i++) b[i] = parseInt(h.substr(2 * i, 2), 16); return b }
  function sha (s) { return S ? S.digest('SHA-256', enc.encode(s)).then(hex, function () { return sha256(s) }) : Promise.resolve(sha256(s)) }

  // FIPS 180-4 SHA-256 in plain JS, used only where the browser's digest is unavailable (a page served without
  // https). UTF-8 string in, lowercase hex out. Adapted from joseqc.com's sha256.js.
  var K = new Uint32Array(64), H0 = new Uint32Array(8)
  for (var c0 = 2, n0 = 0; n0 < 64; c0++) {
    var pr = 1
    for (var d0 = 2; d0 * d0 <= c0; d0++) if (c0 % d0 === 0) { pr = 0; break }
    if (!pr) continue
    if (n0 < 8) H0[n0] = (Math.pow(c0, 0.5) % 1) * 4294967296
    K[n0++] = (Math.pow(c0, 1 / 3) % 1) * 4294967296
  }
  function ror (x, n) { return (x >>> n) | (x << (32 - n)) }
  function sha256 (str) {
    var m = enc.encode(str), L = m.length, N = (L + 72) >> 6
    var M = new Uint32Array(N * 16), w = new Uint32Array(64), h = H0.slice(), i, j
    for (i = 0; i < L; i++) M[i >> 2] |= m[i] << (24 - (i & 3) * 8)
    M[L >> 2] |= 0x80 << (24 - (L & 3) * 8)
    M[N * 16 - 1] = L * 8
    for (j = 0; j < M.length; j += 16) {
      for (i = 0; i < 64; i++) {
        if (i < 16) { w[i] = M[j + i]; continue }
        var a0 = w[i - 15], b0 = w[i - 2]
        w[i] = (ror(a0, 7) ^ ror(a0, 18) ^ (a0 >>> 3)) + w[i - 7] + (ror(b0, 17) ^ ror(b0, 19) ^ (b0 >>> 10)) + w[i - 16]
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7]
      for (i = 0; i < 64; i++) {
        var t1 = (k + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0
        var t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
        k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
      }
      h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += k
    }
    return Array.prototype.map.call(h, function (x) { return ('0000000' + x.toString(16)).slice(-8) }).join('')
  }

  // The demo key: one ECDSA P-256 pair per browser, kept in IndexedDB so later visits reuse it.
  var key = null // { priv, pub, id, raw, kept }
  function idb (fn) {
    return new Promise(function (ok, no) {
      var req
      try { req = W.indexedDB.open('iqc-console', 1) } catch (e) { no(e); return }
      req.onupgradeneeded = function () { req.result.createObjectStore('keys') }
      req.onerror = function () { no(req.error) }
      req.onblocked = function () { no(new Error('storage blocked')) }
      req.onsuccess = function () {
        var db = req.result, tx, r
        try { tx = db.transaction('keys', 'readwrite'); r = fn(tx.objectStore('keys')) } catch (e) { db.close(); no(e); return }
        tx.oncomplete = function () { db.close(); ok(r && r.result) }
        tx.onerror = tx.onabort = function () { db.close(); no(tx.error) }
      }
    })
  }
  async function getKey (fresh) {
    if (!S) return null
    var kp = null, kept = false
    // Reset makes a new key: the old pair is deleted from this browser first
    if (fresh) { try { await idb(function (s) { return s.delete('demo-key-v1') }) } catch (e) { /* storage unavailable */ } }
    else { try { kp = await idb(function (s) { return s.get('demo-key-v1') }) } catch (e) { kp = null } }
    var usable = kp && kp.privateKey && kp.publicKey && kp.privateKey.algorithm && kp.privateKey.algorithm.namedCurve === 'P-256'
    if (usable) kept = true
    else {
      kp = await S.generateKey(GEN, false, ['sign', 'verify'])
      try { await idb(function (s) { return s.put({ privateKey: kp.privateKey, publicKey: kp.publicKey }, 'demo-key-v1') }); kept = true } catch (e) { kept = false }
    }
    var spki = await S.exportKey('spki', kp.publicKey), raw = await S.exportKey('raw', kp.publicKey)
    return { priv: kp.privateKey, pub: kp.publicKey, id: hex(await S.digest('SHA-256', spki)).slice(0, 32).toUpperCase(), raw: hex(raw), kept: kept }
  }

  // ---------------------------------------------------------------- the demo lab
  var recs = [], anchors = [], res = null, sel = 8, view = 'records', sim = null, busy = false
  var form = { inst: 'HPLC-02', value: '', fix: '', why: '' }, errs = {}, recipeOpen = false, simNote = null
  function payload (f) { return FIELDS.map(function (k) { return f[k] }).join('|') }
  function nowISO () { return new Date().toISOString().replace(/\.\d+Z$/, 'Z') }
  function inst (id) { for (var i = 0; i < INST.length; i++) if (INST[i].id === id) return INST[i]; return INST[0] }
  function suggest (id, n) {
    var t = inst(id).type
    if (t === 'hplc') return String(1506000 + ((n * 7919) % 26000))
    if (t === 'lcms') return String(48200 + ((n * 4513) % 3600))
    if (t === 'ph') return (7 + (((n * 37) % 9) - 4) / 100).toFixed(2)
    return (21 + (((n * 53) % 13) - 6) / 10).toFixed(1)
  }

  async function seal (f, prev, n, extra) {
    var r = await sha(payload(f)), h = await sha(prev + r + n)
    var sig = key ? lowS(hex(await S.sign(SIG, key.priv, bytes(r)))) : ''
    var x = { n: n, f: f, r: r, prev: prev, h: h, sig: sig, ctx: null, corrects: 0, reason: '', at: '' }
    for (var k in extra) x[k] = extra[k]
    x.sealed = { value: f.value, r: r, prev: prev, h: h }
    return x
  }
  async function reseed () {
    var out = [], prev = ZERO
    for (var i = 0; i < SEQ.length; i++) {
      var s = SEQ[i]
      var x = await seal({ instrumentId: 'HPLC-02', sensorType: 'hplc', value: s[4], unit: 'counts', capturedAt: s[6] }, prev, i + 1,
        { ctx: { inj: s[0], kind: s[1], sample: s[2], desc: s[3], rt: s[5] } })
      out.push(x)
      prev = x.h
    }
    recs = out
    anchors = [{ N: SEQ.length, h: SITE_ANCHOR, seeded: true, at: '' }]
    sel = SEQ.length
    sim = null
    simNote = null
    form.fix = ''; form.why = ''; form.value = ''
    errs = {}
  }

  // One check of the whole history: every fingerprint, signature and link, then a full replay for the anchors.
  async function check () {
    var t0 = performance.now()
    var rp = await Promise.all(recs.map(function (x) { return sha(payload(x.f)) }))
    var hp = await Promise.all(recs.map(function (x, i) { return sha(x.prev + rp[i] + (i + 1)) }))
    var full = [], p = ZERO
    for (var i = 0; i < recs.length; i++) { p = await sha(p + rp[i] + (i + 1)); full.push(p) }
    var sg = await Promise.all(recs.map(function (x, i) {
      if (!key) return null
      if (!sigForm(x.sig)) return false
      return S.verify(SIG, key.pub, bytes(x.sig), bytes(rp[i])).catch(function () { return false })
    }))
    var rows = recs.map(function (x, i) {
      var sep = sepIn(x.f), fp = rp[i] === x.r && !sep, nx = recs[i + 1]
      // its own link, as on the site: the newest record's stored link is checked too
      var link = hp[i] === x.h && (!nx || nx.prev === x.h) && (i > 0 || x.prev === ZERO)
      return { x: x, n: i + 1, rp: rp[i], hp: hp[i], full: full[i], fp: fp, sep: sep, sig: sg[i], nosig: !!key && !x.sig, link: link, ok: fp && link && sg[i] !== false }
    })
    var an = anchors.map(function (a) { return { a: a, ok: a.N <= rows.length && full[a.N - 1] === a.h } })
    res = { rows: rows, an: an, ms: performance.now() - t0, at: new Date() }
    return res
  }

  // ---------------------------------------------------------------- words, all from the check's results
  function topAnchored () { return anchors.reduce(function (m, a) { return Math.max(m, a.N) }, 0) }
  function range (a, b) { return a === b ? 'record ' + a : 'records ' + a + (b === a + 1 ? ' and ' : ' to ') + b }
  function Range (a, b) { var s = range(a, b); return s.charAt(0).toUpperCase() + s.slice(1) }
  function anchorState () {
    if (!res.an.length) return { s: 'na', w: 'not anchored' }
    var bad = res.an.filter(function (o) { return !o.ok })
    if (bad.length) return { s: 'bad', w: 'simulated anchor does not match', N: bad[0].a.N }
    return { s: 'ok', w: 'simulated anchor matches (' + range(1, topAnchored()) + ')', N: topAnchored() }
  }
  // the broken links, named by the records they join ("6→7"), as on the site; the newest record has no next record
  function brokenLinks () { var n = res.rows.length; return res.rows.filter(function (r) { return !r.link && r.n < n }).map(function (r) { return r.n + '→' + (r.n + 1) }) }
  function statusLine () {
    var rows = res.rows, n = rows.length
    var ok = rows.filter(function (r) { return r.ok }).length
    var parts = ['Checked in your browser: ' + ok + ' of ' + n + ' records pass' + (key ? '' : ' the fingerprint and link checks')]
    var changed = rows.filter(function (r) { return !r.fp }).length
    if (changed) parts.push(changed + ' changed')
    var sigBad = rows.filter(function (r) { return r.fp && r.sig === false }).length
    if (sigBad) parts.push(sigBad + (sigBad === 1 ? ' signature fails' : ' signatures fail'))
    var lk = brokenLinks()
    if (lk.length) parts.push((lk.length === 1 ? 'link ' : 'links ') + lk.join(', ') + ' broken')
    parts.push(anchorState().w)
    var top = topAnchored()
    if (n > top) parts.push(range(top + 1, n) + ' not yet anchored')
    if (!key) parts.push('signatures not checked here')
    return parts.join(' · ')
  }
  function overall () { return res.rows.every(function (r) { return r.ok }) && anchorState().s !== 'bad' ? 'ok' : 'bad' }
  function supersededBy (n) { return recs.filter(function (y) { return y.corrects === n }).map(function (y) { return y.n }) }
  function rewritten (x) { return x.r !== x.sealed.r || x.h !== x.sealed.h || x.prev !== x.sealed.prev }
  // the site's row words (Check a record, Record history), for the same states
  function rowWords (o) {
    var x = o.x, w = [], n = res.rows.length
    w.push(!o.fp ? (o.sep ? 'changed (separator in a field)' : 'changed') : o.sig === false ? (o.nosig ? 'signature missing' : 'signature fails') : !o.link ? '' : o.sig === null ? (x.sig ? 'fingerprint and link pass · signature not checked' : 'fingerprint and link pass · not signed') : 'checks pass')
    if (!o.link) w.push(o.n < n ? 'link ' + o.n + '→' + (o.n + 1) + ' broken' : 'stored link does not match')
    if (o.ok && rewritten(x)) w.push('relinked (simulated)')
    if (x.corrects) w.push('correction of #' + x.corrects)
    var by = supersededBy(o.n)
    if (by.length) w.push('corrected by #' + by.join(', #'))
    if (o.n > topAnchored()) w.push('not yet anchored')
    return w.filter(Boolean).join(' · ')
  }
  // The plain-language account of the history as it now stands, read out after each action.
  function account () {
    var rows = res.rows, out = []
    rows.forEach(function (r) {
      if (!r.fp) out.push('Record ' + r.n + (r.sep ? ' has a field holding the separator |' : ' no longer matches its fingerprint') + (r.sig === false ? ' and its signature fails.' : '.'))
      else if (r.sig === false) out.push('Record ' + r.n + (r.nosig ? ' has no signature, and a missing signature fails.' : '’s signature fails.'))
      if (!r.link) out.push(r.n < rows.length ? 'The link from record ' + r.n + ' to record ' + (r.n + 1) + ' is broken.' : 'Record ' + r.n + '’s stored link does not match.')
    })
    var first = rows.filter(function (r) { return !r.ok })[0]
    if (first && first.n < rows.length && rows.slice(first.n).every(function (r) { return r.ok })) out.push(Range(first.n + 1, rows.length) + (rows.length === first.n + 1 ? ' still passes its own checks.' : ' still pass their own checks.'))
    var okN = rows.filter(function (r) { return r.ok }).length
    if (okN === rows.length) out.push('All ' + rows.length + ' records pass' + (key ? '.' : ' the fingerprint and link checks; signatures not checked in this browser.'))
    var as = anchorState()
    if (as.s === 'bad') out.push('Replayed from 64 zeros, the history no longer reaches the anchored fingerprint for ' + range(1, as.N) + '.')
    else if (as.s === 'ok') out.push('The anchored fingerprint for ' + range(1, as.N) + ' still matches.')
    var top = topAnchored()
    if (rows.length > top) out.push(Range(top + 1, rows.length) + (rows.length === top + 1 ? ' is' : ' are') + ' not yet anchored.')
    if (!key) out.push('Signatures cannot be made or checked here.')
    return out.join(' ')
  }

  // ---------------------------------------------------------------- rendering
  var plate = D.querySelector('[data-console]')
  if (!plate) return
  var $ = function (s, r) { return (r || D).querySelector(s) }
  function esc (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] }) }
  function hx (h, cls) { return '<span class="hx' + (cls ? ' ' + cls : '') + '">' + h.match(/.{1,8}/g).map(function (g) { return '<span>' + g + '</span>' }).join('<wbr>') + '</span>' }
  // a payload may break after each bar, never inside a value
  function plHTML (p) { return esc(p).replace(/\|/g, '|<wbr>') }
  function short (h) { return h.slice(0, 8) + '…' }
  function ic (s) { return '<svg class="i" aria-hidden="true"><use href="#i-' + (s === 'ok' ? 'ok' : s === 'bad' ? 'x' : 'dash') + '"/></svg>' }
  function st (v) { return v === null ? 'na' : v ? 'ok' : 'bad' }
  function shq (s) { return "'" + String(s).replace(/'/g, "'\\''") + "'" }
  function dis (b) { return b ? ' disabled' : '' }
  function errP (id) { return '<p class="err" id="' + id + '-err"' + (errs[id] ? '' : ' hidden') + '>' + esc(errs[id] || '') + '</p>' }
  function inv (id) { return errs[id] ? ' aria-invalid="true" aria-describedby="' + id + '-err"' : '' }
  function wide () { return W.matchMedia('(min-width: 1100px)').matches }

  function vRecords () {
    var o = res.rows[sel - 1]
    return addForm() + '<div class="rv"><div class="rv-list" id="records-list">' + historyList() + '</div><div class="rv-det" id="detail">' + detail(o) + '</div></div>'
  }
  function addForm () {
    var I = inst(form.inst), full = recs.length >= MAX
    var v = form.value || suggest(I.id, recs.length + 1)
    return '<form class="add" id="add-form" novalidate><h4 class="lab">Add a result</h4>' +
      '<div class="add-g"><div class="fld"><label for="add-inst">Instrument</label><select id="add-inst" name="inst">' +
      INST.map(function (i) { return '<option value="' + i.id + '"' + (i.id === I.id ? ' selected' : '') + '>' + esc(i.id + ' · ' + i.name) + '</option>' }).join('') +
      '</select></div><div class="fld"><label for="add-val">Value <span class="u">(' + esc(I.unit) + ')</span></label>' +
      '<input id="add-val" name="value" inputmode="decimal" autocomplete="off" spellcheck="false" value="' + esc(v) + '"' + inv('add-val') + '></div>' +
      '<button class="btn btn-ok" id="b-add" type="submit"' + dis(full) + '>Seal result</button></div>' + errP('add-val') +
      '<p class="help">' + (full ? 'The demo lab holds up to ' + MAX + ' records. Reset it to start again.' : 'Prefilled with a simulated value; type your own if you like. The capture time is this browser’s clock, in UTC.') + '</p></form>'
  }
  function historyList () {
    var h = '<div class="hh"><h4 class="lab">Record history <span class="sub">' + esc(range(1, recs.length)) + ', in order</span></h4>' +
      '<button class="btn" id="b-check" type="button" data-act="check">Check all records</button></div><ol class="hist">'
    res.rows.forEach(function (o) {
      var x = o.x
      h += '<li data-s="' + (o.ok ? 'ok' : 'bad') + '"' + (o.n === sel ? ' class="on"' : '') + '>' +
        '<button class="hn" id="rec-' + o.n + '" type="button" data-act="sel" data-n="' + o.n + '"' + (o.n === sel ? ' aria-current="true"' : '') + '><span class="sr-only">Record </span>' + o.n + '</button>' +
        '<div class="hm"><p class="hv"><span class="hi">' + esc(x.f.instrumentId) + '</span> <b' + (x.f.value !== x.sealed.value ? ' class="ed"' : '') + '>' + esc(x.f.value) + '</b> ' + esc(x.f.unit) + '</p>' +
        '<p class="ht"><span class="nw">' + esc(x.f.capturedAt) + '</span>' + (x.ctx && x.ctx.inj ? ' · <span class="nw">inj ' + x.ctx.inj + '</span>' : '') + ' · <span class="nw">r ' + short(x.r) + '</span></p>' +
        '<p class="hc"><span data-s="' + st(o.fp) + '">' + ic(st(o.fp)) + 'fingerprint</span><span data-s="' + st(o.sig) + '">' + ic(st(o.sig)) + 'signature</span><span data-s="' + st(o.link) + '">' + ic(st(o.link)) + (o.n < res.rows.length ? 'link ' + o.n + '→' + (o.n + 1) : 'stored link') + '</span></p>' +
        '<p class="hs">' + esc(rowWords(o)) + '</p>' + anchoredHere(o.n) + '</div></li>'
    })
    return h + '</ol>'
  }
  function anchoredHere (n) {
    var a = res.an.filter(function (o) { return o.a.N === n })[0]
    return a ? '<p class="ha" data-s="' + (a.ok ? 'ok' : 'bad') + '">' + ic(a.ok ? 'ok' : 'bad') + 'Anchored at this record: ' + esc(range(1, n)) + ' (simulated) · ' + (a.ok ? 'matches the replay' : 'does not match the replay') + '</p>' : ''
  }
  function detail (o) {
    var x = o.x, rows = res.rows, n = o.n, next = rows[n], top = topAnchored(), by = supersededBy(n)
    var ed = x.f.value !== x.sealed.value
    var h = '<a class="back" href="#records-list">Back to the record history</a>' +
      '<h4 class="det-h" id="det-h" tabindex="-1">Record ' + n + ' <span class="det-s" data-s="' + (o.ok ? 'ok' : 'bad') + '">' + esc(rowWords(o)) + '</span></h4>'
    if (x.ctx && x.ctx.inj) h += '<p class="ctx">Injection ' + x.ctx.inj + ' · ' + esc(x.ctx.kind === 'SST' ? 'system suitability' : 'sample') + ' · ' + esc(x.ctx.sample) + ' · ' + esc(x.ctx.desc) + ' · retention time ' + x.ctx.rt + ' min · ' + SEQ_ID + ' <span class="nb">(context, not sealed in the alpha)</span></p>'
    else if (x.corrects) h += '<p class="ctx">Correction of record ' + x.corrects + ' · reason: “' + esc(x.reason) + '” · made ' + esc(x.at) + ' in this browser <span class="nb">(beside the seal, not sealed)</span></p>'
    else h += '<p class="ctx">Added in this browser at ' + esc(x.f.capturedAt) + ' <span class="nb">(no sample or method metadata: sealing those is upcoming)</span></p>'
    h += '<dl class="kv"><dt>Instrument</dt><dd>' + esc(x.f.instrumentId) + '</dd><dt>Measurement type</dt><dd>' + esc(x.f.sensorType) + '</dd>' +
      '<dt>Value</dt><dd' + (ed ? ' class="ed"' : '') + '>' + esc(x.f.value) + (ed ? ' <span class="was">was ' + esc(x.sealed.value) + ' before the simulated change</span>' : '') + '</dd>' +
      '<dt>Unit</dt><dd>' + esc(x.f.unit) + '</dd><dt>Captured (UTC)</dt><dd class="nw">' + esc(x.f.capturedAt) + '</dd></dl>'
    var pl = payload(x.f)
    h += '<p class="lab pl-l">Sealed payload <span class="sub">UTF-8, ' + enc.encode(pl).length + ' bytes</span></p><code class="pl">' + plHTML(pl) + '</code>'
    var keyWord = key ? 'the demo key in this browser (key ID ' + key.id.slice(0, 8) + '…)' : ''
    var sigS = st(o.sig), sigW = o.sig === null ? (key ? 'not signed' : 'not checked') : o.sig ? 'valid' : o.nosig ? 'missing' : 'fails'
    var as = res.an.filter(function (a) { return a.a.N >= n }).sort(function (a, b) { return a.a.N - b.a.N })[0]
    var pv = rows[n - 2]
    h += '<dl class="ck">' +
      ck('Fingerprint', st(o.fp), o.fp ? 'match' : o.sep ? 'invalid' : 'no match', '<span class="k">stored r</span>' + hx(x.r) + '<span class="k">recomputed</span>' + hx(o.rp, o.fp ? '' : 'bad') + (o.sep ? '<span class="k">a field holds the separator | or a control character, so the payload no longer reads as five fields</span>' : '')) +
      ck('Signature', sigS, sigW, !key ? 'Signatures cannot be made or checked here: this page needs a secure (https://) connection for that.' : !x.sig ? 'No signature is stored with this record. Every record here is signed with the key in this browser, so a missing signature fails.' : o.sig ? 'ECDSA P-256 over the recomputed fingerprint, checked with ' + keyWord + '.' : 'The signature was made over the fingerprint as sealed. It does not fit the recomputed one, checked with ' + keyWord + '.') +
      ck('Link h' + n + (next ? ', carried by record ' + (n + 1) : ', the newest record'), st(o.link), o.link ? 'intact' : 'broken',
        '<span class="k">stored previous (' + (n === 1 ? '64 zeros' : 'h' + (n - 1)) + ')</span>' + hx(x.prev) + '<span class="k">recomputed h' + n + '</span>' + hx(o.hp, o.link ? '' : 'bad') + '<span class="k">stored h' + n + '</span>' + hx(x.h) +
        (next ? '<span class="k">record ' + (n + 1) + '’s stored previous</span>' + hx(next.x.prev) : '') +
        (pv && !pv.link ? '<span class="k">the link into this record is broken: record ' + pv.n + ' changed, so it no longer gives the previous link stored here</span>' : '')) +
      (as ? ck('Anchor', as.ok ? 'ok' : 'bad', as.ok ? 'matches' : 'no match', 'Anchored fingerprint for ' + range(1, as.a.N) + ' (simulated, no network call)' + hx(as.a.h) + '<span class="k">full replay from 64 zeros, record ' + as.a.N + '</span>' + hx(rows[as.a.N - 1].full, as.ok ? '' : 'bad'))
        : ck('Anchor', 'na', 'not yet anchored', 'Record ' + n + ' came after the last anchor (' + range(1, top) + '). Until it is anchored, a rewrite of it would not show. See Anchor.')) +
      '</dl>'
    h += recipe(o)
    h += fixForm(o, by) + simulate(o)
    return h
  }
  function ck (name, s, word, d) { return '<div data-s="' + s + '"><dt>' + name + '</dt><dd class="res">' + ic(s) + '<span>' + word + '</span></dd><dd class="d">' + d + '</dd></div>' }
  // the shell commands for one record; only 64-hex values go into the link command, quoted, so a stored previous link
  // read from an edited store never runs as shell code
  function cmdHTML (t) {
    var m = /^(printf '%s' )('(?:[^']|'\\'')*')( \| sha256sum)$/.exec(t)
    if (!m) return esc(t)
    return esc(m[1]) + (/^'[0-9a-f]+'$/.test(m[2]) ? esc(m[2]) : plHTML(m[2])) + ' <span class="nw">| sha256sum</span>'
  }
  function recipe (o) {
    var x = o.x, n = o.n, H64 = /^[0-9a-f]{64}$/, linkOk = H64.test(x.prev) && H64.test(o.rp), L = [
      ['c', '# record ' + n + ': fingerprint of the five sealed fields, in a UTF-8 terminal (macOS: shasum -a 256)'],
      ['p', 'printf \'%s\' ' + shq(payload(x.f)) + ' | sha256sum'],
      ['o', o.rp + '  -'],
      ['c', o.sep ? '# a field holds the separator | or a control character: the payload no longer reads as five fields' : o.rp === x.r ? '# same as the stored fingerprint' : '# differs from the stored fingerprint ' + short(x.r)],
      ['c', n === 1 ? '# link: 64 zeros (the start), then the fingerprint, then 1' : '# link: the stored previous link, then the fingerprint, then ' + n],
      linkOk ? ['p', 'printf \'%s\' ' + shq(x.prev + o.rp + n) + ' | sha256sum'] : ['c', '# the stored previous link is not 64 lowercase hex characters, so no command is printed for it'],
      [linkOk ? 'o' : 'c', linkOk ? o.hp + '  -' : '# recomputed in your browser: ' + o.hp],
      ['c', o.hp === x.h ? '# same as the stored link' : '# differs from the stored link ' + short(x.h) + (res.rows[n] ? ': link ' + n + '→' + (n + 1) + ' broken' : '')]
    ]
    return '<details class="rc-d" id="rc"' + (recipeOpen ? ' open' : '') + '><summary id="rc-sum">Show the commands to check record ' + n + '</summary><pre class="rc" id="rc-pre">' +
      L.map(function (l) { return '<span class="' + l[0] + '">' + (l[0] === 'p' ? cmdHTML(l[1]) : esc(l[1])) + '</span>' }).join('\n') + '</pre>' +
      '<p class="rc-f"><button class="btn" id="b-copy" type="button" data-act="copy">Copy the commands</button><span class="say" id="copied"></span></p></details>'
  }
  function fixForm (o, by) {
    var x = o.x, h = '<form class="fix" id="fix-form" novalidate><h5 class="lab">Correct this result</h5>'
    if (sim) return h + '<p class="help">A simulated change is active. Reset the demo lab to append corrections to an intact record history.</p></form>'
    if (recs.length >= MAX) return h + '<p class="help">The demo lab holds up to ' + MAX + ' records. Reset it to start again.</p></form>'
    if (by.length) return h + '<p class="help">Record ' + o.n + ' is corrected by record ' + by[by.length - 1] + '. To change the value again, correct record ' + by[by.length - 1] + '.</p></form>'
    return h + '<div class="fld"><label for="fix-val">Corrected value <span class="u">(' + esc(x.f.unit) + ')</span></label><input id="fix-val" inputmode="decimal" autocomplete="off" spellcheck="false" value="' + esc(form.fix) + '"' + inv('fix-val') + '></div>' + errP('fix-val') +
      '<div class="fld"><label for="fix-why">Reason for the change (at least three words)</label><input id="fix-why" autocomplete="off" placeholder="e.g. dilution factor entered as 10, should be 20" value="' + esc(form.why) + '"' + inv('fix-why') + '></div>' + errP('fix-why') +
      '<p><button class="btn btn-ok" id="b-fix" type="submit">Append correction</button></p>' +
      '<p class="help">Record ' + o.n + ' stays as sealed. The correction is appended as record ' + (recs.length + 1) + ' with the same capture time; the reason, “correction of #' + o.n + '” and the time you append it sit beside the seal, not inside it. A reintegration belongs in the CDS; import the corrected result again from there.</p></form>'
  }
  function simulate (o) {
    var broken = res.rows.some(function (r) { return !r.fp || !r.link })
    return '<div class="simu"><h5 class="lab">Simulate a problem</h5>' +
      '<p class="help">These change the history in this tab the way a direct edit to a database would, so you can see what the checks catch.</p>' +
      '<div class="act"><button class="btn btn-x" id="b-edit" type="button" data-act="edit">Change record ' + o.n + '’s stored value</button><p>Changes one digit in place, without sealing again.</p></div>' +
      '<div class="act"><button class="btn btn-x" id="b-rewrite" type="button" data-act="rewrite"' + dis(!broken) + '>Re-seal, re-sign and relink</button><p>' + (broken ? 'Recomputes each changed record’s fingerprint, signs it again with this browser’s key and rewrites every later link. This browser holds the key, so the signatures pass again; only an anchor taken earlier still disagrees.' : 'Available after a simulated edit.') + '</p></div>' +
      simResult() +
      '<div class="act"><button class="btn" id="b-reset" type="button" data-act="reset">Reset the demo lab</button><p>Seals the eight-record sequence again with a new demo key, and clears every change.</p></div></div>'
  }
  // what the last simulated change did, shown under the buttons that made it (the summary at the top says it too)
  function simResult () {
    if (!simNote) return ''
    var o = res.rows[simNote.n - 1]
    if (!o) return ''
    var as = anchorState(), w = [
      ['fingerprint', o.fp ? 'ok' : 'bad', o.fp ? 'match' : 'no match'],
      ['signature', st(o.sig), o.sig === null ? 'not checked' : o.sig ? 'valid' : o.nosig ? 'missing' : 'fails'],
      [o.n < res.rows.length ? 'link ' + o.n + '→' + (o.n + 1) : 'stored link', o.link ? 'ok' : 'bad', o.link ? 'intact' : 'broken'],
      ['simulated anchor', as.s, as.s === 'ok' ? 'matches' : as.s === 'bad' ? 'no match' : 'none']
    ]
    return '<div class="sim-r" data-s="' + (o.ok && as.s !== 'bad' ? 'ok' : 'bad') + '"><p class="lab">' + esc(simNote.what) + ' · record ' + o.n + ' now</p><p class="hc">' +
      w.map(function (v) { return '<span data-s="' + v[1] + '">' + ic(v[1]) + esc(v[0] + ' ' + v[2]) + '</span>' }).join('') + '</p>' +
      '<p><button class="btn" id="b-see" type="button" data-act="see" data-n="' + o.n + '">See record ' + o.n + '’s checks</button></p></div>'
  }

  function vInstruments () {
    var today = Date.now()
    var day = function (k) { return new Date(today + k * 864e5).toISOString().slice(0, 10) }
    return '<p class="help">Four demo instruments. No instrument is connected; here results are typed in or simulated.</p><ul class="inst">' + INST.map(function (I) {
      var last = recs.filter(function (x) { return x.f.instrumentId === I.id }).pop()
      return '<li><h4><span class="iid">' + esc(I.id) + '</span> <span class="inm">' + esc(I.name) + ' (demo)</span></h4><dl class="kv">' +
        '<dt>Measures</dt><dd>' + esc(I.what) + '</dd><dt>Sealed as</dt><dd>' + esc(I.type + ' · ' + I.unit) + '</dd>' +
        '<dt>Calibration</dt><dd>demo: last ' + day(-I.cal[0]) + ', next due ' + day(I.cal[1]) + '</dd>' +
        '<dt>Last result</dt><dd>' + (last ? '#' + last.n + ' · ' + esc(last.f.value + ' ' + last.f.unit) : 'none yet') + '</dd></dl>' +
        '<button class="btn" id="b-sim-' + I.id + '" type="button" data-act="sim-add" data-i="' + I.id + '"' + dis(recs.length >= MAX) + '>Add a simulated result</button></li>'
    }).join('') + '</ul>'
  }

  function vAnchor () {
    var rows = res.rows, N = rows.length, top = topAnchored(), as = anchorState()
    var recOk = rows.every(function (r) { return r.ok })
    var why = !recOk ? 'The history does not pass its checks. Reset the demo lab before anchoring again.' : as.s === 'bad' ? 'An earlier anchor no longer matches the replay, and a new anchor would not hide that. Reset the demo lab to start again.' : N === top ? Range(1, N) + (N === 1 ? ' is' : ' are') + ' already anchored. Add a result first.' : ''
    // the head as replayed from 64 zeros over the recomputed fingerprints, never the stored link taken on trust
    var h = '<div class="anc-now"><p class="lab">Head now <span class="sub">link of record ' + N + ', replayed from 64 zeros; it depends on every record before it</span></p>' + hx(rows[N - 1].full) +
      '<p class="rc-f"><button class="btn btn-ok" id="b-anchor" type="button" data-act="anchor"' + dis(!!why) + '>Anchor (simulated)</button><span class="say">' + esc(why || 'Keeps this head, for ' + range(1, N) + ', in this tab. No network call.') + '</span></p></div>'
    h += '<h4 class="lab">Anchors <span class="sub">newest first · ' + esc(as.w) + '</span></h4><ol class="anc">'
    res.an.slice().reverse().forEach(function (o) {
      var a = o.a
      h += '<li data-s="' + (o.ok ? 'ok' : 'bad') + '"><p class="anc-h"><span>Anchored fingerprint (simulated, no network call) · ' + esc(range(1, a.N)) + '</span><span class="res">' + ic(o.ok ? 'ok' : 'bad') + '<span>' + (o.ok ? 'matches the replay' : 'does not match the replay') + '</span></span></p>' +
        hx(a.h) + '<p class="say">' + (a.seeded ? 'Set when the demo lab starts: the same value as the anchored fingerprint on the site’s Check a record page.' : 'Anchored at ' + esc(a.at) + ' (this browser’s clock).') + (o.ok ? '' : ' A full replay from 64 zeros gives ' + short(rows[a.N - 1].full) + ' at record ' + a.N + '.') + '</p></li>'
    })
    return h + '</ol>'
  }

  function draw () {
    var a = D.activeElement, fid = a && a.id && plate.contains(a) ? a.id : null
    var caret = a && fid && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null
    // the summary over every view
    var s = $('[data-sum-st]')
    s.textContent = statusLine()
    s.setAttribute('data-s', overall())
    $('[data-sum-key]').textContent = !S ? 'Signatures cannot be made or checked here: this page needs a secure (https://) connection for that. Fingerprints and links are still checked.'
      : key ? 'Signed with the demo key in this browser · key ID ' + key.id.slice(0, 8) + '… · checked ' + res.at.toISOString().replace(/\.\d+Z$/, 'Z') + ' in ' + res.ms.toFixed(1) + ' ms'
        : 'Signatures cannot be made here: this browser did not create a key.'
    var tabs = plate.querySelectorAll('.tabs a')
    for (var i = 0; i < tabs.length; i++) { if (tabs[i].hash === '#' + view) tabs[i].setAttribute('aria-current', 'true'); else tabs[i].removeAttribute('aria-current') }
    var views = plate.querySelectorAll('.view')
    for (var j = 0; j < views.length; j++) views[j].classList.toggle('on', views[j].id === view)
    var tgt = $('[data-v="' + view + '"]')
    if (tgt) tgt.innerHTML = view === 'records' ? vRecords() : view === 'instruments' ? vInstruments() : view === 'anchor' ? vAnchor() : ''
    if (view === 'method') fillMethod()
    if (fid) {
      var b = D.getElementById(fid)
      if (b && b !== a) {
        if (b.disabled) b = D.getElementById('b-reset') || D.getElementById('det-h')
        if (b) b.focus({ preventScroll: true })
        if (caret && b && b.setSelectionRange && b.id === fid) try { b.setSelectionRange(caret[0], caret[1]) } catch (e) { /* not a text field */ }
      }
    }
  }
  function fillMethod () {
    var m = $('#method')
    $('[data-key-id]', m).textContent = key ? key.id : 'none: ' + (S ? 'this browser did not create a key' : 'signatures need a secure (https://) connection')
    $('[data-key-pub]', m).innerHTML = key ? hx(key.raw) : 'none'
    $('[data-key-kept]', m).textContent = key ? (key.kept ? 'in this browser’s storage for this site, so later visits reuse it until you reset the demo lab' : 'this tab only: browser storage is unavailable, so a new key is made on each visit') : 'none'
  }
  function say (text) { $('[data-out]').textContent = text }

  // ---------------------------------------------------------------- actions
  async function run (fn) {
    if (busy) return
    busy = true
    try { await fn() } catch (e) { say('That did not work in this browser: ' + ((e && e.message) || e)) }
    busy = false
  }
  async function addResult (id, value) {
    if (recs.length >= MAX) return
    var I = inst(id), v = String(value).trim()
    if (!NUM.test(v)) { errs['add-val'] = 'Enter a number, such as ' + suggest(I.id, recs.length + 1) + '.'; draw(); $('#add-val').focus(); say('The result was not sealed: ' + errs['add-val']); return }
    errs = {}
    var n = recs.length + 1
    var x = await seal({ instrumentId: I.id, sensorType: I.type, value: v, unit: I.unit, capturedAt: nowISO() }, recs[n - 2].h, n, {})
    recs.push(x)
    sel = n
    form.value = ''
    await check()
    draw()
    say('Sealed record ' + n + ' from ' + I.id + ': ' + v + ' ' + I.unit + '. ' + account())
  }
  async function appendFix () {
    var o = res.rows[sel - 1], x = o.x, v = form.fix.trim(), why = form.why.trim()
    errs = {}
    if (!NUM.test(v)) errs['fix-val'] = 'Enter the corrected value as a number.'
    else if (v === x.f.value) errs['fix-val'] = 'That is the value already sealed.'
    // a reason a reviewer could follow: at least three words
    if (why.split(/\s+/).filter(function (w) { return /\w/.test(w) }).length < 3) errs['fix-why'] = 'A correction needs a reason of at least three words, such as what was wrong and where it is recorded.'
    if (errs['fix-val'] || errs['fix-why']) { draw(); $(errs['fix-val'] ? '#fix-val' : '#fix-why').focus(); say('The correction was not appended: ' + (errs['fix-val'] || errs['fix-why'])); return }
    var n = recs.length + 1, k = o.n
    // the correction keeps the original capture time, as on the site's pages; the time it was made sits beside the seal
    var y = await seal({ instrumentId: x.f.instrumentId, sensorType: x.f.sensorType, value: v, unit: x.f.unit, capturedAt: x.f.capturedAt }, recs[n - 2].h, n, { corrects: k, reason: why, at: nowISO() })
    recs.push(y)
    form.fix = ''; form.why = ''
    sel = n
    simNote = null
    await check()
    draw()
    say('Appended record ' + n + ': it corrects record ' + k + ' (' + x.f.value + ' → ' + v + ' ' + x.f.unit + '), with the same capture time and your reason beside the seal. Record ' + k + ' stays as sealed. ' + account())
  }
  async function simEdit () {
    var x = recs[sel - 1], v = x.f.value, i = v.length - 1
    while (i >= 0 && !/\d/.test(v[i])) i--
    var nv = v.slice(0, i) + String((+v[i] + 6) % 10) + v.slice(i + 1)
    x.f = Object.assign({}, x.f, { value: nv })
    sim = 'edit'
    simNote = { n: x.n, what: 'Stored value changed' }
    await check()
    draw()
    say('Simulated edit: record ' + x.n + '’s stored value changed from ' + v + ' to ' + nv + ' without sealing again. ' + account())
  }
  async function simRewrite () {
    var i0 = res.rows.findIndex(function (r) { return !r.fp || !r.link })
    if (i0 < 0) return
    var changed = []
    for (var i = i0; i < recs.length; i++) {
      var x = recs[i], r = await sha(payload(x.f))
      if (r !== x.r) { x.r = r; x.sig = key ? lowS(hex(await S.sign(SIG, key.priv, bytes(r)))) : ''; changed.push(x.n) }
      x.prev = i ? recs[i - 1].h : ZERO
      x.h = await sha(x.prev + x.r + (i + 1))
    }
    sim = 'rewrite'
    simNote = { n: changed[0] || i0 + 1, what: 'Re-sealed, re-signed and relinked' }
    await check()
    draw()
    say('Simulated rewrite: ' + (changed.length ? (changed.length === 1 ? 'record ' + changed[0] : 'records ' + changed.join(', ')) + ' sealed again' + (key ? ' and re-signed with this browser’s key' : ' (not signed: signatures cannot be made here)') + ', and ' : '') + 'every link from record ' + (i0 + 1) + ' on rewritten. ' + account())
  }
  async function reset () {
    // a new demo key: the old pair is deleted from this browser, so bundles exported before and after do not share a key ID
    if (S) { try { key = await getKey(true) } catch (e) { key = null } }
    await reseed()
    await check()
    draw()
    say('Demo lab reset: the eight-record sequence sealed again' + (key ? ' and signed with a new demo key in this browser (key ID ' + key.id.slice(0, 8) + '…)' : '') + '. ' + account())
  }
  async function anchorNow () {
    if (overall() !== 'ok') return
    var N = recs.length
    if (N <= topAnchored()) return
    var head = res.rows[N - 1].full // replayed from 64 zeros; the same as the stored link when every check passes
    anchors.push({ N: N, h: head, seeded: false, at: nowISO() })
    await check()
    draw()
    say('Anchored the head of ' + range(1, N) + ' (simulated, no network call): ' + short(head) + '. ' + account())
  }
  async function recheck () {
    await check()
    draw()
    say(statusLine() + '. ' + account())
  }
  function copy () {
    var text = Array.prototype.map.call(D.querySelectorAll('#rc-pre .p'), function (s) { return s.textContent }).join('\n'), out = $('#copied')
    var done = function (ok) {
      if (!ok) { var rg = D.createRange(); rg.selectNodeContents($('#rc-pre')); var s = W.getSelection(); s.removeAllRanges(); s.addRange(rg) }
      out.textContent = ok ? 'Copied.' : 'Selected: press Ctrl+C or ⌘C to copy.'
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true) }, function () { done(false) })
    else done(false)
  }
  function exportBundle () {
    var o = {
      note: 'Immutable QC alpha console: demo bundle. Synthetic data made in this browser; not a lab record.',
      exported: nowISO(),
      construction: {
        payload: 'instrumentId|sensorType|value|unit|capturedAt, UTF-8',
        fingerprint: 'r_n = SHA-256(payload), hex',
        link: 'h_n = SHA-256(h_(n-1) hex + r_n hex + n decimal), h_0 = 64 zeros',
        signature: 'ECDSA P-256 with SHA-256 over the 32 bytes of r_n, IEEE P1363 hex, low-S form only'
      },
      demoKey: key ? { id: key.id, publicKeyRaw: key.raw, note: 'made in this browser; identifies the browser, not a person. Bundles exported from this browser share this key ID until the demo lab is reset.' } : null,
      check: statusLine(),
      records: recs.map(function (x) {
        var r = { n: x.n, fields: x.f, fingerprint: x.r, previous: x.prev, link: x.h, signature: x.sig || null }
        if (x.ctx) r.context = x.ctx
        if (x.corrects) { r.corrects = x.corrects; r.reason = x.reason; r.madeAt = x.at; r.besideTheSeal = 'corrects, reason and madeAt are not sealed' }
        return r
      }),
      anchors: anchors.map(function (a) { return { records: '1 to ' + a.N, fingerprint: a.h, status: 'simulated, no network call', at: a.seeded ? 'set when the demo lab starts' : a.at } })
    }
    var url = URL.createObjectURL(new Blob([JSON.stringify(o, null, 2)], { type: 'application/json' }))
    var l = D.createElement('a')
    l.href = url; l.download = 'immutableqc-demo-bundle.json'
    D.body.appendChild(l); l.click(); l.remove()
    setTimeout(function () { URL.revokeObjectURL(url) }, 1000)
    say('Exported the demo bundle (JSON): ' + recs.length + ' records, ' + anchors.length + ' anchor' + (anchors.length === 1 ? '' : 's') + ', and the demo key’s public half.')
  }

  // ---------------------------------------------------------------- routing and events
  var VIEWS = ['records', 'instruments', 'anchor', 'method']
  function go (hash, focus) {
    var m = /^#record-(\d+)$/.exec(hash || ''), v = (hash || '').slice(1)
    if (m && +m[1] >= 1 && +m[1] <= recs.length) { sel = +m[1]; v = 'records' }
    if (v === 'records-list') v = 'records'
    if (VIEWS.indexOf(v) < 0) v = 'records'
    view = v
    draw()
    if (focus) {
      var t = m ? $('#det-h') : hash === '#records-list' ? $('#rec-' + sel) : $('#' + view + '-h')
      if (t) t.focus()
    }
  }
  plate.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="#"]')
    if (a && plate.contains(a)) {
      e.preventDefault()
      try { W.history.replaceState(null, '', a.hash === '#records-list' ? '#records' : a.hash) } catch (err) { /* sandboxed preview */ }
      go(a.hash, true)
      return
    }
    var t = e.target.closest('[data-act]')
    if (!t || t.disabled) return
    var act = t.getAttribute('data-act')
    if (act === 'see') {
      // the selected record's checks, brought into view, with focus on its heading
      var dh = $('#det-h')
      if (dh) { dh.focus({ preventScroll: true }); dh.scrollIntoView({ block: 'start' }) }
      return
    }
    if (act === 'sel') {
      sel = +t.getAttribute('data-n'); errs = {}; form.fix = ''; form.why = ''; simNote = null
      try { W.history.replaceState(null, '', '#record-' + sel) } catch (err) { /* sandboxed preview */ }
      draw()
      if (!wide()) $('#det-h').focus()
      return
    }
    if (act === 'copy') return copy()
    if (act === 'export') return exportBundle()
    run(function () {
      if (act === 'check') return recheck()
      if (act === 'edit') return simEdit()
      if (act === 'rewrite') return simRewrite()
      if (act === 'reset') return reset()
      if (act === 'anchor') return anchorNow()
      if (act === 'sim-add') { var I = inst(t.getAttribute('data-i')); return addResult(I.id, suggest(I.id, recs.length + 1)) }
    })
  })
  plate.addEventListener('submit', function (e) {
    e.preventDefault()
    if (e.target.id === 'add-form') run(function () { return addResult(form.inst, $('#add-val').value) })
    if (e.target.id === 'fix-form' && $('#b-fix')) run(appendFix)
  })
  plate.addEventListener('change', function (e) {
    if (e.target.id === 'add-inst') { form.inst = e.target.value; form.value = ''; errs = {}; draw() }
  })
  plate.addEventListener('input', function (e) {
    var id = e.target.id
    if (id === 'add-val') form.value = e.target.value
    if (id === 'fix-val') form.fix = e.target.value
    if (id === 'fix-why') form.why = e.target.value
  })
  plate.addEventListener('toggle', function (e) { if (e.target.id === 'rc') recipeOpen = e.target.open }, true)
  W.addEventListener('hashchange', function () { go(location.hash, true) })

  // ---------------------------------------------------------------- start
  async function boot () {
    try { key = await getKey() } catch (e) { key = null }
    await reseed()
    await check()
    var js = plate.querySelectorAll('[data-jsonly]')
    for (var i = 0; i < js.length; i++) js[i].hidden = false
    D.documentElement.classList.add('ready')
    go(location.hash, false)
    W.__iqcConsole = { get res () { return res }, get recs () { return recs }, get anchors () { return anchors }, statusLine: statusLine, account: account }
  }
  boot().catch(function (e) {
    D.documentElement.classList.remove('js')
    var s = $('[data-sum-st]')
    if (s) { s.textContent = 'The demo lab could not start in this browser: ' + ((e && e.message) || e); s.setAttribute('data-s', 'bad') }
  })
})()
