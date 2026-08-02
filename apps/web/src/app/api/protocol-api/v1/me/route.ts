import { NextResponse } from "next/server";
import { verifyApiKey } from "@/lib/integrations/api-key";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Key self-test for Protocol API licensees -- same shape as
 * /api/integrations/me. First call in every partner onboarding runbook
 * (docs/INTEGRATIONS_API.md § Protocol API).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const verified = await verifyApiKey(request);
  if (!verified) {
    return NextResponse.json({ error: "Invalid or revoked API key" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const { data: org } = await supabase
    .from("organisations")
    .select("name")
    .eq("id", verified.organisationId)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    organisation: org?.name ?? null,
    scopes: verified.scopes,
  });
}
