"use client";

import { useState } from "react";
import {
  useAllClinicalStaff,
  useCreateClinicalStaff,
  useVerifyClinicalStaff,
  useSetClinicalStaffActive,
  useSetClinicalStaffIndemnity,
  useSetClinicalStaffIndemnityExempt,
  useOrgIndemnityExemptions,
  useAddIndemnityExemption,
  useRemoveIndemnityExemption,
  type ClinicalStaff,
  type ClinicalStaffIndemnityExemption,
} from "@/lib/queries/clinical-staff";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { DOCTOR_TIER_LABEL } from "@/lib/clinical/doctor-tier";

// Only Clinical Director + Tier 4/5 must carry indemnity/malpractice cover
// before activation — docs/CLINICAL_TRUST_MODEL_SPEC.md §5,
// docs/Tarragon_Health_Master_Operating_Plan_v4.md §4. Tiers 1-3 are
// employed and covered under Tarragon's institutional policy.
const INDEMNITY_REQUIRED_TIERS: ClinicalStaff["doctor_tier"][] = [
  "tier_4_senior_registrar",
  "tier_5_partner_specialist",
];

function needsIndemnity(staff: Pick<ClinicalStaff, "is_clinical_director" | "doctor_tier">): boolean {
  return staff.is_clinical_director || INDEMNITY_REQUIRED_TIERS.includes(staff.doctor_tier);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function daysUntil(value: string): number {
  return Math.ceil((new Date(value).getTime() - Date.now()) / MS_PER_DAY);
}

/** Re-verification is annual (CLINICAL_TRUST_MODEL_SPEC.md §5) — derived from license_verified_at, no separate column needed. */
function reverifyDueDate(licenseVerifiedAt: string): Date {
  const due = new Date(licenseVerifiedAt);
  due.setFullYear(due.getFullYear() + 1);
  return due;
}

function ReverifyBadge({ licenseVerifiedAt }: { licenseVerifiedAt: string }) {
  const due = reverifyDueDate(licenseVerifiedAt);
  const days = daysUntil(due.toISOString());
  if (days < 0) return <Badge variant="red">Re-verification overdue</Badge>;
  if (days <= 30) return <Badge variant="amber">Re-verify by {formatDate(due.toISOString())}</Badge>;
  return <Badge variant="grey">Re-verify by {formatDate(due.toISOString())}</Badge>;
}

function IndemnityBadge({ expiresAt }: { expiresAt: string | null }) {
  if (!expiresAt) return <Badge variant="grey">No cover on file</Badge>;
  const days = daysUntil(expiresAt);
  if (days < 0) return <Badge variant="red">Cover expired</Badge>;
  if (days <= 30) return <Badge variant="amber">Cover expires {formatDate(expiresAt)}</Badge>;
  return <Badge variant="green">Covered until {formatDate(expiresAt)}</Badge>;
}

/** True if this record can be active without current cover — an individual exemption or an org/tier/director exemption covering it. */
function isIndemnityExempt(staff: ClinicalStaff, orgExemptions: ClinicalStaffIndemnityExemption[]): boolean {
  if (staff.indemnity_exempt) return true;
  return orgExemptions.some(
    (e) =>
      (e.doctor_tier === null && !e.applies_to_director) ||
      (e.doctor_tier !== null && e.doctor_tier === staff.doctor_tier) ||
      (e.applies_to_director && staff.is_clinical_director)
  );
}

function IndemnityForm({
  staff,
  orgExemptions,
}: {
  staff: ClinicalStaff;
  orgExemptions: ClinicalStaffIndemnityExemption[];
}) {
  const setIndemnity = useSetClinicalStaffIndemnity();
  const setExempt = useSetClinicalStaffIndemnityExempt();
  const [insurer, setInsurer] = useState(staff.indemnity_insurer ?? "");
  const [policyNumber, setPolicyNumber] = useState(staff.indemnity_policy_number ?? "");
  const [expiresAt, setExpiresAt] = useState(
    staff.indemnity_expires_at ? staff.indemnity_expires_at.slice(0, 10) : ""
  );

  const canSave = insurer.trim().length > 0 && policyNumber.trim().length > 0 && expiresAt.length > 0;
  const coveredByBroaderExemption = !staff.indemnity_exempt && isIndemnityExempt(staff, orgExemptions);

  return (
    <div className="mt-3 rounded-lg border border-charcoal-ink/10 bg-warm-ivory p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/60">
          Indemnity / malpractice insurance
        </p>
        {staff.indemnity_exempt ? (
          <Badge variant="blue">Individually exempt</Badge>
        ) : coveredByBroaderExemption ? (
          <Badge variant="blue">Covered by org/tier/director exemption</Badge>
        ) : (
          <IndemnityBadge expiresAt={staff.indemnity_expires_at} />
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Input
          placeholder="Insurer"
          value={insurer}
          onChange={(e) => setInsurer(e.target.value)}
        />
        <Input
          placeholder="Policy number"
          value={policyNumber}
          onChange={(e) => setPolicyNumber(e.target.value)}
        />
        <Input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
        />
      </div>
      {setIndemnity.isError && (
        <p className="mt-2 text-sm text-red-600">{(setIndemnity.error as Error).message}</p>
      )}
      <Button
        size="sm"
        variant="outline"
        className="mt-2"
        disabled={!canSave || setIndemnity.isPending}
        onClick={() =>
          setIndemnity.mutate({
            clinicalStaffId: staff.id,
            insurer: insurer.trim(),
            policyNumber: policyNumber.trim(),
            expiresAt,
          })
        }
      >
        {setIndemnity.isPending ? "Saving…" : "Save cover"}
      </Button>

      <label className="mt-3 flex items-center gap-2 text-sm text-charcoal-ink/70">
        <input
          type="checkbox"
          checked={staff.indemnity_exempt}
          disabled={setExempt.isPending}
          onChange={(e) => setExempt.mutate({ clinicalStaffId: staff.id, exempt: e.target.checked })}
        />
        Exempt this person from the indemnity requirement
      </label>
      {setExempt.isError && (
        <p className="mt-1 text-sm text-red-600">{(setExempt.error as Error).message}</p>
      )}
    </div>
  );
}

type ExemptionScope = "org_wide" | "director" | "tier_4_senior_registrar" | "tier_5_partner_specialist";

const EXEMPTION_SCOPE_LABEL: Record<ExemptionScope, string> = {
  org_wide: "Whole organisation",
  director: "All Clinical Directors",
  tier_4_senior_registrar: `All ${DOCTOR_TIER_LABEL.tier_4_senior_registrar}`,
  tier_5_partner_specialist: `All ${DOCTOR_TIER_LABEL.tier_5_partner_specialist}`,
};

function exemptionScopeOf(e: ClinicalStaffIndemnityExemption): ExemptionScope {
  if (e.applies_to_director) return "director";
  if (e.doctor_tier === "tier_4_senior_registrar" || e.doctor_tier === "tier_5_partner_specialist") {
    return e.doctor_tier;
  }
  return "org_wide";
}

function IndemnityExemptionsSection() {
  const { data: exemptions, isLoading } = useOrgIndemnityExemptions();
  const addExemption = useAddIndemnityExemption();
  const removeExemption = useRemoveIndemnityExemption();

  const [scope, setScope] = useState<ExemptionScope>("org_wide");
  const [reason, setReason] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Indemnity requirement exemptions</CardTitle>
        <CardDescription>
          Waives the indemnity/malpractice cover requirement for activation — for a whole tier or
          all Clinical Directors org-wide, or the whole organisation. To exempt a single named
          person instead, use the checkbox under their record above. Every exemption here is
          admin-granted and visible to all staff for transparency.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {exemptions && exemptions.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No org-wide, tier-wide, or director-wide exemptions on file.</p>
        )}
        {exemptions && exemptions.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {exemptions.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-4 py-2.5">
                <div>
                  <p className="text-sm font-medium text-charcoal-ink">
                    {EXEMPTION_SCOPE_LABEL[exemptionScopeOf(e)]}
                  </p>
                  {e.reason && <p className="text-xs text-charcoal-ink/60">{e.reason}</p>}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={removeExemption.isPending}
                  onClick={() => removeExemption.mutate(e.id)}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-lg border border-charcoal-ink/10 bg-warm-ivory p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-charcoal-ink/60">
            Grant a new exemption
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Select value={scope} onChange={(e) => setScope(e.target.value as ExemptionScope)}>
              <option value="org_wide">{EXEMPTION_SCOPE_LABEL.org_wide}</option>
              <option value="director">{EXEMPTION_SCOPE_LABEL.director}</option>
              <option value="tier_4_senior_registrar">
                {EXEMPTION_SCOPE_LABEL.tier_4_senior_registrar}
              </option>
              <option value="tier_5_partner_specialist">
                {EXEMPTION_SCOPE_LABEL.tier_5_partner_specialist}
              </option>
            </Select>
            <Input
              placeholder="Reason (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {addExemption.isError && (
            <p className="mt-2 text-sm text-red-600">{(addExemption.error as Error).message}</p>
          )}
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            disabled={addExemption.isPending}
            onClick={() =>
              addExemption.mutate(
                {
                  doctorTier: scope === "tier_4_senior_registrar" || scope === "tier_5_partner_specialist" ? scope : null,
                  applyToDirector: scope === "director",
                  reason: reason.trim(),
                },
                { onSuccess: () => setReason("") }
              )
            }
          >
            {addExemption.isPending ? "Granting…" : "Grant exemption"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ClinicalStaffManager() {
  const { data: staff, isLoading, isError } = useAllClinicalStaff();
  const { data: orgExemptions } = useOrgIndemnityExemptions();
  const create = useCreateClinicalStaff();
  const verify = useVerifyClinicalStaff();
  const setActive = useSetClinicalStaffActive();

  const [doctorTier, setDoctorTier] = useState<ClinicalStaff["doctor_tier"]>("tier_1");
  const [isClinicalDirector, setIsClinicalDirector] = useState(false);
  const [fullName, setFullName] = useState("");
  const [credentialType, setCredentialType] = useState("");
  const [credentialNumber, setCredentialNumber] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [bio, setBio] = useState("");
  const [profilePhone, setProfilePhone] = useState("");

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (isError || !staff) {
    return <p className="text-sm text-red-600">Could not load clinical staff.</p>;
  }

  const canSubmit = fullName.trim().length > 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add clinical staff</CardTitle>
          <CardDescription>
            Starts inactive and unverified. A unique employee number (EMP-000123) is assigned
            automatically so staff who share a name and tier can be told apart. Link an existing
            login by phone number if this person needs to act in the system (sign escalations, sign
            protocols) — leave it blank for a bio-only Clinical Director record.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="doctor-tier">Doctor tier</Label>
              <Select
                id="doctor-tier"
                value={doctorTier ?? ""}
                onChange={(e) =>
                  setDoctorTier((e.target.value || null) as ClinicalStaff["doctor_tier"])
                }
              >
                <option value="">No tier (bio-only record)</option>
                {(Object.keys(DOCTOR_TIER_LABEL) as (keyof typeof DOCTOR_TIER_LABEL)[]).map((tier) => (
                  <option key={tier} value={tier}>
                    {DOCTOR_TIER_LABEL[tier]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="full-name">Full name</Label>
              <Input id="full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-charcoal-ink/70">
            <input
              type="checkbox"
              checked={isClinicalDirector}
              onChange={(e) => setIsClinicalDirector(e.target.checked)}
            />
            Clinical Director (org-governance flag — protocol signing, staff verification;
            independent of tier)
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="credential-type">Credential type</Label>
              <Input
                id="credential-type"
                placeholder="MDCN or NMCN"
                value={credentialType}
                onChange={(e) => setCredentialType(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="credential-number">Credential number</Label>
              <Input
                id="credential-number"
                value={credentialNumber}
                onChange={(e) => setCredentialNumber(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="specialty">Specialty (optional)</Label>
            <Input id="specialty" value={specialty} onChange={(e) => setSpecialty(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bio">Bio (optional)</Label>
            <Textarea id="bio" rows={3} value={bio} onChange={(e) => setBio(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-phone">Link to existing login (optional)</Label>
            <Input
              id="profile-phone"
              placeholder="+234XXXXXXXXXX"
              value={profilePhone}
              onChange={(e) => setProfilePhone(e.target.value)}
            />
          </div>
          {create.isError && (
            <p className="text-sm text-red-600">{(create.error as Error).message}</p>
          )}
          <Button
            disabled={!canSubmit || create.isPending}
            onClick={() => {
              create.mutate(
                {
                  doctorTier,
                  isClinicalDirector,
                  fullName: fullName.trim(),
                  credentialType: credentialType.trim(),
                  credentialNumber: credentialNumber.trim(),
                  specialty: specialty.trim(),
                  bio: bio.trim(),
                  profilePhone: profilePhone.trim(),
                },
                {
                  onSuccess: () => {
                    setFullName("");
                    setCredentialType("");
                    setCredentialNumber("");
                    setSpecialty("");
                    setBio("");
                    setProfilePhone("");
                  },
                }
              );
            }}
          >
            {create.isPending ? "Adding…" : "Add"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All clinical staff</CardTitle>
        </CardHeader>
        <CardContent>
          {staff.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No clinical staff on file yet.</p>
          )}
          {staff.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {staff.map((s) => {
                const requiresIndemnity = needsIndemnity(s);
                const hasCurrentIndemnity =
                  !requiresIndemnity ||
                  isIndemnityExempt(s, orgExemptions ?? []) ||
                  (s.indemnity_expires_at !== null && daysUntil(s.indemnity_expires_at) >= 0);
                const canActivate = s.license_verified_at !== null && hasCurrentIndemnity;
                const tierLabel = s.doctor_tier ? DOCTOR_TIER_LABEL[s.doctor_tier] : "No tier";

                return (
                  <li key={s.id} className="py-3">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-charcoal-ink">
                          {s.full_name}{" "}
                          <span className="text-charcoal-ink/60">
                            — {s.is_clinical_director ? `Clinical Director · ${tierLabel}` : tierLabel}
                          </span>
                        </p>
                        <p className="text-xs text-charcoal-ink/60">
                          {s.employee_number && (
                            <span className="font-mono text-charcoal-ink/70">{s.employee_number} · </span>
                          )}
                          {s.credential_type && s.credential_number && `${s.credential_type} ${s.credential_number} · `}
                          {s.license_verified_at
                            ? `Verified ${formatDate(s.license_verified_at)}`
                            : "Not verified"}
                        </p>
                        {s.license_verified_at && (
                          <div className="mt-1">
                            <ReverifyBadge licenseVerifiedAt={s.license_verified_at} />
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={s.active ? "green" : "grey"}>
                          {s.active ? "Active" : "Inactive"}
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={verify.isPending}
                          onClick={() => verify.mutate(s.id)}
                        >
                          {s.license_verified_at ? "Re-verify" : "Mark verified"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={setActive.isPending || (!s.active && !canActivate)}
                          title={
                            !s.active && !canActivate
                              ? requiresIndemnity && !hasCurrentIndemnity
                                ? "Needs current indemnity cover on file before activation"
                                : "Needs license verification before activation"
                              : undefined
                          }
                          onClick={() => setActive.mutate({ clinicalStaffId: s.id, active: !s.active })}
                        >
                          {s.active ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    </div>
                    {requiresIndemnity && (
                      <IndemnityForm staff={s} orgExemptions={orgExemptions ?? []} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {setActive.isError && (
            <p className="mt-2 text-sm text-red-600">{(setActive.error as Error).message}</p>
          )}
        </CardContent>
      </Card>

      <IndemnityExemptionsSection />
    </div>
  );
}
