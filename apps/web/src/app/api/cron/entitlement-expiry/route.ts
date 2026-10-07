import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Expire active entitlements whose `ends_at` has passed.
 *
 * Runs on a schedule (e.g. daily). For each active entitlement whose
 * `ends_at` is in the past, sets `state` to `expired`. The service-role
 * client bypasses RLS so this works across all organisations.
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

  const { data, error } = await supabase
    .from("entitlements")
    .update({ state: "expired" })
    .eq("state", "active")
    .lt("ends_at", new Date().toISOString())
    .select("id");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ expired: data?.length ?? 0 });
}
