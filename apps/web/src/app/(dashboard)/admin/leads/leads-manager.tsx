"use client";

import { useMemo, useState, useActionState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SearchableList } from "@/components/ui/searchable-list";
import { LEAD_ROLES } from "@/lib/validation/lead";
import { toggleLeadContactedAction, type LeadActionState } from "./actions";
import type { LeadRow } from "./page";

// Record<(typeof LEAD_ROLES)[number], ...> rather than Record<string, ...>
// deliberately, so TypeScript fails the build if LEAD_ROLES ever gains a
// value this map doesn't — a plain Record<string, string> let the "ngo" role
// go unlabelled here (and employerHmoNewCount below silently exclude it)
// until review caught it.
const ROLE_LABEL: Record<(typeof LEAD_ROLES)[number], string> = {
  patient: "Patient",
  family: "Family",
  employer: "Employer",
  hmo: "HMO",
  ngo: "NGO / PHC / government",
  other: "Other",
};

/** `lead.role` is a plain string off the DB row (not narrowed to LeadRole),
 * so a direct ROLE_LABEL[lead.role] index fails to typecheck against the
 * now-exhaustive Record above — this keeps that exhaustiveness (a missing
 * key for a real LeadRole value is still a compile error) while safely
 * falling back to the raw string for any value ROLE_LABEL doesn't know. */
function roleLabel(role: string): string {
  return role in ROLE_LABEL ? ROLE_LABEL[role as keyof typeof ROLE_LABEL] : role;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function LeadsManager({ leads }: { leads: LeadRow[] }) {
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [showContacted, setShowContacted] = useState(true);

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      if (roleFilter !== "all" && l.role !== roleFilter) return false;
      if (!showContacted && l.contacted_at) return false;
      return true;
    });
  }, [leads, roleFilter, showContacted]);

  const newCount = leads.filter((l) => !l.contacted_at).length;
  // Includes "ngo" alongside employer/hmo: the Corporate page's NGO/PHC
  // funded-cohort offer (docs/FUNDING_STRATEGY.md) generates the same kind
  // of high-value B2B enquiry and must not go unnoticed on this dashboard.
  const b2bNewCount = leads.filter(
    (l) => !l.contacted_at && (l.role === "employer" || l.role === "hmo" || l.role === "ngo")
  ).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 py-4">
          <div>
            <p className="font-heading text-2xl font-semibold text-charcoal-ink">{leads.length}</p>
            <p className="text-sm text-charcoal-ink/60">total leads</p>
          </div>
          <div>
            <p className="font-heading text-2xl font-semibold text-brand-green">{newCount}</p>
            <p className="text-sm text-charcoal-ink/60">not yet contacted</p>
          </div>
          {b2bNewCount > 0 && (
            <div>
              <p className="font-heading text-2xl font-semibold text-clinical-navy">
                {b2bNewCount}
              </p>
              <p className="text-sm text-charcoal-ink/60">
                employer/HMO/NGO {b2bNewCount === 1 ? "enquiry" : "enquiries"} waiting
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="max-w-[220px]"
        >
          <option value="all">All roles</option>
          {LEAD_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r] ?? r}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-charcoal-ink/70">
          <input
            type="checkbox"
            checked={showContacted}
            onChange={(e) => setShowContacted(e.target.checked)}
          />
          Show contacted
        </label>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No leads to show</CardTitle>
            <CardDescription>Nothing matches this filter right now.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <SearchableList
          items={filtered}
          filterFn={(lead, q) =>
            [lead.name, lead.contact, lead.message, roleLabel(lead.role), lead.source]
              .filter(Boolean)
              .some((field) => field!.toLowerCase().includes(q))
          }
          searchPlaceholder="Search by name, contact, or message…"
          noMatchMessage={(q) => `No leads match "${q}".`}
          renderContainer={(children) => <div className="space-y-3">{children}</div>}
          renderItem={(lead) => <LeadCard key={lead.id} lead={lead} />}
        />
      )}
    </div>
  );
}

function LeadCard({ lead }: { lead: LeadRow }) {
  const [, action, pending] = useActionState<LeadActionState, FormData>(
    toggleLeadContactedAction,
    undefined
  );

  return (
    <Card>
      <CardContent className="space-y-2 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-charcoal-ink">{lead.name}</p>
              <Badge variant={lead.role === "employer" || lead.role === "hmo" ? "green" : "grey"}>
                {roleLabel(lead.role)}
              </Badge>
              {lead.contacted_at && <Badge variant="grey">Contacted</Badge>}
            </div>
            <p className="text-sm text-charcoal-ink/70">{lead.contact}</p>
          </div>
          <p className="text-xs text-charcoal-ink/50">
            {shortDate(lead.created_at)} · via {lead.source}
          </p>
        </div>

        {lead.message && <p className="text-sm text-charcoal-ink/80">{lead.message}</p>}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          {lead.contacted_at ? (
            <p className="text-xs text-charcoal-ink/50">
              Contacted {shortDate(lead.contacted_at)}
              {lead.contacted_by_name ? ` by ${lead.contacted_by_name}` : ""}
            </p>
          ) : null}
          <form action={action}>
            <input type="hidden" name="leadId" value={lead.id} />
            <input type="hidden" name="contacted" value={lead.contacted_at ? "false" : "true"} />
            <Button type="submit" variant="outline" size="sm" disabled={pending}>
              {pending ? "Saving…" : lead.contacted_at ? "Mark as new" : "Mark contacted"}
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
