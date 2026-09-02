"use client";

import { useState, type FormEvent } from "react";
import {
  useEmployerRoster,
  useEmployerRosterCounts,
  useAddRosterMember,
  useClaimRosterMember,
  useRemoveRosterMember,
  useMarkRosterMemberDeparted,
  useInviteRosterMember,
  useAssignBenefitPackage,
} from "@/lib/queries/employer-roster";
import { useEmployerDepartments, useEmployerLocations } from "@/lib/queries/employer-accounts";
import { useBenefitPackages } from "@/lib/queries/employer-benefits";
import { rosterMemberSchema } from "@/lib/validation/employer-roster";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { SEMANTIC_ICON } from "@/lib/icons";

const EMPLOYMENT_STATUS_LABEL: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  nysc: "NYSC",
  intern: "Intern",
};

const STATUS_BADGE: Record<string, { variant: "green" | "grey" | "amber" | "blue" | "red"; label: string }> = {
  pending: { variant: "grey", label: "Pending signup" },
  invited: { variant: "amber", label: "Invited" },
  claimed: { variant: "green", label: "Enrolled" },
  departed: { variant: "grey", label: "Departed" },
  removed: { variant: "grey", label: "Removed" },
};

/**
 * Full-population employer enrolment (docs/FULL_SPECIFICATION_V4.md §2.4/§8
 * — "corporate contracts that auto-enrol the whole workforce rather than
 * relying on elective sign-up") plus Module 26 §26.4/§26.5/§26.17: six join
 * routes, eligibility segmentation (department/location/employment status),
 * and departure. Attach-now / auto-claim-at-signup are unchanged from the
 * original component.
 */
export function RosterManager({
  organisationId,
  entityLabel = "staff",
}: {
  organisationId: string;
  /** "staff" (default, corporate) or "member" (HMO) — copy only, same table/hooks. */
  entityLabel?: "staff" | "member";
}) {
  const roster = useEmployerRoster(organisationId);
  const counts = useEmployerRosterCounts(organisationId);
  const departments = useEmployerDepartments(organisationId);
  const locations = useEmployerLocations(organisationId);
  const packages = useBenefitPackages(organisationId);
  const addMember = useAddRosterMember(organisationId);
  const claimMember = useClaimRosterMember(organisationId);
  const removeMember = useRemoveRosterMember(organisationId);
  const markDeparted = useMarkRosterMemberDeparted(organisationId);
  const inviteMember = useInviteRosterMember(organisationId);
  const assignPackage = useAssignBenefitPackage(organisationId);

  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [claimResult, setClaimResult] = useState<{ id: string; attached: boolean } | null>(null);
  const [inviteResult, setInviteResult] = useState<{ id: string; token: string } | null>(null);

  function handleAdd(event: FormEvent) {
    event.preventDefault();
    const parsed = rosterMemberSchema.safeParse({
      phone,
      email,
      full_name: fullName,
      department_id: departmentId,
      location_id: locationId,
      employment_status: employmentStatus,
    });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setValidationError(null);
    addMember.mutate(parsed.data, {
      onSuccess: () => {
        setPhone("");
        setEmail("");
        setFullName("");
        setDepartmentId("");
        setLocationId("");
        setEmploymentStatus("");
      },
    });
  }

  const mutationError =
    (addMember.error as Error | null)?.message ??
    (claimMember.error as Error | null)?.message ??
    (removeMember.error as Error | null)?.message ??
    (markDeparted.error as Error | null)?.message ??
    (inviteMember.error as Error | null)?.message ??
    (assignPackage.error as Error | null)?.message ??
    null;
  const displayError = validationError ?? mutationError;

  const departmentById = new Map((departments.data ?? []).map((d) => [d.id, d.name]));
  const locationById = new Map((locations.data ?? []).map((l) => [l.id, l.name]));
  const activeRows = (roster.data ?? []).filter((r) => r.status !== "removed");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.family className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          {entityLabel === "member" ? "Member enrolment" : "Staff enrolment"}
        </CardTitle>
        <CardDescription>
          Add by phone or email; they&apos;re attached the moment they sign up (or immediately, with
          &quot;Attach now&quot;), invited by email/SMS, or can join themselves with your organisation code.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {counts.data && (
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              icon={SEMANTIC_ICON.family}
              label={entityLabel === "member" ? "Eligible members" : "Eligible employees"}
              value={String(counts.data.eligible_count)}
            />
            <StatTile icon={SEMANTIC_ICON.family} label="Activated" value={String(counts.data.activated_count)} />
          </div>
        )}
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="roster_phone">Phone</Label>
            <Input
              id="roster_phone"
              placeholder="+2348012345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="roster_email">Email</Label>
            <Input
              id="roster_email"
              type="email"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="roster_name">Name (optional)</Label>
            <Input id="roster_name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="roster_department">Department</Label>
            <Select
              id="roster_department"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="min-w-[140px]"
            >
              <option value="">—</option>
              {(departments.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="roster_location">Location</Label>
            <Select
              id="roster_location"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="min-w-[140px]"
            >
              <option value="">—</option>
              {(locations.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="roster_employment_status">Employment</Label>
            <Select
              id="roster_employment_status"
              value={employmentStatus}
              onChange={(e) => setEmploymentStatus(e.target.value)}
              className="min-w-[130px]"
            >
              <option value="">—</option>
              {Object.entries(EMPLOYMENT_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" size="sm" disabled={addMember.isPending}>
            {addMember.isPending ? "Adding…" : "Add to roster"}
          </Button>
        </form>
        {displayError && <p className="text-sm text-red-600">{displayError}</p>}

        {roster.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {activeRows.length === 0 && !roster.isLoading && (
          <p className="text-sm text-charcoal-ink/60">No one on your roster yet. Add someone above.</p>
        )}
        {activeRows.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {activeRows.map((member) => {
              const statusMeta = STATUS_BADGE[member.status] ?? { variant: "grey" as const, label: member.status };
              return (
                <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="text-sm text-charcoal-ink">{member.full_name || member.phone || member.email}</p>
                    <p className="text-xs text-charcoal-ink/60">
                      {[member.phone, member.email].filter(Boolean).join(" · ")}
                      {member.department_id && ` · ${departmentById.get(member.department_id) ?? ""}`}
                      {member.location_id && ` · ${locationById.get(member.location_id) ?? ""}`}
                      {member.employment_status && ` · ${EMPLOYMENT_STATUS_LABEL[member.employment_status]}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                    {member.status === "claimed" && (packages.data ?? []).length > 0 && (
                      <Select
                        value={member.benefit_package_id ?? ""}
                        onChange={(e) =>
                          assignPackage.mutate({ rosterId: member.id, packageId: e.target.value || null })
                        }
                        className="h-8 min-w-[140px] text-xs"
                      >
                        <option value="">No benefit package</option>
                        {(packages.data ?? []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    )}
                    {(member.status === "pending" || member.status === "invited") && (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={claimMember.isPending}
                          onClick={() =>
                            claimMember.mutate(member.id, {
                              onSuccess: (attached) => setClaimResult({ id: member.id, attached }),
                            })
                          }
                        >
                          Attach now
                        </Button>
                        {member.email && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={inviteMember.isPending}
                            onClick={() =>
                              inviteMember.mutate(
                                { rosterId: member.id, channel: "email" },
                                { onSuccess: (token) => setInviteResult({ id: member.id, token }) }
                              )
                            }
                          >
                            Invite by email
                          </Button>
                        )}
                        {member.phone && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={inviteMember.isPending}
                            onClick={() =>
                              inviteMember.mutate(
                                { rosterId: member.id, channel: "sms" },
                                { onSuccess: (token) => setInviteResult({ id: member.id, token }) }
                              )
                            }
                          >
                            Invite by SMS
                          </Button>
                        )}
                      </>
                    )}
                    {member.status === "claimed" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={markDeparted.isPending}
                        onClick={() => markDeparted.mutate({ rosterId: member.id })}
                      >
                        Mark departed
                      </Button>
                    )}
                    {member.status !== "departed" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={removeMember.isPending}
                        onClick={() => removeMember.mutate(member.id)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  {claimResult?.id === member.id && !claimResult.attached && (
                    <p className="w-full text-xs text-charcoal-ink/60">
                      No Tarragon account found with those details yet. They&apos;ll be attached automatically
                      once they sign up.
                    </p>
                  )}
                  {inviteResult?.id === member.id && (
                    <p className="w-full text-xs text-charcoal-ink/60">
                      Invitation issued. Share the link built from this token: {inviteResult.token}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
