import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

/**
 * Private journal encryption (S57, function 10.8). The key is generated on the device and never leaves it; the server (only when the
 * person turns sync on) stores `ciphertext` it cannot read. Authenticated encryption, so a changed byte fails to open rather than
 * decrypting to garbage. Randomness is injected (`random`) so the caller uses the platform source (crypto.getRandomValues on web,
 * expo-crypto on mobile) and tests are deterministic.
 */
export const JOURNAL_ALG = "xchacha20poly1305-v1" as const;
const KEY_BYTES = 32;
const NONCE_BYTES = 24;

export type RandomBytes = (n: number) => Uint8Array;

export interface SealedEntry {
  readonly alg: typeof JOURNAL_ALG;
  readonly iv: string; // base64 nonce
  readonly ciphertext: string; // base64
}

export function toBase64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function newJournalKey(random: RandomBytes): Uint8Array {
  const k = random(KEY_BYTES);
  if (k.length !== KEY_BYTES) throw new Error("bad key length");
  return k;
}

/** `entryId` is bound as associated data, so a ciphertext cannot be moved under another entry. */
export function sealJournalEntry(key: Uint8Array, entryId: string, plaintext: string, random: RandomBytes): SealedEntry {
  if (key.length !== KEY_BYTES) throw new Error("bad key length");
  const nonce = random(NONCE_BYTES);
  if (nonce.length !== NONCE_BYTES) throw new Error("bad nonce length");
  const aad = new TextEncoder().encode(entryId);
  const ct = xchacha20poly1305(key, nonce, aad).encrypt(new TextEncoder().encode(plaintext));
  return { alg: JOURNAL_ALG, iv: toBase64(nonce), ciphertext: toBase64(ct) };
}

/** Returns null when the key is wrong or the data was changed (never throws on bad input). */
export function openJournalEntry(key: Uint8Array, entryId: string, sealed: SealedEntry): string | null {
  try {
    if (sealed.alg !== JOURNAL_ALG) return null;
    const aad = new TextEncoder().encode(entryId);
    const pt = xchacha20poly1305(key, fromBase64(sealed.iv), aad).decrypt(fromBase64(sealed.ciphertext));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
