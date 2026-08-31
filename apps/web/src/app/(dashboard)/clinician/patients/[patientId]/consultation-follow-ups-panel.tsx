"use client";

import { useState } from "react";
import {
  useEncounterFollowUps,
  useCreateFollowUp,
  useActionFollowUp,
  useMarkFollowUpNotNeeded,
  type ConsultationFollowUp,
} from "@/lib/queries/consultation-follow-ups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const ACTION_TYPE_LABEL: Record<ConsultationFollowUp["action_type"], string> = {
  monitoring_schedule: "Monitoring schedule",
  investigation: "Investigation",
  referral: "Specialist referral",
  follow_up_appointment: "Follow-up appointment",
  care_plan_review: "Care plan review",
};

const SPECIALIST_TYPES = [
  "urologist",
  "oncologist",
  "ob_gyn",
  "cardiology",
  "endocrinology",
  "nephrology",
  "ophthalmology",
  "dietetics",
  "podiatry",
  "other",
] as const;

const STATUS_BADGE: Record<ConsultationFollowUp["status"], { label: string; tone: "amber" | "green" | "grey" }> = {
  pending: { label: "Pending", tone: "amber" },
  actioned: { label: "Actioned", tone: "green" },
  not_needed: { label: "Not needed", tone: "grey" },
};

function NewFollowUpForm({
  encounterNoteId,
  organisationId,
  patientId,
}: {
  encounterNoteId: string;
  organisationId: string;
  patientId: string;
}) {
  const [open, setOpen] = useState(false);
  const [actionType, setActionType] = useState<ConsultationFollowUp["action_type"]>("monitoring_schedule");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const create = useCreateFollowUp();

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Add follow-up
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
      <div>
        <Label>Type</Label>
        <Select value={actionType} onChange={(e) => setActionType(e.target.value as ConsultationFollowUp["action_type"])}>
          {Object.entries(ACTION_TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label>What did you tell the patient? (e.g. &ldquo;Check BP twice weekly for 4 weeks&rdquo;)</Label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <Label>Due by (optional)</Label>
        <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
      </div>
      {create.isError && <p className="text-xs text-red-600">{(create.error as Error).message}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={description.trim().length === 0 || create.isPending}
          onClick={() =>
            create.mutate(
              {
                encounterNoteId,
                organisationId,
                patientId,
                actionType,
                description: description.trim(),
                dueAt: dueAt ? new Date(dueAt).toISOString() : null,
              },
              { onSuccess: () => { setDescription(""); setDueAt(""); setOpen(false); } }
            )
          }
        >
          {create.isPending ? "Saving…" : "Save follow-up"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ActionFollowUpControls({ followUp }: { followUp: ConsultationFollowUp }) {
  const action = useActionFollowUp();
  const notNeeded = useMarkFollowUpNotNeeded();
  const [frequencyDays, setFrequencyDays] = useState("7");
  const [specialistType, setSpecialistType] = useState<(typeof SPECIALIST_TYPES)[number]>("other");
  const [reason, setReason] = useState("");
  const [dismissReason, setDismissReason] = useState("");

  const error = (action.error as Error | null)?.message ?? (notNeeded.error as Error | null)?.message;

  if (followUp.action_type === "monitoring_schedule") {
    return (
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label>Frequency (days)</Label>
          <Input
            type="number"
            min={1}
            max={90}
            className="w-24"
            value={frequencyDays}
            onChange={(e) => setFrequencyDays(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          disabled={action.isPending}
          onClick={() =>
            action.mutate({
              followUpId: followUp.id,
              encounterNoteId: followUp.encounter_note_id,
              monitoringFrequencyDays: Number(frequencyDays),
            })
          }
        >
          {action.isPending ? "Setting…" : "Set monitoring cadence"}
        </Button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  if (followUp.action_type === "referral") {
    return (
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label>Specialist</Label>
          <Select value={specialistType} onChange={(e) => setSpecialistType(e.target.value as typeof specialistType)}>
            {SPECIALIST_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace("_", " ")}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[12rem]">
          <Label>Referral reason (optional — defaults to the follow-up note)</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <Button
          size="sm"
          disabled={action.isPending}
          onClick={() =>
            action.mutate({
              followUpId: followUp.id,
              encounterNoteId: followUp.encounter_note_id,
              referralSpecialistType: specialistType,
              referralReason: reason.trim() || undefined,
            })
          }
        >
          {action.isPending ? "Creating…" : "Create referral"}
        </Button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  // investigation / follow_up_appointment / care_plan_review — Care
  // Coordinator logistics, routed onto the outreach worklist.
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Button
        size="sm"
        disabled={action.isPending}
        onClick={() => action.mutate({ followUpId: followUp.id, encounterNoteId: followUp.encounter_note_id })}
      >
        {action.isPending ? "Adding…" : "Add to outreach worklist"}
      </Button>
      <div className="min-w-[10rem]">
        <Label>Or mark not needed</Label>
        <Input value={dismissReason} onChange={(e) => setDismissReason(e.target.value)} placeholder="Why not?" />
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={dismissReason.trim().length === 0 || notNeeded.isPending}
        onClick={() =>
          notNeeded.mutate({
            followUpId: followUp.id,
            encounterNoteId: followUp.encounter_note_id,
            reason: dismissReason.trim(),
          })
        }
      >
        Not needed
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/**
 * Consultation System §9.16 — the connector between a signed encounter
 * note's plan and the real downstream record it describes. canAction mirrors
 * the DB's own authority split: monitoring_schedule/referral need clinical
 * tier, everything else (investigation/follow_up_appointment/
 * care_plan_review, and dismissing any type as not-needed) is Care
 * Coordinator logistics — enforced server-side either way, this is UX only.
 */
export function ConsultationFollowUpsPanel({
  encounterNoteId,
  organisationId,
  patientId,
  canWrite,
}: {
  encounterNoteId: string;
  organisationId: string;
  patientId: string;
  canWrite: boolean;
}) {
  const { data: followUps, isLoading } = useEncounterFollowUps(encounterNoteId);

  if (isLoading) return null;
  if ((followUps?.length ?? 0) === 0 && !canWrite) return null;

  return (
    <div className="space-y-2 border-t border-charcoal-ink/10 pt-3">
      <p className="text-sm font-medium text-charcoal-ink">Follow-ups</p>
      {(followUps?.length ?? 0) === 0 && (
        <p className="text-xs text-charcoal-ink/50">
          Nothing recorded — a monitoring schedule, investigation, or referral mentioned in the plan
          should be added here so it actually happens.
        </p>
      )}
      {followUps?.map((fu) => {
        const status = STATUS_BADGE[fu.status];
        return (
          <div key={fu.id} className="space-y-1 rounded-md border border-charcoal-ink/10 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-charcoal-ink">{ACTION_TYPE_LABEL[fu.action_type]}</span>
              <Badge variant={status.tone}>{status.label}</Badge>
              {fu.due_at && (
                <span className="text-xs text-charcoal-ink/50">
                  Due {new Date(fu.due_at).toLocaleDateString()}
                </span>
              )}
            </div>
            <p className="text-sm text-charcoal-ink/80">{fu.description}</p>
            {fu.status === "not_needed" && fu.resolution_note && (
              <p className="text-xs text-charcoal-ink/50">Reason: {fu.resolution_note}</p>
            )}
            {fu.status === "pending" && canWrite && <ActionFollowUpControls followUp={fu} />}
          </div>
        );
      })}
      {canWrite && (
        <NewFollowUpForm encounterNoteId={encounterNoteId} organisationId={organisationId} patientId={patientId} />
      )}
    </div>
  );
}
