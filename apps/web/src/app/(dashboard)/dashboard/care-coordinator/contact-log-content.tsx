"use client";

import { useMemo, useState } from "react";
import {
  useOutreachTasks,
  useRecentOutreachContacts,
  useOutreachContacts,
  useLogOutreachContact,
  type OutreachContactChannel,
} from "@/lib/queries/care-outreach";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const CHANNEL_LABEL: Record<OutreachContactChannel, string> = { call: "Call", whatsapp: "WhatsApp" };

interface PatientRef {
  id: string;
  fullName: string | null;
  patientNumber: string | null;
  /** An open outreach task to link a new contact entry to, if one exists. */
  taskId: string | null;
  preview: string | null;
}

/**
 * The reframed "Messages" tab: a per-patient outreach CONTACT LOG, not a live
 * chat. CLAUDE.md is explicit that two-way patient<->care-team conversation
 * stays in-app only, never WhatsApp — a coordinator-authored live WhatsApp
 * send here would reopen exactly the trust gap that rule closed. So instead
 * of a send box, this is a history feed (what a coordinator did and what
 * happened) with a form that appends one more entry.
 */
export function CareCoordinatorContactLog() {
  const { data: tasks } = useOutreachTasks();
  const { data: recentContacts } = useRecentOutreachContacts(50);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const patients = useMemo<PatientRef[]>(() => {
    const map = new Map<string, PatientRef>();
    for (const t of tasks ?? []) {
      if (!map.has(t.patient_id)) {
        map.set(t.patient_id, {
          id: t.patient_id,
          fullName: t.patient?.full_name ?? null,
          patientNumber: t.patient?.patient_number ?? null,
          taskId: t.id,
          preview: null,
        });
      }
    }
    for (const c of recentContacts ?? []) {
      const existing = map.get(c.patient_id);
      if (existing) {
        existing.preview ??= c.note;
      } else {
        map.set(c.patient_id, {
          id: c.patient_id,
          fullName: c.patient?.full_name ?? null,
          patientNumber: c.patient?.patient_number ?? null,
          taskId: null,
          preview: c.note,
        });
      }
    }
    return Array.from(map.values());
  }, [tasks, recentContacts]);

  const selected = patients.find((p) => p.id === selectedId) ?? patients[0] ?? null;

  return (
    <div className="flex gap-4" style={{ height: "calc(100vh - 220px)" }}>
      <Card className="w-72 shrink-0 overflow-y-auto">
        {patients.length === 0 ? (
          <p className="p-4 text-sm text-charcoal-ink/60">
            No patients with an open outreach task or contact history yet.
          </p>
        ) : (
          <ul>
            {patients.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 border-b border-charcoal-ink/6 px-4 py-3 text-left transition-colors",
                    selected?.id === p.id ? "bg-warm-ivory" : "hover:bg-charcoal-ink/5"
                  )}
                >
                  <span className="text-sm font-semibold text-charcoal-ink">
                    {p.fullName ?? "Patient"}
                    {p.patientNumber ? ` · ${p.patientNumber}` : ""}
                  </span>
                  <span className="line-clamp-1 text-xs text-charcoal-ink/50">
                    {p.preview ?? "No contact logged yet"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-1 flex-col overflow-hidden">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-charcoal-ink/50">
            Select a patient to see their outreach contact history.
          </div>
        ) : (
          <ContactThread key={selected.id} patient={selected} />
        )}
      </Card>
    </div>
  );
}

function ContactThread({ patient }: { patient: PatientRef }) {
  const { data: contacts, isLoading } = useOutreachContacts(patient.id);
  const logContact = useLogOutreachContact();
  const [channel, setChannel] = useState<OutreachContactChannel>("call");
  const [note, setNote] = useState("");

  const submit = () => {
    const trimmed = note.trim();
    if (!trimmed) return;
    logContact.mutate(
      { patientId: patient.id, taskId: patient.taskId, channel, note: trimmed },
      { onSuccess: () => setNote("") }
    );
  };

  return (
    <>
      <div className="shrink-0 border-b border-charcoal-ink/8 px-5 py-3">
        <p className="text-sm font-semibold text-charcoal-ink">
          {patient.fullName ?? "Patient"}
          {patient.patientNumber ? ` · ${patient.patientNumber}` : ""}
        </p>
        <p className="text-xs text-charcoal-ink/50">Outreach contact log — not a live chat</p>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-5">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {contacts && contacts.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No contact logged for this patient yet.</p>
        )}
        {contacts?.map((c) => (
          <div key={c.id} className="rounded-lg border border-charcoal-ink/8 bg-warm-ivory p-3">
            <div className="mb-1 flex items-center gap-2">
              <Badge variant="grey">{CHANNEL_LABEL[c.channel]}</Badge>
              <span className="text-xs text-charcoal-ink/45">
                {new Date(c.contacted_at).toLocaleString()}
              </span>
            </div>
            <p className="text-sm text-charcoal-ink">{c.note}</p>
          </div>
        ))}
      </div>
      <div className="shrink-0 space-y-2 border-t border-charcoal-ink/8 p-4">
        <div className="flex items-start gap-2">
          <Select
            value={channel}
            onChange={(e) => setChannel(e.target.value as OutreachContactChannel)}
            className="w-32 shrink-0"
          >
            <option value="call">Call</option>
            <option value="whatsapp">WhatsApp</option>
          </Select>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What happened on this contact? (e.g. reminded about lipid panel, will book Thursday)"
            className="min-h-10 flex-1"
            rows={1}
          />
          <Button onClick={submit} disabled={logContact.isPending || !note.trim()}>
            Log contact
          </Button>
        </div>
        {logContact.isError && (
          <p className="text-xs text-red-600">
            {(logContact.error as Error).message || "Could not log this contact."}
          </p>
        )}
      </div>
    </>
  );
}
