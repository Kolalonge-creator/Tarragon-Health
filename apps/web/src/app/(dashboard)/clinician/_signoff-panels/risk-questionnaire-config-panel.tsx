import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { LoadFailure } from "@/components/ui/load-failure";
import {
  RiskQuestionnaireConfigManager,
  type RiskQuestionnaireConfigRow,
} from "@/app/(dashboard)/admin/settings/risk-questionnaire-config/risk-questionnaire-config-manager";
import { RiskQuestionnaireConfigEditor } from "@/app/(dashboard)/admin/settings/risk-questionnaire-config/risk-questionnaire-config-editor";

const QUESTIONNAIRE_CODE = "prevention_intake";

/**
 * The risk-questionnaire-config sign-off panel: loads its own data and renders the real editor and
 * manager, values and Sign control together. Shared by the CMO's own page for
 * this config and by the sign-off hub (/clinician/clinical-signoff), which opens
 * it inline so a signature is always given while looking at the actual values.
 * Access is gated by the page that renders it (both require canAssignCases).
 */
export async function RiskQuestionnaireConfigPanel() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const { data: configs, error: configsError } = await supabase
    .from("risk_questionnaire_configs")
    .select("id, version, config, notes, is_active, approved_at, created_at")
    .eq("organisation_id", profile?.organisation_id ?? "")
    .eq("code", QUESTIONNAIRE_CODE)
    .order("version", { ascending: false });

  const rows = (configs as RiskQuestionnaireConfigRow[] | null) ?? [];
  const prefillConfig = rows.find((r) => r.is_active)?.config ?? rows[0]?.config ?? { questions: [], conditions: [] };

  return (
    <div className="space-y-6">
      {configsError ? (
        <LoadFailure>
          The risk questionnaire configuration could not be loaded. It is not empty, and this page
          cannot say which version is signed and in force. Do not save a new version from here
          until it loads: it would be written on top of an empty question bank.
        </LoadFailure>
      ) : (
        <>
          <RiskQuestionnaireConfigEditor
            key={rows[0]?.id ?? "seed"}
            defaultConfigJson={JSON.stringify(prefillConfig, null, 2)}
          />
          <RiskQuestionnaireConfigManager configs={rows} />
        </>
      )}
    </div>
  );
}
