"use client";

import { useState } from "react";
import { AlertTriangle, FileCheck2, ShieldCheck, UserCheck } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useGovernanceSummary,
  useRiskRegister,
  useUpsertRisk,
  type RiskInput,
} from "@/lib/analytics/queries";
import { formatNumber, formatPercent } from "@/lib/analytics/format";
import { CenterNote, MiniBarList, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

const CATEGORIES = ["clinical", "data_privacy", "security", "regulatory", "financial", "operational"];
const LEVELS = ["low", "medium", "high"];

const BLANK: RiskInput = {
  title: "",
  category: "operational",
  likelihood: "medium",
  impact: "medium",
  status: "open",
  owner: "",
  mitigation: "",
};

export function GovernanceDashboard() {
  const { data } = useGovernanceSummary();
  const risks = useRiskRegister();
  const upsert = useUpsertRisk();
  const [form, setForm] = useState<RiskInput>(BLANK);

  const c = data?.clinical;
  const p = data?.privacy;
  const consentAvg =
    p?.consent_coverage && p.consent_coverage.length > 0
      ? Math.round(
          (p.consent_coverage.reduce((s, x) => s + x.pct, 0) / p.consent_coverage.length) * 10
        ) / 10
      : 0;

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        Governance readiness evidence. Certifications (SOC 2 / ISO 27001 / ISO 27701) require an
        external audit — this tab tracks readiness, not a certificate.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={UserCheck} label="Staff credential-verified" value={formatPercent(c?.verification_pct ?? 0)} />
        <StatTile icon={ShieldCheck} label="Indemnity expiring (30d)" value={formatNumber(c?.indemnity_expiring_30d ?? 0)} />
        <StatTile icon={FileCheck2} label="Avg consent coverage" value={formatPercent(consentAvg)} />
        <StatTile icon={AlertTriangle} label="Open risks" value={formatNumber(data?.risk?.open ?? 0)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Clinical governance" description="Credentials, indemnity, and protocol integrity.">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[
              ["Clinical staff", c?.staff_total ?? 0],
              ["Credential-verified", c?.staff_verified ?? 0],
              ["Unverified but active", c?.staff_unverified_active ?? 0],
              ["Tier unassigned", c?.tier_unassigned ?? 0],
              ["Indemnity covered", c?.indemnity_covered ?? 0],
              ["Indemnity expired", c?.indemnity_expired ?? 0],
              ["Protocols total", c?.protocols_total ?? 0],
              ["Protocols signed", c?.protocols_signed ?? 0],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between rounded-md border border-charcoal-ink/10 px-3 py-2">
                <span className="text-charcoal-ink/60">{label}</span>
                <span className="font-medium tabular-nums text-charcoal-ink">{formatNumber(Number(value))}</span>
              </div>
            ))}
          </dl>
        </SectionCard>

        <SectionCard
          title="Consent coverage (NDPR)"
          description="Patients who accepted each current consent version."
          actions={<ExportButton filename="consent-coverage" rows={p?.consent_coverage ?? []} />}
        >
          <MiniBarList
            items={(p?.consent_coverage ?? []).map((x) => ({
              label: x.consent_type,
              value: x.pct,
              display: `${x.pct}% (${x.accepted}/${x.total})`,
            }))}
            emptyLabel="No current consent versions."
          />
          <div className="mt-4 flex gap-6 text-sm text-charcoal-ink/70">
            <span>KYC verified: <b className="text-charcoal-ink">{formatNumber(p?.kyc_verified ?? 0)}</b></span>
            <span>KYC pending: <b className="text-charcoal-ink">{formatNumber(p?.kyc_pending ?? 0)}</b></span>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Risk register"
        description="Clinical / data-privacy / security / regulatory / financial / operational risks."
        actions={<ExportButton filename="risk-register" rows={risks.data ?? []} />}
      >
        <form
          className="mb-4 grid gap-3 rounded-lg border border-charcoal-ink/10 bg-white p-3 md:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.title.trim()) return;
            upsert.mutate(form, { onSuccess: () => setForm(BLANK) });
          }}
        >
          <div className="md:col-span-2">
            <Label htmlFor="r-title">Risk</Label>
            <Input id="r-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Describe the risk" />
          </div>
          <div>
            <Label htmlFor="r-cat">Category</Label>
            <select id="r-cat" className="h-9 w-full rounded-md border border-charcoal-ink/15 px-2 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((x) => <option key={x} value={x}>{x.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="r-like">Likelihood</Label>
            <select id="r-like" className="h-9 w-full rounded-md border border-charcoal-ink/15 px-2 text-sm" value={form.likelihood} onChange={(e) => setForm({ ...form, likelihood: e.target.value })}>
              {LEVELS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="r-impact">Impact</Label>
            <select id="r-impact" className="h-9 w-full rounded-md border border-charcoal-ink/15 px-2 text-sm" value={form.impact} onChange={(e) => setForm({ ...form, impact: e.target.value })}>
              {LEVELS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <Button type="submit" size="sm" disabled={upsert.isPending || !form.title.trim()}>
              Add risk
            </Button>
          </div>
        </form>

        {risks.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (risks.data ?? []).length === 0 ? (
          <CenterNote>No risks recorded.</CenterNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                  <th className="py-2 pr-4 font-medium">Risk</th>
                  <th className="py-2 pr-4 font-medium">Category</th>
                  <th className="py-2 pr-4 font-medium">Likelihood</th>
                  <th className="py-2 pr-4 font-medium">Impact</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {(risks.data ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-charcoal-ink/5 align-top">
                    <td className="py-2 pr-4 text-charcoal-ink/80">
                      {r.title}
                      {r.mitigation && <div className="text-xs text-charcoal-ink/50">{r.mitigation}</div>}
                    </td>
                    <td className="py-2 pr-4 capitalize text-charcoal-ink/60">{r.category.replace(/_/g, " ")}</td>
                    <td className="py-2 pr-4 capitalize text-charcoal-ink/60">{r.likelihood}</td>
                    <td className="py-2 pr-4 capitalize text-charcoal-ink/60">{r.impact}</td>
                    <td className={`py-2 capitalize ${r.status === "open" ? "font-medium text-red-700" : r.status === "mitigating" ? "text-sprout-gold" : "text-charcoal-ink/50"}`}>
                      {r.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
