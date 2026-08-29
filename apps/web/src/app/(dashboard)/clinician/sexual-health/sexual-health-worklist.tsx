"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Enums } from "@tarragon/shared";
import {
  useOrgOpenStiCaseEpisodes,
  orgOpenStiCaseEpisodesKey,
  type StiCaseEpisodeWithDetails,
} from "@/lib/queries/sti-case-episodes";
import {
  usePartnerNotifications,
  partnerNotificationsKey,
  type StiPartnerNotification,
} from "@/lib/queries/sti-partner-notifications";
import {
  useOrgPendingEcRequests,
  orgPendingEcRequestsKey,
  type EcRequestWithPatient,
} from "@/lib/queries/emergency-contraception";
import {
  useContraceptionMethods,
  useOrgRequestedContraceptionPlans,
  orgRequestedContraceptionPlansKey,
  type ContraceptionPlanWithPatient,
} from "@/lib/queries/contraception";
import {
  advanceStiCaseEpisode,
  updatePartnerNotificationOutcome,
  actionEmergencyContraceptionRequest,
  actionContraceptionPlanRequest,
} from "./actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { NAV_ICON } from "@/lib/icons";

type StiCaseStatus = Enums<"sti_case_status">;
type PartnerNotificationStatus = Enums<"partner_notification_status">;

const STI_CODE_LABEL: Record<string, string> = {
  chlamydia_gonorrhoea: "Chlamydia & Gonorrhoea",
  syphilis: "Syphilis",
};

const STI_STATUS_BADGE: Record<StiCaseStatus, { variant: BadgeProps["variant"]; label: string }> = {
  result_received: { variant: "amber", label: "Result received" },
  clinical_review: { variant: "blue", label: "Clinical review" },
  patient_notified: { variant: "blue", label: "Patient notified" },
  treatment_in_progress: { variant: "amber", label: "Treatment in progress" },
  treatment_completed: { variant: "green", label: "Treatment completed" },
  declined_care: { variant: "grey", label: "Declined care" },
  closed: { variant: "grey", label: "Closed" },
};

/** Mirrors enforce_sti_case_episode_transition() in migration
 * 20260829090200 exactly — declined_care is reachable from every
 * non-terminal state except treatment_completed, whose only legal next
 * state is closed. */
const STI_NEXT_STATUSES: Record<StiCaseStatus, StiCaseStatus[]> = {
  result_received: ["clinical_review", "declined_care"],
  clinical_review: ["patient_notified", "declined_care"],
  patient_notified: ["treatment_in_progress", "declined_care"],
  treatment_in_progress: ["treatment_completed", "declined_care"],
  treatment_completed: ["closed"],
  declined_care: [],
  closed: [],
};

const STI_ACTION_LABEL: Record<StiCaseStatus, string> = {
  result_received: "Result received",
  clinical_review: "Mark clinical review done",
  patient_notified: "Mark patient notified",
  treatment_in_progress: "Start treatment",
  treatment_completed: "Mark treatment completed",
  declined_care: "Patient declined care",
  closed: "Close case",
};

/** Statuses where the confirm step asks for a note before submitting —
 * treatment notes for the two treatment stages, an optional reason for
 * declining. Every other transition submits immediately. */
const STI_STATUSES_NEEDING_NOTE: StiCaseStatus[] = [
  "treatment_in_progress",
  "treatment_completed",
  "declined_care",
];

const PARTNER_STATUS_LABEL: Record<PartnerNotificationStatus, string> = {
  requested: "Requested",
  contacted: "Contacted",
  could_not_reach: "Could not reach",
  declined_by_care_team: "Care team declined",
};

function PartnerNotificationRow({ notification }: { notification: StiPartnerNotification }) {
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState(notification.clinician_assisted_notes ?? "");

  function setStatus(status: PartnerNotificationStatus) {
    setError(null);
    startTransition(async () => {
      const result = await updatePartnerNotificationOutcome(
        notification.id,
        status,
        notes.trim() || undefined
      );
      if (result?.error) {
        setError(result.error);
        return;
      }
      queryClient.invalidateQueries({
        queryKey: partnerNotificationsKey(notification.sti_case_episode_id),
      });
    });
  }

  return (
    <div className="space-y-1.5 rounded-md border border-charcoal-ink/10 bg-white p-3 text-xs">
      <p className="text-charcoal-ink/80">
        {notification.partner_label || "Partner"}
        {notification.partner_contact ? ` · ${notification.partner_contact}` : ""}
      </p>
      <p className="text-charcoal-ink/60">
        Current:{" "}
        {notification.clinician_assisted_status
          ? PARTNER_STATUS_LABEL[notification.clinician_assisted_status]
          : "Not yet actioned"}
      </p>
      <Textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        rows={2}
        placeholder="Notes on the contact attempt"
        className="text-xs"
      />
      <div className="flex flex-wrap gap-1.5">
        {(["contacted", "could_not_reach", "declined_by_care_team"] as const).map((status) => (
          <Button
            key={status}
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setStatus(status)}
          >
            {PARTNER_STATUS_LABEL[status]}
          </Button>
        ))}
      </div>
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}

function PartnerNotificationsForClinician({ episodeId }: { episodeId: string }) {
  const { data: notifications } = usePartnerNotifications(episodeId);
  const assisted = (notifications ?? []).filter((n) => n.method === "clinician_assisted");
  if (assisted.length === 0) return null;

  return (
    <div className="space-y-2 border-t border-charcoal-ink/10 pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
        Partner notification — clinician assisted
      </p>
      {assisted.map((notification) => (
        <PartnerNotificationRow key={notification.id} notification={notification} />
      ))}
    </div>
  );
}

function StiCaseRow({ episode }: { episode: StiCaseEpisodeWithDetails }) {
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<StiCaseStatus | null>(null);
  const [note, setNote] = useState("");

  const nextStatuses = STI_NEXT_STATUSES[episode.status];

  function submit(nextStatus: StiCaseStatus, noteToSend?: string) {
    setError(null);
    startTransition(async () => {
      const result = await advanceStiCaseEpisode(episode.id, nextStatus, noteToSend);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setConfirming(null);
      setNote("");
      queryClient.invalidateQueries({ queryKey: orgOpenStiCaseEpisodesKey });
    });
  }

  function chooseStatus(nextStatus: StiCaseStatus) {
    setError(null);
    if (STI_STATUSES_NEEDING_NOTE.includes(nextStatus)) {
      setConfirming(nextStatus);
      return;
    }
    submit(nextStatus);
  }

  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-charcoal-ink">
            {episode.patient?.full_name ?? "Unknown patient"}
            {episode.patient?.patient_number ? ` · ${episode.patient.patient_number}` : ""}
          </p>
          <p className="text-xs text-charcoal-ink/60">
            {STI_CODE_LABEL[episode.sti_code] ?? episode.sti_code.replace(/_/g, " ")} — result
            {episode.screening_result?.created_at
              ? ` ${new Date(episode.screening_result.created_at).toLocaleDateString()}`
              : " date unknown"}
            {episode.screening_result?.result_summary ? `: ${episode.screening_result.result_summary}` : ""}
          </p>
          {episode.treatment_notes && (
            <p className="mt-1 text-xs text-charcoal-ink/60">Notes: {episode.treatment_notes}</p>
          )}
        </div>
        <Badge variant={STI_STATUS_BADGE[episode.status].variant}>
          {STI_STATUS_BADGE[episode.status].label}
        </Badge>
      </div>

      {confirming ? (
        <div className="space-y-2 rounded-md border border-charcoal-ink/10 bg-warm-ivory/60 p-3">
          <Label htmlFor={`note-${episode.id}`}>
            {confirming === "declined_care" ? "Reason (optional)" : "Treatment notes (optional)"}
          </Label>
          <Textarea
            id={`note-${episode.id}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => submit(confirming, note.trim() || undefined)}
            >
              {pending ? "Saving…" : `Confirm: ${STI_ACTION_LABEL[confirming]}`}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setConfirming(null);
                setNote("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        nextStatuses.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {nextStatuses.map((nextStatus) => (
              <Button
                key={nextStatus}
                type="button"
                size="sm"
                variant={nextStatus === "declined_care" ? "ghost" : "outline"}
                disabled={pending}
                onClick={() => chooseStatus(nextStatus)}
              >
                {STI_ACTION_LABEL[nextStatus]}
              </Button>
            ))}
          </div>
        )
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <PartnerNotificationsForClinician episodeId={episode.id} />
    </li>
  );
}

function StiCasesSection() {
  const { data, isLoading, isError } = useOrgOpenStiCaseEpisodes();

  return (
    <Card>
      <CardHeader>
        <CardTitle>STI cases</CardTitle>
        <CardDescription>
          Open chlamydia, gonorrhoea, and syphilis cases — result received through treatment and
          follow-up.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load STI cases.</p>}
        {data && data.length === 0 && <p className="text-sm text-charcoal-ink/60">No open cases.</p>}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((episode) => (
              <StiCaseRow key={episode.id} episode={episode} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function elapsedSince(requestedAt: string): { label: string; breached: boolean } {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(requestedAt).getTime()) / 60000));
  const breached = minutes >= 60;
  const label = minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
  return { label, breached };
}

function EcRequestRow({ request }: { request: EcRequestWithPatient }) {
  const queryClient = useQueryClient();
  const { data: methods } = useContraceptionMethods();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [methodAdvised, setMethodAdvised] = useState("");
  const { label, breached } = elapsedSince(request.requested_at);

  function act(status: "reviewed" | "dispensed" | "declined") {
    setError(null);
    startTransition(async () => {
      const result = await actionEmergencyContraceptionRequest(
        request.id,
        status,
        methodAdvised || undefined
      );
      if (result?.error) {
        setError(result.error);
        return;
      }
      queryClient.invalidateQueries({ queryKey: orgPendingEcRequestsKey });
    });
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          {request.patient?.full_name ?? "Unknown patient"}
        </p>
        <Badge variant={breached ? "red" : "amber"}>{breached ? `Overdue · ${label}` : label}</Badge>
      </div>
      <p className="text-xs text-charcoal-ink/60">
        {request.hours_since_intercourse != null
          ? `Reported ${request.hours_since_intercourse}h since intercourse`
          : "Time since intercourse not specified"}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`ec-method-${request.id}`}>Method advised (optional)</Label>
          <Select
            id={`ec-method-${request.id}`}
            value={methodAdvised}
            onChange={(event) => setMethodAdvised(event.target.value)}
            className="w-56"
          >
            <option value="">Not specified</option>
            {(methods ?? []).map((method) => (
              <option key={method.code} value={method.code}>
                {method.name}
              </option>
            ))}
          </Select>
        </div>
        <Button type="button" size="sm" disabled={pending} onClick={() => act("reviewed")}>
          Reviewed
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => act("dispensed")}>
          Dispensed
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => act("declined")}>
          Declined
        </Button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </li>
  );
}

function EmergencyContraceptionSection() {
  const { data, isLoading, isError } = useOrgPendingEcRequests();

  return (
    <Card className="border-2 border-sprout-gold/60 bg-sprout-gold/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-deep-forest">
          <NAV_ICON.warning className="h-5 w-5 text-sprout-gold" strokeWidth={2} />
          Emergency contraception requests
        </CardTitle>
        <CardDescription className="text-charcoal-ink/70">
          Each carries a 1-hour SLA from when it was requested — oldest, most urgent first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load requests.</p>}
        {data && data.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No pending requests.</p>
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((request) => (
              <EcRequestRow key={request.id} request={request} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ContraceptionPlanRow({
  plan,
  methodName,
}: {
  plan: ContraceptionPlanWithPatient;
  methodName: string;
}) {
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function act(status: "active" | "declined") {
    setError(null);
    startTransition(async () => {
      const result = await actionContraceptionPlanRequest(plan.id, status);
      if (result?.error) {
        setError(result.error);
        return;
      }
      queryClient.invalidateQueries({ queryKey: orgRequestedContraceptionPlansKey });
    });
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div>
        <p className="text-sm font-medium text-charcoal-ink">
          {plan.patient?.full_name ?? "Unknown patient"}
        </p>
        <p className="text-xs text-charcoal-ink/60">
          {methodName} · requested {new Date(plan.requested_at).toLocaleDateString()}
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={() => act("active")}>
          Activate
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => act("declined")}>
          Decline
        </Button>
      </div>
    </li>
  );
}

function ContraceptionRequestsSection() {
  const { data, isLoading, isError } = useOrgRequestedContraceptionPlans();
  const { data: methods } = useContraceptionMethods();
  const methodNameByCode = new Map((methods ?? []).map((method) => [method.code, method.name]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contraception requests</CardTitle>
        <CardDescription>Requested methods awaiting clinical review.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load requests.</p>}
        {data && data.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No pending requests.</p>
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((plan) => (
              <ContraceptionPlanRow
                key={plan.id}
                plan={plan}
                methodName={methodNameByCode.get(plan.method_code) ?? plan.method_code.replace(/_/g, " ")}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Org-scoped worklist for everything in the Sexual & Reproductive Health
 * module that needs a clinician's action: emergency contraception requests
 * (shown first — the one item here with a real, short SLA), open STI cases,
 * and requested contraception plans. Every list is a plain react-query hook
 * relying on RLS (is_org_staff) for org scoping, same shape as
 * EscalationWorklist/the Referrals page; every mutation goes through
 * actions.ts under the caller's own authenticated session, never a service
 * role, so the module's own transition triggers stay the real authority.
 */
export function SexualHealthWorklist() {
  return (
    <div className="space-y-6">
      <EmergencyContraceptionSection />
      <StiCasesSection />
      <ContraceptionRequestsSection />
    </div>
  );
}
