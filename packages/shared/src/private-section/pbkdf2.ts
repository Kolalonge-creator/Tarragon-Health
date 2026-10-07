/**
 * PBKDF2-HMAC-SHA256 in plain TypeScript (S66).
 *
 * Why this exists: the private-section PIN is hashed ON THE DEVICE, on web (browser) and on mobile (Hermes). Web Crypto has PBKDF2
 * but React Native does not, and expo-crypto only offers a single SHA-256 digest. One synchronous implementation that behaves the same
 * everywhere means one set of tests and no per-platform hashing differences. It is verified against Node's `crypto.pbkdf2Sync` in
 * `pbkdf2.test.ts`, including the RFC 7914 test vectors, so it is a standard algorithm, not a home-made scheme.
 *
 * The PIN hash is a device-held speed bump, not the security boundary: the real limits are the attempt counter and lockout in
 * `lock-state.ts`, the device keystore that holds the record, and the fact that the PIN protects a view, not server data.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
  0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
  0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
  0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
  0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INIT = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** Processes one 64 byte block into `state` using the caller's 64 word scratch buffer. */
function compress(state: Uint32Array, block: Uint8Array, offset: number, w: Uint32Array): void {
  for (let i = 0; i < 16; i += 1) {
    const j = offset + i * 4;
    w[i] = ((block[j] as number) << 24) | ((block[j + 1] as number) << 16) | ((block[j + 2] as number) << 8) | (block[j + 3] as number);
  }
  for (let i = 16; i < 64; i += 1) {
    const w15 = w[i - 15] as number;
    const w2 = w[i - 2] as number;
    const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
    const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
    w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) | 0;
  }
  let a = state[0] as number, b = state[1] as number, c = state[2] as number, d = state[3] as number;
  let e = state[4] as number, f = state[5] as number, g = state[6] as number, h = state[7] as number;
  for (let i = 0; i < 64; i += 1) {
    const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const ch = (e & f) ^ (~e & g);
    const t1 = (h + S1 + ch + (K[i] as number) + (w[i] as number)) | 0;
    const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  state[0] = ((state[0] as number) + a) | 0; state[1] = ((state[1] as number) + b) | 0;
  state[2] = ((state[2] as number) + c) | 0; state[3] = ((state[3] as number) + d) | 0;
  state[4] = ((state[4] as number) + e) | 0; state[5] = ((state[5] as number) + f) | 0;
  state[6] = ((state[6] as number) + g) | 0; state[7] = ((state[7] as number) + h) | 0;
}

function stateToBytes(state: Uint32Array): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i += 1) {
    const v = state[i] as number;
    out[i * 4] = v >>> 24; out[i * 4 + 1] = (v >>> 16) & 255; out[i * 4 + 2] = (v >>> 8) & 255; out[i * 4 + 3] = v & 255;
  }
  return out;
}

/** SHA-256 of `data`, optionally continuing from a prefix block already absorbed (used by HMAC to avoid re-hashing the key pads). */
export function sha256(data: Uint8Array): Uint8Array {
  const state = new Uint32Array(INIT);
  const w = new Uint32Array(64);
  const padded = padMessage(data, 0);
  for (let off = 0; off < padded.length; off += 64) compress(state, padded, off, w);
  return stateToBytes(state);
}

function padMessage(data: Uint8Array, prefixBytes: number): Uint8Array {
  const total = data.length + 9;
  const len = Math.ceil(total / 64) * 64;
  const out = new Uint8Array(len);
  out.set(data);
  out[data.length] = 0x80;
  const bits = (data.length + prefixBytes) * 8;
  const view = new DataView(out.buffer);
  view.setUint32(len - 8, Math.floor(bits / 0x100000000));
  view.setUint32(len - 4, bits >>> 0);
  return out;
}

/** HMAC-SHA256 helper holding the two pre-absorbed key pad states, so each PBKDF2 round hashes only its own message. */
class Hmac {
  private readonly innerState: Uint32Array;
  private readonly outerState: Uint32Array;
  private readonly w = new Uint32Array(64);

  constructor(key: Uint8Array) {
    const k = new Uint8Array(64);
    k.set(key.length > 64 ? sha256(key) : key);
    const ipad = new Uint8Array(64);
    const opad = new Uint8Array(64);
    for (let i = 0; i < 64; i += 1) {
      ipad[i] = (k[i] as number) ^ 0x36;
      opad[i] = (k[i] as number) ^ 0x5c;
    }
    this.innerState = new Uint32Array(INIT);
    this.outerState = new Uint32Array(INIT);
    compress(this.innerState, ipad, 0, this.w);
    compress(this.outerState, opad, 0, this.w);
  }

  mac(message: Uint8Array): Uint8Array {
    const inner = new Uint32Array(this.innerState);
    const padded = padMessage(message, 64);
    for (let off = 0; off < padded.length; off += 64) compress(inner, padded, off, this.w);
    const innerDigest = stateToBytes(inner);
    const outer = new Uint32Array(this.outerState);
    const outerPadded = padMessage(innerDigest, 64);
    compress(outer, outerPadded, 0, this.w);
    return stateToBytes(outer);
  }
}

export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  return new Hmac(key).mac(message);
}

/** PBKDF2-HMAC-SHA256, 32 byte output (one block). */
export function pbkdf2Sha256(password: Uint8Array, salt: Uint8Array, iterations: number): Uint8Array {
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error("iterations must be a positive integer");
  const hmac = new Hmac(password);
  const first = new Uint8Array(salt.length + 4);
  first.set(salt);
  first[salt.length + 3] = 1;
  let u = hmac.mac(first);
  const t = new Uint8Array(u);
  for (let i = 1; i < iterations; i += 1) {
    u = hmac.mac(u);
    for (let j = 0; j < 32; j += 1) t[j] = (t[j] as number) ^ (u[j] as number);
  }
  return t;
}

export const utf8 = (s: string): Uint8Array => {
  // TextEncoder exists in Hermes (RN 0.81), browsers and Node.
  return new TextEncoder().encode(s);
};

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error("not hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Constant-time equality over two equal-length hex strings (a different length is simply unequal). */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
