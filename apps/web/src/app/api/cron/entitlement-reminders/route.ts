import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Send expiry-reminder notifications for entitlements ending within 7 days.
 *
 * Runs on a schedule (e.g. daily). Finds active entitlements where `ends_at`
 * is within 7 days and `reminded_at` is still null, inserts an in-app
 * notification for each, and stamps `reminded_at` so the same entitlement
 * is never reminded twice.
 *
 * Verifies the Vercel-attached CRON_SECRET bearer, same as the other cron
 * routes.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const sevenDaysFromNow = new Date();
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

  // Claim first, notify second, in that order: the claim (reminded_at) is one atomic UPDATE ... RETURNING, so two overlapping runs can
  // never both remind the same entitlement, and a failed notification puts the claim back so the next run tries again.
  const { data: claimed } = await supabase
    .from("entitlements")
    .update({ reminded_at: new Date().toISOString() })
    .eq("state", "active")
    .is("reminded_at", null)
    .lte("ends_at", sevenDaysFromNow.toISOString())
    .gt("ends_at", new Date().toISOString())
    .select("id, patient_id, organisation_id, ends_at, kind");

  let reminded = 0;

  for (const ent of claimed ?? []) {
    // The payload carries the kind and the date only, never an item name (INV-07 keeps notification text neutral).
    const { error: notifErr } = await supabase.from("notifications").insert({
      organisation_id: ent.organisation_id,
      recipient_id: ent.patient_id,
      channel: "in_app",
      status: "pending",
      template: "entitlement_expiring_soon",
      payload: {
        entitlement_id: ent.id,
        kind: ent.kind,
        ends_at: ent.ends_at,
      },
    });

    if (notifErr) {
      await supabase.from("entitlements").update({ reminded_at: null }).eq("id", ent.id);
      continue;
    }

    reminded += 1;
  }

  return Response.json({ reminded });
}
