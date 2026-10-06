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

  const { data: expiring } = await supabase
    .from("entitlements")
    .select(
      "id, patient_id, organisation_id, ends_at, kind, order:orders!entitlements_order_id_fkey(catalog_item:catalog_items(name))",
    )
    .eq("state", "active")
    .is("reminded_at", null)
    .lte("ends_at", sevenDaysFromNow.toISOString())
    .gt("ends_at", new Date().toISOString());

  let reminded = 0;

  for (const ent of expiring ?? []) {
    const order = ent.order as { catalog_item: { name: string } | null } | null;
    const itemName = order?.catalog_item?.name ?? ent.kind;

    const { error: notifErr } = await supabase.from("notifications").insert({
      organisation_id: ent.organisation_id,
      recipient_id: ent.patient_id,
      channel: "in_app",
      status: "pending",
      template: "entitlement_expiring_soon",
      payload: {
        entitlement_id: ent.id,
        kind: ent.kind,
        item_name: itemName,
        ends_at: ent.ends_at,
      },
    });

    if (notifErr) continue;

    await supabase
      .from("entitlements")
      .update({ reminded_at: new Date().toISOString() })
      .eq("id", ent.id);

    reminded += 1;
  }

  return Response.json({ reminded });
}
