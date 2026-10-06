/** Signs a webhook the way Svix (Resend) does, so email tests can run without Resend. */
export async function signSvixRaw(secret: string, rawBody: string, nowMs: number): Promise<{ rawBody: string; headers: { id: string; timestamp: string; signature: string } }> {
  const id = `msg_${nowMs}`;
  const timestamp = String(Math.floor(nowMs / 1000));
  const bin = atob(secret.replace(/^whsec_/, ""));
  const keyBytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) keyBytes[i] = bin.charCodeAt(i);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`)));
  return { rawBody, headers: { id, timestamp, signature: `v1,${btoa(String.fromCharCode(...sig))}` } };
}

export const signSvix = (secret: string, body: unknown, nowMs: number) => signSvixRaw(secret, JSON.stringify(body), nowMs);
