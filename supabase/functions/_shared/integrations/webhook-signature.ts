// S10x-b: signing for partner webhooks, shared by the drainer and its tests (an edge function cannot import a workspace package).
//
// Two headers are sent. The original X-Tarragon-Signature (sha256 of the body, no timestamp) is kept so any endpoint built against it
// keeps working. The new X-Tarragon-Signature-V2 is "t=<unix seconds>,v1=<hex>" where hex is HMAC-SHA256 over "<t>.<body>"; the
// timestamp lets a receiver reject a replayed request. During a key rotation grace window a second "v1=" is added, signed with the
// previous secret, so a receiver can verify against either key. Receivers accept the request if ANY v1 matches.

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function legacySignature(secret: string, rawBody: string): Promise<string> {
  return `sha256=${await hmacHex(secret, rawBody)}`;
}

export async function signatureV2(secret: string, previousSecret: string | null, timestampSeconds: number, rawBody: string): Promise<string> {
  const signed = `${timestampSeconds}.${rawBody}`;
  const parts = [`t=${timestampSeconds}`, `v1=${await hmacHex(secret, signed)}`];
  if (previousSecret) parts.push(`v1=${await hmacHex(previousSecret, signed)}`);
  return parts.join(",");
}

export interface SignedHeaders {
  "X-Tarragon-Signature": string;
  "X-Tarragon-Signature-V2": string;
  "X-Tarragon-Timestamp": string;
}

export async function signedHeaders(secret: string, previousSecret: string | null, nowMs: number, rawBody: string): Promise<SignedHeaders> {
  const t = Math.floor(nowMs / 1000);
  return {
    "X-Tarragon-Signature": await legacySignature(secret, rawBody),
    "X-Tarragon-Signature-V2": await signatureV2(secret, previousSecret, t, rawBody),
    "X-Tarragon-Timestamp": String(t),
  };
}

/** Receiver-side check, used by the tests and as the reference for partner documentation. */
export async function verifyV2(header: string, secrets: string[], rawBody: string, nowMs: number, toleranceSeconds = 300): Promise<boolean> {
  const parts = header.split(",").map((p) => p.trim());
  const t = Number(parts.find((p) => p.startsWith("t="))?.slice(2));
  if (!Number.isFinite(t) || Math.abs(Math.floor(nowMs / 1000) - t) > toleranceSeconds) return false;
  const given = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  for (const secret of secrets) {
    const expected = await hmacHex(secret, `${t}.${rawBody}`);
    if (given.includes(expected)) return true;
  }
  return false;
}
