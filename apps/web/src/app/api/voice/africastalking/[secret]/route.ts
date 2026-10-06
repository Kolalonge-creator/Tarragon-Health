import { constantTimeEqual, handleAfricasTalkingCallback } from "@tarragon/integrations";
import { createBridgeStore } from "@/lib/consultations/bridge-store";

/**
 * Africa's Talking Voice callback for the consultation phone bridge (S21, OQ-131). Their callbacks are not signed, so two things
 * protect this route: a long secret in the URL (AT_VOICE_CALLBACK_SECRET, set in the vendor dashboard as part of the callback URL),
 * and the fact that every callback must match a live bridge we created, so a guessed URL on its own does nothing. A wrong secret,
 * or no secret configured, answers 404 and nothing else (it never says which).
 *
 * The reply is always an XML action: an empty reply makes the vendor abort the call.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ secret: string }> }): Promise<Response> {
  const { secret } = await context.params;
  const expected = process.env.AT_VOICE_CALLBACK_SECRET;
  const callerNumber = process.env.AT_VOICE_NUMBER;
  if (!expected || expected.length < 24 || !callerNumber || !constantTimeEqual(secret, expected)) {
    return new Response("Not found", { status: 404 });
  }

  const form: Record<string, string> = {};
  try {
    (await request.formData()).forEach((value, key) => {
      if (typeof value === "string") form[key] = value;
    });
  } catch {
    // an unreadable body is handled like any other callback that matches nothing
  }

  const { xml } = await handleAfricasTalkingCallback(form, { store: createBridgeStore(), callerNumber });
  return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
}
