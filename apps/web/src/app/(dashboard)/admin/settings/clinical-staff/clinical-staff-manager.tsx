"use client";

import { useState } from "react";
import {
  useAllClinicalStaff,
  useCreateClinicalStaff,
  useVerifyClinicalStaff,
  useSetClinicalStaffActive,
  type ClinicalStaff,
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

const ROLE_LABEL: Record<ClinicalStaff["role"], string> = {
  clinical_director: "Clinical Director",
  clinician: "Clinician",
  escalation_doctor: "Escalation Doctor",
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function ClinicalStaffManager() {
  const { data: staff, isLoading, isError } = useAllClinicalStaff();
  const create = useCreateClinicalStaff();
  const verify = useVerifyClinicalStaff();
  const setActive = useSetClinicalStaffActive();

  const [role, setRole] = useState<ClinicalStaff["role"]>("clinician");
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
            Starts inactive and unverified. Link an existing login by phone number if this person
            needs to act in the system (sign escalations, sign protocols) — leave it blank for a
            bio-only Clinical Director record.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="role">Role</Label>
              <Select id="role" value={role} onChange={(e) => setRole(e.target.value as ClinicalStaff["role"])}>
                <option value="clinical_director">Clinical Director</option>
                <option value="clinician">Clinician</option>
                <option value="escalation_doctor">Escalation Doctor</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="full-name">Full name</Label>
              <Input id="full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
          </div>
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
                  role,
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
              {staff.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-charcoal-ink">
                      {s.full_name} <span className="text-charcoal-ink/60">— {ROLE_LABEL[s.role]}</span>
                    </p>
                    <p className="text-xs text-charcoal-ink/60">
                      {s.credential_type && s.credential_number && `${s.credential_type} ${s.credential_number} · `}
                      {s.license_verified_at
                        ? `Verified ${formatDate(s.license_verified_at)}`
                        : "Not verified"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={s.active ? "green" : "grey"}>
                      {s.active ? "Active" : "Inactive"}
                    </Badge>
                    {!s.license_verified_at && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={verify.isPending}
                        onClick={() => verify.mutate(s.id)}
                      >
                        Mark verified
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setActive.isPending || (!s.active && !s.license_verified_at)}
                      onClick={() => setActive.mutate({ clinicalStaffId: s.id, active: !s.active })}
                    >
                      {s.active ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {setActive.isError && (
            <p className="mt-2 text-sm text-red-600">{(setActive.error as Error).message}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
