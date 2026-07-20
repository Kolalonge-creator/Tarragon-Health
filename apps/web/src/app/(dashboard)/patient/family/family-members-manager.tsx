"use client";

import { useState } from "react";
import {
  useFamilyPlanMembers,
  useAddFamilyPlanMember,
  useRemoveFamilyPlanMember,
} from "@/lib/queries/family-plan-members";
import { addFamilyPlanMemberSchema } from "@/lib/validation/family-plan-members";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { LipidProfileCard } from "@/components/patient/lipid-profile-card";

const RELATIONSHIP_LABEL: Record<string, string> = {
  spouse: "Spouse",
  parent: "Parent",
  child: "Child",
  sibling: "Sibling",
  other: "Other",
};

export function FamilyMembersManager() {
  const { data: members, isLoading, isError } = useFamilyPlanMembers();
  const addMember = useAddFamilyPlanMember();
  const removeMember = useRemoveFamilyPlanMember();

  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("other");
  const [validationError, setValidationError] = useState<string | null>(null);

  const mutationError =
    (addMember.error as Error | null)?.message ?? (removeMember.error as Error | null)?.message ?? null;
  const displayError = validationError ?? mutationError;

  function submit() {
    const parsed = addFamilyPlanMemberSchema.safeParse({ member_phone: phone, relationship });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setValidationError(null);
    addMember.mutate(parsed.data, {
      onSuccess: () => {
        setPhone("");
        setRelationship("other");
      },
    });
  }

  return (
    <div className="space-y-6">
      {displayError && <p className="text-sm text-red-600">{displayError}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Add a family member</CardTitle>
          <CardDescription>
            They need their own Tarragon account first — enter the phone number they signed up
            with.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="member_phone">Phone number</Label>
            <Input
              id="member_phone"
              placeholder="+234XXXXXXXXXX"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="w-48"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="relationship">Relationship</Label>
            <Select
              id="relationship"
              value={relationship}
              onChange={(event) => setRelationship(event.target.value)}
            >
              {Object.entries(RELATIONSHIP_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <Button size="sm" disabled={addMember.isPending || !phone} onClick={submit}>
            {addMember.isPending ? "Adding…" : "Add"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your family</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && <p className="text-sm text-red-600">Could not load family members.</p>}
          {members && members.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">
              No family members added yet — everyone you add here gets Complete Care–level
              monitoring under your plan.
            </p>
          )}
          {members && members.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {members.map((member) => (
                <li key={member.id} className="space-y-3 py-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-charcoal-ink">
                        {member.member?.full_name ?? "Unknown"}
                      </p>
                      <p className="text-xs text-charcoal-ink/60">
                        {RELATIONSHIP_LABEL[member.relationship] ?? member.relationship}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={removeMember.isPending}
                      onClick={() => removeMember.mutate(member.id)}
                    >
                      Remove
                    </Button>
                  </div>
                  {/* Consent-gated: the lipid history only appears if this
                      member has granted you view access (profile_access) —
                      RLS enforces it, so with no grant the card shows the
                      neutral empty state below rather than their data. */}
                  <LipidProfileCard
                    patientId={member.member_id}
                    title={`${member.member?.full_name ?? "Member"} · lipid profile`}
                    emptyMessage="No lipid results are shared with you for this member yet. They can grant you view access from their account."
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
