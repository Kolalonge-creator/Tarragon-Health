/**
 * Resend webhook helpers (S13): Svix signature check and the mapping from a Resend event to our delivery event.
 * Resend signs with Svix: HMAC-SHA256 over `${id}.${timestamp}.${body}` keyed by the base64 part of the `whsec_` secret.
 */
export interface SvixHeaders { readonly id: string | null; readonly timestamp: string | null; readonly signature: string | null }

const b64ToBytes = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (b: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(b)));

export async function verifySvix(secret: string, h: SvixHeaders, body: string, nowMs: number, toleranceSec = 300): Promise<boolean> {
  if (!h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > toleranceSec) return false;
  const key = await crypto.subtle.importKey("raw", b64ToBytes(secret.replace(/^whsec_/, "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = bytesToB64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${h.id}.${h.timestamp}.${body}`)));
  // The header can hold several space separated "v1,<sig>" values (key rotation); any match passes.
  return h.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig || sig.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  });
}

export interface ResendEvent {
  readonly type?: string;
  readonly data?: { readonly email_id?: string; readonly to?: readonly string[]; readonly bounce?: { readonly type?: string } };
}
export type MappedResend = { readonly event: "delivered" | "bounced" | "complained" | "failed" | "opened"; readonly emailId: string; readonly email: string | null };

/** Only a hard bounce suppresses an address; a soft bounce (full mailbox) is recorded as failed and retried by the sender's own limits. */
export function mapResendEvent(e: ResendEvent): MappedResend | null {
  const emailId = e.data?.email_id;
  if (!emailId || !e.type) return null;
  const email = e.data?.to?.[0]?.toLowerCase() ?? null;
  switch (e.type) {
    case "email.delivered": return { event: "delivered", emailId, email };
    case "email.opened": return { event: "opened", emailId, email };
    case "email.complained": return { event: "complained", emailId, email };
    case "email.bounced": return { event: e.data?.bounce?.type === "Permanent" ? "bounced" : "failed", emailId, email };
    case "email.failed": return { event: "failed", emailId, email };
    default: return null;
  }
}
