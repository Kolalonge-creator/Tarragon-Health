import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { Card, CardContent } from "@/components/ui/card";
import { formatPatientDateTime } from "@/lib/format-date";

interface Row {
  encounter_id: string;
  type: string;
  status: string;
  scheduled_at: string;
  final_media_mode: string | null;
  patient_first_name: string;
}

const STATUS: Record<string, string> = {
  scheduled: "Booked",
  waiting: "Someone is waiting",
  in_progress: "In progress",
  completed: "Completed",
  no_show_patient: "Patient did not come",
  no_show_clinician: "Not attended",
  cancelled: "Cancelled",
  failed: "Failed",
};

/**
 * S21: today's and tomorrow's consultations for the signed-in clinician (spec 9.1, "Consultations"). my_clinician_encounters()
 * returns only this clinician's own, with the patient's first name and nothing else (INV-12).
 */
export default async function ClinicianConsultationsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_clinician_encounters" as never, {} as never);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <DashboardPlaceholder greeting="Consultations" roleLabel="Clinician" comingUp={[]}>
      {rows.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">No consultations booked for today or tomorrow.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.encounter_id}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-4 text-sm">
                  <div>
                    <p className="font-medium">{formatPatientDateTime(r.scheduled_at, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                    <p className="text-charcoal-ink/70 dark:text-night-ink/70">
                      {r.patient_first_name || "Patient"} · {STATUS[r.status] ?? r.status}
                      {r.final_media_mode === "audio_only" ? " · audio only" : r.final_media_mode === "phone" ? " · on the phone" : ""}
                    </p>
                  </div>
                  <Link href={`/clinician/consultation/${r.encounter_id}`} className="text-sm font-medium text-brand-green hover:underline">
                    Open the room →
                  </Link>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </DashboardPlaceholder>
  );
}
