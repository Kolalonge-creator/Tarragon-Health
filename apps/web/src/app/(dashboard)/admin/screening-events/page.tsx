import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { ScreeningEventsManager } from "./screening-events-manager";

export default async function ScreeningEventsPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role === "patient" || !profile.organisation_id) redirect("/admin");

  const supabase = await createClient();
  const [{ data: events }, { data: panels }] = await Promise.all([
    supabase.from("screening_events").select("*").order("created_at", { ascending: false }),
    supabase.from("panel_bundles").select("id, code, name, price_kobo").eq("is_active", true).order("name"),
  ]);

  return <ScreeningEventsManager events={events ?? []} panels={panels ?? []} />;
}
