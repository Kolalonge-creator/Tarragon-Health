import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Daily: send the 7-day and 1-day reminders for confirmed testing-day places.
 *
 * The work is one database function (`send_testing_day_reminders`), which stamps each booking once per reminder, so two overlapping
 * runs, or a retry, can never remind the same person twice. The notices are neutral (a place and a date, never a test or a result).
 * Verifies the Vercel-attached CRON_SECRET bearer, same as the other cron routes. A reminder is a convenience: the booking and the
 * date are always in the app, so a failed run changes nothing about the visit itself.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("send_testing_day_reminders");
  if (error) {
    return Response.json({ error: "reminder run failed" }, { status: 500 });
  }
  return Response.json({ reminded: data ?? 0 });
}
