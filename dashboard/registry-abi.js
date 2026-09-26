/* Immutable QC · minimal ABI codec for RootRegistry.
   Hand-rolled so the console stays dependency-free (no ethers/web3 bundle).
   Verified byte-for-byte against ethers in contracts/test.js. */
(function (window) {
  "use strict";

  var FALLBACK = {
    attest: "0xb3d25223",
    attestation: "0x1a7fca86",
    isAttested: "0xc13c2396",
    count: "0x06661abd",
  };

  function selectors() {
    var reg = window.IQC_REGISTRY;
    return (reg && reg.selectors) || FALLBACK;
  }

  function strip0x(h) { h = String(h || ""); return h.indexOf("0x") === 0 || h.indexOf("0X") === 0 ? h.slice(2) : h; }

  function word(hex) {
    var h = strip0x(hex).toLowerCase();
    if (h.length > 64) throw new Error("ABI word overflow");
    while (h.length < 64) h = "0" + h;
    return h;
  }

  function uintWord(n) {
    if (typeof n === "bigint") return word(n.toString(16));
    n = Number(n);
    if (!isFinite(n) || n < 0 || Math.floor(n) !== n) throw new Error("uint expected");
    if (n > Number.MAX_SAFE_INTEGER) throw new Error("uint too large for JS number");
    return word(n.toString(16));
  }

  function bytes32Word(hex) {
    var h = strip0x(hex).toLowerCase();
    if (h.length !== 64 || /[^0-9a-f]/.test(h)) throw new Error("bytes32 expected, got " + hex);
    return h;
  }

  function utf8Bytes(str) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
    var s = unescape(encodeURIComponent(str));
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function bytesToHex(bytes) {
    var h = "";
    for (var i = 0; i < bytes.length; i++) h += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return h;
  }

  function stringTail(str) {
    var b = utf8Bytes(String(str));
    var hex = bytesToHex(b);
    var padded = hex;
    while (padded.length % 64 !== 0) padded += "0";
    return uintWord(b.length) + padded;
  }

  /* attest(bytes32 root, uint64 fromSeq, uint64 toSeq, string batchId)
     head: root · fromSeq · toSeq · offset(0x80)   tail: len · utf8 bytes */
  function encodeAttest(root, fromSeq, toSeq, batchId) {
    return selectors().attest + bytes32Word(root) + uintWord(fromSeq) + uintWord(toSeq) + uintWord(0x80) + stringTail(batchId);
  }
  function encodeAttestation(root) { return selectors().attestation + bytes32Word(root); }
  function encodeIsAttested(root) { return selectors().isAttested + bytes32Word(root); }
  function encodeCount() { return selectors().count; }

  function words(hex) {
    var h = strip0x(hex);
    var out = [];
    for (var i = 0; i + 64 <= h.length; i += 64) out.push(h.slice(i, i + 64));
    return out;
  }
  function wordToNumber(w) {
    var n = parseInt(w, 16);
    if (!isFinite(n)) throw new Error("bad uint word");
    return n;
  }

  /* attestation(bytes32) returns (address publisher, uint64 blockNumber, uint64 timestamp, uint64 fromSeq, uint64 toSeq) */
  function decodeAttestation(hex) {
    var w = words(hex);
    if (w.length < 5) throw new Error("short attestation return");
    return {
      publisher: "0x" + w[0].slice(24),
      blockNumber: wordToNumber(w[1]),
      timestamp: wordToNumber(w[2]),
      fromSeq: wordToNumber(w[3]),
      toSeq: wordToNumber(w[4]),
    };
  }
  function decodeBool(hex) { var w = words(hex); return !!(w.length && /[1-9a-f]/.test(w[0])); }
  function decodeUint(hex) { var w = words(hex); if (!w.length) throw new Error("empty return"); return wordToNumber(w[0]); }

  window.IQC_ABI = {
    encodeAttest: encodeAttest,
    encodeAttestation: encodeAttestation,
    encodeIsAttested: encodeIsAttested,
    encodeCount: encodeCount,
    decodeAttestation: decodeAttestation,
    decodeBool: decodeBool,
    decodeUint: decodeUint,
  };
})(typeof window !== "undefined" ? window : this);
