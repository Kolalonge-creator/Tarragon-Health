import type { EmailProvider } from "../integrations/email.ts";
import { escapeHtml } from "./followup-render.ts";
import { unsubscribeToken } from "./unsubscribe-token.ts";

/** One handoff the database says must be announced (service_fd_claim_alerts). */
export interface ClaimedAlert {
  readonly handoff_id: string;
  readonly urgency: "normal" | "urgent";
  readonly reason: string;
  readonly summary: string | null;
  readonly suggested_reply: string | null;
  readonly conversation_id: string | null;
  readonly contact_name: string | null;
  readonly contact_email: string | null;
  readonly contact_phone: string | null;
  readonly transcript: readonly { readonly role: string; readonly content: string }[] | null;
  readonly attempts: number;
}

/** One founder reply the database says must be sent (service_fd_claim_replies). */
export interface ClaimedReply {
  readonly handoff_id: string;
  readonly contact_id: string;
  readonly email: string;
  readonly first_name: string | null;
  readonly reply: string;
  readonly attempts: number;
}

export interface DeliveryResult {
  readonly claimed: number;
  readonly sent: number;
  readonly failed: number;
  readonly unrecorded: number;
}

const REASON: Record<string, string> = {
  visitor_asked: "asked for a person",
  cannot_answer: "the assistant could not answer",
  ai_unavailable: "the assistant was unavailable",
  clinical_request: "asked for medical advice",
  emergency: "used emergency wording",
  complaint: "made a complaint",
  form_fallback: "left a message on the contact form",
};

/**
 * The email the founder gets for a handoff. An URGENT one says so in the subject and puts the emergency fact first, so it can be read from a
 * lock screen. Sent as `staff` audience (not patient-linted) because it has to carry what the visitor actually wrote. Plain, short, with a link.
 */
export function renderAlert(a: ClaimedAlert, appBaseUrl: string): { subject: string; text: string; html: string } {
  const urgent = a.urgency === "urgent";
  const why = REASON[a.reason] ?? a.reason;
  const who = [a.contact_name, a.contact_email, a.contact_phone].filter(Boolean).join(", ") || "No contact details left yet";
  const subject = urgent ? `URGENT: website chat, a visitor ${why}` : `Website chat: a visitor ${why}`;
  const transcript = (a.transcript ?? []).map((m) => `${m.role === "visitor" ? "Visitor" : m.role === "founder" ? "You" : "Assistant"}: ${m.content}`).join("\n");
  const link = `${appBaseUrl}/admin/inbox`;
  const text = [
    urgent ? "URGENT. This visitor used emergency wording. The assistant has told them to go to the nearest hospital." : null,
    `Who: ${who}`,
    a.summary ? `Summary: ${a.summary}` : null,
    a.suggested_reply ? `Suggested reply: ${a.suggested_reply}` : null,
    "",
    "Recent messages:",
    transcript || "(none)",
    "",
    `Open the inbox: ${link}`,
  ].filter((l) => l !== null).join("\n");
  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;max-width:600px">` +
    (urgent ? `<p style="background:#fdecea;border:1px solid #f5c2c0;padding:10px 12px;border-radius:8px"><strong>URGENT.</strong> This visitor used emergency wording. The assistant has told them to go to the nearest hospital.</p>` : "") +
    `<p><strong>Who:</strong> ${escapeHtml(who)}</p>` +
    (a.summary ? `<p><strong>Summary:</strong> ${escapeHtml(a.summary)}</p>` : "") +
    (a.suggested_reply ? `<p><strong>Suggested reply:</strong> ${escapeHtml(a.suggested_reply)}</p>` : "") +
    `<p><strong>Recent messages</strong></p><pre style="white-space:pre-wrap;font-family:inherit;background:#f4f6f5;padding:10px;border-radius:8px">${escapeHtml(transcript || "(none)")}</pre>` +
    `<p><a href="${escapeHtml(link)}">Open the inbox</a></p></div>`;
  return { subject, text, html };
}

export interface AlertDeps {
  readonly email: EmailProvider;
  readonly to: string;
  readonly appBaseUrl: string;
  readonly claim: (limit: number) => Promise<{ ok: true; alerts: readonly ClaimedAlert[] } | { ok: false; error: string }>;
  readonly finish: (handoffId: string, ok: boolean, error: string | null) => Promise<void>;
}

/** Sends each claimed alert to the founder. Never throws. Urgent ones were claimed first. */
export async function deliverAlerts(deps: AlertDeps): Promise<DeliveryResult | { error: string }> {
  const claimed = await deps.claim(10);
  if (!claimed.ok) return { error: claimed.error };
  let sent = 0;
  let failed = 0;
  let unrecorded = 0;
  for (const a of claimed.alerts) {
    let delivered = false;
    try {
      const mail = renderAlert(a, deps.appBaseUrl);
      const res = await deps.email.send({
        to: deps.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        audience: "staff",
        // One alert per handoff and attempt: a retry after a send that succeeded but was not recorded is deduplicated by the provider.
        idempotencyKey: `fd-alert-${a.handoff_id}-${a.urgency}`,
        tags: { source: "front_desk", kind: a.urgency === "urgent" ? "alert_urgent" : "alert" },
      });
      if (res.ok) {
        delivered = true;
        await deps.finish(a.handoff_id, true, null);
        sent += 1;
      } else {
        await deps.finish(a.handoff_id, false, `${res.error.code}: ${res.error.message}`);
        failed += 1;
      }
    } catch (e) {
      if (delivered) unrecorded += 1;
      else {
        await deps.finish(a.handoff_id, false, e instanceof Error ? e.message : "unknown").catch(() => undefined);
        failed += 1;
      }
    }
  }
  return { claimed: claimed.alerts.length, sent, failed, unrecorded };
}

export interface ReplyDeps {
  readonly email: EmailProvider;
  readonly appBaseUrl: string;
  readonly unsubscribeSecret: string;
  readonly claim: (limit: number) => Promise<{ ok: true; replies: readonly ClaimedReply[] } | { ok: false; error: string }>;
  readonly finish: (handoffId: string, ok: boolean, messageId: string | null, error: string | null) => Promise<void>;
}

/**
 * Sends the founder's reply to the visitor by email (their original channel, now that they left an address). It is a person's own words, so it is
 * sent as `staff` audience, with a short footer and the one-click unsubscribe so the person can always stop hearing from us.
 */
export async function deliverReplies(deps: ReplyDeps): Promise<DeliveryResult | { error: string }> {
  const claimed = await deps.claim(10);
  if (!claimed.ok) return { error: claimed.error };
  let sent = 0;
  let failed = 0;
  let unrecorded = 0;
  for (const r of claimed.replies) {
    let delivered = false;
    try {
      const token = await unsubscribeToken(deps.unsubscribeSecret, r.contact_id);
      const unsub = `${deps.appBaseUrl}/api/frontdesk/unsubscribe?c=${r.contact_id}&t=${token}`;
      const text = `${r.reply.trim()}\n\n--\nThis is a reply from the TarragonHealth team to your message.\nStop these emails: ${unsub}\n`;
      const html =
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.55;max-width:560px">` +
        r.reply.trim().split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("") +
        `<hr style="border:none;border-top:1px solid #dde5e2;margin:22px 0"><p style="margin:0;font-size:13px;color:#5b6b68">This is a reply from the TarragonHealth team to your message.<br><a href="${escapeHtml(unsub)}">Stop these emails</a></p></div>`;
      const res = await deps.email.send({
        to: r.email,
        subject: "Your question to TarragonHealth",
        text,
        html,
        audience: "staff",
        idempotencyKey: `fd-reply-${r.handoff_id}`,
        tags: { source: "front_desk", kind: "founder_reply" },
        headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      if (res.ok) {
        delivered = true;
        await deps.finish(r.handoff_id, true, res.data.providerMessageId, null);
        sent += 1;
      } else {
        await deps.finish(r.handoff_id, false, null, `${res.error.code}: ${res.error.message}`);
        failed += 1;
      }
    } catch (e) {
      if (delivered) unrecorded += 1;
      else {
        await deps.finish(r.handoff_id, false, null, e instanceof Error ? e.message : "unknown").catch(() => undefined);
        failed += 1;
      }
    }
  }
  return { claimed: claimed.replies.length, sent, failed, unrecorded };
}
