import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { deviceFaultReportSchema } from "@/lib/validation/device-fault-report";

/**
 * Device fault reporting — spec §52.12's "My BP machine isn't working"
 * workflow. Same bearer-auth shape as
 * apps/web/src/app/api/mobile/device-readings/route.ts: the Expo app's
 * Devices screen is where a patient manages a paired device, so that's
 * where reporting a problem with it lives too.
 *
 * Writes under the caller's own RLS session (not service-role) — the
 * device_fault_reports_insert policy already allows a patient to file a
 * report against their own patient_id, so there is nothing here that needs
 * elevated privilege. Staff pick these up by querying device_fault_reports
 * directly (RLS already grants org staff full visibility) — there is no
 * dedicated "technical support" role/queue to page yet, so this
 * deliberately does not invent one.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) {
    return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = deviceFaultReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  const { patient_device_id, description } = parsed.data;

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: "No organisation on file" }, { status: 400 });
  }

  // Same "clean 404 over a silent RLS-empty result" reasoning as
  // device-readings — confirms the device is actually the caller's own
  // before filing anything against it, and picks up device_unit_id when
  // this pairing is linked to a registered physical unit.
  const { data: device } = await supabase
    .from("patient_devices")
    .select("id, device_unit_id")
    .eq("id", patient_device_id)
    .eq("patient_id", user.id)
    .maybeSingle();
  if (!device) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }

  const { data: report, error: insertError } = await supabase
    .from("device_fault_reports")
    .insert({
      organisation_id: profile.organisation_id,
      patient_id: user.id,
      patient_device_id: device.id,
      device_unit_id: device.device_unit_id,
      reported_by: user.id,
      description,
    })
    .select("id, status")
    .single();

  if (insertError || !report) {
    return NextResponse.json({ error: insertError?.message ?? "Failed to file report" }, { status: 500 });
  }

  return NextResponse.json({ success: true, report_id: report.id, status: report.status });
}
