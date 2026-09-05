"use client";

import { useState } from "react";
import {
  useOrgCareThreads,
  useCloseThread,
  type CareThreadWithPatient,
} from "@/lib/queries/care-messages";
import { CareMessageThread } from "@/components/care-message-thread";
import { CareMessageTemplateManager } from "@/components/care-message-template-manager";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatWait, isAwaitingCareTeam, waitingMs } from "@/lib/worklist/message-triage";
import type { Enums } from "@tarragon/shared";

const CATEGORY_LABEL: Record<Enums<"care_message_category">, string> = {
  clinical: "Clinical",
  appointment: "Appointment",
  medication: "Medication",
  laboratory: "Lab result",
  pharmacy: "Pharmacy",
  billing: "Billing",
  technical: "Technical",
  general: "General",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ThreadRow({ thread }: { thread: CareThreadWithPatient }) {
  const [open, setOpen] = useState(false);
  const close = useCloseThread();
  // "Unread" here means the patient (or their sponsor) spoke last and no
  // staff member has opened the thread since — the only sense in which a
  // shared team inbox can be unread.
  const awaiting = isAwaitingCareTeam(thread);
  const waited = waitingMs(thread);

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <span
            className={
              awaiting ? "font-semibold text-charcoal-ink" : "font-medium text-charcoal-ink"
            }
          >
            {thread.subject}
          </span>
          <span className="ml-2 text-sm text-charcoal-ink/60">
            {thread.patient?.full_name ?? "Patient"}
            {thread.patient?.patient_number ? ` · ${thread.patient.patient_number}` : ""}
          </span>
        </button>
        <span className="flex items-center gap-2">
          {awaiting && (
            <Badge variant="amber">
              Unread{waited === null ? "" : ` · waiting ${formatWait(waited)}`}
            </Badge>
          )}
          <Badge variant="grey">{CATEGORY_LABEL[thread.category]}</Badge>
          <Badge variant={thread.status === "open" ? "amber" : "grey"}>
            {thread.status === "open" ? "Open" : "Closed"}
          </Badge>
          <span className="text-xs text-charcoal-ink/50">{when(thread.last_message_at)}</span>
        </span>
      </div>
      {open && (
        <div className="mt-3 space-y-3">
          <CareMessageThread
            threadId={thread.id}
            patientId={thread.patient_id}
            closed={thread.status === "closed"}
            isStaff
            showDraftAssist
          />
          {thread.status === "open" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={close.isPending}
              onClick={() => close.mutate(thread.id)}
            >
              {close.isPending ? "Closing…" : "Close conversation"}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export function ClinicianMessagesWorklist() {
  const { data: threads, isLoading, isError } = useOrgCareThreads();
  const [showTemplates, setShowTemplates] = useState(false);
  const [awaitingOnly, setAwaitingOnly] = useState(false);
  // useOrgCareThreads already returns threads ranked longest-waiting first;
  // splitting open from closed preserves that order inside each group.
  const allOpen = (threads ?? []).filter((t) => t.status === "open");
  const awaitingCount = allOpen.filter(isAwaitingCareTeam).length;
  const open = awaitingOnly ? allOpen.filter(isAwaitingCareTeam) : allOpen;
  const closed = (threads ?? []).filter((t) => t.status === "closed");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Patient messages</CardTitle>
          <p className="mt-1 text-sm text-charcoal-ink/60">
            {awaitingCount === 0
              ? "Nobody is waiting on a reply. Ordered by most recent activity."
              : `${awaitingCount} waiting on a reply, longest wait first.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {awaitingCount > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={awaitingOnly}
              onClick={() => setAwaitingOnly((v) => !v)}
            >
              {awaitingOnly ? "Show all threads" : "Waiting on a reply"}
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => setShowTemplates((v) => !v)}>
            {showTemplates ? "Hide templates" : "Manage templates"}
          </Button>
        </div>
      </CardHeader>
      {showTemplates && (
        <CardContent className="border-b border-charcoal-ink/10 pb-6">
          <CareMessageTemplateManager />
        </CardContent>
      )}
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load patient messages.</p>}
        {!isLoading && !isError && (!threads || threads.length === 0) && (
          <p className="text-sm text-charcoal-ink/60">No patient messages.</p>
        )}
        {open.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {open.map((thread) => (
              <ThreadRow key={thread.id} thread={thread} />
            ))}
          </ul>
        )}
        {awaitingOnly && open.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">Nothing is waiting on a reply right now.</p>
        )}
        {!awaitingOnly && closed.length > 0 && (
          <>
            <p className="mt-6 mb-1 text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
              Closed
            </p>
            <ul className="divide-y divide-charcoal-ink/10">
              {closed.map((thread) => (
                <ThreadRow key={thread.id} thread={thread} />
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
