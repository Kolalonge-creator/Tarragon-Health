"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { signClinicalRuleWithGovernanceAction, type SignoffActionState } from "./actions";

export type StaffOption = { id: string; full_name: string; doctor_tier: string | null };
export type ProtocolOption = { id: string; protocol_id: string; title: string; version_number: number };

export type UnsignedRule = {
  id: string;
  rule_key: string;
  version: number;
  name: string;
  description: string | null;
  category: string;
  status: string;
  /** Plain-English consequence of signing, derived server-side. */
  whatHappens: string;
};

export type SignedRule = {
  id: string;
  rule_key: string;
  version: number;
  name: string;
  category: string;
  ownerName: string | null;
  protocolTitle: string | null;
  signedOn: string | null;
  whatHappens: string;
};

export type SettledItem = {
  key: string;
  title: string;
  detail: string;
  href: string;
};

const TIER_LABEL: Record<string, string> = {
  chief_medical_officer: "Chief Medical Officer",
  senior_medical_officer: "Senior Medical Officer",
  medical_officer: "Medical Officer",
};

function SignRuleForm({
  rule,
  staff,
  protocols,
}: {
  rule: UnsignedRule;
  staff: StaffOption[];
  protocols: ProtocolOption[];
}) {
  const [state, action, pending] = useActionState<SignoffActionState, FormData>(
    signClinicalRuleWithGovernanceAction,
    undefined
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{rule.name}</CardTitle>
          <Badge variant="amber">Not signed</Badge>
          <Badge variant="grey">{rule.category}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {rule.description && <p className="text-sm text-charcoal-ink/70">{rule.description}</p>}

        <div className="rounded-md border border-mist-grey/40 bg-mist-grey/10 p-3 text-sm">
          <p className="font-medium text-charcoal-ink/80">What changes when you sign this</p>
          <p className="text-charcoal-ink/70">{rule.whatHappens}</p>
        </div>

        <form action={action} className="space-y-3">
          <input type="hidden" name="source_id" value={rule.id} />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`owner-${rule.id}`}>1. Who is accountable for this rule?</Label>
              <Select id={`owner-${rule.id}`} name="owner_clinical_staff_id" defaultValue="" required>
                <option value="">Choose a doctor…</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                    {s.doctor_tier ? ` — ${TIER_LABEL[s.doctor_tier] ?? s.doctor_tier}` : ""}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-charcoal-ink/60">
                The doctor who owns this rule&apos;s clinical behaviour and reviews it if it misfires.
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor={`protocol-${rule.id}`}>2. Which signed protocol are its thresholds from?</Label>
              <Select id={`protocol-${rule.id}`} name="protocol_version_id" defaultValue="" required>
                <option value="">Choose a protocol…</option>
                {protocols.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} (v{p.version_number})
                  </option>
                ))}
              </Select>
              <p className="text-xs text-charcoal-ink/60">
                Deliberately not pre-filled: which protocol backs a rule is a clinical judgement, and
                it is recorded as yours.
              </p>
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm text-charcoal-ink/80">
            <input type="checkbox" name="confirm" className="mt-1" />
            <span>
              3. I am signing this as Clinical Director. My name is recorded against it, and the rule
              goes live immediately.
            </span>
          </label>

          <Button type="submit" disabled={pending}>
            {pending ? "Signing…" : "Sign and activate"}
          </Button>

          {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
          {state?.success && <p className="text-sm text-green-700">{state.success}</p>}
        </form>
      </CardContent>
    </Card>
  );
}

function CorrectRuleForm({
  rule,
  staff,
  protocols,
}: {
  rule: SignedRule;
  staff: StaffOption[];
  protocols: ProtocolOption[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<SignoffActionState, FormData>(
    signClinicalRuleWithGovernanceAction,
    undefined
  );

  return (
    <li className="rounded-md border border-mist-grey/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-charcoal-ink">{rule.name}</span>
        <Badge variant="green">Signed</Badge>
      </div>
      <p className="mt-1 text-xs text-charcoal-ink/60">
        Owner: {rule.ownerName ?? "—"} · Protocol: {rule.protocolTitle ?? "—"}
        {rule.signedOn ? ` · signed ${rule.signedOn}` : ""}
      </p>

      {!open && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => setOpen(true)}
        >
          Change the owner or protocol
        </Button>
      )}

      {open && (
        <form action={action} className="mt-3 space-y-3">
          <input type="hidden" name="source_id" value={rule.id} />
          <p className="text-xs text-charcoal-ink/70">
            This records a new version with the corrected link and retires the current one. The
            rule&apos;s clinical behaviour is copied across unchanged, and the original signature
            stays in the history.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`fix-owner-${rule.id}`}>Accountable owner</Label>
              <Select id={`fix-owner-${rule.id}`} name="owner_clinical_staff_id" defaultValue="" required>
                <option value="">Choose a doctor…</option>
                {staff.map((s2) => (
                  <option key={s2.id} value={s2.id}>
                    {s2.full_name}
                    {s2.doctor_tier ? ` — ${TIER_LABEL[s2.doctor_tier] ?? s2.doctor_tier}` : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`fix-protocol-${rule.id}`}>Signed protocol</Label>
              <Select id={`fix-protocol-${rule.id}`} name="protocol_version_id" defaultValue="" required>
                <option value="">Choose a protocol…</option>
                {protocols.map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.title} (v{pr.version_number})
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm text-charcoal-ink/80">
            <input type="checkbox" name="confirm" className="mt-1" />
            <span>I am signing this correction as Clinical Director.</span>
          </label>

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save correction"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>

          {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
          {state?.success && <p className="text-sm text-green-700">{state.success}</p>}
        </form>
      )}
    </li>
  );
}

export function SignoffChecklist({
  unsignedRules,
  signedRules,
  unsignedConfigs,
  settled,
  staff,
  protocols,
  totalConfigCount,
  basePath = "/admin/settings",
}: {
  unsignedRules: UnsignedRule[];
  signedRules: SignedRule[];
  unsignedConfigs: SettledItem[];
  settled: SettledItem[];
  staff: StaffOption[];
  protocols: ProtocolOption[];
  totalConfigCount: number;
  /** Where the "sign a clinical protocol first" prompt below links — the
   * only hardcoded /admin/settings/* link left in this component after
   * unsignedConfigs/settled already threaded their hrefs through
   * readGovernedConfigSignoff's basePath. Found 2026-09-22: rendering this
   * component unchanged on /clinician/clinical-signoff meant a CMO hitting
   * this exact empty state got a link into /admin, which proxy.ts refuses
   * for a plain `clinician` login — the one dead end left in the page this
   * PR built specifically so a CMO never has to touch /admin. */
  basePath?: string;
}) {
  const signedRuleCount = signedRules.length;
  const totalRules = unsignedRules.length + signedRuleCount;
  const outstanding = unsignedRules.length + unsignedConfigs.length;
  const allGreen = outstanding === 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {allGreen
              ? "Everything is signed"
              : `${outstanding} thing${outstanding === 1 ? "" : "s"} still need your signature`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-charcoal-ink/70">
            Clinical rules signed: <strong>{signedRuleCount} of {totalRules}</strong>. Platform
            configuration signed: <strong>{settled.length} of {totalConfigCount}</strong>.
          </p>
          {allGreen ? (
            <p className="text-green-700">
              Nothing is waiting on you here. Every clinical rule and every governed configuration
              carries a Clinical Director signature.
            </p>
          ) : (
            <p className="text-charcoal-ink/70">
              Each card below is one rule. Answer the two questions, tick the box, press the button —
              that is the whole thing. Nothing is signed until you press it.
            </p>
          )}
        </CardContent>
      </Card>

      {unsignedConfigs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Configuration that needs signing elsewhere</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-charcoal-ink/70">
              These are signed on their own pages, because each one needs its actual values reviewed
              before a signature means anything.
            </p>
            <ul className="space-y-1">
              {unsignedConfigs.map((c) => (
                <li key={c.key}>
                  <span className="text-amber-700">•</span>{" "}
                  <Link href={c.href} className="underline">
                    {c.title}
                  </Link>{" "}
                  — {c.detail}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {protocols.length === 0 && unsignedRules.length > 0 && (
        <Card>
          <CardContent className="py-4 text-sm text-amber-800">
            No signed protocol exists to link a rule to yet, so none of these can be signed.{" "}
            <Link href={`${basePath}/protocols`} className="underline">
              Sign a clinical protocol first
            </Link>
            .
          </CardContent>
        </Card>
      )}

      {unsignedRules.map((rule) => (
        <SignRuleForm key={rule.id} rule={rule} staff={staff} protocols={protocols} />
      ))}

      {signedRules.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Signed clinical rules</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-charcoal-ink/70">
              Each one names the protocol its thresholds come from. If that protocol does not
              describe the rule, correct it here — an inaccurate governance link reads as a
              deliberate claim, which is worse than a missing one.
            </p>
            <ul className="space-y-2">
              {signedRules.map((r) => (
                <CorrectRuleForm key={r.id} rule={r} staff={staff} protocols={protocols} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {settled.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Platform configuration — signed</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-charcoal-ink/70">
              {settled.map((s) => (
                <li key={s.key}>
                  <span className="text-green-700">✓</span>{" "}
                  <Link href={s.href} className="underline">
                    {s.title}
                  </Link>{" "}
                  — {s.detail}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
