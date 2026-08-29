"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  useGovernanceDomainOwners,
  useSetGovernanceDomainOwner,
  GOVERNANCE_DOMAINS,
  GOVERNANCE_DOMAIN_LABEL,
  type GovernanceDomain,
  type GovernanceDomainOwner,
} from "@/lib/queries/clinical-governance-domains";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

type StaffOption = { id: string; full_name: string; is_clinical_director: boolean };

/** Every active clinical_staff member in the org, for the assignment dropdown. */
function useOrgClinicalStaff(organisationId: string) {
  const [staff, setStaff] = useState<StaffOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("clinical_staff")
      .select("id, full_name, is_clinical_director")
      .eq("organisation_id", organisationId)
      .eq("active", true)
      .order("full_name", { ascending: true })
      .then(({ data }) => {
        if (!cancelled) setStaff(data ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [organisationId]);
  return staff;
}

function DomainRow({
  domain,
  owner,
  staffOptions,
  organisationId,
}: {
  domain: GovernanceDomain;
  owner: GovernanceDomainOwner | undefined;
  staffOptions: StaffOption[];
  organisationId: string;
}) {
  const setOwner = useSetGovernanceDomainOwner(organisationId);
  const [selected, setSelected] = useState(owner?.accountable_staff ?? "");
  const [notes, setNotes] = useState(owner?.notes ?? "");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {GOVERNANCE_DOMAIN_LABEL[domain]}
          {owner?.accountable_staff ? (
            <Badge variant="green">Assigned</Badge>
          ) : (
            <Badge variant="amber">Unassigned</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {owner?.accountable_staff_record && (
          <p className="text-sm text-charcoal-ink/70">
            Currently: {owner.accountable_staff_record.full_name}
            {owner.accountable_staff_record.is_clinical_director && " (Clinical Director)"}
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`owner_${domain}`} className="text-xs">
            Accountable
          </Label>
          <Select
            id={`owner_${domain}`}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Unassigned</option>
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
                {s.is_clinical_director ? " (Clinical Director)" : ""}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`notes_${domain}`} className="text-xs">
            Notes (optional)
          </Label>
          <Textarea
            id={`notes_${domain}`}
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {setOwner.error && (
          <p className="text-sm text-red-600" role="alert">
            {setOwner.error.message}
          </p>
        )}
        <Button
          size="sm"
          disabled={setOwner.isPending}
          onClick={() =>
            setOwner.mutate({
              domain,
              accountableStaffId: selected || null,
              notes: notes.trim() || undefined,
            })
          }
        >
          {setOwner.isPending ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

export function GovernanceDomainsManager({ organisationId }: { organisationId: string }) {
  const { data: owners, isLoading, isError } = useGovernanceDomainOwners();
  const staffOptions = useOrgClinicalStaff(organisationId);

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (isError) return <p className="text-sm text-red-600">Could not load governance domains.</p>;

  const byDomain = new Map((owners ?? []).map((o) => [o.domain, o]));
  const unassignedCount = GOVERNANCE_DOMAINS.filter((d) => !byDomain.get(d)?.accountable_staff).length;

  return (
    <div className="space-y-4">
      {unassignedCount > 0 && (
        <p className="text-sm text-amber-800">
          {unassignedCount} of {GOVERNANCE_DOMAINS.length} governance domains have no accountable
          person on file.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {GOVERNANCE_DOMAINS.map((domain) => (
          <DomainRow
            key={domain}
            domain={domain}
            owner={byDomain.get(domain)}
            staffOptions={staffOptions}
            organisationId={organisationId}
          />
        ))}
      </div>
    </div>
  );
}
