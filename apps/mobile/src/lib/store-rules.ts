/**
 * Pure rules for the encrypted local store (S06x). No I/O, so every branch is unit tested.
 */

/** The legacy plain database, kept by name only to find and remove it. */
export const LEGACY_DB_NAME = "tarragon-offline.db";

/** Encrypted store file for a generation. A new generation is started only when the key was lost. */
export function storeFileName(generation: number): string {
  return `tarragon-secure-${Math.max(1, Math.floor(generation))}.db`;
}

/** SQLCipher raw-key pragma. The key is 64 hex characters (256 bits); anything else is refused. */
export function keyPragma(hexKey: string): string {
  if (!/^[0-9a-f]{64}$/.test(hexKey)) throw new Error("store key must be 64 hex characters");
  return `PRAGMA key = "x'${hexKey}'";`;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

const WRONG_KEY = /file is not a database|not a database|file is encrypted|SQLITE_NOTADB|sqlite_notadb|hmac check failed/i;

/** True when an open/read error means "this file was written with a different key", not a disk or lock problem. */
export function isWrongKeyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return WRONG_KEY.test(message);
}

/** FNV-1a 32-bit over a string, as 8 hex characters. Not a security hash: a copy-integrity check. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function canonical(value: unknown): string {
  if (value === null || value === undefined) return "n";
  if (value instanceof Uint8Array) return `b${value.length}:${fnv1a(Array.from(value).join(","))}`;
  if (typeof value === "number") return `i${value}`;
  return `s${String(value).length}:${String(value)}`;
}

/** Order-sensitive checksum of rows (arrays of column values, in rowid order). Chain pages by passing the previous result as seed. */
export function rowsChecksum(rows: readonly (readonly unknown[])[], seed = ""): string {
  let acc = seed;
  for (const row of rows) acc = fnv1a(acc + "|" + row.map(canonical).join("\u0001"));
  return acc;
}

export interface TableSummary {
  table: string;
  count: number;
  checksum: string;
}

/** Empty list means the copy is faithful; otherwise one line per difference. */
export function compareSummaries(source: readonly TableSummary[], copy: readonly TableSummary[]): string[] {
  const problems: string[] = [];
  const byName = new Map(copy.map((t) => [t.table, t]));
  for (const s of source) {
    const c = byName.get(s.table);
    if (!c) problems.push(`${s.table}: missing in copy`);
    else if (c.count !== s.count) problems.push(`${s.table}: ${s.count} rows in source, ${c.count} in copy`);
    else if (c.checksum !== s.checksum) problems.push(`${s.table}: checksum differs`);
  }
  return problems;
}

/** Short code a patient can read to support. First 8 characters of an id, upper case. */
export function eventCode(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}

export type WipeReason = "lost_phone" | "stolen" | "admin" | "lease_expired";

export type LeaseVerdict = "ok" | "expired";

/**
 * Local key-lease check. leaseExpiresAt is the last value the server gave us. A clock that moved BACKWARDS
 * since the last successful check-in proves nothing about expiry, so it is read as "ok" (a forward jump cannot
 * be told from real time passing; that risk is recorded in docs/design/S06x.md).
 */
export function leaseVerdict(leaseExpiresAtIso: string | null, lastCheckinClockIso: string | null, now: Date): LeaseVerdict {
  if (!leaseExpiresAtIso) return "ok";
  if (lastCheckinClockIso && now.getTime() < new Date(lastCheckinClockIso).getTime()) return "ok";
  return now.getTime() >= new Date(leaseExpiresAtIso).getTime() ? "expired" : "ok";
}
