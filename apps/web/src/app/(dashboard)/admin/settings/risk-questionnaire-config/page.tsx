import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
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
  const { data: configs } = await supabase
    .from("risk_questionnaire_configs")
    .select("id, version, config, notes, is_active, approved_at, created_at")
    .eq("organisation_id", profile.organisation_id ?? "")
    .eq("code", QUESTIONNAIRE_CODE)
    .order("version", { ascending: false });

  const rows = (configs as RiskQuestionnaireConfigRow[] | null) ?? [];
  const prefillConfig = rows.find((r) => r.is_active)?.config ?? rows[0]?.config ?? { questions: [], conditions: [] };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Risk questionnaire configuration
        </h1>
        <p className="text-charcoal-ink/60">
          The question bank and per-condition scoring rules behind every patient&apos;s risk
          assessment — including which questions branch on earlier answers, and the points/
          thresholds that produce a Low/Moderate/High/Unknown tier per condition. The seeded
          version is a verbatim port of the platform&apos;s existing built-in logic (zero clinical
          change) and is{" "}
          <strong>not in force until a Clinical Director signs it</strong>. Review it, then sign
          to switch the live risk assessment onto this configuration.
        </p>
      </div>
      <RiskQuestionnaireConfigEditor defaultConfigJson={JSON.stringify(prefillConfig, null, 2)} />
      <RiskQuestionnaireConfigManager configs={rows} />
    </div>
  );
}
