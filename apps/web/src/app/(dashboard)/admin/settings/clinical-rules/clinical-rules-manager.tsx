"use client";

import { useActionState, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import {
  promoteToShadowAction,
  signClinicalRuleAction,
  rollbackClinicalRuleAction,
  retireClinicalRuleAction,
  fetchShadowReportAction,
  draftNextClinicalRuleVersionAction,
  type ClinicalRuleActionState,
  type ShadowReportState,
  type DraftNextVersionState,
} from "./actions";

export type ClinicalStaffOption = { id: string; full_name: string; doctor_tier: string | null };
export type SignedProtocolOption = { id: string; protocol_id: string; title: string; version_number: number };

export type ClinicalRuleVersionRow = {
  id: string;
  rule_key: string;
  version: number;
  name: string;
  description: string;
  category: string;
  domain: string;
  event_type: string;
  population: unknown;
  conditions: unknown;
  actions: unknown;
  priority: number;
  specificity: number;
  escalation: unknown;
  suppression: unknown;
  explanation_template: string;
  status: "draft" | "shadow" | "active" | "retired" | "rolled_back";
  effective_from: string;
  effective_to: string | null;
  owner_clinical_staff_id: string | null;
  protocol_version_id: string | null;
  organisation_id: string | null;
  patient_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  activated_at: string | null;
  retired_at: string | null;
  retired_reason: string | null;
  rolled_back_at: string | null;
  rollback_reason: string | null;
  notes: string | null;
  created_at: string;
};

const STATUS_VARIANT: Record<ClinicalRuleVersionRow["status"], "grey" | "amber" | "green" | "red" | "blue"> = {
  draft: "grey",
  shadow: "amber",
  active: "green",
  retired: "grey",
  rolled_back: "red",
};

const CATEGORY_LABEL: Record<string, string> = {
  preventive: "Preventive",
  monitoring: "Monitoring",
  diagnostic: "Diagnostic",
  medication: "Medication",
  referral: "Referral",
  engagement: "Engagement",
  operational: "Operational",
};

function StatusBadge({ status }: { status: ClinicalRuleVersionRow["status"] }) {
  return <Badge variant={STATUS_VARIANT[status]}>{status.replace("_", " ")}</Badge>;
}

function PromoteButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ClinicalRuleActionState, FormData>(
    promoteToShadowAction,
    undefined
  );
  return (
    <form action={action} className="inline-flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Promoting…" : "Promote to shadow"}
      </Button>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.success && <p className="text-xs text-brand-green">{state.success}</p>}
    </form>
  );
}

function SignButton({
  id,
  activate = true,
  label = "Sign & activate",
}: {
  id: string;
  activate?: boolean;
  label?: string;
}) {
  const [state, action, pending] = useActionState<ClinicalRuleActionState, FormData>(
    signClinicalRuleAction,
    undefined
  );
  return (
    <form action={action} className="inline-flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="activate" value={activate ? "true" : "false"} />
      <Button type="submit" size="sm" variant={activate ? "default" : "outline"} disabled={pending}>
        {pending ? "Signing…" : label}
      </Button>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.success && <p className="text-xs text-brand-green">{state.success}</p>}
    </form>
  );
}

function RetireForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ClinicalRuleActionState, FormData>(
    retireClinicalRuleAction,
    undefined
  );
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <input
        name="reason"
        placeholder="Retirement reason (required)"
        className="rounded-md border border-mist-grey/60 p-1 text-xs"
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Retiring…" : "Retire"}
      </Button>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.success && <p className="text-xs text-brand-green">{state.success}</p>}
    </form>
  );
}

function RollbackForm({ ruleKey, signedVersions }: { ruleKey: string; signedVersions: number[] }) {
  const [state, action, pending] = useActionState<ClinicalRuleActionState, FormData>(
    rollbackClinicalRuleAction,
    undefined
  );
  if (signedVersions.length === 0) return null;
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="rule_key" value={ruleKey} />
      <select name="to_version" className="rounded-md border border-mist-grey/60 p-1 text-xs">
        {signedVersions.map((v) => (
          <option key={v} value={v}>
            Roll back to v{v}
          </option>
        ))}
      </select>
      <input
        name="reason"
        placeholder="Rollback reason (required)"
        className="rounded-md border border-mist-grey/60 p-1 text-xs"
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Rolling back…" : "§32.15 Rollback"}
      </Button>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.success && <p className="text-xs text-brand-green">{state.success}</p>}
    </form>
  );
}

function ShadowReportPanel({ ruleKey }: { ruleKey: string }) {
  const [state, action, pending] = useActionState<ShadowReportState, FormData>(
    fetchShadowReportAction,
    undefined
  );
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Hide shadow report" : "§32.13 View shadow report"}
      </Button>
      {open && (
        <form action={action} className="mt-2 space-y-2">
          <input type="hidden" name="rule_key" value={ruleKey} />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? "Loading…" : "Refresh (last 30 days)"}
          </Button>
          {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
          {state?.report && (
            <pre className="max-h-64 overflow-auto rounded-md bg-mist-grey/20 p-2 text-xs">
              {JSON.stringify(state.report, null, 2)}
            </pre>
          )}
        </form>
      )}
    </div>
  );
}

/**
 * The fix for "no way to sign this" on a rule already past `draft`: since
 * private.guard_clinical_rule_immutable refuses to let owner_clinical_staff_id
 * or protocol_version_id change once a row leaves draft, the only path to a
 * signable version is a fresh draft that copies the latest version's
 * clinical content and carries the two governance fields the original
 * seed rows shipped without. Deliberately admin-gated at the RLS layer
 * (clinical_rules_insert), same as every other draft creation on this
 * page — the Director-only gate is signClinicalRuleAction, not this one.
 */
function DraftNextVersionForm({
  sourceId,
  nextVersion,
  clinicalStaff,
  signedProtocols,
}: {
  sourceId: string;
  nextVersion: number;
  clinicalStaff: ClinicalStaffOption[];
  signedProtocols: SignedProtocolOption[];
}) {
  const [state, action, pending] = useActionState<DraftNextVersionState, FormData>(
    draftNextClinicalRuleVersionAction,
    undefined
  );
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="text-sm">Draft v{nextVersion}: assign owner &amp; link protocol</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <input type="hidden" name="source_id" value={sourceId} />
          <p className="text-xs text-charcoal-ink/60">
            Duplicates this rule&apos;s clinical content into a new draft, unchanged, with the owner
            and protocol you pick here. Nothing about the conditions or actions can be edited from
            this form — that stays a migration-only change.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor={`owner-${sourceId}`} className="text-xs font-medium text-charcoal-ink">
                Accountable owner
              </label>
              <Select id={`owner-${sourceId}`} name="owner_clinical_staff_id" defaultValue="">
                <option value="">Select a clinical staff owner…</option>
                {clinicalStaff.map((cs) => (
                  <option key={cs.id} value={cs.id}>
                    {cs.full_name}
                    {cs.doctor_tier ? ` (${cs.doctor_tier})` : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label htmlFor={`protocol-${sourceId}`} className="text-xs font-medium text-charcoal-ink">
                Signed protocol this rule implements
              </label>
              <Select id={`protocol-${sourceId}`} name="protocol_version_id" defaultValue="">
                <option value="">Select a signed protocol version…</option>
                {signedProtocols.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} (v{p.version_number}, {p.protocol_id})
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {signedProtocols.length === 0 && (
            <p className="text-xs text-amber-700">
              No signed protocol exists yet to link. Sign one at /admin/settings/protocols first, or
              leave this unset and the new draft still won&apos;t be signable until it is.
            </p>
          )}
          <div className="space-y-1">
            <label htmlFor={`notes-${sourceId}`} className="text-xs font-medium text-charcoal-ink">
              Notes (optional)
            </label>
            <textarea
              id={`notes-${sourceId}`}
              name="notes"
              rows={2}
              className="w-full rounded-md border border-mist-grey/60 p-2 text-xs"
              placeholder="Why this owner and protocol, if not obvious from the rule."
            />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? "Drafting…" : `Create draft v${nextVersion}`}
          </Button>
          {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
          {state?.success && <p className="text-xs text-brand-green">{state.success}</p>}
        </form>
      </CardContent>
    </Card>
  );
}

function RuleVersionCard({ rule, signedVersions }: { rule: ClinicalRuleVersionRow; signedVersions: number[] }) {
  const canPromoteToShadow = rule.status === "draft";
  const canSign = rule.status === "draft" || rule.status === "shadow";
  const canRetire = rule.status === "draft" || rule.status === "shadow" || rule.status === "active";
  const isSignable = Boolean(rule.protocol_version_id && rule.owner_clinical_staff_id);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">
            {rule.name} <span className="font-mono text-xs text-charcoal-ink/50">v{rule.version}</span>
          </CardTitle>
          <StatusBadge status={rule.status} />
          <Badge variant="blue">{CATEGORY_LABEL[rule.category] ?? rule.category}</Badge>
          <Badge variant="grey">{rule.domain}</Badge>
          <Badge variant="grey">trigger: {rule.event_type}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/70">{rule.description}</p>

        <div className="rounded-md border border-mist-grey/40 p-2 text-xs">
          <p className="font-medium text-charcoal-ink/70">Explanation template (§32.11)</p>
          <p className="text-charcoal-ink/80">{rule.explanation_template}</p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs text-charcoal-ink/60 sm:grid-cols-4">
          <span>Priority: {rule.priority}</span>
          <span>Specificity: {rule.specificity}</span>
          <span>Owner set: {rule.owner_clinical_staff_id ? "yes" : "no"}</span>
          <span>Protocol linked: {rule.protocol_version_id ? "yes" : "no"}</span>
        </div>

        {!isSignable && rule.status !== "active" && rule.status !== "retired" && rule.status !== "rolled_back" && (
          <p className="text-xs text-amber-700">
            Cannot be signed yet. Assign an owner and link a signed protocol version first.
          </p>
        )}

        {rule.retired_reason && (
          <p className="text-xs text-charcoal-ink/60">Retired: {rule.retired_reason}</p>
        )}
        {rule.rollback_reason && (
          <p className="text-xs text-charcoal-ink/60">Rolled back: {rule.rollback_reason}</p>
        )}

        <div className="flex flex-wrap gap-3">
          {canPromoteToShadow && <PromoteButton id={rule.id} />}
          {canSign && isSignable && <SignButton id={rule.id} />}
          {canSign && isSignable && (
            <SignButton id={rule.id} activate={false} label="Sign only (don't activate)" />
          )}
          {canRetire && <RetireForm id={rule.id} />}
          <RollbackForm ruleKey={rule.rule_key} signedVersions={signedVersions.filter((v) => v !== rule.version)} />
        </div>

        <ShadowReportPanel ruleKey={rule.rule_key} />
      </CardContent>
    </Card>
  );
}

export function ClinicalRulesManager({
  rules,
  clinicalStaff,
  signedProtocols,
}: {
  rules: ClinicalRuleVersionRow[];
  clinicalStaff: ClinicalStaffOption[];
  signedProtocols: SignedProtocolOption[];
}) {
  const byKey = new Map<string, ClinicalRuleVersionRow[]>();
  for (const rule of rules) {
    const bucket = byKey.get(rule.rule_key) ?? [];
    bucket.push(rule);
    byKey.set(rule.rule_key, bucket);
  }

  const groups = [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b));

  if (groups.length === 0) {
    return <p className="text-sm text-charcoal-ink/60">No clinical rules defined yet.</p>;
  }

  return (
    <div className="space-y-8">
      {groups.map(([ruleKey, versions]) => {
        const signedVersions = versions.filter((v) => v.approved_by).map((v) => v.version);
        // versions is already ordered version desc (page.tsx's query order).
        const latest = versions[0];
        const latestNeedsGovernance =
          !latest.owner_clinical_staff_id || !latest.protocol_version_id;
        return (
          <div key={ruleKey} className="space-y-3">
            <h2 className="font-mono text-sm text-charcoal-ink/50">{ruleKey}</h2>
            {versions.map((rule) => (
              <RuleVersionCard key={rule.id} rule={rule} signedVersions={signedVersions} />
            ))}
            {latestNeedsGovernance && latest.status !== "retired" && latest.status !== "rolled_back" && (
              <DraftNextVersionForm
                sourceId={latest.id}
                nextVersion={latest.version + 1}
                clinicalStaff={clinicalStaff}
                signedProtocols={signedProtocols}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
