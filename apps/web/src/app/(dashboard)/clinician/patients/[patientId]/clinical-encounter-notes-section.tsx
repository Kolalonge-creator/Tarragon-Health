"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { PatientIdentityConfirm } from "@/components/patient-identity-confirm";
import { ConsultationFollowUpsPanel } from "./consultation-follow-ups-panel";
import { ScribePanel, type ScribeDraftResult } from "@/components/scribe";
import { attachScribeDraftToNote } from "@/lib/scribe/actions";
import { useScribeAvailable } from "@/lib/scribe/use-scribe-available";
import { createNoteAmendment, setNoteProtected, withdrawNoteAsEnteredInError } from "./note-actions";
import { AMENDMENT_KINDS, AMENDMENT_KIND_LABEL, type AmendmentKind, type NoteActionState } from "@/lib/clinician/note-requests";

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
          A narrative account only: actual medication/lab/referral orders belong on their own
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

function NewNoteForm({
  patientId,
  organisationId,
  defaultEncounterType = "in_person",
  videoConsultationId,
  startOpen = false,
}: {
  patientId: string;
  organisationId: string;
  defaultEncounterType?: ClinicalEncounterNote["encounter_type"];
  /** Links the note to the live call it's written from (Consultation
   * System §9.9/§9.16) — omitted outside a video-consultation context. */
  videoConsultationId?: string;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [encounterType, setEncounterType] =
    useState<ClinicalEncounterNote["encounter_type"]>(defaultEncounterType);
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
        <CardDescription>Saved as a draft. Nothing is final until you sign it.</CardDescription>
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
                  videoConsultationId,
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

const notesKey = (patientId: string) => ["clinical-encounter-notes", patientId];

/** "Protected content" switch on a draft (S22): only the Chief Medical Officer can release a protected note to the patient. */
function ProtectedToggle({ note, patientId }: { note: ClinicalEncounterNote; patientId: string }) {
  const queryClient = useQueryClient();
  const [pending, start] = useTransition();
  const [state, setState] = useState<NoteActionState>();
  return (
    <div className="space-y-1 rounded-md border border-charcoal-ink/10 p-2">
      <label className="flex items-center gap-2 text-sm text-charcoal-ink">
        <input
          type="checkbox"
          checked={note.is_protected}
          disabled={pending}
          onChange={(e) =>
            start(async () => {
              const result = await setNoteProtected({ noteId: note.id, protected: e.target.checked });
              setState(result);
              if (result?.message) await queryClient.invalidateQueries({ queryKey: notesKey(patientId) });
            })
          }
        />
        Protected content
      </label>
      <p className="text-xs text-charcoal-ink/60">
        For reproductive health and similar sensitive notes. Only the Chief Medical Officer can release a protected note to the patient.
      </p>
      {state?.error && <p role="alert" className="text-xs text-red-600">{state.error}</p>}
    </div>
  );
}

/** "Amend" on a signed note (S22): starts a linked draft (addendum, late entry or correction); the original is never edited. */
function AmendNote({ note, patientId }: { note: ClinicalEncounterNote; patientId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AmendmentKind>("addendum");
  const [reason, setReason] = useState("");
  const [state, setState] = useState<NoteActionState>();
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Amend
      </Button>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
      <p className="text-xs text-charcoal-ink/60">
        The signed note stays as it is. This starts a new linked draft, which you edit and sign like any other note.
      </p>
      <div>
        <Label>What kind of amendment?</Label>
        <Select value={kind} onChange={(e) => setKind(e.target.value as AmendmentKind)}>
          {AMENDMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {AMENDMENT_KIND_LABEL[k]}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label>Reason (required)</Label>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
      </div>
      {state?.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state?.message && <p className="text-sm text-brand-green">{state.message}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await createNoteAmendment({ noteId: note.id, kind, reason });
              setState(result);
              if (result?.message) {
                // The new draft appears in this list as an editable draft; the existing editor takes it from here.
                await queryClient.invalidateQueries({ queryKey: notesKey(patientId) });
                setReason("");
              }
            })
          }
        >
          {pending ? "Starting..." : "Start amendment draft"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </div>
  );
}

/** "Withdraw (entered in error)" on a signed note: needs a reason and a confirm step. The note itself is never deleted. */
function WithdrawNote({ note, patientId }: { note: ClinicalEncounterNote; patientId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<NoteActionState>();
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Withdraw (entered in error)
      </Button>
    );
  }
  const reasonOk = reason.trim().length >= 10;
  return (
    <div className="space-y-2 rounded-md border border-red-200 p-3">
      <p className="text-xs text-charcoal-ink/60">
        The note is never deleted: staff still see it marked as withdrawn. The patient sees that it was withdrawn and why, but none of its
        text. A withdrawn note cannot be amended; write a new note instead.
      </p>
      <div>
        <Label>Reason (required, 10 characters or more)</Label>
        <Textarea
          rows={2}
          value={reason}
          maxLength={1000}
          onChange={(e) => {
            setReason(e.target.value);
            setConfirming(false);
          }}
        />
      </div>
      {state?.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {!confirming ? (
          <Button size="sm" disabled={!reasonOk} onClick={() => setConfirming(true)}>
            Withdraw this note
          </Button>
        ) : (
          <>
            <span className="text-sm text-charcoal-ink">This cannot be undone. Withdraw this note?</span>
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await withdrawNoteAsEnteredInError({ noteId: note.id, reason });
                  setState(result);
                  setConfirming(false);
                  if (result?.message) await queryClient.invalidateQueries({ queryKey: notesKey(patientId) });
                })
              }
            >
              {pending ? "Withdrawing..." : "Yes, withdraw it"}
            </Button>
          </>
        )}
        <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </div>
  );
}

function DraftNoteCard({
  note,
  patientId,
  organisationId,
  patientName,
  patientDateOfBirth,
}: {
  note: ClinicalEncounterNote;
  patientId: string;
  organisationId: string;
  patientName: string;
  patientDateOfBirth: string | null;
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
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const update = useUpdateEncounterNoteDraft();
  const finalize = useFinalizeEncounterNote();
  const scribeAvailable = useScribeAvailable().data === true;
  // Set when the clinician uses an AI scribe draft; recorded on the note (consent, summary, ai_drafted) at the next save or sign.
  const [scribe, setScribe] = useState<(ScribeDraftResult & { persisted: boolean }) | null>(null);
  const [scribeError, setScribeError] = useState<string | null>(null);

  function applyScribeDraft(result: ScribeDraftResult) {
    const add = (existing: string, incoming: string) =>
      incoming.trim() ? (existing.trim() ? `${existing.trim()}\n\n${incoming.trim()}` : incoming.trim()) : existing;
    setFields((f) => ({
      ...f,
      history: add(f.history, result.draft.history),
      examinationFindings: add(f.examinationFindings, result.draft.examination),
      assessment: add(f.assessment, result.draft.assessment),
      plan: add(f.plan, result.draft.plan),
      followUpInstructions: add(f.followUpInstructions, result.draft.followUp),
    }));
    setScribe({ ...result, persisted: false });
  }

  /** Records the scribe's consent and summary on the note before a save or sign. Returns false (and says why) if refused. */
  async function persistScribe(): Promise<boolean> {
    setScribeError(null);
    if (!scribe || scribe.persisted) return true;
    try {
      await attachScribeDraftToNote({
        encounterNoteId: note.id,
        scribeConsentId: scribe.consentId,
        patientSummary: scribe.patientSummary,
        patientSummaryLanguage: scribe.language,
      });
      setScribe({ ...scribe, persisted: true });
      return true;
    } catch (err) {
      setScribeError(err instanceof Error ? err.message : "Could not record the AI scribe on this note.");
      return false;
    }
  }

  // Computed once on mount (the lint rule forbids Date.now() during render); age only needs to be right to the year.
  const [ageYears] = useState(() =>
    patientDateOfBirth
      ? Math.floor((Date.now() - new Date(patientDateOfBirth).getTime()) / (365.25 * 24 * 3600 * 1000))
      : undefined
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">
            {ENCOUNTER_TYPE_LABEL[note.encounter_type]} · {formatDateTime(note.encounter_date)}
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {note.auto_generated && (
              <Badge variant="blue" title="The platform drafted this the moment the encounter concluded — review and complete it before signing.">
                Auto-drafted
              </Badge>
            )}
            <Badge variant="amber">Draft</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <NoteFields values={fields} onChange={(field, value) => setFields((f) => ({ ...f, [field]: value }))} />
        {scribeAvailable && (
          <div className="space-y-2 border-t border-charcoal-ink/10 pt-3">
            <ScribePanel
              patientId={patientId}
              encounterNoteId={note.id}
              patientContext={ageYears !== undefined && ageYears >= 0 && ageYears <= 130 ? { age: ageYears } : undefined}
              onUseDraft={applyScribeDraft}
            />
            {scribe && <p className="text-xs text-charcoal-ink/50">AI-drafted text is in the fields above. It is yours to edit; nothing is saved until you save or sign.</p>}
          </div>
        )}
        {scribeError && <p className="text-sm text-red-600">{scribeError}</p>}
        {update.isError && <p className="text-sm text-red-600">{(update.error as Error).message}</p>}
        {finalize.isError && <p className="text-sm text-red-600">{(finalize.error as Error).message}</p>}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={update.isPending}
            onClick={async () => {
              if (!(await persistScribe())) return;
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
              });
            }}
          >
            {update.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
        <ProtectedToggle note={note} patientId={patientId} />
        <div className="space-y-2 border-t border-charcoal-ink/10 pt-3">
          <PatientIdentityConfirm
            patientName={patientName}
            patientDateOfBirth={patientDateOfBirth}
            confirmed={identityConfirmed}
            onConfirmedChange={setIdentityConfirmed}
          />
          <div className="flex flex-wrap items-end gap-2">
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
              disabled={
                fields.reasonForEncounter.trim().length === 0 ||
                outcome === "" ||
                !identityConfirmed ||
                finalize.isPending
              }
              title="Locks this note permanently, no further edits after signing"
              onClick={async () => {
                if (!(await persistScribe())) return;
                finalize.mutate({
                  noteId: note.id,
                  patientId,
                  outcome: outcome as NonNullable<ClinicalEncounterNote["outcome"]>,
                  identityConfirmed,
                });
              }}
            >
              {finalize.isPending ? "Signing…" : "Sign & finalise"}
            </Button>
          </div>
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
  canAmend,
}: {
  note: ClinicalEncounterNote;
  patientId: string;
  organisationId: string;
  canActionFollowUps: boolean;
  canAmend: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">
            {ENCOUNTER_TYPE_LABEL[note.encounter_type]} · {formatDateTime(note.encounter_date)}
          </CardTitle>
          {note.entered_in_error ? (
            <Badge variant="red">Withdrawn as entered in error</Badge>
          ) : note.status === "finalized" && note.finalized_at ? (
            <Badge variant="green">Signed {formatDateTime(note.finalized_at)}</Badge>
          ) : (
            <Badge variant="amber">Draft</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-charcoal-ink">
        {note.entered_in_error && (
          <div role="note" className="rounded-md border border-red-200 bg-red-50 p-2 text-red-800">
            <p className="font-medium">Withdrawn as entered in error</p>
            {note.withdrawn_at && <p className="text-xs">On {formatDateTime(note.withdrawn_at)}</p>}
            {note.withdrawn_reason && <p className="text-xs">Reason: {note.withdrawn_reason}</p>}
          </div>
        )}
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
        {canAmend && note.status === "finalized" && !note.entered_in_error && (
          <div className="flex flex-wrap gap-2">
            <AmendNote note={note} patientId={patientId} />
            <WithdrawNote note={note} patientId={patientId} />
          </div>
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
  defaultEncounterType,
  videoConsultationId,
  startOpen,
  hideHeader = false,
  patientName,
  patientDateOfBirth,
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
  /** Pre-fills a new note's encounter type and links it to the live call —
   * used by the video-consultation screen (68.9/68.10) so a note started
   * mid-call is correctly attributed without extra clicks. */
  defaultEncounterType?: ClinicalEncounterNote["encounter_type"];
  videoConsultationId?: string;
  startOpen?: boolean;
  /** The video-consultation screen already has its own "Clinical notes"
   * heading via its own card layout. */
  hideHeader?: boolean;
  /** Shown on the identity-confirmation step before signing a note — §89.4. */
  patientName: string;
  patientDateOfBirth: string | null;
}) {
  const { data: notesData, isLoading, isError } = usePatientEncounterNotes(patientId);
  const notes = notesData?.notes;

  const body = (
    <div className="space-y-4">
      {canWrite && (
        <NewNoteForm
          patientId={patientId}
          organisationId={organisationId}
          defaultEncounterType={defaultEncounterType}
          videoConsultationId={videoConsultationId}
          startOpen={startOpen}
        />
      )}
      {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
      {isError && (
        <p role="alert" className="text-sm text-amber-700">
          The clinical notes are not available to you for this patient (you are not on their care team), or could not be loaded. This is
          not the same as no notes.
        </p>
      )}
      {notesData?.scope === "own_only" && (
        <p className="text-xs text-amber-700">
          You are not on this patient&apos;s care team, so only the notes you wrote are shown.
        </p>
      )}
      {!isLoading && !isError && (notes?.length ?? 0) === 0 && (
        <p className="text-sm text-charcoal-ink/60">No clinical notes yet.</p>
      )}
      {notes?.map((note) =>
        note.status === "draft" && canWrite ? (
          <DraftNoteCard
            key={note.id}
            note={note}
            patientId={patientId}
            organisationId={organisationId}
            patientName={patientName}
            patientDateOfBirth={patientDateOfBirth}
          />
        ) : (
          <FinalizedNoteCard
            key={note.id}
            note={note}
            patientId={patientId}
            organisationId={organisationId}
            canActionFollowUps={canActionFollowUps}
            canAmend={canWrite}
          />
        )
      )}
    </div>
  );

  if (hideHeader) {
    return body;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clinical notes</CardTitle>
        <CardDescription>
          Reason, history, examination, assessment, diagnosis, and plan for each encounter.
        </CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
