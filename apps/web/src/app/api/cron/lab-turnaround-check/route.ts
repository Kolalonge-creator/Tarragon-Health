import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * §56.11 turnaround-time delay alerting — the sweep that populates
 * lab_turnaround_alerts (schema-only, 20260829123436). Same shape as every
 * other periodic job in apps/web/src/app/api/cron/ (video-visit-refunds,
 * wearable-sync): CRON_SECRET bearer auth, service-role client, plain table
 * reads/writes rather than a SECURITY DEFINER SQL function — see that
 * migration's own comment for why this pattern was chosen over a new one.
 *
 * Expected turnaround for a specimen is the WORST case across its order's
 * panel — the slowest test in a bundle is what actually determines when a
 * patient should have a result, and understating it would silence a real
 * delay. The clock starts at collected_at once a sample is drawn, or
 * payment_confirmed_at/ordered_at before that — a specimen that has sat in
 * pending_collection too long is exactly as much an operational problem as
 * one stuck in processing.
 *
 * lab_turnaround_alerts_one_open_per_specimen (a partial unique index on
 * specimen_id where acknowledged_at is null) is the actual guarantee against
 * a duplicate alert; this route still checks first so a re-run doesn't spam
 * failed-insert noise into the logs on every specimen already flagged.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: openSpecimens } = await supabase
    .from("lab_specimens")
    .select("id, organisation_id, lab_order_id, provider_id, collected_at, created_at")
    .not("status", "in", "(completed,rejected)");

  const specimens = openSpecimens ?? [];
  if (specimens.length === 0) {
    return Response.json({ checked: 0, flagged: 0 });
  }

  const orderIds = [...new Set(specimens.map((s) => s.lab_order_id))];
  const { data: labOrders } = await supabase
    .from("lab_orders")
    .select("id, payment_confirmed_at, ordered_at, panel_bundle_id")
    .in("id", orderIds);
  const orderById = new Map((labOrders ?? []).map((o) => [o.id, o]));

  const { data: existingAlerts } = await supabase
    .from("lab_turnaround_alerts")
    .select("specimen_id")
    .is("acknowledged_at", null);
  const alreadyFlagged = new Set((existingAlerts ?? []).map((a) => a.specimen_id));

  const bundleIds = [
    ...new Set(specimens.map((s) => orderById.get(s.lab_order_id)?.panel_bundle_id).filter((v): v is string => !!v)),
  ];
  const { data: bundles } = await supabase
    .from("panel_bundles")
    .select("id, test_codes")
    .in("id", bundleIds.length > 0 ? bundleIds : ["00000000-0000-0000-0000-000000000000"]);
  const testCodesByBundle = new Map((bundles ?? []).map((b) => [b.id, b.test_codes]));

  const providerIds = [...new Set(specimens.map((s) => s.provider_id).filter((v): v is string => !!v))];
  const { data: labTests } = await supabase
    .from("lab_tests")
    .select("provider_id, code, turnaround_hours")
    .in("provider_id", providerIds.length > 0 ? providerIds : ["00000000-0000-0000-0000-000000000000"]);
  const turnaroundByProviderCode = new Map(
    (labTests ?? []).map((t) => [`${t.provider_id}:${t.code}`, t.turnaround_hours ?? null]),
  );

  const nowMs = Date.now();
  let flagged = 0;

  for (const specimen of specimens) {
    const order = orderById.get(specimen.lab_order_id);
    if (alreadyFlagged.has(specimen.id) || !specimen.provider_id || !order) continue;

    const testCodes = testCodesByBundle.get(order.panel_bundle_id ?? "") ?? [];
    const hoursList = testCodes
      .map((code) => turnaroundByProviderCode.get(`${specimen.provider_id}:${code}`))
      .filter((h): h is number => h != null);
    if (hoursList.length === 0) continue; // no turnaround data on file — nothing to compare against
    const expectedHours = Math.max(...hoursList);

    const referenceIso = specimen.collected_at ?? order.payment_confirmed_at ?? order.ordered_at ?? specimen.created_at;
    const elapsedHours = (nowMs - new Date(referenceIso).getTime()) / 3_600_000;
    if (elapsedHours <= expectedHours) continue;

    const { error } = await supabase.from("lab_turnaround_alerts").insert({
      organisation_id: specimen.organisation_id,
      lab_order_id: specimen.lab_order_id,
      specimen_id: specimen.id,
      provider_id: specimen.provider_id,
      expected_hours: expectedHours,
      elapsed_hours: elapsedHours,
      severity: elapsedHours > expectedHours * 1.5 ? "critical" : "warning",
    });
    if (!error) flagged += 1;
  }

  return Response.json({ checked: specimens.length, flagged });
}
