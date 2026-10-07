// sha256.js (Team DI): FIPS 180-4 SHA-256 for pages without crypto.subtle (insecure context). A separate lazy chunk,
// fetched only then. UTF-8 string in, lowercase hex out. Constants are derived (first 32 bits of the fractional parts of
// the square / cube roots of the first primes), as the standard defines them.
const K = new Uint32Array(64), H0 = new Uint32Array(8)
for (let c = 2, n = 0; n < 64; c++) {
  let p = 1
  for (let d = 2; d * d <= c; d++) if (c % d === 0) { p = 0; break }
  if (!p) continue
  if (n < 8) H0[n] = (c ** 0.5 % 1) * 4294967296
  K[n++] = (c ** (1 / 3) % 1) * 4294967296
}
const ror = (x, n) => (x >>> n) | (x << (32 - n))

export function sha256(str) {
  const m = new TextEncoder().encode(str), L = m.length, N = (L + 72) >> 6
  const W = new Uint32Array(N * 16), w = new Uint32Array(64), h = H0.slice()
  for (let i = 0; i < L; i++) W[i >> 2] |= m[i] << (24 - (i & 3) * 8)
  W[L >> 2] |= 0x80 << (24 - (L & 3) * 8)
  W[N * 16 - 1] = L * 8
  for (let j = 0; j < W.length; j += 16) {
    for (let i = 0; i < 64; i++) {
      if (i < 16) { w[i] = W[j + i]; continue }
      const a = w[i - 15], b = w[i - 2]
      w[i] = (ror(a, 7) ^ ror(a, 18) ^ (a >>> 3)) + w[i - 7] + (ror(b, 17) ^ ror(b, 19) ^ (b >>> 10)) + w[i - 16]
    }
    let [a, b, c, d, e, f, g, k] = h
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += k
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('')
}
