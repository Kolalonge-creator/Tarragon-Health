"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useProviderQualityNetworkSummary,
  useProviderCredentialMonitor,
  useProviderComplaints,
  useLiftProviderRestriction,
} from "@/lib/queries/provider-quality";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { formatNumber, formatPercent } from "@/lib/analytics/format";

type SectionKey = "network" | "credentials" | "complaints";

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "network", label: "Network summary" },
  { key: "credentials", label: "Credential monitor" },
  { key: "complaints", label: "Complaints" },
];

export function ProviderQualityDashboard({
  complaintsBasePath = "/admin/provider-quality/complaints",
}: {
  /**
   * Where a complaint row links to. Defaults to the admin console's own
   * path; /clinician/provider-quality (added 2026-09-14, CMO
   * governance-surface audit) passes its own base so a Chief Medical
   * Officer reading this same dashboard under /clinician/* doesn't get
   * bounced into the admin-only complaint detail route by proxy.ts.
   */
  complaintsBasePath?: string;
}) {
  const [section, setSection] = useState<SectionKey>("network");

  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b border-charcoal-ink/10">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSection(s.key)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              section === s.key
                ? "border-brand-green text-brand-green"
                : "border-transparent text-charcoal-ink/50 hover:text-charcoal-ink"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === "network" ? <NetworkSummarySection /> : null}
      {section === "credentials" ? <CredentialMonitorSection /> : null}
      {section === "complaints" ? <ComplaintsSection complaintsBasePath={complaintsBasePath} /> : null}
    </div>
  );
}

const STATUS_TONE: Record<string, "green" | "amber" | "red" | "grey"> = {
  on_target: "green",
  watch: "amber",
  below_target: "red",
};

function NetworkSummarySection() {
  const { data, isLoading, isError } = useProviderQualityNetworkSummary();

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (isError || !data) return <p className="text-sm text-red-600">Could not load the network summary.</p>;
  if (!data.corrective_action) {
    return <p className="text-sm text-charcoal-ink/60">Not authorised to view this.</p>;
  }

  const ca = data.corrective_action;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-charcoal-ink/50">Active providers</p>
            <p className="font-heading text-xl font-semibold text-charcoal-ink">
              {formatNumber(data.provider_count ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-charcoal-ink/50">Complaints upheld this period</p>
            <p className="font-heading text-xl font-semibold text-charcoal-ink">
              {formatNumber(ca.complaints_upheld_in_period)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-charcoal-ink/50">Interventions overdue</p>
            <p className="font-heading text-xl font-semibold text-charcoal-ink">
              {formatNumber(ca.interventions_overdue)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-charcoal-ink/50">Credentials not on record</p>
            <p className="font-heading text-xl font-semibold text-charcoal-ink">
              {formatNumber(ca.credentials_not_recorded)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Metric health across the network</CardTitle>
          <CardDescription>
            {data.clinical_quality_note ??
              "Where the network is performing well vs. failing, by metric, not by provider (§29.10, §29.11)."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            caption="Metric health"
            columns={[
              { header: "Metric", sortable: true },
              { header: "Domain", sortable: true },
              { header: "On target", sortable: true, defaultDir: "desc" },
              { header: "Watch", sortable: true, defaultDir: "desc" },
              { header: "Below target", sortable: true, defaultDir: "desc" },
              { header: "Too few cases", sortable: true, defaultDir: "desc" },
              { header: "Median" },
            ]}
            rows={data.metric_health.map((m) => ({
              key: m.metric,
              searchText: `${m.metric.replace(/_/g, " ")} ${m.domain.replace(/_/g, " ")}`,
              sort: [m.metric, m.domain, m.on_target, m.watch, m.below_target, m.insufficient_volume, null],
              cells: [
                <span key="m" className="text-charcoal-ink">{m.metric.replace(/_/g, " ")}</span>,
                <span key="d" className="text-charcoal-ink/60">{m.domain.replace(/_/g, " ")}</span>,
                <Badge key="on" variant={STATUS_TONE.on_target}>{m.on_target}</Badge>,
                <Badge key="w" variant={STATUS_TONE.watch}>{m.watch}</Badge>,
                <Badge key="b" variant={STATUS_TONE.below_target}>{m.below_target}</Badge>,
                <span key="few" className="text-charcoal-ink/60">{m.insufficient_volume}</span>,
                m.median_value === null ? "—" : m.unit === "percent" ? formatPercent(m.median_value) : m.median_value,
              ],
            }))}
            searchLabel="Search metrics"
            emptyMessage="No metric activity in this period yet."
            noun={{ one: "metric", many: "metrics" }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

const LICENSE_TONE: Record<string, "green" | "amber" | "red" | "grey"> = {
  current: "green",
  expiring_soon: "amber",
  expired: "red",
  not_recorded: "grey",
  not_applicable: "grey",
};

function CredentialMonitorSection() {
  const { data, isLoading, isError } = useProviderCredentialMonitor();
  const lift = useLiftProviderRestriction();
  const [liftingId, setLiftingId] = useState<string | null>(null);

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (isError || !data) return <p className="text-sm text-red-600">Could not load the credential monitor.</p>;
  if (data.providers.length === 0) {
    return <p className="text-sm text-charcoal-ink/60">No active clinical staff on file, or not authorised.</p>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Licence, indemnity, attestation (§29.6)</CardTitle>
        <CardDescription>
          A blank expiry date shows as &quot;not recorded&quot;, rather than as expired. Nobody has
          typed it in yet, that&apos;s a different fact.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* A row can hold a half-typed "lift" reason; DataTable hides filtered rows rather than unmounting them, so a
            search or a page change never loses it. */}
        <DataTable
          caption="Providers"
          columns={[
            { header: "Provider", sortable: true, className: "min-w-44" },
            { header: "Licence", sortable: true },
            { header: "Indemnity", sortable: true },
            { header: "Attestation", sortable: true },
            { header: "Open complaints", sortable: true, defaultDir: "desc", align: "right" },
            { header: "Status", sortable: true },
          ]}
          rows={data.providers.map((p) => ({
            key: p.clinical_staff_id,
            searchText: `${p.full_name} ${p.doctor_tier ?? ""} ${p.license_state} ${p.work_restricted ? "restricted" : "clear"}`,
            // Licence sorts by days left, overdue first; restricted providers sort before clear ones.
            sort: [p.full_name, p.license_days_remaining, p.indemnity_state, p.attestation_current ? 1 : 0, p.open_complaints, p.work_restricted ? 0 : 1],
            cells: [
              <div key="who">
                <p className="font-medium text-charcoal-ink">{p.full_name}</p>
                <p className="text-xs text-charcoal-ink/50">{p.doctor_tier ?? "—"}</p>
              </div>,
              <div key="lic">
                <Badge variant={LICENSE_TONE[p.license_state]}>{p.license_state.replace("_", " ")}</Badge>
                {p.license_days_remaining !== null ? (
                  <p className="mt-1 text-xs text-charcoal-ink/50">
                    {p.license_days_remaining >= 0 ? `${p.license_days_remaining}d left` : `${Math.abs(p.license_days_remaining)}d overdue`}
                  </p>
                ) : null}
              </div>,
              <Badge key="ind" variant={LICENSE_TONE[p.indemnity_state]}>{p.indemnity_state.replace("_", " ")}</Badge>,
              <Badge key="att" variant={p.attestation_current ? "green" : "amber"}>{p.attestation_current ? "current" : "due"}</Badge>,
              <span key="c" className="text-charcoal-ink">{p.open_complaints}</span>,
              p.work_restricted ? (
                <div key="st" className="space-y-1">
                  <Badge variant="red">{p.restriction_stage?.replace("_", " ") ?? "restricted"}</Badge>
                  {liftingId === p.clinical_staff_id ? (
                    <RestrictionLiftForm
                      pending={lift.isPending}
                      onCancel={() => setLiftingId(null)}
                      onSubmit={(reason) => {
                        if (!p.restriction_id) return;
                        lift.mutate({ restrictionId: p.restriction_id, reason }, { onSuccess: () => setLiftingId(null) });
                      }}
                    />
                  ) : (
                    <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setLiftingId(p.clinical_staff_id)}>
                      Lift
                    </Button>
                  )}
                </div>
              ) : (
                <Badge key="st" variant="grey">clear</Badge>
              ),
            ],
          }))}
          searchLabel="Search providers"
          emptyMessage="No providers."
          noun={{ one: "provider", many: "providers" }}
        />
      </CardContent>
    </Card>
  );
}

function RestrictionLiftForm({
  onSubmit,
  onCancel,
  pending,
}: {
  onSubmit: (reason: string) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="flex gap-1">
      <input
        className="w-32 rounded border border-charcoal-ink/20 px-1.5 py-0.5 text-xs"
        placeholder="Reason"
        aria-label="Reason for lifting the restriction"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button
        type="button"
        size="sm"
        onClick={() => onSubmit(reason)}
        disabled={!reason.trim() || pending}
      >
        {pending ? "Lifting…" : "Lift"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
        Cancel
      </Button>
    </div>
  );
}

const COMPLAINT_STAGE_TONE: Record<string, "green" | "amber" | "red" | "grey" | "blue"> = {
  received: "grey",
  triage: "amber",
  investigation: "amber",
  provider_response: "blue",
  resolution: "blue",
  governance_review: "blue",
  closed: "green",
  withdrawn: "grey",
};

function ComplaintsSection({ complaintsBasePath }: { complaintsBasePath: string }) {
  const { data, isLoading, isError } = useProviderComplaints();

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (isError || !data) return <p className="text-sm text-red-600">Could not load complaints.</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">§29.5 complaints pipeline</CardTitle>
        <CardDescription>
          received → triage → investigation → provider response → resolution → governance review
          → closed. A clinical complaint can only close through a signed governance review.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-charcoal-ink/50">No complaints on file.</p>
        ) : (
          <div className="divide-y divide-charcoal-ink/5">
            {data.map((c) => (
              <Link
                key={c.id}
                href={`${complaintsBasePath}/${c.id}`}
                className="flex items-center justify-between gap-3 py-3 hover:bg-charcoal-ink/5"
              >
                <div>
                  <p className="text-sm font-medium text-charcoal-ink">
                    {c.reference}: {c.subject?.full_name ?? "Unknown provider"}
                  </p>
                  <p className="text-xs text-charcoal-ink/50">
                    {c.category} · {new Date(c.created_at).toLocaleDateString()}
                  </p>
                </div>
                <Badge variant={COMPLAINT_STAGE_TONE[c.stage] ?? "grey"}>{c.stage.replace("_", " ")}</Badge>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
