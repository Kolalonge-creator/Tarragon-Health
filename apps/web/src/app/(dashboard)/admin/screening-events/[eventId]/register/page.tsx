import { redirect, notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { RegisterParticipantForm } from "./register-participant-form";

export default async function RegisterParticipantsPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const profile = await getCurrentProfile();
  if (!profile || profile.role === "patient" || !profile.organisation_id) redirect("/admin");

  const supabase = await createClient();
  const { data: event } = await supabase.from("screening_events").select("*").eq("id", eventId).maybeSingle();
  if (!event) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-charcoal-ink">{event.organiser_name}</h1>
        <p className="text-sm text-charcoal-ink/70">
          {event.registered_count} / {event.headcount_target} registered · {event.location_text} ·{" "}
          {event.event_date}
        </p>
      </div>
      {event.status !== "confirmed" ? (
        <p className="text-sm text-amber-700">
          This event isn&apos;t confirmed yet — record the deposit and balance first.
        </p>
      ) : (
        <RegisterParticipantForm
          eventId={event.id}
          registeredCount={event.registered_count}
          headcountTarget={event.headcount_target}
        />
      )}
    </div>
  );
}
