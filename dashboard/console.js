/* Immutable QC Open Alpha console
   Synthetic lab: signed QC packets, hash-chained ledger, Merkle commitments,
   optional publish to the RootRegistry contract on the Filecoin EVM.
   Everything runs in the browser. No accounts. Requires registry-artifact.js
   and registry-abi.js to be loaded first. */
(function () {
  "use strict";

  var GENESIS = "0".repeat(64);
  var DEMO_FP = "iqc-demo/fp-7a3c9e";
  var VERSION = "0.1";
  var BATCH_SIZE = 3;

  /* Filecoin EVM networks. Roots are published to the RootRegistry contract
     (contracts/RootRegistry.sol). `registry` is the deployed address; null means
     the console will offer to deploy one from the connected wallet. */
  var NETWORKS = {
    calibration: {
      key: "calibration",
      chainId: "0x4cb2f",
      chainIdDec: 314159,
      chainName: "Filecoin Calibration",
      shortName: "Calibration",
      rpcUrls: ["https://api.calibration.node.glif.io/rpc/v1"],
      nativeCurrency: { name: "Test Filecoin", symbol: "tFIL", decimals: 18 },
      blockExplorerUrls: ["https://filecoin-testnet.blockscout.com"],
      faucet: "https://faucet.calibnet.chainsafe-fil.io/funds.html",
      label: "TESTNET",
      registry: null,
    },
    mainnet: {
      key: "mainnet",
      chainId: "0x13a",
      chainIdDec: 314,
      chainName: "Filecoin Mainnet",
      shortName: "Filecoin",
      rpcUrls: ["https://api.node.glif.io/rpc/v1"],
      nativeCurrency: { name: "Filecoin", symbol: "FIL", decimals: 18 },
      blockExplorerUrls: ["https://filecoin.blockscout.com"],
      faucet: null,
      label: "MAINNET",
      registry: null,
    },
  };
  var NET = NETWORKS.calibration;
  var EPOCH_MS = 30000; // Filecoin block time
  var RECEIPT_POLL_MS = 5000;
  var RECEIPT_TIMEOUT_MS = 8 * 60 * 1000;

  var INSTRUMENTS = [
    { id: "HPLC-01", name: "Alliance HPLC", type: "HPLC", protocol: "TCP/IP", firmware: "emp3-4.2.1", captureStatus: "in-progress", heartbeatAgoMs: 140000 },
    { id: "MS-02", name: "QToF mass spec", type: "MS", protocol: "TCP/IP", firmware: "masslynx-4.2", captureStatus: "in-progress", heartbeatAgoMs: 238000 },
    { id: "PH-BENCH", name: "Bench pH meter", type: "pH", protocol: "RS-232", firmware: "ph-2.11", captureStatus: "live-file", heartbeatAgoMs: 9000 },
    { id: "ENV-RACK", name: "Environmental rack", type: "env", protocol: "file-watcher", firmware: "env-1.0.8", captureStatus: "live-file", heartbeatAgoMs: 4000 },
  ];

  var DEMOS = {
    "HPLC-01": [
      { analyte: "Caffeine", method_id: "USP-caff-01", value: 12.41, unit: "µg/mL", qc_level: "QC1" },
      { analyte: "Ibuprofen", method_id: "USP-ibu-02", value: 98.2, unit: "%", qc_level: "assay" },
    ],
    "MS-02": [{ analyte: "Nitrosamine NDMA", method_id: "MS-ndma-3", value: 0.18, unit: "ng/mL", qc_level: "LOQ" }],
    "PH-BENCH": [{ analyte: "Buffer pH", method_id: "pH-buf-a", value: 7.12, unit: "pH", qc_level: "cal" }],
    "ENV-RACK": [{ analyte: "Lab temperature", method_id: "env-t-1", value: 21.4, unit: "°C", qc_level: "monitor" }],
  };

  var SAMPLE_PREFIX = { "HPLC-01": "S-2231", "MS-02": "S-2231", "PH-BENCH": "BUF", "ENV-RACK": "ENV-LAB1" };

  var AMEND_FIELDS = [
    { id: "sample_id", label: "Sample ID", type: "text" },
    { id: "collected_at", label: "Collection date", type: "date" },
    { id: "dilution_factor", label: "Dilution factor", type: "number" },
  ];

  var NAV = [
    { id: "dash", label: "Dashboard", group: "Lab", icon: "dash" },
    { id: "instruments", label: "Instruments", group: "Lab", icon: "inst" },
    { id: "packets", label: "Records", group: "Lab", icon: "list" },
    { id: "ledger", label: "Ledger", group: "Integrity", icon: "chain" },
    { id: "registry", label: "Registry", group: "Integrity", icon: "globe" },
    { id: "auditor", label: "Auditor", group: "Integrity", icon: "shield" },
    { id: "settings", label: "Settings", group: "", icon: "gear" },
  ];

  var ICONS = {
    dash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>',
    inst: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="3" width="12" height="9" rx="1.5"/><path d="M5 12v2M11 12v2M5 7h2M9 7h2"/></svg>',
    list: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 4h10M3 8h10M3 12h7"/></svg>',
    chain: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.5" y="5" width="5" height="6" rx="1.2"/><rect x="9.5" y="5" width="5" height="6" rx="1.2"/><path d="M6.5 8h3"/></svg>',
    globe: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"/></svg>',
    shield: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4l5-2z"/><path d="M5.5 8l1.8 1.8L10.5 6.5"/></svg>',
    gear: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M3.6 12.4l1.3-1.3M11.1 4.9l1.3-1.3"/></svg>',
    copy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>',
    check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>',
    cross: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  };

  var state = {
    booting: true,
    labName: "IQC Alpha Lab",
    view: "dash",
    packets: [],
    commitments: [],
    chain: { ok: true, results: {} },
    lastVerifiedAt: null,
    tamperedSeq: null,
    selectedPacket: null,
    amendOpen: false,
    ingesting: false,
    sealing: false,
    bootError: null,
    verifyOut: null,
    wallet: { address: null, chainId: null, status: "disconnected", error: null, publishingId: null, lastTxHash: null, lastPublishError: null },
    registry: { address: null, txHash: null, deployedBy: null, deployed_at: null, status: "none", error: null, count: null },
    registryCheck: null,
  };

  /* ---------------- crypto ---------------- */

  function utf8Bytes(str) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
    var s = unescape(encodeURIComponent(str));
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function toHex(bytes) {
    var h = "";
    for (var i = 0; i < bytes.length; i++) h += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return h;
  }

  var K256 = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  // Pure JS SHA-256, used only when Web Crypto is unavailable (in-app browsers, odd contexts).
  function sha256Sync(msg) {
    var l = msg.length;
    var padLen = ((l + 9 + 63) >> 6) << 6;
    var m = new Uint8Array(padLen);
    m.set(msg);
    m[l] = 0x80;
    var bitLo = (l * 8) >>> 0;
    var bitHi = Math.floor((l * 8) / 4294967296);
    m[padLen - 8] = (bitHi >>> 24) & 255; m[padLen - 7] = (bitHi >>> 16) & 255; m[padLen - 6] = (bitHi >>> 8) & 255; m[padLen - 5] = bitHi & 255;
    m[padLen - 4] = (bitLo >>> 24) & 255; m[padLen - 3] = (bitLo >>> 16) & 255; m[padLen - 2] = (bitLo >>> 8) & 255; m[padLen - 1] = bitLo & 255;
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Uint32Array(64);
    for (var off = 0; off < padLen; off += 64) {
      var i;
      for (i = 0; i < 16; i++) w[i] = (m[off + 4 * i] << 24) | (m[off + 4 * i + 1] << 16) | (m[off + 4 * i + 2] << 8) | m[off + 4 * i + 3];
      for (i = 16; i < 64; i++) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var out = new Uint8Array(32);
    for (var j = 0; j < 8; j++) {
      out[4 * j] = H[j] >>> 24; out[4 * j + 1] = (H[j] >>> 16) & 255; out[4 * j + 2] = (H[j] >>> 8) & 255; out[4 * j + 3] = H[j] & 255;
    }
    return out;
  }

  var cryptoMode = "webcrypto";
  async function sha256Hex(data) {
    var bytes = utf8Bytes(data);
    if (cryptoMode === "webcrypto") {
      try {
        if (typeof crypto !== "undefined" && crypto.subtle && typeof crypto.subtle.digest === "function") {
          var buf = await crypto.subtle.digest("SHA-256", bytes);
          return toHex(new Uint8Array(buf));
        }
      } catch (err) { /* fall through to JS */ }
      cryptoMode = "js";
    }
    return toHex(sha256Sync(bytes));
  }

  /* ---------------- packet model ---------------- */

  function canonical(p) {
    return JSON.stringify({
      packet_id: p.packet_id,
      seq: p.seq,
      captured_at: p.captured_at,
      instrument: p.instrument,
      sample: p.sample || null,
      measurement: p.measurement,
      calibration: p.calibration,
      operator_id: p.operator_id,
      amends: p.amends || null,
    });
  }

  async function signRecord(recordSha) {
    return sha256Hex("IQC-DEMO-KEY-v0.1|" + recordSha);
  }

  function demoMeasurement(id, n) {
    var options = DEMOS[id] || DEMOS["PH-BENCH"];
    var base = options[n % options.length];
    var jitter = ((n % 7) - 3) * 0.01;
    return { analyte: base.analyte, method_id: base.method_id, value: Number((base.value + jitter).toFixed(3)), unit: base.unit, qc_level: base.qc_level };
  }

  function demoSample(instId, n, collectedAt) {
    var prefix = SAMPLE_PREFIX[instId] || "S";
    var suffix = instId === "ENV-RACK" ? "" : "-" + String.fromCharCode(65 + (n % 26));
    return { sample_id: prefix + suffix, collected_at: collectedAt, dilution_factor: 1 };
  }

  async function seal(draft, prev) {
    var payload = canonical(draft);
    var payload_sha256 = await sha256Hex(payload);
    var record_sha256 = await sha256Hex(payload_sha256 + "|" + prev + "|" + draft.seq);
    var sig = await signRecord(record_sha256);
    var sealed = {};
    for (var k in draft) if (Object.prototype.hasOwnProperty.call(draft, k)) sealed[k] = draft[k];
    sealed.commitment_batch_id = null;
    sealed.hashes = { payload_sha256: payload_sha256, prev_record_sha256: prev, record_sha256: record_sha256 };
    sealed.signature = { alg: "DEMO-SHA256", pubkey_fingerprint: DEMO_FP, sig: sig };
    return sealed;
  }

  async function merkleRoot(hashes) {
    if (!hashes.length) return GENESIS;
    var layer = hashes.slice();
    while (layer.length > 1) {
      var next = [];
      for (var i = 0; i < layer.length; i += 2) {
        var a = layer[i];
        var b = layer[i + 1] || layer[i];
        next.push(await sha256Hex(a + b));
      }
      layer = next;
    }
    return layer[0];
  }

  function ordered(packets) {
    return (packets || state.packets).slice().sort(function (a, b) { return a.seq - b.seq; });
  }

  function findPacket(id) {
    for (var i = 0; i < state.packets.length; i++) if (state.packets[i].packet_id === id) return state.packets[i];
    return null;
  }

  function amendmentsOf(packetId) {
    return ordered().filter(function (p) { return p.amends && p.amends.packet_id === packetId; });
  }

  function effectiveSample(p) {
    var s = {};
    var base = p.sample || {};
    for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) s[k] = base[k];
    amendmentsOf(p.packet_id).forEach(function (a) { if (a.amends && a.amends.field) s[a.amends.field] = a.amends.to; });
    return s;
  }

  async function verifyPacket(packet, prev, all) {
    var reasons = [];
    var payloadHash = await sha256Hex(canonical(packet));
    if (payloadHash !== packet.hashes.payload_sha256) reasons.push("Payload hash mismatch: a signed field was changed after sealing.");
    if (packet.hashes.prev_record_sha256 !== prev) reasons.push("Previous-record hash mismatch: chain link broken.");
    var recordHash = await sha256Hex(payloadHash + "|" + packet.hashes.prev_record_sha256 + "|" + packet.seq);
    if (recordHash !== packet.hashes.record_sha256) reasons.push("Record hash mismatch.");
    if ((await signRecord(packet.hashes.record_sha256)) !== packet.signature.sig) reasons.push("Demo signature invalid.");
    if (packet.amends) {
      var list = all || state.packets;
      var original = null;
      for (var i = 0; i < list.length; i++) if (list[i].packet_id === packet.amends.packet_id) original = list[i];
      if (!original) reasons.push("Amended record " + packet.amends.packet_id + " not found in ledger.");
      else if (original.hashes.record_sha256 !== packet.amends.record_sha256) reasons.push("Amendment link mismatch: original record hash changed.");
    }
    return { ok: reasons.length === 0, reasons: reasons };
  }

  async function verifyChain(packets) {
    var list = ordered(packets);
    var prev = GENESIS;
    var results = {};
    var first = null;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var r = await verifyPacket(p, prev, packets);
      results[p.seq] = r;
      if (!r.ok && !first) first = { breakAt: p.seq, reason: r.reasons[0] };
      prev = p.hashes.record_sha256;
    }
    state.lastVerifiedAt = Date.now();
    return first ? { ok: false, breakAt: first.breakAt, reason: first.reason, results: results } : { ok: true, results: results };
  }

  async function commitIfDue(packets, commitments) {
    var unbatched = packets.filter(function (p) { return !p.commitment_batch_id; });
    if (unbatched.length < BATCH_SIZE) return { packets: packets, commitments: commitments };
    var batch = unbatched.slice(0, BATCH_SIZE);
    var id = "cmt-" + Math.random().toString(16).slice(2, 10);
    var root = await merkleRoot(batch.map(function (p) { return p.hashes.record_sha256; }));
    var commitment = {
      id: id,
      created_at: new Date().toISOString(),
      merkle_root: root,
      from_seq: batch[0].seq,
      to_seq: batch[batch.length - 1].seq,
      packet_ids: batch.map(function (p) { return p.packet_id; }),
      leaves: batch.map(function (p) { return p.hashes.record_sha256; }),
      onchain: null,
    };
    var ids = {};
    batch.forEach(function (b) { ids[b.packet_id] = true; });
    var nextPackets = packets.map(function (p) {
      if (!ids[p.packet_id]) return p;
      var q = {};
      for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) q[k] = p[k];
      q.commitment_batch_id = id;
      return q;
    });
    return commitIfDue(nextPackets, commitments.concat(commitment));
  }

  /* The seed clock is pinned per browser so seeded record hashes (and therefore
     Merkle roots) stay stable across reloads. That is what lets a published root
     keep its on-chain status after a refresh. Reset lab re-pins it. */
  var SEED_EPOCH_KEY = "iqc-seed-epoch-v1";
  function seedEpoch(fresh) {
    var v = null;
    try { v = fresh ? null : Number(localStorage.getItem(SEED_EPOCH_KEY)); } catch (err) { v = null; }
    if (!v || !isFinite(v)) {
      v = Date.now();
      try { localStorage.setItem(SEED_EPOCH_KEY, String(v)); } catch (err) { /* private mode */ }
    }
    return v;
  }

  async function seed(fresh) {
    var now = seedEpoch(fresh);
    var drafts = [
      { inst: "HPLC-01", n: 0, agoMin: 372 },
      { inst: "MS-02", n: 0, agoMin: 325 },
      { inst: "PH-BENCH", n: 0, agoMin: 281 },
      { inst: "ENV-RACK", n: 0, agoMin: 240 },
      { inst: "HPLC-01", n: 1, agoMin: 196 },
    ];
    var packets = [];
    var prev = GENESIS;
    for (var i = 0; i < drafts.length; i++) {
      var d = drafts[i];
      var inst = instrumentById(d.inst);
      var at = new Date(now - d.agoMin * 60000).toISOString();
      var sealed = await seal(
        {
          packet_id: "pkt-seed-" + String(i + 1).padStart(2, "0"),
          seq: i + 1,
          captured_at: at,
          instrument: { id: inst.id, type: inst.type, protocol: inst.protocol, firmware: inst.firmware },
          sample: demoSample(inst.id, i, new Date(now - (d.agoMin + 90) * 60000).toISOString().slice(0, 10)),
          measurement: demoMeasurement(d.inst, d.n),
          calibration: { cal_id: "cal-" + inst.id + "-2026-08", valid_until: "2026-10-01T00:00:00.000Z" },
          operator_id: i % 2 === 0 ? "op.reyes" : "op.chen",
          amends: null,
        },
        prev,
      );
      packets.push(sealed);
      prev = sealed.hashes.record_sha256;
    }
    // One seeded amendment so the link-back is visible from the first load.
    var original = packets[0];
    var amendment = await seal(
      {
        packet_id: "pkt-seed-06",
        seq: 6,
        captured_at: new Date(now - 22 * 60000).toISOString(),
        instrument: original.instrument,
        sample: { sample_id: original.sample.sample_id, collected_at: original.sample.collected_at, dilution_factor: 2.5 },
        measurement: original.measurement,
        calibration: original.calibration,
        operator_id: "op.reyes",
        amends: {
          packet_id: original.packet_id,
          seq: original.seq,
          record_sha256: original.hashes.record_sha256,
          field: "dilution_factor",
          from: 1,
          to: 2.5,
          reason: "Prep sheet shows a 1:2.5 dilution; factor was entered as 1.00 at capture.",
        },
      },
      prev,
    );
    packets.push(amendment);
    return commitIfDue(packets, []);
  }

  function instrumentById(id) {
    for (var i = 0; i < INSTRUMENTS.length; i++) if (INSTRUMENTS[i].id === id) return INSTRUMENTS[i];
    return INSTRUMENTS[0];
  }

  function nextSeq() {
    var list = ordered();
    return (list.length ? list[list.length - 1].seq : 0) + 1;
  }

  function headHash() {
    var list = ordered();
    return list.length ? list[list.length - 1].hashes.record_sha256 : GENESIS;
  }

  async function ingest(id) {
    if (state.ingesting) return;
    state.ingesting = true;
    render();
    try {
      var inst = instrumentById(id);
      var seq = nextSeq();
      var now = new Date();
      var sealed = await seal(
        {
          packet_id: "pkt-" + Math.random().toString(16).slice(2, 10),
          seq: seq,
          captured_at: now.toISOString(),
          instrument: { id: inst.id, type: inst.type, protocol: inst.protocol, firmware: inst.firmware },
          sample: demoSample(inst.id, seq, now.toISOString().slice(0, 10)),
          measurement: demoMeasurement(id, seq),
          calibration: { cal_id: "cal-" + inst.id + "-2026-08", valid_until: "2026-10-01T00:00:00.000Z" },
          operator_id: "op.reyes",
          amends: null,
        },
        headHash(),
      );
      var next = await commitIfDue(state.packets.concat(sealed), state.commitments);
      var committedNow = next.commitments.length > state.commitments.length;
      state.packets = next.packets;
      state.commitments = next.commitments;
      state.chain = await verifyChain(state.packets);
      state.tamperedSeq = null;
      state.selectedPacket = sealed.packet_id;
      toast("Sealed seq " + seq + " from " + inst.id + (committedNow ? " · batch committed, root ready to publish" : ""), "ok");
    } catch (err) {
      state.bootError = (err && err.message) || String(err);
    }
    state.ingesting = false;
    render();
  }

  async function amendPacket(originalId, field, rawValue, reason) {
    var original = findPacket(originalId);
    var def = null;
    for (var i = 0; i < AMEND_FIELDS.length; i++) if (AMEND_FIELDS[i].id === field) def = AMEND_FIELDS[i];
    if (!original || !def) return { ok: false, error: "Unknown record or field." };
    var current = effectiveSample(original);
    var value = rawValue;
    if (def.type === "number") {
      value = Number(rawValue);
      if (!isFinite(value) || value <= 0) return { ok: false, error: "Dilution factor must be a positive number." };
    } else {
      value = String(rawValue || "").trim();
      if (!value) return { ok: false, error: def.label + " cannot be empty." };
    }
    if (value === current[field]) return { ok: false, error: "New value matches the current value." };
    if (!reason || !String(reason).trim()) return { ok: false, error: "A reason is required for the audit trail." };
    state.sealing = true;
    render();
    try {
      var sample = {};
      for (var k in current) if (Object.prototype.hasOwnProperty.call(current, k)) sample[k] = current[k];
      sample[field] = value;
      var seq = nextSeq();
      var sealed = await seal(
        {
          packet_id: "pkt-" + Math.random().toString(16).slice(2, 10),
          seq: seq,
          captured_at: new Date().toISOString(),
          instrument: original.instrument,
          sample: sample,
          measurement: original.measurement,
          calibration: original.calibration,
          operator_id: "op.reyes",
          amends: {
            packet_id: original.packet_id,
            seq: original.seq,
            record_sha256: original.hashes.record_sha256,
            field: field,
            from: current[field],
            to: value,
            reason: String(reason).trim(),
          },
        },
        headHash(),
      );
      var next = await commitIfDue(state.packets.concat(sealed), state.commitments);
      state.packets = next.packets;
      state.commitments = next.commitments;
      state.chain = await verifyChain(state.packets);
      state.selectedPacket = sealed.packet_id;
      state.amendOpen = false;
      toast("Amendment sealed as seq " + seq + " · linked to seq " + original.seq, "ok");
      state.sealing = false;
      render();
      return { ok: true };
    } catch (err) {
      state.sealing = false;
      render();
      return { ok: false, error: (err && err.message) || String(err) };
    }
  }

  async function tamper() {
    var list = ordered().filter(function (p) { return !p.amends; });
    if (!list.length) return;
    var target = list[Math.floor(list.length / 2)];
    state.packets = state.packets.map(function (p) {
      if (p.seq !== target.seq) return p;
      var q = {};
      for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) q[k] = p[k];
      q.measurement = { analyte: p.measurement.analyte, method_id: p.measurement.method_id, value: Number((p.measurement.value + 1.11).toFixed(3)), unit: p.measurement.unit, qc_level: p.measurement.qc_level };
      return q;
    });
    state.tamperedSeq = target.seq;
    state.chain = await verifyChain(state.packets);
    state.selectedPacket = target.packet_id;
    toast("Edited seq " + target.seq + " in place without resigning. The walk now fails there.", "bad");
    render();
  }

  async function resetLab() {
    try {
      var seeded = await seed(true);
      state.packets = seeded.packets;
      state.commitments = restoreOnchain(seeded.commitments);
      state.chain = await verifyChain(state.packets);
      state.tamperedSeq = null;
      state.selectedPacket = null;
      state.amendOpen = false;
      state.verifyOut = null;
      state.bootError = null;
      toast("Synthetic lab reset.", "ok");
    } catch (err) {
      state.bootError = (err && err.message) || String(err);
    }
    render();
  }

  function exportBundle() {
    var blob = new Blob(
      [JSON.stringify({
        exported_at: new Date().toISOString(),
        lab: state.labName,
        version: VERSION,
        disclaimer: "DEMO / SYNTHETIC DATA. Demo SHA-256 signatures, not production keys.",
        chain: { ok: state.chain.ok, breakAt: state.chain.breakAt || null, reason: state.chain.reason || null, head: headHash() },
        commitments: state.commitments,
        packets: ordered(),
      }, null, 2)],
      { type: "application/json" },
    );
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "iqc-audit-bundle.json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast("Audit bundle downloaded.", "ok");
  }

  /* ---------------- on-chain store ---------------- */

  // v2: keyed per network; entries carry a status (submitted → included → verified).
  var ONCHAIN_STORE_KEY = "iqc-onchain-v2-" + NET.key;
  var REGISTRY_STORE_KEY = "iqc-registry-v1-" + NET.key;

  function loadOnchainStore() {
    try { return JSON.parse(localStorage.getItem(ONCHAIN_STORE_KEY) || "{}") || {}; } catch (err) { return {}; }
  }
  function saveOnchainStore(store) {
    try { localStorage.setItem(ONCHAIN_STORE_KEY, JSON.stringify(store)); } catch (err) { /* private mode */ }
  }
  function persistOnchain(commitment) {
    if (!commitment || !commitment.onchain || !commitment.onchain.txHash) return;
    var store = loadOnchainStore();
    store[commitment.id] = commitment.onchain;
    store["root:" + commitment.merkle_root] = commitment.onchain;
    saveOnchainStore(store);
  }
  function restoreOnchain(commitments) {
    var store = loadOnchainStore();
    return commitments.map(function (c) {
      var hit = store[c.id] || store["root:" + c.merkle_root];
      if (!hit || hit.chainId !== NET.chainIdDec) return c;
      var q = {};
      for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) q[k] = c[k];
      q.onchain = hit;
      return q;
    });
  }

  function loadRegistry() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(REGISTRY_STORE_KEY) || "null"); } catch (err) { saved = null; }
    if (saved && saved.address && isAddress(saved.address)) {
      state.registry = { address: saved.address, txHash: saved.txHash || null, deployedBy: saved.deployedBy || null, deployed_at: saved.deployed_at || null, status: "ready", error: null, count: null };
    } else if (NET.registry) {
      state.registry = { address: NET.registry, txHash: null, deployedBy: null, deployed_at: null, status: "ready", error: null, count: null };
    }
  }
  function saveRegistry() {
    try {
      if (state.registry.address) localStorage.setItem(REGISTRY_STORE_KEY, JSON.stringify({ address: state.registry.address, txHash: state.registry.txHash, deployedBy: state.registry.deployedBy, deployed_at: state.registry.deployed_at }));
      else localStorage.removeItem(REGISTRY_STORE_KEY);
    } catch (err) { /* private mode */ }
  }
  function isAddress(a) { return /^0x[0-9a-fA-F]{40}$/.test(String(a || "")); }
  function registryAddress() { return state.registry && state.registry.address ? state.registry.address : null; }

  /* ---------------- JSON-RPC (wallet first, public RPC fallback) ---------------- */

  var rpcId = 1;
  async function rpcCall(method, params) {
    var eth = ethereum();
    if (eth && state.wallet.address && onCorrectChain()) {
      return eth.request({ method: method, params: params || [] });
    }
    var res = await fetch(NET.rpcUrls[0], {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method: method, params: params || [] }),
    });
    var json = await res.json();
    if (json.error) {
      var e = new Error(json.error.message || "RPC error");
      e.code = json.error.code;
      e.data = json.error.data;
      throw e;
    }
    return json.result;
  }

  function hexToInt(h) { return h === null || h === undefined ? null : parseInt(String(h), 16); }

  /* ---------------- wallet (MetaMask / EIP-6963) ---------------- */

  function onCorrectChain() {
    return Number(state.wallet.chainId) === NET.chainIdDec || state.wallet.chainId === NET.chainId;
  }

  var eip6963Providers = [];

  function isUsableProvider(p) { return !!(p && typeof p.request === "function"); }

  function rememberEip6963(detail) {
    if (!detail || !detail.provider || !isUsableProvider(detail.provider)) return;
    var rdns = detail.info && detail.info.rdns;
    var exists = eip6963Providers.some(function (x) { return (rdns && x.info && x.info.rdns === rdns) || x.provider === detail.provider; });
    if (!exists) eip6963Providers.push(detail);
  }

  function requestEip6963Providers() {
    try { window.dispatchEvent(new Event("eip6963:requestProvider")); } catch (err) { /* ignore */ }
  }

  function collectInjectedProviders() {
    var list = [];
    try {
      eip6963Providers.forEach(function (item) { if (item && item.provider) list.push(item.provider); });
      var eth = window.ethereum;
      if (eth) {
        if (Array.isArray(eth.providers)) list = list.concat(eth.providers);
        if (Array.isArray(eth)) list = list.concat(eth);
        list.push(eth);
      }
    } catch (err) { /* ignore */ }
    var unique = [];
    list.forEach(function (p) { if (p && unique.indexOf(p) === -1) unique.push(p); });
    return unique;
  }

  function ethereum() {
    try {
      var unique = collectInjectedProviders();
      if (!unique.length) return null;
      var byRdns = null;
      eip6963Providers.forEach(function (x) {
        if (!byRdns && x.info && /metamask/i.test(String(x.info.rdns || x.info.name || "")) && isUsableProvider(x.provider)) byRdns = x;
      });
      if (byRdns) return byRdns.provider;
      var metamask = null, nested = null, any = null;
      unique.forEach(function (p) {
        if (!metamask && p && p.isMetaMask && isUsableProvider(p)) metamask = p;
        if (!nested && p && p.provider && p.provider.isMetaMask && isUsableProvider(p.provider)) nested = p.provider;
        if (!any && isUsableProvider(p)) any = p;
      });
      return metamask || nested || any || null;
    } catch (err) {
      return null;
    }
  }

  function hasAnyWalletInjection() {
    try { return !!(eip6963Providers.length || window.ethereum); } catch (err) { return false; }
  }

  function providerErrorMessage() {
    if (hasAnyWalletInjection()) {
      return "Wallet detected but not usable yet. Open MetaMask, unlock it, set it as the default wallet, disable other wallet extensions, then connect again.";
    }
    return "MetaMask was not detected in this browser tab. Install or unlock it, then connect.";
  }

  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  async function resolveProvider(timeoutMs) {
    requestEip6963Providers();
    var started = Date.now();
    var eth = ethereum();
    while (!eth && Date.now() - started < timeoutMs) {
      await wait(100);
      requestEip6963Providers();
      eth = ethereum();
    }
    return eth;
  }

  async function ensureNetwork() {
    var eth = ethereum() || (await resolveProvider(800));
    if (!eth) throw new Error("MetaMask not detected in this tab");
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: NET.chainId }] });
    } catch (err) {
      if (err && (err.code === 4902 || String(err.message || "").indexOf("Unrecognized chain") !== -1)) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: NET.chainId, chainName: NET.chainName, rpcUrls: NET.rpcUrls, nativeCurrency: NET.nativeCurrency, blockExplorerUrls: NET.blockExplorerUrls }],
        });
      } else {
        throw err;
      }
    }
    state.wallet.chainId = await eth.request({ method: "eth_chainId" });
  }
  var wrongNetworkMsg = "Wrong network. Switch to " + NET.chainName + " to publish.";

  async function connectWallet() {
    state.wallet.error = null;
    state.wallet.status = "connecting";
    render();
    try {
      var eth = await resolveProvider(1500);
      if (!eth || typeof eth.request !== "function") {
        state.wallet.status = hasAnyWalletInjection() ? "disconnected" : "missing";
        state.wallet.error = providerErrorMessage();
        render();
        return;
      }
      var accounts = await eth.request({ method: "eth_requestAccounts" });
      state.wallet.address = (accounts && accounts[0]) || null;
      await ensureNetwork();
      state.wallet.status = state.wallet.address ? "connected" : "disconnected";
      if (!onCorrectChain()) state.wallet.error = wrongNetworkMsg;
      attachWalletListeners();
    } catch (err) {
      state.wallet.status = "disconnected";
      state.wallet.error = (err && err.message) || "Connection rejected.";
    }
    render();
  }

  function disconnectWallet() {
    state.wallet.address = null;
    state.wallet.chainId = null;
    state.wallet.status = "disconnected";
    state.wallet.error = null;
    state.wallet.publishingId = null;
    render();
  }

  function attachWalletListeners() {
    try {
      if (!window.__iqcEip6963) {
        window.__iqcEip6963 = true;
        window.addEventListener("eip6963:announceProvider", function (event) {
          rememberEip6963(event.detail);
          if (state.wallet.status === "missing") {
            state.wallet.status = "disconnected";
            state.wallet.error = null;
            render();
          }
        });
        requestEip6963Providers();
        window.addEventListener("ethereum#initialized", function () {
          if (state.wallet.status === "missing" && ethereum()) {
            state.wallet.status = "disconnected";
            state.wallet.error = null;
            render();
          }
        }, { once: true });
      }
      var eth = ethereum();
      if (!eth || eth.__iqcListeners) return;
      eth.__iqcListeners = true;
      if (typeof eth.on === "function") {
        eth.on("accountsChanged", function (accounts) {
          state.wallet.address = accounts && accounts[0] ? accounts[0] : null;
          if (!state.wallet.address) state.wallet.status = "disconnected";
          render();
        });
        eth.on("chainChanged", function (chainId) {
          state.wallet.chainId = chainId;
          state.wallet.error = onCorrectChain() ? null : wrongNetworkMsg;
          render();
        });
      }
    } catch (err) {
      console.warn("IQC wallet listeners skipped", err);
    }
  }

  /* ---------------- registry: deploy, publish, track, verify ----------------
     UX rule: nothing blocks on the chain. Sealing is local and instant. Publishing
     returns as soon as the wallet hands back a tx hash ("submitted"); a background
     poll upgrades the status to "included" when the receipt lands (~1-2 Filecoin
     epochs) and "verified" once the registry reports the root via eth_call. */

  async function requireWallet() {
    if (!state.wallet.address) {
      await connectWallet();
      if (!state.wallet.address) return null;
    }
    var eth = (await resolveProvider(1500)) || ethereum();
    if (!eth || typeof eth.request !== "function") {
      state.wallet.status = "missing";
      state.wallet.error = providerErrorMessage();
      return null;
    }
    await ensureNetwork();
    if (!onCorrectChain()) {
      state.wallet.error = wrongNetworkMsg;
      return null;
    }
    return eth;
  }

  function walletErrorText(err, verb) {
    var msg = (err && (err.message || (err.data && err.data.message))) || String(err);
    var low = msg.toLowerCase();
    if (low.indexOf("insufficient funds") !== -1 || low.indexOf("insufficient balance") !== -1 || low.indexOf("not enough funds") !== -1 || (err && err.code === -32000)) {
      return "Needs " + NET.nativeCurrency.symbol + " to " + verb + "." + (NET.faucet ? " Get test FIL from the faucet, then retry." : "");
    }
    if (low.indexOf("user rejected") !== -1 || low.indexOf("user denied") !== -1 || (err && err.code === 4001)) return (verb === "deploy" ? "Deploy" : "Publish") + " cancelled in the wallet.";
    if (low.indexOf("rootalreadyattested") !== -1 || low.indexOf("already attested") !== -1) return "This root is already attested in the registry.";
    return msg;
  }

  async function sendTx(eth, txParams) {
    try {
      var gas = await eth.request({ method: "eth_estimateGas", params: [txParams] });
      if (gas) txParams.gas = gas;
    } catch (err) {
      // A failed estimate on Filecoin almost always means the call would revert. Surface it.
      var m = String((err && (err.message || (err.data && err.data.message))) || "");
      if (/revert|RootAlreadyAttested|EmptyRoot|execution failed/i.test(m)) throw err;
    }
    return eth.request({ method: "eth_sendTransaction", params: [txParams] });
  }

  async function waitForReceipt(txHash, onTick) {
    var started = Date.now();
    while (Date.now() - started < RECEIPT_TIMEOUT_MS) {
      var receipt = null;
      try { receipt = await rpcCall("eth_getTransactionReceipt", [txHash]); } catch (err) { receipt = null; }
      if (receipt && receipt.blockNumber) return receipt;
      if (onTick) onTick(Date.now() - started);
      await wait(RECEIPT_POLL_MS);
    }
    return null;
  }

  async function deployRegistry() {
    if (!window.IQC_REGISTRY || !window.IQC_REGISTRY.bytecode) {
      state.registry.error = "Registry artifact missing (registry-artifact.js). Rebuild with contracts/build.js.";
      render();
      return null;
    }
    state.registry.error = null;
    state.registry.status = "deploying";
    render();
    try {
      var eth = await requireWallet();
      if (!eth) { state.registry.status = registryAddress() ? "ready" : "none"; render(); return null; }
      var txHash = await sendTx(eth, { from: state.wallet.address, data: window.IQC_REGISTRY.bytecode, value: "0x0" });
      state.registry.txHash = txHash;
      state.registry.deployedBy = state.wallet.address;
      state.registry.status = "confirming";
      toast("Registry deploy submitted. Waiting for a Filecoin epoch…", "ok");
      render();
      var receipt = await waitForReceipt(txHash);
      if (!receipt) throw new Error("Deploy not confirmed after " + Math.round(RECEIPT_TIMEOUT_MS / 60000) + " min. Check the explorer and paste the address in Settings.");
      if (receipt.status && hexToInt(receipt.status) === 0) throw new Error("Deploy transaction reverted.");
      if (!receipt.contractAddress) throw new Error("Deploy confirmed but no contract address in the receipt.");
      state.registry.address = receipt.contractAddress;
      state.registry.deployed_at = new Date().toISOString();
      state.registry.status = "ready";
      saveRegistry();
      toast("RootRegistry live at " + shortAddr(receipt.contractAddress) + ".", "ok");
      render();
      refreshRegistryCount();
      return receipt.contractAddress;
    } catch (err) {
      state.registry.error = walletErrorText(err, "deploy");
      state.registry.status = registryAddress() ? "ready" : "none";
      render();
      return null;
    }
  }

  function useRegistryAddress(addr) {
    addr = String(addr || "").trim();
    if (!isAddress(addr)) { state.registry.error = "Enter a 0x address (40 hex characters)."; render(); return false; }
    state.registry = { address: addr, txHash: null, deployedBy: null, deployed_at: new Date().toISOString(), status: "ready", error: null, count: null };
    saveRegistry();
    toast("Registry set to " + shortAddr(addr) + ".", "ok");
    render();
    refreshRegistryCount();
    return true;
  }

  function forgetRegistry() {
    state.registry = { address: null, txHash: null, deployedBy: null, deployed_at: null, status: "none", error: null, count: null };
    saveRegistry();
    render();
  }

  async function refreshRegistryCount() {
    var addr = registryAddress();
    if (!addr || !window.IQC_ABI) return;
    try {
      var out = await rpcCall("eth_call", [{ to: addr, data: window.IQC_ABI.encodeCount() }, "latest"]);
      state.registry.count = window.IQC_ABI.decodeUint(out);
      render();
    } catch (err) { /* read-only nicety */ }
  }

  async function publishCommitment(id) {
    var c = null;
    state.commitments.forEach(function (x) { if (x.id === id) c = x; });
    if (!c) return;
    state.wallet.error = null;
    state.wallet.lastPublishError = null;
    state.wallet.publishingId = id;
    render();
    try {
      var eth = await requireWallet();
      if (!eth) { state.wallet.publishingId = null; render(); return; }
      if (!registryAddress()) {
        toast("No registry yet. Deploying one from your wallet first…", "ok");
        var deployed = await deployRegistry();
        if (!deployed) { state.wallet.error = state.registry.error || "Registry deploy did not complete."; state.wallet.publishingId = null; render(); return; }
      }
      if (!window.IQC_ABI) throw new Error("ABI codec missing (registry-abi.js).");
      var rootHex = c.merkle_root.indexOf("0x") === 0 ? c.merkle_root : "0x" + c.merkle_root;
      var data = window.IQC_ABI.encodeAttest(rootHex, c.from_seq, c.to_seq, c.id);
      var txHash = await sendTx(eth, { from: state.wallet.address, to: registryAddress(), value: "0x0", data: data });
      c.onchain = {
        status: "submitted",
        network: NET.chainName,
        chainId: NET.chainIdDec,
        registry: registryAddress(),
        txHash: txHash,
        merkle_root: c.merkle_root,
        submitted_at: new Date().toISOString(),
        published_at: null,
        blockNumber: null,
        label: NET.label,
        explorer: explorerTxUrl(txHash),
      };
      persistOnchain(c);
      state.wallet.lastTxHash = txHash;
      state.view = "registry";
      toast("Root submitted to " + NET.shortName + ". Confirming in the background.", "ok");
      trackCommitment(c);
    } catch (err) {
      state.wallet.error = walletErrorText(err, "publish");
      state.wallet.lastPublishError = state.wallet.error;
    }
    state.wallet.publishingId = null;
    render();
  }

  var tracking = {};
  async function trackCommitment(c) {
    if (!c || !c.onchain || !c.onchain.txHash || tracking[c.id]) return;
    tracking[c.id] = true;
    try {
      if (c.onchain.status === "submitted") {
        var receipt = await waitForReceipt(c.onchain.txHash);
        if (!receipt) { c.onchain.status = "stalled"; persistOnchain(c); render(); return; }
        if (receipt.status && hexToInt(receipt.status) === 0) { c.onchain.status = "failed"; persistOnchain(c); render(); return; }
        c.onchain.status = "included";
        c.onchain.blockNumber = hexToInt(receipt.blockNumber);
        c.onchain.published_at = new Date().toISOString();
        persistOnchain(c);
        render();
      }
      if (c.onchain.status === "included") {
        var check = await checkRegistry(c.merkle_root, c.onchain.registry);
        if (check && check.attested) {
          c.onchain.status = "verified";
          c.onchain.publisher = check.publisher;
          c.onchain.chainTimestamp = check.timestamp;
          c.onchain.blockNumber = check.blockNumber || c.onchain.blockNumber;
          persistOnchain(c);
          render();
          refreshRegistryCount();
        }
      }
    } finally {
      delete tracking[c.id];
    }
  }

  /* Read the registry directly. Works without a wallet (public RPC), so an auditor
     can confirm a root from a plain browser tab. */
  async function checkRegistry(root, addr) {
    addr = addr || registryAddress();
    if (!addr || !window.IQC_ABI) return null;
    var rootHex = String(root).indexOf("0x") === 0 ? root : "0x" + root;
    var out = await rpcCall("eth_call", [{ to: addr, data: window.IQC_ABI.encodeAttestation(rootHex) }, "latest"]);
    var a = window.IQC_ABI.decodeAttestation(out);
    var attested = /[1-9a-f]/i.test(a.publisher.slice(2));
    return { attested: attested, publisher: attested ? a.publisher : null, blockNumber: a.blockNumber, timestamp: a.timestamp, fromSeq: a.fromSeq, toSeq: a.toSeq, registry: addr };
  }

  async function checkCommitmentOnChain(c) {
    if (!c) return;
    var addr = (c.onchain && c.onchain.registry) || registryAddress();
    state.registryCheck = { id: c.id, pending: true };
    render();
    try {
      if (!addr) throw new Error("No registry address configured.");
      var r = await checkRegistry(c.merkle_root, addr);
      state.registryCheck = { id: c.id, pending: false, ok: r.attested, text: r.attested
        ? "Root found in registry " + shortAddr(addr) + " · published by " + shortAddr(r.publisher) + " · epoch " + r.blockNumber + " · " + fmtTimeS(new Date(r.timestamp * 1000).toISOString()) + " · seq " + r.fromSeq + "–" + r.toSeq
        : "Root not found in registry " + shortAddr(addr) + "." };
      if (r.attested && c.onchain && c.onchain.status !== "verified") {
        c.onchain.status = "verified";
        c.onchain.publisher = r.publisher;
        c.onchain.chainTimestamp = r.timestamp;
        c.onchain.blockNumber = r.blockNumber;
        persistOnchain(c);
        refreshRegistryCount();
      }
    } catch (err) {
      state.registryCheck = { id: c.id, pending: false, ok: false, text: "Registry read failed: " + ((err && err.message) || String(err)) };
    }
    render();
  }

  /* ---------------- ui helpers ---------------- */

  function esc(s) {
    return String(s === undefined || s === null ? "" : s)
      .split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;").split('"').join("&quot;");
  }
  function shortHash(h) { h = String(h || ""); return h.length > 16 ? h.slice(0, 10) + "…" + h.slice(-4) : h; }
  function shortAddr(a) { return a ? a.slice(0, 6) + "…" + a.slice(-4) : ""; }
  function explorerTxUrl(txHash) {
    var h = String(txHash || "");
    return NET.blockExplorerUrls[0] + "/tx/" + (h.indexOf("0x") === 0 ? h : "0x" + h);
  }
  function explorerAddressUrl(addr) { return NET.blockExplorerUrls[0] + "/address/" + String(addr || ""); }
  function onchainStatus(o) {
    if (!o || !o.txHash) return { kind: "plain", text: "local" };
    if (o.status === "verified") return { kind: "ok", text: "verified" };
    if (o.status === "included") return { kind: "ok", text: "included" };
    if (o.status === "failed") return { kind: "bad", text: "failed" };
    if (o.status === "stalled") return { kind: "warn", text: "unconfirmed" };
    return { kind: "warn", text: "submitted" };
  }
  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function fmtTimeS(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  function fmtClock(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  function relTime(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + " s ago";
    var m = Math.round(s / 60);
    if (m < 60) return m + " min ago";
    var h = Math.round(m / 60);
    if (h < 48) return h + " h ago";
    return Math.round(h / 24) + " d ago";
  }
  function fieldLabel(id) {
    for (var i = 0; i < AMEND_FIELDS.length; i++) if (AMEND_FIELDS[i].id === id) return AMEND_FIELDS[i].label;
    return id;
  }
  function fmtValue(field, v) {
    if (field === "dilution_factor") return Number(v).toFixed(2);
    if (field === "collected_at") return fmtDate(v);
    return String(v);
  }
  function copyBtn(value, label) {
    return '<span class="copy" data-action="copy" data-value="' + esc(value) + '" title="Copy">' + (label || esc(shortHash(value))) + ICONS.copy + "</span>";
  }
  function pill(kind, text) { return '<span class="pill pill--' + kind + '">' + esc(text) + "</span>"; }
  function commitmentOf(p) {
    if (!p.commitment_batch_id) return null;
    for (var i = 0; i < state.commitments.length; i++) if (state.commitments[i].id === p.commitment_batch_id) return state.commitments[i];
    return null;
  }
  function packetStatus(p) {
    var r = state.chain.results && state.chain.results[p.seq];
    if (r && !r.ok) return { kind: "bad", text: state.tamperedSeq === p.seq ? "tampered" : "invalid" };
    if (p.amends) return { kind: "warn", text: "amendment" };
    if (amendmentsOf(p.packet_id).length) return { kind: "plain", text: "amended" };
    return { kind: "ok", text: "sealed" };
  }
  function measurementText(p) {
    return p.measurement.analyte + " " + p.measurement.value + " " + p.measurement.unit;
  }
  function pendingCount() { return state.packets.filter(function (p) { return !p.commitment_batch_id; }).length; }
  function publishedCount() { return state.commitments.filter(function (c) { return c.onchain && c.onchain.txHash; }).length; }

  var toastTimer = null;
  function toast(msg, kind) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.className = "toast" + (kind ? " toast--" + kind : "");
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3800);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { toast("Copied.", "ok"); }, function () { toast("Copy failed.", "bad"); });
    }
    var ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast("Copied.", "ok"); } catch (err) { toast("Copy failed.", "bad"); }
    ta.remove();
  }

  /* ---------------- chrome (nav, top bar, side status) ---------------- */

  function navItem(n) {
    var count = "";
    if (n.id === "packets") count = '<span class="count">' + state.packets.length + "</span>";
    if (n.id === "registry" && pendingCount()) count = '<span class="count">' + pendingCount() + "/" + BATCH_SIZE + "</span>";
    return '<a href="#' + n.id + '" class="side__link' + (state.view === n.id ? " is-active" : "") + '" data-action="nav" data-view="' + n.id + '">' + ICONS[n.icon] + "<span>" + esc(n.label) + "</span>" + count + "</a>";
  }

  function renderChrome() {
    var nav = document.getElementById("nav");
    if (nav) {
      var html = "", lastGroup = null;
      NAV.forEach(function (n) {
        if (n.group !== lastGroup) {
          if (n.group) html += '<div class="side__group">' + esc(n.group) + "</div>";
          else html += '<div class="side__group" aria-hidden="true">&nbsp;</div>';
          lastGroup = n.group;
        }
        html += navItem(n);
      });
      nav.innerHTML = html;
    }
    var tabs = document.getElementById("tabs");
    if (tabs) {
      tabs.innerHTML = NAV.map(function (n) {
        return '<a href="#' + n.id + '" class="' + (state.view === n.id ? "is-active" : "") + '" data-action="nav" data-view="' + n.id + '">' + esc(n.label) + "</a>";
      }).join("");
    }
    var title = document.getElementById("topTitle");
    if (title) {
      var current = NAV.filter(function (n) { return n.id === state.view; })[0] || NAV[0];
      title.innerHTML = '<p class="kicker">' + esc(state.labName) + "</p>" + esc(current.label);
    }
    var chips = document.getElementById("topChips");
    if (chips) {
      var w = state.wallet;
      var integrity = state.booting
        ? '<span class="chip"><span class="chip__dot"></span>seeding</span>'
        : state.chain.ok
          ? '<a class="chip chip--ok chip--btn" href="#ledger" data-action="nav" data-view="ledger"><span class="chip__dot"></span><span class="hide-sm">chain&nbsp;</span><strong>intact</strong></a>'
          : '<a class="chip chip--bad chip--btn" href="#ledger" data-action="nav" data-view="ledger"><span class="chip__dot"></span><span class="hide-sm">break at&nbsp;</span>seq ' + state.chain.breakAt + "</a>";
      var wallet;
      if (w.address) {
        wallet = '<a class="chip ' + (onCorrectChain() ? "chip--ok" : "chip--warn") + ' chip--btn" href="#registry" data-action="nav" data-view="registry"><span class="chip__dot"></span>' + '<span class="hide-sm">' + (onCorrectChain() ? NET.shortName : "wrong network") + " · </span>" + esc(shortAddr(w.address)) + "</a>";
      } else {
        wallet = '<button type="button" class="chip chip--btn" data-action="connect"><span class="chip__dot"></span>' + (w.status === "connecting" ? "connecting…" : 'connect<span class="hide-sm"> wallet</span>') + "</button>";
      }
      chips.innerHTML = integrity + wallet;
    }
    var side = document.getElementById("sideStatus");
    if (side) {
      var last = state.commitments.length ? state.commitments[state.commitments.length - 1] : null;
      side.innerHTML =
        '<div class="row"><span>head</span><span>' + esc(shortHash(headHash())) + "</span></div>" +
        '<div class="row"><span>records</span><span>' + state.packets.length + "</span></div>" +
        '<div class="row"><span>last root</span><span>' + (last ? esc(fmtClock(last.created_at)) : "none") + "</span></div>" +
        '<div class="row"><span>crypto</span><span>' + (cryptoMode === "webcrypto" ? "WebCrypto" : "JS fallback") + "</span></div>";
    }
  }

  /* ---------------- views ---------------- */

  function viewBooting() {
    return '<div class="boot"><span class="boot__dot"></span><span>Seeding synthetic ledger and verifying the chain…</span></div>' +
      '<div class="kpis">' + [0, 1, 2, 3].map(function () { return '<div class="kpi"><div class="skeleton" style="width:60%"></div><div class="skeleton" style="width:40%;height:24px;margin-top:14px"></div></div>'; }).join("") + "</div>";
  }

  function ledgerStrip(opts) {
    var list = ordered();
    var head = list.length ? list[list.length - 1].seq : 0;
    var html = '<div class="blk blk--genesis"><div class="blk__id">genesis</div><div class="blk__body">empty chain</div><div class="blk__hash">' + esc(shortHash(GENESIS)) + "</div></div>";
    list.forEach(function (p) {
      var st = packetStatus(p);
      var cls = "blk";
      if (p.seq === head) cls += " blk--head";
      if (p.amends) cls += " blk--amend";
      if (st.kind === "bad") cls += " blk--bad";
      var r = state.chain.results && state.chain.results[p.seq];
      var linkBad = r && !r.ok && r.reasons.some(function (x) { return x.indexOf("Previous-record") === 0; });
      html += '<div class="blk-link' + (linkBad ? " blk-link--bad" : "") + '"></div>';
      html += '<div class="' + cls + '" data-action="open-packet" data-id="' + esc(p.packet_id) + '" title="Open record">' +
        '<div class="blk__id"><span>#' + String(p.seq).padStart(4, "0") + '</span><span class="tag">' + (p.amends ? "AMD" : st.kind === "bad" ? "BREAK" : esc(p.instrument.id)) + "</span></div>" +
        '<div class="blk__body">' + (p.amends ? esc(fieldLabel(p.amends.field)) + " " + esc(fmtValue(p.amends.field, p.amends.from)) + " → " + esc(fmtValue(p.amends.field, p.amends.to)) : esc(measurementText(p))) + "</div>" +
        '<div class="blk__hash">' + esc(shortHash(p.hashes.record_sha256)) + "</div>" +
        (p.amends ? '<span class="blk__ref">refs #' + String(p.amends.seq).padStart(4, "0") + "</span>" : "") +
        "</div>";
    });
    var hasAmend = list.some(function (p) { return !!p.amends; });
    return '<div class="strip-wrap"><div class="strip' + (hasAmend ? " strip--tall" : "") + '">' + html + "</div></div>" +
      (opts && opts.legend ? '<p class="note">teal border = chain head · gold = amendment linked to an earlier record · red = record fails verification. Click a block to open it.</p>' : "");
  }

  function registryCard() {
    var last = state.commitments.length ? state.commitments[state.commitments.length - 1] : null;
    var pending = pendingCount();
    var body;
    if (!last) {
      body = '<p class="lede">No commitment yet. Every ' + BATCH_SIZE + " sealed records become one Merkle root.</p>";
    } else {
      body = '<dl class="kv" style="margin-top:12px">' +
        "<dt>latest</dt><dd>" + esc(last.id) + ' <span class="subtle">· seq ' + last.from_seq + "–" + last.to_seq + "</span></dd>" +
        "<dt>root</dt><dd>" + copyBtn(last.merkle_root) + "</dd>" +
        "<dt>created</dt><dd>" + esc(fmtTime(last.created_at)) + "</dd>" +
        "</dl>";
      if (last.onchain && last.onchain.txHash) body += renderPublishedTx(last.onchain, last);
      else body += '<div class="row-actions">' + publishButton(last) + '<a class="btn btn--secondary btn--sm" href="#registry" data-action="nav" data-view="registry">All commitments</a></div>';
    }
    var toward = pending % BATCH_SIZE;
    body += '<p class="note">' + toward + " of " + BATCH_SIZE + " records toward the next root.</p>" +
      '<div class="meter"><span style="width:' + Math.round((toward / BATCH_SIZE) * 100) + '%"></span></div>';
    if (state.wallet.error && state.wallet.publishingId === null) body += '<p class="bad note">' + esc(state.wallet.error) + faucetLink(state.wallet.error) + "</p>";
    return '<div class="card"><div class="card__head"><p class="kicker">Registry · ' + esc(NET.chainName) + '</p>' + pill(publishedCount() ? "ok" : "plain", publishedCount() + " published") + "</div>" + body + "</div>";
  }

  function faucetLink(err) {
    return NET.faucet && String(err || "").indexOf("Needs " + NET.nativeCurrency.symbol) !== -1 ? ' · <a href="' + NET.faucet + '" target="_blank" rel="noopener">faucet</a>' : "";
  }

  function publishButton(c) {
    var publishing = state.wallet.publishingId === c.id;
    var label = publishing ? "Publishing…" : state.wallet.address && onCorrectChain() ? "Publish root to " + NET.shortName : "Connect and publish root";
    return '<button type="button" class="btn btn--primary btn--sm" data-action="publish" data-id="' + esc(c.id) + '"' + (publishing ? " disabled" : "") + ">" + label + "</button>";
  }

  function renderPublishedTx(onchain, c) {
    if (!onchain || !onchain.txHash) return "";
    var st = onchainStatus(onchain);
    var line;
    if (onchain.status === "verified") line = "Verified in registry";
    else if (onchain.status === "included") line = "Included on " + NET.chainName;
    else if (onchain.status === "failed") line = "Transaction reverted";
    else if (onchain.status === "stalled") line = "Not confirmed yet";
    else line = "Submitted to " + NET.chainName;
    var when = onchain.published_at || onchain.submitted_at;
    var check = c && state.registryCheck && state.registryCheck.id === c.id ? state.registryCheck : null;
    return '<div class="tx-result"><p class="' + (st.kind === "bad" ? "bad" : st.kind === "warn" ? "warn" : "ok") + '" style="margin:0">' + esc(line) +
      (onchain.status === "submitted" ? ' <span class="subtle">· confirming, about ' + Math.round(EPOCH_MS / 1000) + ' s per epoch</span>' : "") +
      (onchain.blockNumber ? ' <span class="subtle">· epoch ' + esc(onchain.blockNumber) + "</span>" : "") +
      (when ? ' <span class="subtle">· ' + esc(fmtTime(when)) + "</span>" : "") + "</p>" +
      '<p class="hash">tx ' + copyBtn(onchain.txHash) + (onchain.registry ? ' · registry ' + copyBtn(onchain.registry, esc(shortAddr(onchain.registry))) : "") + "</p>" +
      '<div class="row-actions"><a class="btn btn--secondary btn--sm" href="' + esc(explorerTxUrl(onchain.txHash)) + '" target="_blank" rel="noopener">View on Blockscout</a>' +
      (c ? '<button type="button" class="btn btn--secondary btn--sm" data-action="check-registry" data-id="' + esc(c.id) + '"' + (check && check.pending ? " disabled" : "") + ">" + (check && check.pending ? "Checking…" : "Check registry") + "</button>" : "") +
      (onchain.status === "stalled" && c ? '<button type="button" class="btn btn--secondary btn--sm" data-action="track" data-id="' + esc(c.id) + '">Retry confirmation</button>' : "") +
      "</div>" +
      (check && !check.pending ? '<p class="note ' + (check.ok ? "ok" : "bad") + '">' + esc(check.text) + "</p>" : "") +
      "</div>";
  }

  function viewDash() {
    var list = ordered();
    var amendments = list.filter(function (p) { return !!p.amends; }).length;
    var live = INSTRUMENTS.filter(function (i) { return i.captureStatus === "live-file"; }).length;
    var recent = list.slice().reverse().slice(0, 6);
    var now = Date.now();
    return '<div class="page-head"><div><p class="kicker">Open alpha · v' + VERSION + ' · synthetic data</p><h1>' + esc(state.labName) + '</h1>' +
      '<p class="lede">Every signed record is chained to the one before it. Batches of ' + BATCH_SIZE + ' become Merkle roots you can publish to a public testnet. Corrections are new records linked to the original.</p></div>' +
      '<div class="actions"><button type="button" class="btn btn--primary" data-action="ingest" data-id="HPLC-01"' + (state.ingesting ? " disabled" : "") + ">" + (state.ingesting ? "Signing…" : "Ingest demo run") + '</button><button type="button" class="btn btn--secondary" data-action="export">Export bundle</button></div></div>' +
      '<div class="kpis">' +
      '<div class="kpi"><span class="kpi__label">Signed records</span><div><div class="kpi__value">' + list.length + '</div><div class="kpi__sub">' + amendments + " amendment" + (amendments === 1 ? "" : "s") + "</div></div></div>" +
      '<div class="kpi"><span class="kpi__label">Chain integrity</span><div><div class="kpi__value ' + (state.chain.ok ? "ok" : "bad") + '">' + (state.chain.ok ? "Intact" : "Break") + '</div><div class="kpi__sub">' + (state.chain.ok ? "verified " + (state.lastVerifiedAt ? relTime(now - state.lastVerifiedAt) : "at boot") : "seq " + state.chain.breakAt + " fails") + "</div></div></div>" +
      '<div class="kpi"><span class="kpi__label">Commitments</span><div><div class="kpi__value">' + state.commitments.length + '</div><div class="kpi__sub">' + publishedCount() + " published on chain</div></div></div>" +
      '<div class="kpi"><span class="kpi__label">Instruments</span><div><div class="kpi__value">' + INSTRUMENTS.length + '</div><div class="kpi__sub">' + live + " live · " + (INSTRUMENTS.length - live) + " adapters in progress</div></div></div>" +
      "</div>" +
      '<section class="section"><div class="section__head"><p class="kicker">Ledger · head ' + esc(shortHash(headHash())) + '</p><a href="#ledger" data-action="nav" data-view="ledger">Open ledger</a></div>' + ledgerStrip({ legend: true }) + "</section>" +
      '<section class="section grid-2">' + registryCard() +
      '<div class="card"><div class="card__head"><p class="kicker">Recent records</p><a href="#packets" data-action="nav" data-view="packets" class="subtle" style="font-size:.85rem">All records</a></div>' +
      '<ul class="activity" style="margin-top:12px">' + recent.map(function (p) {
        var st = packetStatus(p);
        return '<li data-action="open-packet" data-id="' + esc(p.packet_id) + '"><span class="seq">#' + String(p.seq).padStart(4, "0") + '</span><span class="what">' + (p.amends ? '<span class="warn">Amendment</span> · ' + esc(fieldLabel(p.amends.field)) + " on #" + String(p.amends.seq).padStart(4, "0") : esc(p.instrument.id) + " · " + esc(measurementText(p))) + (st.kind === "bad" ? ' <span class="bad">· fails</span>' : "") + '</span><span class="when">' + esc(fmtTime(p.captured_at)) + "</span></li>";
      }).join("") + "</ul></div></section>";
  }

  function viewInstruments() {
    var now = Date.now();
    return '<div class="page-head"><div><p class="kicker">Lab</p><h1>Instruments</h1><p class="lede">HPLC and MS capture adapters are in progress; ingest is file or demo only. Each ingest seals one signed record from a synthetic run.</p></div></div>' +
      '<div class="grid-2 section">' + INSTRUMENTS.map(function (inst) {
        var last = ordered().slice().reverse().filter(function (p) { return p.instrument.id === inst.id && !p.amends; })[0];
        var liveFile = inst.captureStatus === "live-file";
        return '<article class="card inst"><div class="inst__head"><div><div class="inst__name">' + esc(inst.name) + '</div><div class="inst__id">' + esc(inst.id) + " · " + esc(inst.type) + "</div></div>" +
          pill(liveFile ? "ok" : "warn", liveFile ? "file ingest live" : "adapter in progress") + "</div>" +
          '<div class="inst__meta"><span>protocol</span><span>' + esc(inst.protocol) + "</span><span>firmware</span><span>" + esc(inst.firmware) + '</span><span>heartbeat</span><span>' + relTime(inst.heartbeatAgoMs) + "</span><span>calibration</span><span>valid to Oct 1, 2026</span></div>" +
          '<div class="inst__last">' + (last ? "Last signed <strong>" + esc(measurementText(last)) + '</strong> <span class="subtle mono">· #' + String(last.seq).padStart(4, "0") + " · " + esc(fmtTime(last.captured_at)) + "</span>" : '<span class="muted">No signed run yet.</span>') + "</div>" +
          '<div class="row-actions"><button type="button" class="btn btn--primary btn--sm" data-action="ingest" data-id="' + esc(inst.id) + '"' + (state.ingesting ? " disabled" : "") + ">" + (state.ingesting ? "Signing…" : "Ingest demo run") + "</button></div></article>";
      }).join("") + "</div>";
  }

  function packetDetail(p) {
    var st = packetStatus(p);
    var sample = effectiveSample(p);
    var amends = amendmentsOf(p.packet_id);
    var c = commitmentOf(p);
    var r = state.chain.results && state.chain.results[p.seq];
    var html = '<div class="card card--raised section" id="packetDetail"><div class="card__head"><div><p class="kicker">Record #' + String(p.seq).padStart(4, "0") + '</p><h2 class="mono">' + esc(p.packet_id) + "</h2></div><div>" + pill(st.kind, st.text) + (c ? " " + pill("plain", "in " + c.id) : " " + pill("plain", "unbatched")) + "</div></div>";
    if (p.amends) {
      html += '<div class="amend-box"><p class="kicker">Amendment · linked to #' + String(p.amends.seq).padStart(4, "0") + '</p><dl class="kv"><dt>field</dt><dd>' + esc(fieldLabel(p.amends.field)) + '</dd><dt>change</dt><dd><span class="old">' + esc(fmtValue(p.amends.field, p.amends.from)) + '</span><span class="new">' + esc(fmtValue(p.amends.field, p.amends.to)) + "</span></dd><dt>reason</dt><dd>" + esc(p.amends.reason) + '</dd><dt>original</dt><dd><span class="copy" data-action="open-packet" data-id="' + esc(p.amends.packet_id) + '">' + esc(p.amends.packet_id) + "</span> · record " + esc(shortHash(p.amends.record_sha256)) + "</dd></dl></div>";
    }
    if (amends.length) {
      html += '<div class="amend-box"><p class="kicker">Amended ' + amends.length + " time" + (amends.length === 1 ? "" : "s") + ". Original values stay signed; the current values below reflect the linked corrections.</p>" +
        amends.map(function (a) { return '<p class="note" style="margin-top:6px"><span class="copy" data-action="open-packet" data-id="' + esc(a.packet_id) + '">#' + String(a.seq).padStart(4, "0") + "</span> · " + esc(fieldLabel(a.amends.field)) + " " + esc(fmtValue(a.amends.field, a.amends.from)) + " → " + esc(fmtValue(a.amends.field, a.amends.to)) + " · " + esc(fmtTime(a.captured_at)) + "</p>"; }).join("") + "</div>";
    }
    html += '<div class="grid-2" style="margin-top:14px"><div><p class="kicker">Signed payload</p><dl class="kv">' +
      "<dt>captured</dt><dd>" + esc(fmtTimeS(p.captured_at)) + "</dd>" +
      "<dt>instrument</dt><dd>" + esc(p.instrument.id) + ' <span class="subtle">· ' + esc(p.instrument.type) + " · " + esc(p.instrument.firmware) + "</span></dd>" +
      "<dt>sample</dt><dd>" + esc(sample.sample_id || "n/a") + (amends.some(function (a) { return a.amends.field === "sample_id"; }) ? ' <span class="warn">(amended)</span>' : "") + "</dd>" +
      "<dt>collected</dt><dd>" + (sample.collected_at ? esc(fmtDate(sample.collected_at)) : "n/a") + (amends.some(function (a) { return a.amends.field === "collected_at"; }) ? ' <span class="warn">(amended)</span>' : "") + "</dd>" +
      "<dt>dilution</dt><dd>" + (sample.dilution_factor !== undefined ? esc(Number(sample.dilution_factor).toFixed(2)) : "n/a") + (amends.some(function (a) { return a.amends.field === "dilution_factor"; }) ? ' <span class="warn">(amended)</span>' : "") + "</dd>" +
      "<dt>analyte</dt><dd>" + esc(p.measurement.analyte) + ' <span class="subtle">· ' + esc(p.measurement.method_id) + "</span></dd>" +
      "<dt>value</dt><dd" + (st.text === "tampered" ? ' class="bad"' : "") + ">" + esc(p.measurement.value) + " " + esc(p.measurement.unit) + ' <span class="subtle">· ' + esc(p.measurement.qc_level) + "</span></dd>" +
      "<dt>calibration</dt><dd>" + esc(p.calibration.cal_id) + "</dd>" +
      "<dt>operator</dt><dd>" + esc(p.operator_id || "n/a") + "</dd></dl></div>" +
      '<div><p class="kicker">Hashes and signature</p><dl class="kv">' +
      "<dt>payload</dt><dd>" + copyBtn(p.hashes.payload_sha256) + "</dd>" +
      "<dt>prev</dt><dd>" + copyBtn(p.hashes.prev_record_sha256) + "</dd>" +
      '<dt>record</dt><dd class="hash--accent">' + copyBtn(p.hashes.record_sha256) + "</dd>" +
      "<dt>signature</dt><dd>" + copyBtn(p.signature.sig) + ' <span class="subtle">· ' + esc(p.signature.alg) + "</span></dd>" +
      "<dt>key</dt><dd>" + esc(p.signature.pubkey_fingerprint) + "</dd>" +
      (c ? "<dt>root</dt><dd>" + copyBtn(c.merkle_root) + (c.onchain && c.onchain.txHash ? ' <span class="ok">· on chain</span>' : ' <span class="subtle">· not published</span>') + "</dd>" : "") +
      "</dl></div></div>";
    if (r && !r.ok) html += '<p class="chain__reasons">' + r.reasons.map(esc).join(" ") + "</p>";
    if (state.verifyOut && state.verifyOut.id === p.packet_id) html += '<p class="note ' + (state.verifyOut.ok ? "ok" : "bad") + '">' + esc(state.verifyOut.text) + "</p>";
    html += '<div class="row-actions"><button type="button" class="btn btn--secondary btn--sm" data-action="verify-packet" data-id="' + esc(p.packet_id) + '">Verify record</button>' +
      (p.amends ? "" : '<button type="button" class="btn btn--amber btn--sm" data-action="amend-toggle">' + (state.amendOpen ? "Cancel amendment" : "Amend record") + "</button>") +
      '<button type="button" class="btn btn--secondary btn--sm" data-action="nav" data-view="auditor" data-id="' + esc(p.packet_id) + '">Auditor view</button></div>';
    if (state.amendOpen && !p.amends) html += amendForm(p, sample);
    html += '<details class="raw" style="margin-top:14px"><summary>Raw packet JSON</summary><pre class="json">' + esc(JSON.stringify(p, null, 2)) + "</pre></details></div>";
    return html;
  }

  function amendForm(p, sample) {
    return '<form class="amend-box" id="amendForm" data-id="' + esc(p.packet_id) + '"><p class="kicker">New amendment</p>' +
      '<p class="note" style="margin-top:0">This seals a new record that references #' + String(p.seq).padStart(4, "0") + " by its record hash. The original stays exactly as signed.</p>" +
      '<div class="form-row"><div><label class="field" for="amendField">Field</label><select id="amendField" name="field">' +
      AMEND_FIELDS.map(function (f) { return '<option value="' + f.id + '">' + esc(f.label) + " (now " + esc(fmtValue(f.id, sample[f.id])) + ")</option>"; }).join("") +
      '</select></div><div><label class="field" for="amendValue">New value</label><input type="text" id="amendValue" name="value" value="' + esc(sample.sample_id) + '" autocomplete="off"></div></div>' +
      '<label class="field" for="amendReason">Reason</label><textarea id="amendReason" name="reason" placeholder="What was wrong and how you confirmed the correct value"></textarea>' +
      '<div class="row-actions"><button type="submit" class="btn btn--primary btn--sm"' + (state.sealing ? " disabled" : "") + ">" + (state.sealing ? "Sealing…" : "Seal amendment") + '</button><button type="button" class="btn btn--secondary btn--sm" data-action="amend-toggle">Cancel</button></div>' +
      '<p class="note bad" id="amendError"></p></form>';
  }

  function viewPackets() {
    var list = ordered().slice().reverse();
    var selected = findPacket(state.selectedPacket) || list[0];
    return '<div class="page-head"><div><p class="kicker">Lab</p><h1>Records</h1><p class="lede">Signed QC packets in ledger order. Select a row for the full packet, its hashes, and its amendment history.</p></div></div>' +
      '<div class="table-wrap section"><table><thead><tr><th>Seq</th><th>Captured</th><th>Instrument</th><th>Sample</th><th>Measurement</th><th>Status</th><th>Record hash</th></tr></thead><tbody>' +
      list.map(function (p) {
        var st = packetStatus(p);
        var sel = selected && p.packet_id === selected.packet_id;
        return '<tr data-action="select-packet" data-id="' + esc(p.packet_id) + '" class="' + (sel ? "is-selected" : "") + '"><td class="num">' + String(p.seq).padStart(4, "0") + "</td><td>" + esc(fmtTime(p.captured_at)) + "</td><td>" + esc(p.instrument.id) + '</td><td class="mono">' + esc((p.sample && p.sample.sample_id) || "") + "</td><td>" + (p.amends ? '<span class="warn">' + esc(fieldLabel(p.amends.field)) + "</span> → " + esc(fmtValue(p.amends.field, p.amends.to)) + ' <span class="subtle">on #' + String(p.amends.seq).padStart(4, "0") + "</span>" : esc(measurementText(p))) + "</td><td>" + pill(st.kind, st.text) + '</td><td><span class="hash">' + esc(shortHash(p.hashes.record_sha256)) + "</span></td></tr>";
      }).join("") + "</tbody></table></div>" +
      (selected ? packetDetail(selected) : '<div class="empty section">No records yet.</div>');
  }

  function viewLedger() {
    var list = ordered();
    var banner = state.chain.ok
      ? '<div class="banner banner--ok"><span class="banner__icon">' + ICONS.check + '</span><div class="banner__text"><strong>Chain verifies</strong><span>' + list.length + " records · head " + esc(shortHash(headHash())) + (state.lastVerifiedAt ? " · walked " + relTime(Date.now() - state.lastVerifiedAt) : "") + "</span></div>"
      : '<div class="banner banner--bad"><span class="banner__icon">' + ICONS.cross + '</span><div class="banner__text"><strong>Integrity break at seq ' + state.chain.breakAt + "</strong><span>" + esc(state.chain.reason) + "</span></div>";
    banner += '<div class="row-actions"><button type="button" class="btn btn--secondary btn--sm" data-action="verify-chain">Walk the chain</button><button type="button" class="btn btn--danger btn--sm" data-action="tamper">Simulate tamper</button><button type="button" class="btn btn--secondary btn--sm" data-action="reset">Reset lab</button></div></div>';
    return '<div class="page-head"><div><p class="kicker">Integrity</p><h1>Ledger</h1><p class="lede">Append-only hash chain. Each record commits to the previous record hash, so editing a value without resigning breaks the walk at that record.</p></div></div>' +
      '<div class="section">' + banner + "</div>" +
      '<div class="section">' + ledgerStrip({ legend: false }) + "</div>" +
      '<ol class="chain section">' +
      '<li class="chain__item is-ok"><div class="chain__rail"><span class="chain__node"></span></div><div class="card chain__card"><div class="chain__row"><span class="chain__seq">genesis</span>' + pill("plain", "empty chain") + '</div><div class="chain__hashes"><span class="k">record</span><span class="v">' + esc(GENESIS) + "</span></div></div></li>" +
      list.map(function (p) {
        var r = state.chain.results && state.chain.results[p.seq];
        var st = packetStatus(p);
        var cls = "chain__item " + (r ? (r.ok ? "is-ok" : "is-bad") : "") + (p.amends ? " is-amend" : "");
        return '<li class="' + cls + '"><div class="chain__rail"><span class="chain__node"></span></div><div class="card chain__card">' +
          '<div class="chain__row"><span class="chain__seq">#' + String(p.seq).padStart(4, "0") + "</span>" + pill(st.kind, st.text) + (p.amends ? pill("warn", "refs #" + String(p.amends.seq).padStart(4, "0")) : "") + (p.commitment_batch_id ? pill("plain", p.commitment_batch_id) : "") + '<span class="chain__time">' + esc(fmtTime(p.captured_at)) + "</span></div>" +
          '<p class="chain__body">' + (p.amends ? esc(fieldLabel(p.amends.field)) + ' <span class="subtle">' + esc(fmtValue(p.amends.field, p.amends.from)) + '</span> → <span class="warn">' + esc(fmtValue(p.amends.field, p.amends.to)) + "</span> · " + esc(p.amends.reason) : esc(p.instrument.id) + " · " + esc(measurementText(p)) + ' <span class="subtle">· ' + esc((p.sample && p.sample.sample_id) || "") + "</span>") + "</p>" +
          '<div class="chain__hashes"><span class="k">prev</span><span class="v">' + esc(p.hashes.prev_record_sha256) + '</span><span class="k">record</span><span class="v accent">' + esc(p.hashes.record_sha256) + "</span>" + (p.amends ? '<span class="k">amends</span><span class="v">' + esc(p.amends.record_sha256) + "</span>" : "") + "</div>" +
          (r && !r.ok ? '<p class="chain__reasons">' + r.reasons.map(esc).join(" ") + "</p>" : "") +
          '<div class="row-actions" style="margin-top:10px"><button type="button" class="btn btn--secondary btn--sm" data-action="open-packet" data-id="' + esc(p.packet_id) + '">Open record</button></div>' +
          "</div></li>";
      }).join("") + "</ol>";
  }

  function viewRegistry() {
    var pending = pendingCount();
    var w = state.wallet;
    var walletCard = '<div class="card"><div class="card__head"><p class="kicker">Wallet · ' + esc(NET.label.toLowerCase()) + '</p>' + (w.address ? pill(onCorrectChain() ? "ok" : "warn", onCorrectChain() ? NET.shortName : "wrong network") : pill("plain", "not connected")) + "</div>" +
      (w.address
        ? '<p class="lede" style="margin-top:10px"><span class="mono">' + esc(shortAddr(w.address)) + "</span> · publishing calls <span class=\"mono\">attest()</span> on the RootRegistry contract with the Merkle root. Not a token, not a mint.</p><div class=\"row-actions\">" + (!onCorrectChain() ? '<button type="button" class="btn btn--primary btn--sm" data-action="switch-chain">Switch to ' + esc(NET.shortName) + '</button>' : "") + '<button type="button" class="btn btn--secondary btn--sm" data-action="disconnect">Disconnect</button></div>'
        : '<p class="lede" style="margin-top:10px">Connect MetaMask to publish Merkle roots. Reading and verifying never needs a wallet.</p><div class="row-actions"><button type="button" class="btn btn--primary btn--sm" data-action="connect">' + (w.status === "connecting" ? "Connecting…" : "Connect MetaMask") + '</button><a class="btn btn--secondary btn--sm" href="https://metamask.io/download/" target="_blank" rel="noopener">Get MetaMask</a></div>') +
      (w.error ? '<p class="note bad">' + esc(w.error) + faucetLink(w.error) + (w.status === "missing" ? ' · <a href="https://metamask.io/download/" target="_blank" rel="noopener">install</a>' : "") + "</p>" : "") + "</div>";
    var batchCard = '<div class="card"><p class="kicker">Next batch</p><div class="kpi__value" style="margin-top:8px">' + (pending % BATCH_SIZE) + ' <span class="subtle" style="font-size:1rem">/ ' + BATCH_SIZE + '</span></div><p class="note">Records sealed since the last root. A full batch is hashed into a Merkle root automatically.</p><div class="meter"><span style="width:' + Math.round(((pending % BATCH_SIZE) / BATCH_SIZE) * 100) + '%"></span></div><div class="row-actions"><a class="btn btn--secondary btn--sm" href="#instruments" data-action="nav" data-view="instruments">Ingest a run</a></div></div>';
    var list = state.commitments.slice().reverse();
    return '<div class="page-head"><div><p class="kicker">Integrity</p><h1>Public registry</h1><p class="lede">Periodic Merkle roots of signed records. Anyone holding a record can prove it belongs to a published root without seeing the other records.</p></div></div>' +
      '<div class="grid-2 section">' + walletCard + batchCard + "</div>" +
      '<div class="section"><div class="section__head"><p class="kicker">Commitments</p><span class="subtle" style="font-size:.85rem">' + publishedCount() + " of " + state.commitments.length + " published</span></div>" +
      (list.length ? list.map(function (c) {
        var published = c.onchain && c.onchain.txHash;
        return '<article class="card"><div class="card__head"><div><p class="kicker">' + esc(c.id) + '</p><span class="subtle" style="font-size:.85rem">' + esc(fmtTime(c.created_at)) + " · seq " + c.from_seq + "–" + c.to_seq + "</span></div>" + pill(onchainStatus(c.onchain).kind, onchainStatus(c.onchain).text) + "</div>" +
          '<dl class="kv" style="margin-top:12px"><dt>root</dt><dd class="hash--accent">' + copyBtn(c.merkle_root, esc(c.merkle_root)) + "</dd><dt>leaves</dt><dd>" + c.packet_ids.map(function (id) { return '<span class="copy" data-action="open-packet" data-id="' + esc(id) + '">' + esc(id) + "</span>"; }).join(" ") + "</dd></dl>" +
          (published ? renderPublishedTx(c.onchain, c) : '<div class="row-actions">' + publishButton(c) + "</div>") + "</article>";
      }).join("") : '<div class="empty">No commitments yet.</div>') + "</div>";
  }

  function viewAuditor() {
    var list = ordered();
    var selected = findPacket(state.selectedPacket) || list[0];
    var c = selected ? commitmentOf(selected) : null;
    var sample = selected ? effectiveSample(selected) : {};
    return '<div class="page-head"><div><p class="kicker">Planned portal · preview</p><h1>Auditor view</h1><p class="lede">Read-only verification without proprietary methods or raw results. The auditor sees identifiers, hashes, and proof of inclusion; the measured value is withheld.</p></div></div>' +
      '<div class="section"><label class="field" for="pkt" style="margin-top:0">Record</label><select id="pkt">' + list.map(function (p) { return '<option value="' + esc(p.packet_id) + '"' + (selected && p.packet_id === selected.packet_id ? " selected" : "") + ">#" + String(p.seq).padStart(4, "0") + " · " + esc(p.instrument.id) + " · " + (p.amends ? "amendment" : esc(p.measurement.analyte)) + "</option>"; }).join("") + "</select></div>" +
      (selected ? '<div class="grid-2 section"><div class="card"><p class="kicker">Disclosed</p><dl class="kv" style="margin-top:10px">' +
        "<dt>record</dt><dd>#" + String(selected.seq).padStart(4, "0") + ' <span class="subtle">· ' + esc(selected.packet_id) + "</span></dd>" +
        "<dt>captured</dt><dd>" + esc(new Date(selected.captured_at).toISOString()) + "</dd>" +
        "<dt>instrument</dt><dd>" + esc(selected.instrument.id) + " (" + esc(selected.instrument.type) + ")</dd>" +
        "<dt>sample</dt><dd>" + esc(sample.sample_id || "n/a") + "</dd>" +
        "<dt>method</dt><dd>" + esc(selected.measurement.method_id) + "</dd>" +
        "<dt>value</dt><dd class=\"subtle\">withheld</dd>" +
        (selected.amends ? "<dt>amends</dt><dd>#" + String(selected.amends.seq).padStart(4, "0") + " · " + esc(fieldLabel(selected.amends.field)) + "</dd>" : "") +
        "</dl></div>" +
        '<div class="card"><p class="kicker">Proof</p><dl class="kv" style="margin-top:10px">' +
        "<dt>record hash</dt><dd>" + copyBtn(selected.hashes.record_sha256) + "</dd>" +
        "<dt>prev hash</dt><dd>" + copyBtn(selected.hashes.prev_record_sha256) + "</dd>" +
        "<dt>signature</dt><dd>" + esc(selected.signature.alg) + " · " + esc(selected.signature.pubkey_fingerprint) + "</dd>" +
        "<dt>commitment</dt><dd>" + (c ? esc(c.id) + " · root " + copyBtn(c.merkle_root) : '<span class="subtle">not yet batched</span>') + "</dd>" +
        "<dt>on chain</dt><dd>" + (c && c.onchain && c.onchain.txHash ? '<a href="' + esc(explorerTxUrl(c.onchain.txHash)) + '" target="_blank" rel="noopener" class="ok">' + esc(NET.shortName) + " tx " + esc(shortHash(c.onchain.txHash)) + "</a> · " + esc(onchainStatus(c.onchain).text) : '<span class="subtle">not published</span>') + "</dd>" +
        "<dt>registry</dt><dd>" + ((c && c.onchain && c.onchain.registry) || registryAddress() ? '<a href="' + esc(explorerAddressUrl((c && c.onchain && c.onchain.registry) || registryAddress())) + '" target="_blank" rel="noopener">' + esc(shortAddr((c && c.onchain && c.onchain.registry) || registryAddress())) + "</a>" : '<span class="subtle">none configured</span>') + "</dd>" +
        "</dl>" +
        '<div class="row-actions"><button type="button" class="btn btn--primary btn--sm" data-action="verify-packet" data-id="' + esc(selected.packet_id) + '">Verify record</button></div>' +
        (state.verifyOut && state.verifyOut.id === selected.packet_id ? '<p class="note ' + (state.verifyOut.ok ? "ok" : "bad") + '">' + esc(state.verifyOut.text) + "</p>" : "") +
        "</div></div>" : "");
  }

  function registrySettingsCard() {
    var r = state.registry;
    var body;
    if (r.status === "deploying" || r.status === "confirming") {
      body = '<p class="lede" style="margin-top:8px">' + (r.status === "deploying" ? "Confirm the deploy in your wallet…" : "Deploy submitted. Waiting for a Filecoin epoch (about " + Math.round(EPOCH_MS / 1000) + " s)…") + "</p>" +
        (r.txHash ? '<p class="hash">tx ' + copyBtn(r.txHash) + ' · <a href="' + esc(explorerTxUrl(r.txHash)) + '" target="_blank" rel="noopener">explorer</a></p>' : "");
    } else if (r.address) {
      body = '<dl class="kv" style="margin-top:10px"><dt>address</dt><dd>' + copyBtn(r.address, esc(r.address)) + "</dd>" +
        "<dt>roots</dt><dd>" + (r.count === null ? '<span class="subtle">reading…</span>' : esc(r.count) + " attested") + "</dd>" +
        (r.deployedBy ? "<dt>deployed by</dt><dd>" + esc(shortAddr(r.deployedBy)) + (r.deployed_at ? ' <span class="subtle">· ' + esc(fmtTime(r.deployed_at)) + "</span>" : "") + "</dd>" : "") +
        (r.txHash ? "<dt>deploy tx</dt><dd>" + copyBtn(r.txHash) + "</dd>" : "") + "</dl>" +
        '<div class="row-actions"><a class="btn btn--secondary btn--sm" href="' + esc(explorerAddressUrl(r.address)) + '" target="_blank" rel="noopener">View on Blockscout</a><button type="button" class="btn btn--secondary btn--sm" data-action="refresh-registry">Refresh</button><button type="button" class="btn btn--secondary btn--sm" data-action="forget-registry">Forget</button></div>';
    } else {
      body = '<p class="lede" style="margin-top:8px">No RootRegistry on ' + esc(NET.chainName) + ' yet. Deploy one from your wallet (one transaction, needs a little ' + esc(NET.nativeCurrency.symbol) + '), or paste the address of an existing deployment.</p>' +
        '<div class="row-actions"><button type="button" class="btn btn--primary btn--sm" data-action="deploy-registry">Deploy RootRegistry</button>' + (NET.faucet ? '<a class="btn btn--secondary btn--sm" href="' + NET.faucet + '" target="_blank" rel="noopener">Get ' + esc(NET.nativeCurrency.symbol) + '</a>' : "") + "</div>" +
        '<form id="registryForm" style="margin-top:12px"><label class="field" for="registryAddr">Use existing registry</label><div class="row-actions"><input type="text" id="registryAddr" placeholder="0x…" spellcheck="false" autocomplete="off" style="flex:1;min-width:0"><button type="submit" class="btn btn--secondary btn--sm">Use</button></div></form>';
    }
    if (r.error) body += '<p class="note bad">' + esc(r.error) + faucetLink(r.error) + "</p>";
    return '<div class="card"><div class="card__head"><p class="kicker">Registry contract · ' + esc(NET.chainName) + "</p>" + pill(r.address ? "ok" : "plain", r.address ? "ready" : r.status === "none" ? "not deployed" : r.status) + "</div>" + body + "</div>";
  }

  function viewSettings() {
    return '<div class="page-head"><div><p class="kicker">Workspace</p><h1>Settings</h1><p class="lede">Single-lab demo workspace. No accounts. Wallet connection and the registry address are local to this browser.</p></div></div>' +
      '<div class="grid-2 section"><form class="card" id="labForm"><p class="kicker">Lab</p><label class="field" for="lab">Lab name</label><input type="text" id="lab" value="' + esc(state.labName) + '"><div class="row-actions"><button type="submit" class="btn btn--primary btn--sm">Save</button></div></form>' +
      registrySettingsCard() + "</div>" +
      '<div class="card section"><p class="kicker">Data</p><p class="lede" style="margin-top:8px">Export the full ledger, commitments and verification state as JSON, or reseed the synthetic lab.</p><div class="row-actions"><button type="button" class="btn btn--primary btn--sm" data-action="export">Export audit bundle</button><button type="button" class="btn btn--secondary btn--sm" data-action="reset">Reset synthetic lab</button></div></div>' +
      '<div class="card section"><p class="kicker">About this build</p><dl class="kv" style="margin-top:10px"><dt>version</dt><dd>Open alpha v' + VERSION + "</dd><dt>hashing</dt><dd>SHA-256 via " + (cryptoMode === "webcrypto" ? "Web Crypto" : "JavaScript fallback") + "</dd><dt>signing</dt><dd>DEMO-SHA256 · " + esc(DEMO_FP) + " (not production ECDSA)</dd><dt>batch size</dt><dd>" + BATCH_SIZE + " records per Merkle root</dd><dt>network</dt><dd>" + esc(NET.chainName) + " · chain id " + NET.chainIdDec + "</dd><dt>registry</dt><dd>" + (registryAddress() ? '<a href="' + esc(explorerAddressUrl(registryAddress())) + '" target="_blank" rel="noopener">' + esc(registryAddress()) + "</a>" : "not deployed") + "</dd><dt>contract</dt><dd>RootRegistry · solc " + esc((window.IQC_REGISTRY && window.IQC_REGISTRY.compiler || "?").split("+")[0]) + " · evm paris</dd></dl></div>";
  }

  /* ---------------- render ---------------- */

  function render() {
    var app = document.getElementById("app");
    try {
      renderChrome();
      if (!app) return;
      if (state.bootError) {
        app.innerHTML = '<div class="boot-fail"><p class="kicker">Console error</p><p class="boot-fail__msg">' + esc(state.bootError) + '</p><div class="row-actions"><button type="button" class="btn btn--primary btn--sm" data-action="reset">Retry and reset lab</button></div></div>';
        return;
      }
      if (state.booting) { app.innerHTML = viewBooting(); return; }
      var views = { dash: viewDash, instruments: viewInstruments, packets: viewPackets, ledger: viewLedger, registry: viewRegistry, auditor: viewAuditor, settings: viewSettings };
      app.innerHTML = (views[state.view] || viewDash)();
      var strips = app.querySelectorAll(".strip-wrap");
      for (var i = 0; i < strips.length; i++) strips[i].scrollLeft = strips[i].scrollWidth;
    } catch (err) {
      console.error("IQC render failed", err);
      if (app) app.innerHTML = '<div class="boot-fail"><p class="kicker">Console error</p><p class="boot-fail__msg">' + esc((err && err.message) || String(err)) + '</p><div class="row-actions"><button type="button" class="btn btn--primary btn--sm" data-action="reset">Retry and reset lab</button></div></div>';
    }
  }

  function go(view, opts) {
    if (!NAV.some(function (n) { return n.id === view; })) view = "dash";
    state.view = view;
    state.amendOpen = false;
    state.verifyOut = null;
    if (opts && opts.id) state.selectedPacket = opts.id;
    if (location.hash !== "#" + view) {
      try { history.replaceState(null, "", "#" + view); } catch (err) { /* ignore */ }
    }
    render();
    if (view === "settings" && registryAddress()) refreshRegistryCount();
    var main = document.getElementById("app");
    if (main && opts && opts.scroll !== false) window.scrollTo({ top: 0, behavior: "auto" });
  }

  /* ---------------- events ---------------- */

  document.addEventListener("click", async function (e) {
    var t = e.target.closest("[data-action]");
    if (!t) {
      var anchor = e.target.closest("a[href^='#']");
      if (anchor) { e.preventDefault(); go(anchor.getAttribute("href").slice(1)); }
      return;
    }
    var action = t.getAttribute("data-action");
    var id = t.getAttribute("data-id");
    if (t.tagName === "A") e.preventDefault();
    switch (action) {
      case "nav":
        go(t.getAttribute("data-view"), id ? { id: id } : null);
        break;
      case "open-packet":
        go("packets", { id: id });
        setTimeout(function () {
          var d = document.getElementById("packetDetail");
          if (d) d.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 30);
        break;
      case "select-packet":
        state.selectedPacket = id;
        state.amendOpen = false;
        state.verifyOut = null;
        render();
        break;
      case "ingest":
        await ingest(id);
        break;
      case "publish":
        await publishCommitment(id);
        break;
      case "connect":
        await connectWallet();
        break;
      case "disconnect":
        disconnectWallet();
        break;
      case "switch-chain":
        try {
          await ensureNetwork();
          state.wallet.error = onCorrectChain() ? null : "Still on the wrong network.";
        } catch (err) {
          state.wallet.error = (err && err.message) || String(err);
        }
        render();
        break;
      case "deploy-registry":
        await deployRegistry();
        break;
      case "forget-registry":
        forgetRegistry();
        break;
      case "refresh-registry":
        state.registry.count = null;
        render();
        await refreshRegistryCount();
        break;
      case "check-registry": {
        var cc = null;
        state.commitments.forEach(function (x) { if (x.id === id) cc = x; });
        await checkCommitmentOnChain(cc);
        break;
      }
      case "track": {
        var ct = null;
        state.commitments.forEach(function (x) { if (x.id === id) ct = x; });
        if (ct && ct.onchain) { ct.onchain.status = "submitted"; persistOnchain(ct); render(); trackCommitment(ct); }
        break;
      }
      case "tamper":
        await tamper();
        break;
      case "reset":
        await resetLab();
        break;
      case "verify-chain":
        state.chain = await verifyChain(state.packets);
        toast(state.chain.ok ? "Walked " + state.packets.length + " records. Chain intact." : "Break at seq " + state.chain.breakAt + ".", state.chain.ok ? "ok" : "bad");
        render();
        break;
      case "verify-packet": {
        var p = findPacket(id);
        if (!p) return;
        var list = ordered();
        var prevPkt = list.filter(function (x) { return x.seq === p.seq - 1; })[0];
        var r = await verifyPacket(p, prevPkt ? prevPkt.hashes.record_sha256 : GENESIS, state.packets);
        state.verifyOut = { id: p.packet_id, ok: r.ok, text: r.ok ? "Valid. Payload hash, chain link, demo signature" + (p.amends ? " and amendment link" : "") + " all match." : r.reasons.join(" ") };
        render();
        break;
      }
      case "export":
        exportBundle();
        break;
      case "copy":
        copyText(t.getAttribute("data-value") || "");
        break;
      case "amend-toggle":
        state.amendOpen = !state.amendOpen;
        render();
        if (state.amendOpen) {
          var f = document.getElementById("amendField");
          if (f) syncAmendValue(f);
        }
        break;
      default:
        break;
    }
  });

  function syncAmendValue(select) {
    var form = select.closest("form");
    var p = findPacket(form && form.getAttribute("data-id"));
    var input = document.getElementById("amendValue");
    if (!p || !input) return;
    var sample = effectiveSample(p);
    var v = sample[select.value];
    input.value = select.value === "dilution_factor" ? Number(v).toFixed(2) : String(v || "");
    input.type = select.value === "collected_at" ? "date" : "text";
    input.focus();
  }

  document.addEventListener("change", function (e) {
    if (e.target.id === "pkt") {
      state.selectedPacket = e.target.value;
      state.verifyOut = null;
      render();
    }
    if (e.target.id === "amendField") syncAmendValue(e.target);
  });

  document.addEventListener("submit", async function (e) {
    if (e.target.id === "amendForm") {
      e.preventDefault();
      var form = e.target;
      var errEl = document.getElementById("amendError");
      var result = await amendPacket(form.getAttribute("data-id"), form.field.value, form.value.value, form.reason.value);
      if (!result.ok) {
        var el = document.getElementById("amendError") || errEl;
        if (el) el.textContent = result.error;
        else toast(result.error, "bad");
      }
    }
    if (e.target.id === "labForm") {
      e.preventDefault();
      var input = document.getElementById("lab");
      state.labName = (input && input.value.trim()) || "IQC Alpha Lab";
      toast("Lab name saved.", "ok");
      render();
    }
    if (e.target.id === "registryForm") {
      e.preventDefault();
      var addrInput = document.getElementById("registryAddr");
      useRegistryAddress(addrInput ? addrInput.value : "");
    }
  });

  window.addEventListener("hashchange", function () {
    var id = location.hash.slice(1);
    if (NAV.some(function (n) { return n.id === id; }) && id !== state.view) {
      state.view = id;
      render();
    }
  });

  /* ---------------- boot ---------------- */

  render();
  attachWalletListeners();

  (async function boot() {
    try {
      var id = location.hash.slice(1);
      if (NAV.some(function (n) { return n.id === id; })) state.view = id;
      loadRegistry();
      var seeded = await seed();
      state.packets = seeded.packets;
      state.commitments = restoreOnchain(seeded.commitments);
      state.chain = await verifyChain(state.packets);
      state.bootError = null;
    } catch (err) {
      state.bootError = (err && err.message) || String(err);
      console.error("IQC boot failed", err);
    }
    state.booting = false;
    window.__iqcBooted = true;
    render();
    // Resume any publish that was still confirming when the tab closed. Never blocks the UI.
    state.commitments.forEach(function (c) {
      if (c.onchain && (c.onchain.status === "submitted" || c.onchain.status === "included")) trackCommitment(c);
    });
    refreshRegistryCount();
  })();
})();
