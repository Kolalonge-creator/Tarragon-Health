import { NextResponse } from "next/server";
import { hasScope, verifyApiKey } from "@/lib/integrations/api-key";
import { checkProtocolApiQuota } from "@/lib/protocol-api/check-quota";
import { logProtocolApiUsage } from "@/lib/protocol-api/log-usage";
import { bpTriageSchema } from "@/lib/validation/protocol-api";
import { classifyBpLevel, BP_LEVEL_LABEL, bpTrendNote } from "@/lib/rules/bp-classification";

/**
 * Stateless BP triage classifier -- one of the three Protocol API endpoints
 * (founder ask, 2026-07-31: "license or API-expose the escalation/risk/
 * protocol machinery"). Wraps classifyBpLevel verbatim, the same pure
 * function the platform's own patient/clinician BP badge renders from and
 * the DB red-flag trigger mirrors -- a partner gets Tarragon's real,
 * validated triage bands, not a reimplementation.
 *
 * Genuinely stateless: no patient record is read or written, no PHI is
 * persisted anywhere on this platform -- only the call itself is logged
 * (organisation_id, key, endpoint, timestamp), never the reading's values.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const verified = await verifyApiKey(request);
  if (!verified) {
    return NextResponse.json({ error: "Invalid or revoked API key" }, { status: 401 });
  }
  if (!hasScope(verified, "protocol_api:classify")) {
    return NextResponse.json({ error: "API key lacks the protocol_api:classify scope" }, { status: 403 });
  }
  const quota = await checkProtocolApiQuota(verified);
  if (!quota.allowed) {
    return NextResponse.json(
      { error: `Monthly quota exceeded (${quota.used}/${quota.limit} calls) — contact your account manager.` },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bpTriageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  logProtocolApiUsage(verified, "bp-triage");

  const level = classifyBpLevel(parsed.data.systolic, parsed.data.diastolic);
  return NextResponse.json({
    level,
    label: BP_LEVEL_LABEL[level],
    note: bpTrendNote(level),
    advisory: true,
    disclaimer:
      "Advisory triage guidance only, not a diagnosis -- confirm clinically before acting on an urgent/emergency band.",
  });
}
