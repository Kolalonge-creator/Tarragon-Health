import { NextResponse } from "next/server";
import { z } from "zod";
import { handleChatTurn } from "@/lib/frontdesk/chat-service";
import { createChatDeps } from "@/lib/frontdesk/chat-runtime";
import { clientIp, hashSecret, isAllowedOrigin, isJson, newConversationSecret } from "@/lib/frontdesk/chat-http";
import { classifyIncoming, fixedReplyFor } from "@/lib/frontdesk/safety";
import { rateLimit } from "@/lib/rate-limit";

/**
 * The website chat (Front Desk F1). Public by design, so it is defended in layers: JSON only, an allowed Origin, rate limits per connection and
 * per conversation, a message length cap, a per-session message cap and a daily spend cap (both in the database), and a kill switch. The
 * conversation secret is generated here, shown to the browser once, and stored only as a hash.
 *
 * An EMERGENCY message is never turned away: if the request is rate limited, or anything throws, the fixed emergency reply is still returned.
 */
const bodySchema = z
  .object({
    conversationId: z.string().uuid().optional(),
    secret: z.string().min(40).max(64).optional(),
    message: z.string().trim().min(1).max(1000),
    page: z.string().trim().max(200).optional(),
  })
  .refine((b) => (b.conversationId === undefined) === (b.secret === undefined), { message: "conversationId and secret go together" });

const noStore = { "cache-control": "no-store" } as const;

function emergencyOnly(message: string): Response | null {
  const rule = classifyIncoming(message);
  if (rule.kind !== "emergency") return null;
  return NextResponse.json(
    { mode: "chat", conversationId: null, reply: fixedReplyFor(rule), status: "emergency", needsContact: true, emergency: true },
    { headers: noStore },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (!isJson(request.headers)) return NextResponse.json({ error: "json_only" }, { status: 415, headers: noStore });
  if (!isAllowedOrigin(request.headers.get("origin"), request.headers.get("host"), process.env.WIDGET_ALLOWED_ORIGINS)) {
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403, headers: noStore });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: noStore });
  const { conversationId, secret, message, page } = parsed.data;

  try {
    const ip = clientIp(request.headers);
    const [burst, daily, perConversation] = await Promise.all([
      rateLimit(`fd-chat:ip:${ip}`, { limit: 20, windowSeconds: 600 }),
      rateLimit(`fd-chat:ip-day:${ip}`, { limit: 150, windowSeconds: 86_400 }),
      conversationId ? rateLimit(`fd-chat:conv:${conversationId}`, { limit: 10, windowSeconds: 60 }) : Promise.resolve({ success: true, retryAfterSeconds: 0 }),
    ]);
    if (!burst.success || !daily.success || !perConversation.success) {
      // Rate limiting must never stand between a person in an emergency and the answer.
      const emergency = emergencyOnly(message);
      if (emergency) return emergency;
      const retry = Math.max(burst.retryAfterSeconds, daily.retryAfterSeconds, perConversation.retryAfterSeconds, 1);
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { ...noStore, "retry-after": String(retry) } });
    }

    const newSecret = secret ? null : newConversationSecret();
    const result = await handleChatTurn(createChatDeps(), {
      conversationId: conversationId ?? null,
      secretHash: hashSecret(secret ?? (newSecret as string)),
      text: message,
      page: page ?? "",
    });
    if (result.mode === "form") return NextResponse.json({ mode: "form", reason: result.reason }, { headers: noStore });
    if (result.mode === "error") return NextResponse.json({ error: result.reason }, { status: result.reason === "not_found" ? 404 : 409, headers: noStore });
    return NextResponse.json({ ...result, ...(newSecret ? { secret: newSecret } : {}) }, { headers: noStore });
  } catch (e) {
    console.error("front desk chat failed", e);
    return emergencyOnly(message) ?? NextResponse.json({ mode: "form", reason: "error" }, { headers: noStore });
  }
}
