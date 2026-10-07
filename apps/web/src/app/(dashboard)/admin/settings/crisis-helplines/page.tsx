import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import { CrisisHelplinesManager, type HelplineRow } from "./crisis-helplines-manager";

export const metadata = { title: "Crisis helplines" };

/**
 * Where a human verifies the helplines the crisis card may show (S56, function 10.3). Every row starts unverified and the card shows no
 * number until someone has phoned it and recorded how. Verification expires (crisis_card_config.helpline_reverify_days), so a line
 * nobody has re-checked drops back to "not yet verified, call 112" by itself.
 */
export default async function CrisisHelplinesSettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");

  const supabase = await createClient();
  const [lines, cfg] = await Promise.all([
    supabase
      .from("crisis_helplines")
      .select("id, name, phone_e164, hours_text, source_note, is_active, last_verified_at, verification_note")
      .order("name"),
    supabase.from("crisis_card_config").select("version, status, config").eq("is_active", true).maybeSingle(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Crisis helplines"
        description="The helplines the crisis card may show. Phone the line, then record the number and how you verified it. Until then the card says it is not yet verified and points to the emergency number and the nearest hospital."
      />
      {lines.error ? (
        <LoadFailure>The helpline list could not be loaded. Do not mark anything verified from here until it loads.</LoadFailure>
      ) : (
        <CrisisHelplinesManager
          rows={(lines.data ?? []) as HelplineRow[]}
          config={cfg.data ? { version: cfg.data.version, status: cfg.data.status, config: cfg.data.config as Record<string, unknown> } : null}
        />
      )}
    </div>
  );
}
