"use client";

import { useState } from "react";
import {
  useAddInsurancePolicy,
  useInsuranceBenefits,
  useInsurerDirectory,
  usePatientInsuranceClaims,
  usePatientInsurancePolicies,
  usePatientPreauthorizations,
  type InsurancePolicy,
  type Insurer,
} from "@/lib/queries/insurance";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CoverageDecisionNote } from "@/components/coverage-decision-note";
import {
  koboToNaira,
  type InsuranceClaimStatus,
  type InsurancePolicyStatus,
  type InsurancePreauthStatus,
} from "@tarragon/shared";

const POLICY_STATUS_BADGE: Record<InsurancePolicyStatus, { variant: BadgeProps["variant"]; label: string }> = {
  active: { variant: "green", label: "Active" },
  expired: { variant: "grey", label: "Expired" },
  suspended: { variant: "amber", label: "Suspended" },
  cancelled: { variant: "grey", label: "Cancelled" },
};

const PREAUTH_STATUS_BADGE: Record<InsurancePreauthStatus, { variant: BadgeProps["variant"]; label: string }> = {
  pending: { variant: "amber", label: "Awaiting decision" },
  approved: { variant: "green", label: "Approved" },
  denied: { variant: "red", label: "Not covered" },
  expired: { variant: "grey", label: "Expired" },
};

const CLAIM_STATUS_BADGE: Record<InsuranceClaimStatus, { variant: BadgeProps["variant"]; label: string }> = {
  submitted: { variant: "blue", label: "Submitted" },
  adjudicating: { variant: "amber", label: "Being reviewed" },
  approved: { variant: "green", label: "Approved" },
  partially_approved: { variant: "green", label: "Partially covered" },
  denied: { variant: "red", label: "Not covered" },
  paid: { variant: "green", label: "Paid" },
};

const SERVICE_CATEGORY_LABEL: Record<string, string> = {
  consultation: "Doctor consultation",
  laboratory: "Lab tests",
  pharmacy: "Pharmacy",
  referral: "Specialist referral",
};

function naira(kobo: number): string {
  return `₦${koboToNaira(kobo).toLocaleString()}`;
}

function formatDate(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

function AddPolicyForm({
  patientId,
  organisationId,
  onDone,
}: {
  patientId: string;
  organisationId: string;
  onDone: () => void;
}) {
  const { data: insurers } = useInsurerDirectory();
  const addPolicy = useAddInsurancePolicy(patientId, organisationId);
  const [insurerId, setInsurerId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [planName, setPlanName] = useState("");
  const [relationship, setRelationship] = useState<InsurancePolicy["relationship"]>("self");
  const [policyHolderName, setPolicyHolderName] = useState("");
  const [groupNumber, setGroupNumber] = useState("");

  return (
    <div className="space-y-3 rounded-md bg-charcoal-ink/5 dark:bg-night-ink/10 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="insurer">Insurer</Label>
          <Select id="insurer" value={insurerId} onChange={(e) => setInsurerId(e.target.value)}>
            <option value="">Select your insurer</option>
            {insurers?.map((insurer: Insurer) => (
              <option key={insurer.id} value={insurer.id}>
                {insurer.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="member_id">Member ID</Label>
          <Input id="member_id" value={memberId} onChange={(e) => setMemberId(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="plan_name">Plan name (optional)</Label>
          <Input id="plan_name" value={planName} onChange={(e) => setPlanName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="relationship">Whose cover is this?</Label>
          <Select
            id="relationship"
            value={relationship}
            onChange={(e) => setRelationship(e.target.value as InsurancePolicy["relationship"])}
          >
            <option value="self">Mine</option>
            <option value="spouse">My spouse&apos;s</option>
            <option value="child">My child&apos;s</option>
            <option value="other">Someone else&apos;s</option>
          </Select>
        </div>
        {relationship !== "self" && (
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="policy_holder">Policy holder&apos;s name</Label>
            <Input
              id="policy_holder"
              value={policyHolderName}
              onChange={(e) => setPolicyHolderName(e.target.value)}
            />
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="group_number">Group number (optional)</Label>
          <Input id="group_number" value={groupNumber} onChange={(e) => setGroupNumber(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        Your care team will confirm this against your insurer before it&apos;s used for anything.
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!insurerId || !memberId.trim() || addPolicy.isPending}
          onClick={() =>
            addPolicy.mutate(
              {
                insurerId,
                memberId: memberId.trim(),
                planName: planName.trim() || null,
                policyHolderName: relationship === "self" ? null : policyHolderName.trim() || null,
                relationship,
                groupNumber: groupNumber.trim() || null,
              },
              { onSuccess: onDone },
            )
          }
        >
          {addPolicy.isPending ? "Saving…" : "Save policy"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {addPolicy.isError && (
        <p className="text-xs text-red-600 dark:text-red-400">Could not save your policy. Try again.</p>
      )}
    </div>
  );
}

function BenefitsTable({ insurerId, planName }: { insurerId: string; planName: string | null }) {
  const { data: benefits } = useInsuranceBenefits(insurerId, planName);
  if (!benefits || benefits.length === 0) return null;

  return (
    <div className="mt-3">
      <p className="mb-1 text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">What your plan covers</p>
      <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15 text-sm">
        {benefits.map((benefit) => (
          <li key={benefit.id} className="flex items-center justify-between py-1.5">
            <span className="text-charcoal-ink dark:text-night-ink">
              {SERVICE_CATEGORY_LABEL[benefit.service_category] ?? benefit.service_category.replace(/_/g, " ")}
            </span>
            <span className="text-charcoal-ink/60 dark:text-night-ink/60">
              {Math.round(benefit.coverage_pct * 100)}% covered
              {benefit.copay_fixed_kobo > 0 && ` · ${naira(benefit.copay_fixed_kobo)} copay`}
              {benefit.requires_preauth && " · needs pre-authorisation"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PolicyCard({ patientId, organisationId }: { patientId: string; organisationId: string }) {
  const { data: policies, isLoading } = usePatientInsurancePolicies(patientId);
  const [adding, setAdding] = useState(false);

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your policy</CardTitle>
        {(!policies || policies.length === 0) && !adding && (
          <CardDescription>No insurance on file yet. Add it so your care team can check what it covers.</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {policies?.map((policy) => {
          const badge = POLICY_STATUS_BADGE[policy.status];
          return (
            <div key={policy.id} className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant={badge.variant}>{badge.label}</Badge>
                <Badge variant={policy.verified_at ? "green" : "grey"}>
                  {policy.verified_at ? "Confirmed" : "Not yet confirmed"}
                </Badge>
              </div>
              <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{policy.insurer?.name ?? "Unknown insurer"}</p>
              <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                Member ID {policy.member_id}
                {policy.plan_name && ` · ${policy.plan_name}`}
                {policy.relationship !== "self" && policy.policy_holder_name && (
                  <> · {policy.policy_holder_name}&apos;s cover</>
                )}
              </p>
              {policy.status === "active" && (
                <BenefitsTable insurerId={policy.insurer_id} planName={policy.plan_name} />
              )}
            </div>
          );
        })}
        {adding ? (
          <AddPolicyForm patientId={patientId} organisationId={organisationId} onDone={() => setAdding(false)} />
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
            {policies && policies.length > 0 ? "Add another policy" : "Add your insurance"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function PreauthorizationsList({ patientId }: { patientId: string }) {
  const { data: requests, isLoading, isError } = usePatientPreauthorizations(patientId);
  if (isLoading || isError || !requests || requests.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pre-authorisation requests</CardTitle>
        <CardDescription>Your care team asks your insurer to approve certain services in advance.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {requests.map((request) => {
            const badge = PREAUTH_STATUS_BADGE[request.status];
            return (
              <li key={request.id} className="space-y-1.5 py-3">
                <div className="flex items-center gap-2">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  <span className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{formatDate(request.requested_at)}</span>
                </div>
                <p className="text-sm text-charcoal-ink dark:text-night-ink">
                  {SERVICE_CATEGORY_LABEL[request.service_category] ?? request.service_category.replace(/_/g, " ")} ·{" "}
                  {naira(request.estimated_amount_kobo)}
                </p>
                {request.status === "approved" && request.authorization_number && (
                  <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">Authorisation {request.authorization_number}</p>
                )}
                {request.status === "denied" && <CoverageDecisionNote denialReason={request.denial_reason} />}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function ClaimsList({ patientId }: { patientId: string }) {
  const { data: claims, isLoading, isError } = usePatientInsuranceClaims(patientId);
  if (isLoading || isError || !claims || claims.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Claims</CardTitle>
        <CardDescription>What your insurer paid, and what you&apos;re responsible for.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {claims.map((claim) => {
            const badge = CLAIM_STATUS_BADGE[claim.status];
            return (
              <li key={claim.id} className="space-y-1.5 py-3">
                <div className="flex items-center gap-2">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  <span className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{formatDate(claim.submitted_at)}</span>
                </div>
                <p className="text-sm text-charcoal-ink dark:text-night-ink">
                  {SERVICE_CATEGORY_LABEL[claim.service_category] ?? claim.service_category.replace(/_/g, " ")} ·{" "}
                  {naira(claim.billed_amount_kobo)}
                </p>
                {(claim.status === "approved" ||
                  claim.status === "partially_approved" ||
                  claim.status === "paid") && (
                  <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                    Insurer covered {claim.insurer_covered_kobo !== null ? naira(claim.insurer_covered_kobo) : "—"} ·
                    Your share {naira(claim.patient_copay_kobo)}
                  </p>
                )}
                {claim.status === "denied" && <CoverageDecisionNote denialReason={claim.denial_reason} />}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

export function InsuranceOverview({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string;
}) {
  return (
    <div className="space-y-6">
      <PolicyCard patientId={patientId} organisationId={organisationId} />
      <PreauthorizationsList patientId={patientId} />
      <ClaimsList patientId={patientId} />
    </div>
  );
}
