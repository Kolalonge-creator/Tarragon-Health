import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LifestyleFlagsClient, type OpenFlag } from "./lifestyle-flags-client";

/**
 * Clinician worklist for open LPE safety red flags. Org-staff gated (defense in
 * depth on top of RLS). Standing a flag down is clinical-staff-only + reason,
 * enforced in the action and by the DB trigger (no auto-close).
 */
export default async function LifestyleFlagsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id, role")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) redirect("/");

  const { data: flags } = await supabase
    .from("lpe_red_flag_events")
    .select("id, patient_id, rule_key, severity, escalation_level, action, opened_at")
    .eq("status", "open")
    .order("opened_at", { ascending: true });

  // Resolve patient display names in one round-trip.
  const patientIds = [...new Set((flags ?? []).map((f) => f.patient_id))];
  const nameById = new Map<string, string>();
  if (patientIds.length) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", patientIds);
    for (const p of people ?? []) nameById.set(p.id, p.full_name ?? "Patient");
  }

  const open: OpenFlag[] = (flags ?? []).map((f) => ({
    id: f.id,
    patientName: nameById.get(f.patient_id) ?? "Patient",
    ruleKey: f.rule_key,
    severity: f.severity,
    escalationLevel: f.escalation_level,
    action: f.action,
    openedAt: f.opened_at,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Lifestyle safety flags</h1>
        <p className="text-muted-foreground text-sm">
          Open red flags from patients&apos; lifestyle logs. Review, then stand
          each one down with a reason once the patient has been contacted.
        </p>
      </div>
      <LifestyleFlagsClient flags={open} />
    </div>
  );
}
