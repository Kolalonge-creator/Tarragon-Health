"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useOrgNavigationRequests,
  useAssignNavigationRequest,
  useUpdateNavigationRequestStatus,
  useResolveNavigationRequest,
  useHandOffToCareTeam,
  type NavigationRequestWithDetails,
} from "@/lib/queries/navigation-requests";
import { NAVIGATION_REQUEST_CATEGORY_LABEL } from "@/lib/validation/navigation-requests";
import {
  NAVIGATION_REQUEST_STATUS_BADGE,
  NAVIGATION_REQUEST_CLASSIFICATION_BADGE,
} from "@/lib/worklist/navigation-request-badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatTile } from "@/components/ui/stat-tile";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";

/** Inline resolve affordance -- a request needs a resolution note before it
 * can move to resolved (private.enforce_navigation_request_update requires
 * one), so this expands in place rather than sending an empty status update
 * that the DB would reject anyway. */
function ResolveRow({ requestId }: { requestId: string }) {
  const resolve = useResolveNavigationRequest();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Resolve
      </Button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-md border border-charcoal-ink/10 p-3">
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="What did you do to sort this out?"
        maxLength={2000}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={resolve.isPending || note.trim().length < 3}
          onClick={() =>
            resolve.mutate(
              { requestId, resolutionNote: note },
              { onSuccess: () => setOpen(false) }
            )
          }
        >
          {resolve.isPending ? "Saving…" : "Mark resolved"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

const STATUS_TABS: { key: "active" | "resolved"; label: string }[] = [
  { key: "active", label: "Open work" },
  { key: "resolved", label: "Resolved" },
];

/** Module 75.3's navigator dashboard. Every non-resolved request is
 * available to any org staff (RLS: private.is_org_staff) -- there is no
 * separate navigator-only authority the way Tier-2+ gates escalation
 * resolution, since nothing here touches medications, escalation
 * resolution, or protocol signing (the three actions the Care Coordinator
 * write-access rule actually restricts). */
export function SupportRequestsWorklist() {
  const { data, isLoading, isError } = useOrgNavigationRequests();
  const assign = useAssignNavigationRequest();
  const updateStatus = useUpdateNavigationRequestStatus();
  const handOff = useHandOffToCareTeam();
  const [tab, setTab] = useState<"active" | "resolved">("active");

  const all = data ?? [];
  const openCount = all.filter((r) => r.status !== "resolved").length;
  const urgentCount = all.filter((r) => r.is_urgent && r.status !== "resolved").length;
  const waitingProviderCount = all.filter((r) => r.status === "waiting_on_provider").length;
  const waitingPatientCount = all.filter((r) => r.status === "waiting_on_patient").length;
  const resolvedCount = all.filter((r) => r.status === "resolved").length;

  const visible = all.filter((r) => (tab === "resolved" ? r.status === "resolved" : r.status !== "resolved"));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile icon={SEMANTIC_ICON.clinicianFollowUp} label="Open requests" value={String(openCount)} />
        <StatTile
          icon={NAV_ICON.warning}
          tintClassName="bg-red-100"
          iconClassName="text-red-700"
          label="Urgent"
          value={String(urgentCount)}
        />
        <StatTile icon={NAV_ICON.inbox} label="Waiting on provider" value={String(waitingProviderCount)} />
        <StatTile icon={NAV_ICON.messages} label="Waiting on patient" value={String(waitingPatientCount)} />
        <StatTile icon={NAV_ICON.approvals} label="Resolved" value={String(resolvedCount)} />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Support requests</CardTitle>
            <CardDescription>
              Non-clinical help patients asked for -- appointments, pharmacy, labs, insurance,
              referrals, payments, and complaints (module 75).
            </CardDescription>
          </div>
          <div className="flex gap-1">
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  tab === t.key
                    ? "bg-brand-green/10 text-brand-green"
                    : "text-charcoal-ink/60 hover:text-charcoal-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && <p className="text-sm text-red-600">Could not load support requests.</p>}
          {!isLoading && visible.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">Nothing here right now.</p>
          )}
          {visible.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {visible.map((r) => (
                <SupportRequestRow
                  key={r.id}
                  request={r}
                  onAssign={() => assign.mutate(r.id)}
                  onToggleUrgent={() => updateStatus.mutate({ requestId: r.id, isUrgent: !r.is_urgent })}
                  onWaitOnPatient={() => updateStatus.mutate({ requestId: r.id, status: "waiting_on_patient" })}
                  onHandOff={() =>
                    handOff.mutate({ requestId: r.id, patientId: r.patient_id, category: r.category })
                  }
                  assignPending={assign.isPending}
                  handOffPending={handOff.isPending}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SupportRequestRow({
  request: r,
  onAssign,
  onToggleUrgent,
  onWaitOnPatient,
  onHandOff,
  assignPending,
  handOffPending,
}: {
  request: NavigationRequestWithDetails;
  onAssign: () => void;
  onToggleUrgent: () => void;
  onWaitOnPatient: () => void;
  onHandOff: () => void;
  assignPending: boolean;
  handOffPending: boolean;
}) {
  const statusBadge = NAVIGATION_REQUEST_STATUS_BADGE[r.status];
  const classBadge = NAVIGATION_REQUEST_CLASSIFICATION_BADGE[r.classification];
  const needsHandOff = r.classification === "clinical" && !r.care_message_thread_id;

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold text-charcoal-ink">
            {r.patient?.full_name ?? "Patient"}
            <span className="ml-2 font-normal text-charcoal-ink/50">
              {NAVIGATION_REQUEST_CATEGORY_LABEL[r.category]}
            </span>
          </p>
          <p className="max-w-xl text-sm text-charcoal-ink/70">{r.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {r.is_complaint && <Badge variant="amber">Complaint</Badge>}
          {r.is_urgent && <Badge variant="red">Urgent</Badge>}
          {r.classification === "clinical" && <Badge variant={classBadge.variant}>{classBadge.label}</Badge>}
          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
        </div>
      </div>

      {needsHandOff && (
        <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">
          This reads as a clinical concern -- hand it to the care team rather than answering it
          yourself.
        </p>
      )}

      {r.category === "referral" && (
        <Link href="/clinician/referrals" className="text-xs font-semibold text-brand-green hover:underline">
          View referral status →
        </Link>
      )}

      {r.status !== "resolved" && (
        <div className="flex flex-wrap items-center gap-2">
          {!r.assigned_to ? (
            <Button type="button" size="sm" variant="outline" disabled={assignPending} onClick={onAssign}>
              Assign to me
            </Button>
          ) : (
            <span className="text-xs text-charcoal-ink/60">
              With {r.assigned_staff?.full_name ?? "a navigator"}
            </span>
          )}
          <Button type="button" size="sm" variant="outline" onClick={onToggleUrgent}>
            {r.is_urgent ? "Unmark urgent" : "Mark urgent"}
          </Button>
          {r.status !== "waiting_on_patient" && (
            <Button type="button" size="sm" variant="outline" onClick={onWaitOnPatient}>
              Waiting on patient
            </Button>
          )}
          {needsHandOff && (
            <Button type="button" size="sm" disabled={handOffPending} onClick={onHandOff}>
              {handOffPending ? "Handing off…" : "Hand off to care team"}
            </Button>
          )}
          <ResolveRow requestId={r.id} />
        </div>
      )}

      {r.status === "resolved" && r.resolution_note && (
        <p className="rounded-md bg-warm-ivory p-2 text-sm text-charcoal-ink/80">{r.resolution_note}</p>
      )}
    </li>
  );
}
