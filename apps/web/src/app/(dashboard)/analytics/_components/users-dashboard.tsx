"use client";

import { MapPin, UserMinus, UserRoundCheck, Users } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { useUserSegments } from "@/lib/analytics/queries";
import { formatNumber } from "@/lib/analytics/format";
import { MiniBarList, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

export function UsersDashboard() {
  const { data } = useUserSegments();
  const a = data?.activity;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Users} label="Total patients" value={formatNumber(a?.total ?? 0)} />
        <StatTile icon={UserRoundCheck} label="Active (30 days)" value={formatNumber(a?.active_30d ?? 0)} />
        <StatTile icon={UserMinus} label="Dormant (30+ days)" value={formatNumber(a?.dormant_30d ?? 0)} />
        <StatTile icon={UserMinus} label="Churned (cancelled)" value={formatNumber(data?.churned ?? 0)} />
      </div>

      <SectionCard
        title="Activity breakdown"
        description="Active = a page visit, vitals log, or AI-coach chat within the window."
        actions={
          <ExportButton
            filename="user-activity"
            rows={
              a
                ? [
                    { metric: "Total", value: a.total },
                    { metric: "Active 30d", value: a.active_30d },
                    { metric: "Active 90d", value: a.active_90d },
                    { metric: "Dormant 30d+", value: a.dormant_30d },
                    { metric: "Dormant 90d+", value: a.dormant_90d },
                    { metric: "Never active", value: a.never_active },
                    { metric: "Churned", value: data?.churned ?? 0 },
                  ]
                : []
            }
          />
        }
      >
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Active 30d", value: a?.active_30d ?? 0 },
            { label: "Active 90d", value: a?.active_90d ?? 0 },
            { label: "Dormant 30d+", value: a?.dormant_30d ?? 0 },
            { label: "Dormant 90d+", value: a?.dormant_90d ?? 0 },
            { label: "Never active", value: a?.never_active ?? 0 },
            { label: "Churned", value: data?.churned ?? 0 },
          ].map((m) => (
            <div key={m.label} className="rounded-lg border border-charcoal-ink/10 bg-white p-3">
              <p className="text-xs text-charcoal-ink/60">{m.label}</p>
              <p className="font-heading text-2xl font-semibold text-charcoal-ink">
                {formatNumber(m.value)}
              </p>
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard
          title="Users per plan"
          actions={<ExportButton filename="users-by-plan" rows={data?.by_plan ?? []} />}
        >
          <MiniBarList
            items={(data?.by_plan ?? []).map((p) => ({ label: p.plan, value: p.users }))}
            emptyLabel="No subscribers yet."
          />
        </SectionCard>
        <SectionCard
          title="Users per care category"
          actions={<ExportButton filename="users-by-care-category" rows={data?.by_care_category ?? []} />}
        >
          <MiniBarList
            items={(data?.by_care_category ?? []).map((c) => ({ label: c.category, value: c.users }))}
            emptyLabel="No enrolments yet."
          />
        </SectionCard>
        <SectionCard
          title="Users per role"
          actions={<ExportButton filename="users-by-role" rows={data?.by_role ?? []} />}
        >
          <MiniBarList
            items={(data?.by_role ?? []).map((r) => ({ label: r.role, value: r.users }))}
            emptyLabel="No users yet."
          />
        </SectionCard>
        <SectionCard
          title="Users per condition"
          description="Distinct patients on an active care plan."
          actions={<ExportButton filename="users-by-condition" rows={data?.by_condition ?? []} />}
        >
          <MiniBarList
            items={(data?.by_condition ?? []).map((c) => ({ label: c.condition, value: c.users }))}
            emptyLabel="No active care plans yet."
          />
        </SectionCard>
        <SectionCard
          title="Users per state"
          actions={<ExportButton filename="users-by-state" rows={data?.by_state ?? []} />}
        >
          <MiniBarList
            items={(data?.by_state ?? []).map((s) => ({ label: s.state, value: s.users }))}
            emptyLabel="No patients yet."
          />
        </SectionCard>
        <SectionCard title="Geography note">
          <p className="flex items-start gap-2 text-sm text-charcoal-ink/60">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
            State here is the patient&rsquo;s saved profile location. Visitor geography (including
            anonymous traffic) lives on the Acquisition tab.
          </p>
        </SectionCard>
      </div>
    </div>
  );
}
