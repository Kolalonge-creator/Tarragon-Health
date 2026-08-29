import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { TriageProtocolManager, type TriageProtocolRow } from "./protocol-review";

/**
 * Clinical Director sign-off for the symptom checker's decision tree —
 * every red-flag rule and question the structured symptom checker uses.
 * Seeded as an unsigned draft (v1, headache/chest pain/breathlessness) and
 * NOT in force until signed here; the patient-facing symptom checker shows
 * "not switched on yet" until then.
 */
export default async function SymptomTriageProtocolSettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  const supabase = await createClient();
  const { data: protocols } = await supabase
    .from("triage_protocols")
    .select("id, version, config, notes, is_active, approved_at, created_at")
    .order("version", { ascending: false });

  const rows = (protocols as unknown as TriageProtocolRow[] | null) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Symptom triage protocol
        </h1>
        <p className="text-charcoal-ink/60">
          This is the decision tree the patient-facing symptom checker walks: which red flags route
          straight to an emergency pathway, which questions get asked for each presenting complaint,
          and what each outcome tells the patient. It is <strong>not in force until a Clinical
          Director signs it</strong> — until then, patients see a plain &quot;not switched on
          yet&quot; message instead of this tree.
        </p>
      </div>
      <TriageProtocolManager protocols={rows} />
    </div>
  );
}
