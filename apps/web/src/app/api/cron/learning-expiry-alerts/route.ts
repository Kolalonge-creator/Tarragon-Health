import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Learning content expiry alerts. Once a day (06:15 UTC, 07:15 in Lagos; nothing here runs more than daily) the database function
 * public.learning_expiry_run_alerts sends ONE generic in-app notice to the owner of any learning item that is exactly 30, 14 or 7 days
 * from its review date (the days are versioned configuration, learning_config key expiry_alerts, PROPOSED) and ONE digest to each active
 * Chief Medical Officer. The notices carry a count and no item title (INV-07). Safe to run twice in a day: a unique index in the database
 * makes the second run a no-op. This job never changes what a patient can read; the S55 rule that hides an item on its review date is
 * separate and untouched. If the run fails the route returns 500 so a broken run is seen. Verifies the Vercel-attached CRON_SECRET bearer.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }
  const svc = createServiceRoleClient() as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await svc.rpc("learning_expiry_run_alerts", {});
  if (error) {
    return Response.json({ error: "learning_expiry_alerts_failed", message: error.message }, { status: 500 });
  }
  return Response.json(data ?? {}, { status: 200 });
}
