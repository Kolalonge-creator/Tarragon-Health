import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import {
  RiskQuestionnaireConfigManager,
  type RiskQuestionnaireConfigRow,
} from "./risk-questionnaire-config-manager";
import { RiskQuestionnaireConfigEditor } from "./risk-questionnaire-config-editor";

const QUESTIONNAIRE_CODE = "prevention_intake";

/**
 * Clinical-Director sign-off for the prevention risk questionnaire + scoring
 * configuration — the question bank, branching, and per-condition risk
 * factors the risk assessment uses. Seeded as an unsigned provisional draft
 * (a verbatim port of the pre-existing hardcoded engine) and NOT in force
 * until a Clinical Director signs it here; until then, the risk assessment
 * keeps using its built-in fallback logic unchanged.
 */
export default async function RiskQuestionnaireConfigSettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  const supabase = await createClient();
  const { data: configs, error: configsError } = await supabase
    .from("risk_questionnaire_configs")
    .select("id, version, config, notes, is_active, approved_at, created_at")
    .eq("organisation_id", profile.organisation_id ?? "")
    .eq("code", QUESTIONNAIRE_CODE)
    .order("version", { ascending: false });

  const rows = (configs as RiskQuestionnaireConfigRow[] | null) ?? [];
  const prefillConfig = rows.find((r) => r.is_active)?.config ?? rows[0]?.config ?? { questions: [], conditions: [] };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Risk questionnaire configuration"
        description={
          <>
            The question bank and per-condition scoring rules behind every patient&apos;s risk
            assessment, including which questions branch on earlier answers, and the points/
            thresholds that produce a Low/Moderate/High/Unknown tier per condition. The seeded
            version is a verbatim port of the platform&apos;s existing built-in logic (zero clinical
            change) and is{" "}
            <strong>not in force until a Clinical Director signs it</strong>. Review it, then sign
            to switch the live risk assessment onto this configuration.
          </>
        }
      />
      {/* Same hazard as cv-risk-config: on a failed read prefillConfig falls
          back to an EMPTY question bank, so the editor would have opened on
          "no questions, no conditions" and saving it would have wiped the
          live risk assessment. */}
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
