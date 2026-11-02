import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createChatDb } from "@/lib/frontdesk/chat-db";
import { handleChatTurn } from "@/lib/frontdesk/chat-service";
import { createChatDeps } from "@/lib/frontdesk/chat-runtime";
import { clientIp, hashSecret, isAllowedOrigin, isJson, newConversationSecret } from "@/lib/frontdesk/chat-http";
import { fdRpcData } from "@/lib/frontdesk/raw-db";
import { ENQUIRY_CONSENT_VERSION, ENQUIRY_CONSENT_WORDING, parseLeadContact } from "@/lib/frontdesk/lead-consent";
import { classifyIncoming, fixedReplyFor } from "@/lib/frontdesk/safety";
import { rateLimit } from "@/lib/rate-limit";

/**
 * The visitor leaves their details (Front Desk F4), either at the end of a chat that needs a person, or from the contact form the widget shows
 * when the assistant is off or over its spend cap. Capture needs the explicit consent tick, which is checked here AND by the database; the
 * wording stored is this site's own constant, never text from the request.
 *
 * With no conversation (the form fallback) a conversation is opened for the message so a person sees it in the inbox like any handoff. An
 * emergency in that message is answered first, exactly as in the chat.
 */
const bodySchema = z
  .object({
    conversationId: z.string().uuid().optional(),
    secret: z.string().min(40).max(64).optional(),
    name: z.string().trim().min(2).max(120),
    contact: z.string().trim().min(5).max(200),
    consent: z.literal(true),
    message: z.string().trim().max(1000).optional(),
  })
  .refine((b) => (b.conversationId === undefined) === (b.secret === undefined), { message: "conversationId and secret go together" });

const noStore = { "cache-control": "no-store" } as const;

export async function POST(request: Request): Promise<Response> {
  if (!isJson(request.headers)) return NextResponse.json({ error: "json_only" }, { status: 415, headers: noStore });
  if (!isAllowedOrigin(request.headers.get("origin"), request.headers.get("host"), process.env.WIDGET_ALLOWED_ORIGINS)) {
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403, headers: noStore });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request", detail: parsed.error.issues[0]?.message ?? "invalid" }, { status: 400, headers: noStore });
  const body = parsed.data;

  // An emergency typed into the contact form is answered at once, before any limit or capture.
  if (body.message) {
    const rule = classifyIncoming(body.message);
    if (rule.kind === "emergency") {
      try {
        const secret = body.secret ?? newConversationSecret();
        const turn = await handleChatTurn(createChatDeps(), { conversationId: body.conversationId ?? null, secretHash: hashSecret(secret), text: body.message, page: "contact-form" });
        if (turn.mode === "chat") return NextResponse.json({ ...turn, ...(body.secret ? {} : { secret }) }, { headers: noStore });
      } catch (e) {
        console.error("front desk contact emergency failed", e);
      }
      return NextResponse.json({ mode: "chat", conversationId: null, reply: fixedReplyFor(rule), status: "emergency", needsContact: true, emergency: true }, { headers: noStore });
    }
  }

  const limited = await rateLimit(`fd-contact:ip:${clientIp(request.headers)}`, { limit: 6, windowSeconds: 3600 }).catch(() => ({ success: true, retryAfterSeconds: 0 }));
  if (!limited.success) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { ...noStore, "retry-after": String(limited.retryAfterSeconds || 60) } });

  const details = parseLeadContact(body.contact);
  if (!details.email && !details.phone) return NextResponse.json({ error: "invalid_request", detail: "Enter an email address or a phone number" }, { status: 400, headers: noStore });

  try {
    const supabase = createServiceRoleClient();
    const db = createChatDb(supabase);
    let conversationId = body.conversationId ?? null;
    let secret = body.secret ?? null;
    let opened = false;
    if (conversationId === null) {
      secret = newConversationSecret();
      conversationId = await db.open(hashSecret(secret), "contact-form", "Contact form (the assistant was not available).");
      opened = true;
      if (body.message) await db.turn(conversationId, hashSecret(secret), body.message);
    }
    const captured = await fdRpcData<{ captured: boolean; reason?: string }>(supabase, "service_fd_chat_capture", {
      p_conv: conversationId,
      p_secret_hash: hashSecret(secret as string),
      p_name: body.name,
      p_email: details.email,
      p_phone: details.phone,
      p_consent: true,
      p_wording: ENQUIRY_CONSENT_WORDING,
      p_wording_version: ENQUIRY_CONSENT_VERSION,
    });
    if (captured.error || !captured.data) throw new Error(captured.error ?? "no result");
    if (!captured.data.captured) {
      return NextResponse.json({ error: captured.data.reason === "not_found" ? "not_found" : "not_captured" }, { status: captured.data.reason === "not_found" ? 404 : 400, headers: noStore });
    }
    // The form fallback is itself a request for a person; a chat that already handed off has its handoff and now has contact details on it.
    if (opened) {
      await fdRpcData(supabase, "service_fd_chat_handoff", {
        p_conv: conversationId,
        p_reason: "form_fallback",
        p_urgency: "normal",
        p_summary: `Contact form message from ${body.name}: "${(body.message ?? "").slice(0, 400)}"`,
        p_suggested_reply: null,
      });
    }
    return NextResponse.json({ captured: true, ...(opened ? { conversationId, secret } : {}) }, { headers: noStore });
  } catch (e) {
    console.error("front desk contact capture failed", e);
    return NextResponse.json({ error: "could_not_save" }, { status: 500, headers: noStore });
  }
}
