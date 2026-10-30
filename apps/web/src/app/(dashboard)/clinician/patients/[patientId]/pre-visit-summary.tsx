"use client";

import { ageFromDateOfBirth } from "@tarragon/shared";
import { useRiskScores } from "@/lib/queries/risk-assessment";
import { t } from "@tarragon/i18n";
import { useLatestMentalHealthScreens } from "@/lib/queries/mental-health";
import { useCarePlans } from "@/lib/queries/care-plans";
import { useMedications } from "@/lib/queries/medications";
import { usePatientCareGaps } from "@/lib/queries/patient-care-gaps";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { SEMANTIC_ICON } from "@/lib/icons";
import { getProposedConfig } from "@tarragon/shared";
import { usePreVisitVitals } from "@/lib/queries/previsit-vitals";
import { useCareTasks } from "@/lib/queries/care-tasks";
import { usePreVisitConsultations } from "@/lib/queries/previsit-consultations";
import { buildPreVisitBrief, NO_SENSITIVE_ACCESS, ok, unavailable, type Available, type BriefRules } from "@/lib/previsit/brief";
import { PreVisitBriefView } from "@/components/previsit/previsit-brief";

/**
 * True when the source-linked brief is switched on. OFF (the default) until the CMO signs `copilot.previsit_brief_rules`: the card then
 * shows only the existing deterministic sections and makes none of the extra audited reads (vitals by type, tasks, consultations).
 */
export function previsitBriefEnabled(): boolean {
  return getProposedConfig("copilot.previsit_brief_enabled").value === true;
}

/** A query result as the brief wants it: rows when the read worked, "unavailable" when it was refused or failed (never "none"). */
function availableFrom<T>(q: { data: readonly T[] | undefined; isError: boolean; isLoading: boolean }): Available<T> {
  return q.isError || q.data === undefined ? unavailable<T>() : ok(q.data);
}

const RISK_BADGE: Record<string, BadgeProps["variant"]> = {
  low: "green",
  moderate: "amber",
  high: "red",
  very_high: "red",
  // Insufficient data to assess, not a reassuring reading — grey, same as
  // every other "unscored" state on this platform, never green.
  unknown: "grey",
};

const MENTAL_HEALTH_LABEL: Record<string, string> = {
  phq9: "PHQ-9 (depression)",
  gad7: "GAD-7 (anxiety)",
  auditc: "AUDIT-C (alcohol)",
};

const SEX_LETTER: Record<string, string> = { male: "M", female: "F" };

/**
 * A single top-priority pointer, derived only from data this component
 * already loads — never a new scoring model. Deliberately simple and
 * ordered by urgency: a crisis-flagged intake screen outranks a high risk
 * tier, which outranks a due/overdue refill. Returns null rather than a
 * manufactured "routine" action when nothing stands out — an empty "next
 * action" is honest; a fabricated one isn't.
 */
function deriveNextAction(
  mentalHealth: Record<string, { severity_band: string; crisis_flagged: boolean } | undefined> | undefined,
  riskScores: { condition: string; tier: string }[] | undefined,
  medications: { drug_name: string; refill_date: string | null }[] | undefined,
): { text: string; urgent: boolean } | null {
  const crisisEntry = Object.entries(mentalHealth ?? {}).find(([, screen]) => screen?.crisis_flagged);
  if (crisisEntry) {
    const [instrument] = crisisEntry;
    return { text: `Review crisis-flagged ${MENTAL_HEALTH_LABEL[instrument] ?? instrument} screen`, urgent: true };
  }

  const highRisk = (riskScores ?? []).find((s) => s.tier === "high" || s.tier === "very_high");
  if (highRisk) {
    return { text: `Review ${highRisk.tier.replace("_", " ")} risk: ${highRisk.condition}`, urgent: true };
  }

  const dueSoon = (medications ?? [])
    .filter((m): m is { drug_name: string; refill_date: string } => !!m.refill_date)
    .sort((a, b) => (a.refill_date < b.refill_date ? -1 : 1))[0];
  if (dueSoon) {
    const days = Math.round((new Date(dueSoon.refill_date).getTime() - Date.now()) / 86_400_000);
    if (days <= 14) {
      return {
        text: `${days < 0 ? "Overdue" : "Due"} refill: ${dueSoon.drug_name}`,
        urgent: days < 0,
      };
    }
  }

  return null;
}

/**
 * AI intake bridge: the risk assessment, PHQ-9/GAD-7/AUDIT-C intake
 * screens, and active care-plan conditions already exist and already feed
 * patient_risk_scores/care-plan recommendations — but none of it landed as
 * one structured summary a clinician sees before/during a visit. This
 * composes those existing signals into a single "pre-visit summary" at the
 * top of the patient detail page (linked from each Worklist alert row),
 * rather than a fifth place a Tier 1 clinician has to look. Read-only —
 * no new data, no new scoring, nothing clinical is decided here.
 */
export function PreVisitSummary({
  patientId,
  sex,
  dateOfBirth,
}: {
  patientId: string;
  /** Passed down from the server-rendered patient page's own profiles select
   * — avoids a second client-side fetch for two fields the parent already has. */
  sex?: string | null;
  dateOfBirth?: string | null;
}) {
  const riskScores = useRiskScores(patientId);
  const mentalHealth = useLatestMentalHealthScreens(patientId);
  const carePlans = useCarePlans(patientId);
  const medications = useMedications(patientId);
  const careGaps = usePatientCareGaps(patientId);
  // The brief's extra reads are audited chart reads: none is made while the brief is off.
  const briefOn = previsitBriefEnabled();
  const briefRules = getProposedConfig("copilot.previsit_brief_rules").value as unknown as BriefRules;
  const vitals = usePreVisitVitals(briefOn ? patientId : "", briefRules.windowDays, briefRules.maxReadingsRead);
  const tasks = useCareTasks(briefOn ? patientId : null);
  const consultations = usePreVisitConsultations(briefOn ? patientId : "");

  const isLoading =
    riskScores.isLoading ||
    mentalHealth.isLoading ||
    carePlans.isLoading ||
    medications.isLoading ||
    careGaps.isLoading ||
    vitals.isLoading ||
    tasks.isLoading ||
    consultations.isLoading;
  const hasNothing =
    !isLoading &&
    !mentalHealth.isError &&
    (riskScores.data ?? []).length === 0 &&
    Object.keys(mentalHealth.data ?? {}).length === 0 &&
    (carePlans.data ?? []).length === 0 &&
    (careGaps.data ?? []).length === 0;

  const age = ageFromDateOfBirth(dateOfBirth ?? null);
  const sexLetter = sex ? SEX_LETTER[sex] : undefined;
  const demographicLabel = [age !== null ? String(age) : null, sexLetter].filter(Boolean).join("");

  const activeMedCount = (medications.data ?? []).length;
  const nextAction = deriveNextAction(mentalHealth.data, riskScores.data, medications.data);

  const briefLines =
    !briefOn || isLoading
      ? []
      : buildPreVisitBrief(
          {
            now: new Date(),
            bloodPressure: availableFrom({ data: vitals.data?.bloodPressure, isError: vitals.isError, isLoading: vitals.isLoading }),
            glucose: availableFrom({ data: vitals.data?.glucose, isError: vitals.isError, isLoading: vitals.isLoading }),
            medications: availableFrom({
              ...medications,
              data: medications.data?.map((m) => ({
                id: m.id,
                drug_name: m.drug_name,
                refill_date: m.refill_date,
                updated_at: m.updated_at,
                indication: m.indication,
                care_plan_condition: m.care_plan?.condition ?? null,
              })),
            }),
            tasks: availableFrom(tasks),
            careGaps: availableFrom(careGaps),
            carePlans: availableFrom(carePlans),
            consultations: availableFrom(consultations),
            // Fail closed. A read that comes back without error is NOT a sign the viewer may see a category: row-level security answers a
            // refused read with empty rows, and some reads (the mental-health screens) report the refusal as an error while the chart
            // reads here do not. There is no client-side category access check yet, so every sensitive category stays denied (OQ-S89-02).
            access: NO_SENSITIVE_ACCESS,
          },
          briefRules,
        );

  return (
    <Card className="border-brand-green/30">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <SEMANTIC_ICON.aiCoach className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            Pre-visit summary
          </CardTitle>
          {demographicLabel && (
            <span className="text-sm font-medium text-charcoal-ink/60">{demographicLabel}</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {mentalHealth.isError && (
          <p className="text-sm text-charcoal-ink/60">
            {t("mood.denied.previsit")}
          </p>
        )}
        {hasNothing && (
          <p className="text-sm text-charcoal-ink/60">
            No risk assessment, intake screen, or active care plan on file yet.
          </p>
        )}

        {!isLoading && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-charcoal-ink/5 p-2.5 text-xs">
            <span className="text-charcoal-ink/70">
              {/* A refused or failed read is not "0 active": say so (INV-10). */}
              Medication: {medications.isError ? "not available to you" : `${activeMedCount} active`}
            </span>
            <span className={nextAction?.urgent ? "font-medium text-red-700" : "text-charcoal-ink/70"}>
              Next action: {nextAction?.text ?? "None flagged"}
            </span>
          </div>
        )}

        {briefLines.length > 0 && <PreVisitBriefView lines={briefLines} />}

        {(careGaps.data ?? []).length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
              Care gaps
            </p>
            <ul className="mt-1 space-y-1">
              {(careGaps.data ?? []).map((gap, i) => (
                <li key={i} className="flex items-center gap-2 text-xs text-charcoal-ink/70">
                  <Badge variant="amber">{gap.gap_type?.replace(/_/g, " ")}</Badge>
                  {gap.condition_or_type}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(carePlans.data ?? []).length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
              Active care plans
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(carePlans.data ?? []).map((plan) => (
                <Badge key={plan.id} variant="grey">
                  {plan.condition}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {(riskScores.data ?? []).length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
              Prevention risk
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(riskScores.data ?? []).map((score) => (
                <Badge key={score.id} variant={RISK_BADGE[score.tier] ?? "grey"}>
                  {score.condition}: {score.tier.replace("_", " ")}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {Object.keys(mentalHealth.data ?? {}).length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
              Intake screens
            </p>
            <ul className="mt-1 space-y-1">
              {Object.entries(mentalHealth.data ?? {}).map(([instrument, screen]) => (
                <li key={instrument} className="flex items-center gap-2 text-xs">
                  <span className="text-charcoal-ink/70">
                    {MENTAL_HEALTH_LABEL[instrument] ?? instrument}:{" "}
                    {screen?.severity_band.replace(/_/g, " ")}
                  </span>
                  {screen?.crisis_flagged && <Badge variant="red">Crisis flag</Badge>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
