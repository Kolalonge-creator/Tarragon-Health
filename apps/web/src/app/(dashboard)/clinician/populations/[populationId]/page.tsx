import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { Users, HeartPulse, AlertTriangle, Activity } from "lucide-react";
import { formatNumber, formatPercent } from "@/lib/analytics/format";
import {
  populationSummarySchema,
  populationOutcomesSchema,
  CARE_GAP_TYPE_LABEL,
  CONTROL_STATUS_LABEL,
  ENGAGEMENT_BAND_LABEL,
} from "@/lib/populations/schemas";
import { OutreachButton } from "./outreach-button";
import { ArchiveButton } from "./archive-button";
import type { Database } from "@tarragon/shared";

type PopulationMemberRow =
  Database["public"]["Functions"]["get_population_members"]["Returns"][number];

const CONTROL_BADGE = { controlled: "green", uncontrolled: "red", unknown: "grey" } as const;
const ENGAGEMENT_BADGE = { active: "green", declining: "amber", disengaged: "grey" } as const;

/**
 * A single population's read side (spec §41.6/§41.9/§41.11/§41.12) — risk
 * distribution, control status, open care gaps, engagement, outcomes, and
 * the live member roster, all computed by the three get_population_*() RPCs
 * rather than stored anywhere.
 */
export default async function PopulationDetailPage({
  params,
}: {
  params: Promise<{ populationId: string }>;
}) {
  const { populationId } = await params;
  const supabase = await createClient();

  const { data: population } = await supabase
    .from("population_definitions")
    .select("id, name, description, kind, is_system, status")
    .eq("id", populationId)
    .maybeSingle();
  if (!population) notFound();

  const [{ data: summaryRaw }, { data: outcomesRaw }, { data: members }] = await Promise.all([
    supabase.rpc("get_population_summary", { p_population_id: populationId }),
    supabase.rpc("get_population_outcomes", { p_population_id: populationId }),
    supabase.rpc("get_population_members", { p_population_id: populationId }),
  ]);

  const summary = populationSummarySchema.safeParse(summaryRaw);
  const outcomes = populationOutcomesSchema.safeParse(outcomesRaw);
  const rows = (members as PopulationMemberRow[] | null) ?? [];

  const highRisk = rows.filter((r) => r.risk_tier === "high" || r.risk_tier === "very_high").length;
  const openGaps = rows.reduce((sum, r) => sum + (r.open_care_gap_types?.length ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{population.name}</h1>
            <Badge variant={population.is_system ? "blue" : "green"}>
              {population.is_system ? "Registry" : "Custom"}
            </Badge>
            {population.status === "archived" && <Badge variant="grey">Archived</Badge>}
          </div>
          {population.description && <p className="text-charcoal-ink/60">{population.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          <OutreachButton populationId={population.id} />
          <ArchiveButton populationId={population.id} status={population.status} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Users} label="Members" value={formatNumber(rows.length)} />
        <StatTile icon={HeartPulse} label="High / very-high risk" value={formatNumber(highRisk)} />
        <StatTile icon={AlertTriangle} label="Open care gaps" value={formatNumber(openGaps)} />
        <StatTile
          icon={Activity}
          label="Screening completion"
          value={
            outcomes.success && outcomes.data.screening_completion_rate != null
              ? formatPercent(outcomes.data.screening_completion_rate)
              : "—"
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SummaryCard title="Control status" description="Latest scored condition tier, per member.">
          {summary.success
            ? summary.data.control_status.map((b) => (
                <li key={String(b.status)} className="flex items-center justify-between text-sm">
                  <Badge variant={CONTROL_BADGE[b.status as keyof typeof CONTROL_BADGE] ?? "grey"}>
                    {CONTROL_STATUS_LABEL[b.status as keyof typeof CONTROL_STATUS_LABEL] ?? String(b.status)}
                  </Badge>
                  <span className="tabular-nums text-charcoal-ink/70">{b.patients}</span>
                </li>
              ))
            : null}
        </SummaryCard>

        <SummaryCard title="Open care gaps" description="What should have happened but hasn't.">
          {summary.success
            ? summary.data.care_gaps.map((b) => (
                <li key={String(b.gap_type)} className="flex items-center justify-between text-sm">
                  <span>{CARE_GAP_TYPE_LABEL[b.gap_type as keyof typeof CARE_GAP_TYPE_LABEL] ?? String(b.gap_type)}</span>
                  <span className="tabular-nums text-charcoal-ink/70">{b.patients}</span>
                </li>
              ))
            : null}
        </SummaryCard>

        <SummaryCard title="Engagement" description="From real logged activity, not page views.">
          {summary.success
            ? summary.data.engagement.map((b) => (
                <li key={String(b.band)} className="flex items-center justify-between text-sm">
                  <Badge variant={ENGAGEMENT_BADGE[b.band as keyof typeof ENGAGEMENT_BADGE] ?? "grey"}>
                    {ENGAGEMENT_BAND_LABEL[b.band as keyof typeof ENGAGEMENT_BAND_LABEL] ?? String(b.band)}
                  </Badge>
                  <span className="tabular-nums text-charcoal-ink/70">{b.patients}</span>
                </li>
              ))
            : null}
        </SummaryCard>

        <SummaryCard title="Outcomes" description="Disease control, adherence, and care-plan completion.">
          {outcomes.success ? (
            <>
              <OutcomeRow
                label="Medication adherence"
                rate={outcomes.data.medication_adherence_rate}
                n={outcomes.data.medication_checkins_taken}
                d={outcomes.data.medication_checkins_total}
              />
              <OutcomeRow
                label="Care-plan completion"
                rate={outcomes.data.care_plan_completion_rate}
                n={outcomes.data.care_plans_completed}
                d={outcomes.data.care_plans_total}
              />
            </>
          ) : null}
        </SummaryCard>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No patient currently matches this population.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-charcoal-ink/10 text-left text-xs uppercase tracking-wide text-charcoal-ink/50">
                    <th className="py-2 pr-4 font-medium">Patient</th>
                    <th className="py-2 pr-4 font-medium">Age</th>
                    <th className="py-2 pr-4 font-medium">Conditions</th>
                    <th className="py-2 pr-4 font-medium">Risk</th>
                    <th className="py-2 pr-4 font-medium">Control</th>
                    <th className="py-2 pr-4 font-medium">Open gaps</th>
                    <th className="py-2 pr-4 font-medium">Engagement</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.patient_id} className="border-b border-charcoal-ink/5">
                      <td className="py-2 pr-4 text-charcoal-ink">{r.full_name ?? "—"}</td>
                      <td className="py-2 pr-4 tabular-nums">{r.age_years ?? "—"}</td>
                      <td className="py-2 pr-4">{(r.matched_conditions ?? []).join(", ") || "—"}</td>
                      <td className="py-2 pr-4">{r.risk_tier ?? "—"}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={CONTROL_BADGE[r.control_status as keyof typeof CONTROL_BADGE] ?? "grey"}>
                          {CONTROL_STATUS_LABEL[r.control_status as keyof typeof CONTROL_STATUS_LABEL] ??
                            r.control_status}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4">
                        {(r.open_care_gap_types ?? [])
                          .map((g) => CARE_GAP_TYPE_LABEL[g as keyof typeof CARE_GAP_TYPE_LABEL] ?? g)
                          .join(", ") || "—"}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant={ENGAGEMENT_BADGE[r.engagement_band as keyof typeof ENGAGEMENT_BADGE] ?? "grey"}>
                          {ENGAGEMENT_BAND_LABEL[r.engagement_band as keyof typeof ENGAGEMENT_BAND_LABEL] ??
                            r.engagement_band}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-xs text-charcoal-ink/50">{description}</p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5">{children}</ul>
      </CardContent>
    </Card>
  );
}

function OutcomeRow({
  label,
  rate,
  n,
  d,
}: {
  label: string;
  rate: number | null;
  n: number;
  d: number;
}) {
  return (
    <li className="flex items-center justify-between text-sm">
      <span>{label}</span>
      <span className="tabular-nums text-charcoal-ink/70">
        {rate != null ? formatPercent(rate) : "—"} {d > 0 ? `(${n}/${d})` : ""}
      </span>
    </li>
  );
}
