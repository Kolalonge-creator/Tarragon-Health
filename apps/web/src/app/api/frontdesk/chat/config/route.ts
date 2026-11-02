import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { buildIntro } from "@/lib/frontdesk/chat-service";
import { formatLaunchDate, loadChatConfig } from "@/lib/frontdesk/config";
import { ENQUIRY_CONSENT_VERSION, ENQUIRY_CONSENT_WORDING } from "@/lib/frontdesk/lead-consent";

/** What the widget needs to start: whether the assistant is on, the opening disclosure, and the consent wording. Nothing secret, cacheable for a short time. */
export async function GET(): Promise<Response> {
  const fallback = { enabled: false, intro: "", consentWording: ENQUIRY_CONSENT_WORDING, consentVersion: ENQUIRY_CONSENT_VERSION, prelaunch: true, launchDate: "soon" };
  try {
    const { config, ok } = await loadChatConfig(createServiceRoleClient());
    const launchDate = formatLaunchDate(config.launchDate);
    return NextResponse.json(
      { enabled: ok && config.assistantEnabled, intro: buildIntro(config, launchDate), consentWording: ENQUIRY_CONSENT_WORDING, consentVersion: ENQUIRY_CONSENT_VERSION, prelaunch: config.prelaunch, launchDate },
      { headers: { "cache-control": "public, max-age=30, s-maxage=30" } },
    );
  } catch {
    // Unreadable means off: the widget falls back to the contact form.
    return NextResponse.json(fallback, { headers: { "cache-control": "no-store" } });
  }
}
