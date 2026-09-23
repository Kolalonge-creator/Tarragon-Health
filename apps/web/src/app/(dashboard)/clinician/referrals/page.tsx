"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  useOrgSpecialistReferrals,
  useSubmitDraftReferral,
  useDeclineReferral,
  type SpecialistReferralWithDetails,
} from "@/lib/queries/specialist-referrals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadFailure } from "@/components/ui/load-failure";
import { listQueryState } from "@/lib/queries/list-query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { REFERRAL_STATUS_BADGE } from "@/lib/worklist/referral-status-badge";
import { SPECIALIST_TYPE_OPTIONS, type SpecialistType } from "@tarragon/shared";

const TERMINAL_STATUSES: SpecialistReferralWithDetails["status"][] = ["closed", "declined"];

const STATUS_FILTER_OPTIONS = Object.keys(REFERRAL_STATUS_BADGE) as SpecialistReferralWithDetails["status"][];

function DraftActions({ referral }: { referral: SpecialistReferralWithDetails }) {
  const submit = useSubmitDraftReferral();
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" disabled={submit.isPending} onClick={() => submit.mutate(referral.id)}>
        {submit.isPending ? "Submitting…" : "Submit referral"}
      </Button>
      {submit.isError && <p className="text-xs text-red-600">Could not submit. Try again.</p>}
    </div>
  );
}

function DeclineForm({ referral }: { referral: SpecialistReferralWithDetails }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const decline = useDeclineReferral();

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Decline
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why is this referral being declined? (required)"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={reason.trim().length === 0 || decline.isPending}
          onClick={() => decline.mutate({ referralId: referral.id, declinedReason: reason.trim() })}
        >
          {decline.isPending ? "Saving…" : "Confirm decline"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {decline.isError && <p className="text-xs text-red-600">Could not decline. Try again.</p>}
    </div>
  );
}

export default function ClinicianReferralsPage() {
  const { data, isLoading, isError } = useOrgSpecialistReferrals();
  const state = listQueryState({ isLoading, isError, count: data?.length });
  const [statusFilter, setStatusFilter] = useState<"all" | SpecialistReferralWithDetails["status"]>("all");
  const [specialistTypeFilter, setSpecialistTypeFilter] = useState<"all" | SpecialistType>("all");

  // Filtering the org's already-RLS-scoped referral list by two existing
  // columns — no ranking, no re-querying, same rows private.is_org_staff
  // already returned to useOrgSpecialistReferrals.
  const filtered = useMemo(() => {
    if (!data) return data;
    return data.filter(
      (referral) =>
        (statusFilter === "all" || referral.status === statusFilter) &&
        (specialistTypeFilter === "all" || referral.specialist_type === specialistTypeFilter)
    );
  }, [data, statusFilter, specialistTypeFilter]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Referrals</h1>
        <p className="text-sm text-charcoal-ink/60">
          Specialist referrals you have sent or need to action. Start a new one from the patient&apos;s
          own record. Open their Referrals tab.
        </p>
      </div>
      <Card>
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <CardTitle>Specialist referrals</CardTitle>
        <Link href="/clinician/referrals/waitlisted" className="text-xs text-brand-green hover:underline">
          View waitlisted referrals
        </Link>
      </CardHeader>
      <CardContent>
        {state === "ready" && data && data.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              aria-label="Filter by status"
              className="w-auto"
            >
              <option value="all">All statuses</option>
              {STATUS_FILTER_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {REFERRAL_STATUS_BADGE[status].label}
                </option>
              ))}
            </Select>
            <Select
              value={specialistTypeFilter}
              onChange={(e) => setSpecialistTypeFilter(e.target.value as typeof specialistTypeFilter)}
              aria-label="Filter by specialist type"
              className="w-auto"
            >
              <option value="all">All specialist types</option>
              {SPECIALIST_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        {state === "loading" && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {state === "error" && (
          <LoadFailure>
            Referrals could not be loaded. This is not a report that none are open or that none
            need actioning. Reload to try again.
          </LoadFailure>
        )}
        {state === "empty" && <p className="text-sm text-charcoal-ink/60">No referrals yet.</p>}
        {state === "ready" && filtered && filtered.length === 0 && data && data.length > 0 && (
          <p className="text-sm text-charcoal-ink/60">No referrals match this status/specialist filter.</p>
        )}
        {state === "ready" && filtered && filtered.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {filtered.map((referral) => {
              const statusBadge = REFERRAL_STATUS_BADGE[referral.status];
              const terminal = TERMINAL_STATUSES.includes(referral.status);
              return (
                <li key={referral.id} className="space-y-2 py-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                    <span className="text-xs text-charcoal-ink/60">{referral.referral_number}</span>
                  </div>
                  <p className="text-sm font-medium text-charcoal-ink">
                    <Link href={`/clinician/patients/${referral.patient_id}`} className="hover:underline">
                      {referral.patient?.full_name ?? "Unknown patient"}
                    </Link>
                    : {referral.specialist_type}
                  </p>
                  {referral.referral_reason && (
                    <p className="text-xs text-charcoal-ink/60">{referral.referral_reason}</p>
                  )}
                  {referral.status === "waitlisted" && referral.interim_management_plan && (
                    <p className="text-xs text-charcoal-ink/60">
                      Interim plan: {referral.interim_management_plan}
                    </p>
                  )}
                  {referral.status === "declined" && referral.declined_reason && (
                    <p className="text-xs text-charcoal-ink/60">Declined: {referral.declined_reason}</p>
                  )}

                  {referral.status === "draft" ? (
                    <DraftActions referral={referral} />
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <Link
                        href={`/clinician/referrals/${referral.id}`}
                        className="text-xs text-brand-green hover:underline"
                      >
                        Set urgency, clinical summary &amp; close out
                      </Link>
                      {!terminal && <DeclineForm referral={referral} />}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      </Card>
    </div>
  );
}
