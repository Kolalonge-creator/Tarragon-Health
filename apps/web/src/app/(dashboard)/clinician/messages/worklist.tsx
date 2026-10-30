"use client";

import { useState } from "react";
import { useCurrentUserId } from "@/lib/queries/current-user";
import {
  useOrgCareThreads,
  useCloseThread,
  useThreadOwner,
  useCareStaff,
  useSetThreadOwner,
  type CareThreadWithPatient,
} from "@/lib/queries/care-messages";
import { CareMessageThread } from "@/components/care-message-thread";
import { TimeCapture } from "@/components/clinician/time-capture";
import { AgpDisclosure } from "@/components/agp-disclosure";
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

/** Who has this conversation, and the note left for them. Staff only (the owner table is unreadable to a patient). */
function ThreadOwnerBar({ threadId, organisationId }: { threadId: string; organisationId: string }) {
  const { data: owner } = useThreadOwner(threadId);
  const { data: me } = useCurrentUserId();
  const { data: staff } = useCareStaff();
  const setOwner = useSetThreadOwner();
  const [handing, setHanding] = useState(false);
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");

  const mine = !!me && owner?.owner_id === me;
  const assign = (ownerId: string, handoverNote?: string) =>
    setOwner.mutate(
      { threadId, organisationId, ownerId, note: handoverNote },
      { onSuccess: () => { setHanding(false); setNote(""); setTo(""); } }
    );

  return (
    <div className="space-y-2 rounded-md bg-charcoal-ink/5 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-charcoal-ink/70">
          {owner ? (mine ? "You own this conversation" : `Owned by ${owner.owner?.full_name ?? "a colleague"}`) : "Nobody owns this conversation yet"}
        </span>
        {!mine && me && (
          <Button type="button" size="sm" variant="outline" disabled={setOwner.isPending} onClick={() => assign(me)}>
            Take it
          </Button>
        )}
        {owner && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setHanding((v) => !v)}>
            {handing ? "Cancel" : "Hand over"}
          </Button>
        )}
      </div>
      {owner?.handover_note && <p className="text-charcoal-ink/70">Hand-over note: {owner.handover_note}</p>}
      {handing && (
        <div className="flex flex-wrap items-start gap-2">
          <select
            aria-label="Hand over to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-8 rounded-md border border-charcoal-ink/15 bg-white px-2"
          >
            <option value="">Choose a colleague…</option>
            {(staff ?? []).filter((p) => p.id !== me).map((p) => (
              <option key={p.id} value={p.id}>{p.full_name ?? "Colleague"}</option>
            ))}
          </select>
          <input
            aria-label="Hand-over note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What they need to know (staff only)"
            maxLength={2000}
            className="h-8 min-w-48 flex-1 rounded-md border border-charcoal-ink/15 bg-white px-2"
          />
          <Button type="button" size="sm" disabled={!to || setOwner.isPending} onClick={() => assign(to, note)}>
            Hand over
          </Button>
        </div>
      )}
      {setOwner.isError && <p role="alert" className="text-red-600">Could not change the owner.</p>}
    </div>
  );
}

function ThreadRow({ thread, focusedId, onFocus }: { thread: CareThreadWithPatient; focusedId: string | null; onFocus: (id: string) => void }) {
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
          onClick={() => {
            if (!open) onFocus(thread.id);
            setOpen((v) => !v);
          }}
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
        <div className="mt-3 space-y-3" onFocusCapture={() => onFocus(thread.id)} onPointerDownCapture={() => onFocus(thread.id)}>
          {/* W-01: with several threads expanded, only the one in focus is timed */}
          <TimeCapture source="message" sourceRef={thread.id} patientId={thread.patient_id} showNotice={false} active={focusedId === thread.id} />
          <ThreadOwnerBar threadId={thread.id} organisationId={thread.organisation_id} />
          <AgpDisclosure patientId={thread.patient_id} />
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
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // useOrgCareThreads already returns threads ranked longest-waiting first;
  // splitting open from closed preserves that order inside each group.
  const allOpen = (threads ?? []).filter((t) => t.status === "open");
  const awaitingCount = allOpen.filter(isAwaitingCareTeam).length;
  const open = awaitingOnly ? allOpen.filter(isAwaitingCareTeam) : allOpen;
  const closed = (threads ?? []).filter((t) => t.status === "closed");

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 space-y-0 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>Patient messages</CardTitle>
          <p className="mt-1 text-sm text-charcoal-ink/60">
            {awaitingCount === 0
              ? "Nobody is waiting on a reply. Ordered by most recent activity."
              : `${awaitingCount} waiting on a reply, longest wait first.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
              <ThreadRow key={thread.id} thread={thread} focusedId={focusedId} onFocus={setFocusedId} />
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
                <ThreadRow key={thread.id} thread={thread} focusedId={focusedId} onFocus={setFocusedId} />
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
