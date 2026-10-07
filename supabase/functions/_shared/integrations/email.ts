import type { MappedResend, SvixHeaders } from "../notifications/resend.ts";
import { lintText } from "../notifications/neutral.ts";
import { verifySvix, mapResendEvent, type ResendEvent } from "../notifications/resend.ts";
import { isEmailShape } from "./ids.ts";
import { fail, ok, type ProviderResult } from "./result.ts";

/**
 * Email (spec section 10, Resend). Every send needs an idempotency key so a retried job never sends twice. Mail to a
 * patient is checked against the INV-07 word list here, at the boundary, in addition to the template lint in S13: a call
 * site cannot send a clinical word by building the text by hand. Attachment file names are checked too (OQ-91).
 */
export type EmailAudience = "patient" | "staff";

export interface EmailAttachment {
  readonly filename: string;
  /** Base64 content. */
  readonly contentBase64: string;
}
export interface SendEmailInput {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  /** `patient` mail is linted for INV-07; `staff` mail (partner, clinician) is not, because it may need operational detail. */
  readonly audience: EmailAudience;
  /** Stable for one logical send, for example `${notificationId}:email`. */
  readonly idempotencyKey: string;
  /** Letters, digits, dash and underscore only (the vendor's rule). */
  readonly tags?: Readonly<Record<string, string>>;
  readonly attachments?: readonly EmailAttachment[];
}
export interface SentEmail {
  readonly providerMessageId: string;
}

export interface EmailProvider {
  readonly name: "resend" | "mock";
  readonly isMock: boolean;
  send(input: SendEmailInput): Promise<ProviderResult<SentEmail>>;
  /** Checks the Svix signature on the RAW body, then maps to our delivery event. Unmapped event types return `null` data. */
  parseWebhook(rawBody: string, headers: SvixHeaders, nowMs: number): Promise<ProviderResult<MappedResend | null>>;
}

const TAG = /^[A-Za-z0-9_-]{1,256}$/;

/** Shared input rules, so the mock refuses what the real adapter would. Returns a failure or null when the input is fine. */
export function validateSendEmail(input: SendEmailInput): ProviderResult<never> | null {
  if (!isEmailShape(input.to)) return fail("invalid_input", "Recipient address is not valid");
  if (input.subject.trim().length === 0 || input.subject.length > 200) return fail("invalid_input", "Subject is required and must be short");
  if (input.text.trim().length === 0) return fail("invalid_input", "A plain text body is required");
  if (input.idempotencyKey.length === 0 || input.idempotencyKey.length > 256) return fail("invalid_input", "Idempotency key is required");
  for (const [k, v] of Object.entries(input.tags ?? {})) {
    if (!TAG.test(k) || !TAG.test(v)) return fail("invalid_input", "Tags may hold letters, digits, dash and underscore only");
  }
  if (input.audience === "patient") {
    const texts = [input.subject, input.text, stripTags(input.html ?? ""), ...(input.attachments ?? []).map((a) => a.filename)];
    for (const t of texts) {
      if (lintText(t).length > 0) return fail("blocked_content", "Patient email may not name a condition, reading, result or medicine", false);
    }
  }
  return null;
}

/** Replaces each `<...>` tag with a space. A scan, not a regular expression, so a hostile string cannot make it slow. */
export function stripTags(html: string): string {
  let out = "";
  let i = 0;
  while (i < html.length) {
    const open = html.indexOf("<", i);
    if (open === -1) break;
    const close = html.indexOf(">", open + 1);
    if (close === -1) break;
    out += html.slice(i, open) + " ";
    i = close + 1;
  }
  return out + html.slice(i);
}

/** Svix signature check on the RAW body, then the S13 mapping. Shared by the Resend adapter and the mock so they cannot drift. */
export async function parseResendWebhook(secret: string, rawBody: string, headers: SvixHeaders, nowMs: number): Promise<ProviderResult<MappedResend | null>> {
  if (!(await verifySvix(secret, headers, rawBody, nowMs))) return fail("invalid_signature", "Signature does not match", false);
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return fail("bad_response", "Webhook body is not JSON", false);
  }
  const root = typeof json === "object" && json !== null && !Array.isArray(json) ? (json as ResendEvent) : {};
  return ok(mapResendEvent(root));
}
