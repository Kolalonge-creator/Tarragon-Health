"use client";

import { useState } from "react";
import {
  usePatientEncounterNotes,
  useCreateEncounterNote,
  useUpdateEncounterNoteDraft,
  useFinalizeEncounterNote,
  type ClinicalEncounterNote,
} from "@/lib/queries/encounter-notes";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ConsultationFollowUpsPanel } from "./consultation-follow-ups-panel";

const ENCOUNTER_TYPE_LABEL: Record<ClinicalEncounterNote["encounter_type"], string> = {
  video_consult: "Video consult",
  async_consult: "Async consult",
  in_person: "In person",
  phone: "Phone",
  escalation_review: "Escalation review",
  other: "Other",
};

// Consultation System §9.15 — every finalized consultation records one of these.
const OUTCOME_LABEL: Record<NonNullable<ClinicalEncounterNote["outcome"]>, string> = {
  reassurance: "Reassurance",
  continue_monitoring: "Continue monitoring",
  treatment_started: "Treatment started",
  treatment_changed: "Treatment changed",
  investigation_requested: "Investigation requested",
  referral: "Referral",
  follow_up: "Follow-up",
  emergency_escalation: "Emergency escalation",
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function NoteFields({
  values,
  onChange,
  disabled,
}: {
  values: {
    reasonForEncounter: string;
    history: string;
    examinationFindings: string;
    assessment: string;
    diagnosis: string;
    plan: string;
    followUpInstructions: string;
  };
  onChange: (field: keyof typeof values, value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-3">
      <div>
        <Label>Reason for encounter</Label>
        <Input
          value={values.reasonForEncounter}
          disabled={disabled}
          onChange={(e) => onChange("reasonForEncounter", e.target.value)}
        />
      </div>
      <div>
        <Label>History</Label>
        <Textarea
          value={values.history}
          disabled={disabled}
          onChange={(e) => onChange("history", e.target.value)}
        />
      </div>
      <div>
        <Label>Examination findings</Label>
        <Textarea
          value={values.examinationFindings}
          disabled={disabled}
          onChange={(e) => onChange("examinationFindings", e.target.value)}
        />
      </div>
      <div>
        <Label>Assessment</Label>
        <Textarea
          value={values.assessment}
          disabled={disabled}
          onChange={(e) => onChange("assessment", e.target.value)}
        />
      </div>
      <div>
        <Label>Diagnosis</Label>
        <Input
          value={values.diagnosis}
          disabled={disabled}
          onChange={(e) => onChange("diagnosis", e.target.value)}
        />
      </div>
      <div>
        <Label>Plan</Label>
        <Textarea
          value={values.plan}
          disabled={disabled}
          onChange={(e) => onChange("plan", e.target.value)}
        />
        <p className="mt-1 text-xs text-charcoal-ink/50">
          A narrative account only — actual medication/lab/referral orders belong on their own
          tabs, not here.
        </p>
      </div>
      <div>
        <Label>Follow-up instructions</Label>
        <Textarea
          value={values.followUpInstructions}
          disabled={disabled}
          onChange={(e) => onChange("followUpInstructions", e.target.value)}
        />
      </div>
    </div>
  );
}

const EMPTY_FIELDS = {
  reasonForEncounter: "",
  history: "",
  examinationFindings: "",
  assessment: "",
  diagnosis: "",
  plan: "",
  followUpInstructions: "",
};

function NewNoteForm({ patientId, organisationId }: { patientId: string; organisationId: string }) {
  const [open, setOpen] = useState(false);
  const [encounterType, setEncounterType] =
    useState<ClinicalEncounterNote["encounter_type"]>("in_person");
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const create = useCreateEncounterNote();

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        New encounter note
      </Button>
    );
  }

  const canSave = fields.reasonForEncounter.trim().length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>New encounter note</CardTitle>
        <CardDescription>Saved as a draft — nothing is final until you sign it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label>Encounter type</Label>
          <Select
            value={encounterType}
            onChange={(e) =>
              setEncounterType(e.target.value as ClinicalEncounterNote["encounter_type"])
            }
          >
            {Object.entries(ENCOUNTER_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <NoteFields values={fields} onChange={(field, value) => setFields((f) => ({ ...f, [field]: value }))} />
        {create.isError && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={!canSave || create.isPending}
            onClick={() =>
              create.mutate(
                {
                  organisationId,
                  patientId,
                  encounterType,
                  reasonForEncounter: fields.reasonForEncounter.trim(),
                  history: fields.history.trim(),
                  examinationFindings: fields.examinationFindings.trim(),
                  assessment: fields.assessment.trim(),
                  diagnosis: fields.diagnosis.trim(),
                  plan: fields.plan.trim(),
                  followUpInstructions: fields.followUpInstructions.trim(),
                },
                {
                  onSuccess: () => {
                    setFields(EMPTY_FIELDS);
                    setOpen(false);
                  },
                }
              )
            }
          >
            {create.isPending ? "Saving…" : "Save draft"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DraftNoteCard({
  note,
  patientId,
  organisationId,
}: {
  note: ClinicalEncounterNote;
  patientId: string;
  organisationId: string;
}) {
  const [fields, setFields] = useState({
    reasonForEncounter: note.reason_for_encounter,
    history: note.history ?? "",
    examinationFindings: note.examination_findings ?? "",
    assessment: note.assessment ?? "",
    diagnosis: note.diagnosis ?? "",
    plan: note.plan ?? "",
    followUpInstructions: note.follow_up_instructions ?? "",
  });
  const [outcome, setOutcome] = useState<NonNullable<ClinicalEncounterNote["outcome"]> | "">("");
  const update = useUpdateEncounterNoteDraft();
  const finalize = useFinalizeEncounterNote();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">
            {ENCOUNTER_TYPE_LABEL[note.encounter_type]} · {formatDateTime(note.encounter_date)}
          </CardTitle>
          <Badge variant="amber">Draft</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <NoteFields values={fields} onChange={(field, value) => setFields((f) => ({ ...f, [field]: value }))} />
        {update.isError && <p className="text-sm text-red-600">{(update.error as Error).message}</p>}
        {finalize.isError && <p className="text-sm text-red-600">{(finalize.error as Error).message}</p>}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={update.isPending}
            onClick={() =>
              update.mutate({
                noteId: note.id,
                patientId,
                fields: {
                  reason_for_encounter: fields.reasonForEncounter.trim(),
                  history: fields.history.trim() || null,
                  examination_findings: fields.examinationFindings.trim() || null,
                  assessment: fields.assessment.trim() || null,
                  diagnosis: fields.diagnosis.trim() || null,
                  plan: fields.plan.trim() || null,
                  follow_up_instructions: fields.followUpInstructions.trim() || null,
                },
              })
            }
          >
            {update.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-2 border-t border-charcoal-ink/10 pt-3">
          <div className="min-w-[14rem]">
            <Label>Outcome (required to sign)</Label>
            <Select value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
              <option value="">Choose an outcome…</option>
              {Object.entries(OUTCOME_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <Button
            size="sm"
            disabled={fields.reasonForEncounter.trim().length === 0 || outcome === "" || finalize.isPending}
            title="Locks this note permanently — no further edits after signing"
            onClick={() => finalize.mutate({ noteId: note.id, patientId, outcome: outcome as NonNullable<ClinicalEncounterNote["outcome"]> })}
          >
            {finalize.isPending ? "Signing…" : "Sign & finalize"}
          </Button>
        </div>
        <ConsultationFollowUpsPanel
          encounterNoteId={note.id}
          organisationId={organisationId}
          patientId={patientId}
          canWrite
        />
      </CardContent>
    </Card>
  );
}

function FinalizedNoteCard({
  note,
  patientId,
  organisationId,
  canActionFollowUps,
}: {
  note: ClinicalEncounterNote;
  patientId: string;
  organisationId: string;
  canActionFollowUps: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">
            {ENCOUNTER_TYPE_LABEL[note.encounter_type]} · {formatDateTime(note.encounter_date)}
          </CardTitle>
          {note.status === "finalized" && note.finalized_at ? (
            <Badge variant="green">Signed {formatDateTime(note.finalized_at)}</Badge>
          ) : (
            <Badge variant="amber">Draft</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-charcoal-ink">
        <p>
          <span className="font-medium">Reason: </span>
          {note.reason_for_encounter}
        </p>
        {note.history && (
          <p>
            <span className="font-medium">History: </span>
            {note.history}
          </p>
        )}
        {note.examination_findings && (
          <p>
            <span className="font-medium">Examination: </span>
            {note.examination_findings}
          </p>
        )}
        {note.assessment && (
          <p>
            <span className="font-medium">Assessment: </span>
            {note.assessment}
          </p>
        )}
        {note.diagnosis && (
          <p>
            <span className="font-medium">Diagnosis: </span>
            {note.diagnosis}
          </p>
        )}
        {note.plan && (
          <p>
            <span className="font-medium">Plan: </span>
            {note.plan}
          </p>
        )}
        {note.follow_up_instructions && (
          <p>
            <span className="font-medium">Follow-up: </span>
            {note.follow_up_instructions}
          </p>
        )}
        {note.outcome && (
          <p>
            <span className="font-medium">Outcome: </span>
            {OUTCOME_LABEL[note.outcome]}
          </p>
        )}
        <ConsultationFollowUpsPanel
          encounterNoteId={note.id}
          organisationId={organisationId}
          patientId={patientId}
          canWrite={canActionFollowUps}
        />
      </CardContent>
    </Card>
  );
}

/**
 * Clinical encounter documentation (docs/CLINICAL_NETWORK_SPEC.md §4.10) — a
 * signed note per encounter, staff-only. canWrite mirrors the DB's own gate
 * (private.is_clinical_tier) purely for UX — a Care Coordinator can read
 * every note here (private.is_org_staff), but never gets the write controls,
 * and would be rejected by RLS/the attribution trigger if they tried anyway.
 */
export function ClinicalEncounterNotesSection({
  patientId,
  organisationId,
  canWrite,
  canActionFollowUps = canWrite,
}: {
  patientId: string;
  organisationId: string;
  canWrite: boolean;
  /** Any active org staff (Care Coordinator included) may action a
   * logistics-flavoured follow-up (investigation/appointment/care plan
   * review) or dismiss one as not needed — only monitoring_schedule/referral
   * need canWrite's clinical tier. Server-enforced either way; defaults to
   * canWrite for callers that don't distinguish. */
  canActionFollowUps?: boolean;
}) {
  const { data: notes, isLoading } = usePatientEncounterNotes(patientId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clinical notes</CardTitle>
        <CardDescription>
          Reason, history, examination, assessment, diagnosis, and plan for each encounter.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canWrite && <NewNoteForm patientId={patientId} organisationId={organisationId} />}
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {!isLoading && (notes?.length ?? 0) === 0 && (
          <p className="text-sm text-charcoal-ink/60">No clinical notes yet.</p>
        )}
        {notes?.map((note) =>
          note.status === "draft" && canWrite ? (
            <DraftNoteCard key={note.id} note={note} patientId={patientId} organisationId={organisationId} />
          ) : (
            <FinalizedNoteCard
              key={note.id}
              note={note}
              patientId={patientId}
              organisationId={organisationId}
              canActionFollowUps={canActionFollowUps}
            />
          )
        )}
      </CardContent>
    </Card>
  );
}
