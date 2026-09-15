"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatPatientDate } from "@/lib/format-date";

/**
 * Patients who have paid for supervised weight management and are waiting on
 * a doctor to confirm they are a suitable candidate.
 *
 * public.confirm_weight_management_eligibility is a prescribing-class act --
 * the same authority as agreeing a dose-escalation step or approving a
 * psychiatry booking -- so it is gated to Senior Medical Officer+ by a
 * trigger on the enrolment table, not by this page. A Care Coordinator can
 * see this list (routing/logistics is their job) but the confirm action will
 * be refused server-side if they try it; this page does not attempt to hide
 * the action from them, since that would be a UI-only convention rather than
 * a real control.
 */

type Enrolment = {
  id: string;
  organisation_id: string;
  patient_id: string;
  created_at: string;
  term_days: number;
  patient: { full_name: string | null; patient_number: string | null } | null;
};

type ObesityAssessment = {
  id: string;
  assessed_at: string;
  bmi: number;
  bmi_category: string;
};

type PatientMedication = {
  id: string;
  drug_name: string;
  dose: string | null;
  prescriber_name: string | null;
};

function usePendingEligibility() {
  return useQuery({
    queryKey: ["weight-management", "pending-eligibility"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("weight_management_enrolments")
        .select(
          "id, organisation_id, patient_id, created_at, term_days, patient:profiles!weight_management_enrolments_patient_id_fkey(full_name, patient_number)"
        )
        .eq("status", "pending_eligibility")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as unknown as Enrolment[];
    },
  });
}

function usePatientObesityAssessments(patientId: string) {
  return useQuery({
    queryKey: ["weight-management", "obesity-assessments", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("obesity_assessments")
        .select("id, assessed_at, bmi, bmi_category")
        .eq("patient_id", patientId)
        .order("assessed_at", { ascending: false });
      if (error) throw error;
      return data as ObesityAssessment[];
    },
  });
}

function usePatientOwnMedications(patientId: string) {
  return useQuery({
    queryKey: ["weight-management", "patient-medications", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medications")
        .select("id, drug_name, dose, prescriber_name")
        .eq("patient_id", patientId)
        .eq("source", "patient")
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as PatientMedication[];
    },
  });
}

function useConfirmEligibility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      enrolmentId: string;
      obesityAssessmentId: string;
      medicationId: string;
      notes: string;
    }) => {
      const supabase = createClient();
      // The RPC stamps supervising_clinician_id and eligibility_confirmed_by
      // from the session, and the authority rule lives in a trigger, so a
      // Care Coordinator is refused on any path, not only this one.
      const { error } = await supabase.rpc("confirm_weight_management_eligibility", {
        p_enrolment_id: input.enrolmentId,
        p_obesity_assessment_id: input.obesityAssessmentId,
        p_medication_id: input.medicationId,
        p_notes: input.notes.length > 0 ? input.notes : undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["weight-management", "pending-eligibility"] });
    },
  });
}

function EnrolmentRow({ enrolment }: { enrolment: Enrolment }) {
  const [open, setOpen] = useState(false);
  const [obesityAssessmentId, setObesityAssessmentId] = useState("");
  const [medicationId, setMedicationId] = useState("");
  const [notes, setNotes] = useState("");

  const assessments = usePatientObesityAssessments(enrolment.patient_id);
  const medications = usePatientOwnMedications(enrolment.patient_id);
  const confirm = useConfirmEligibility();

  const canSubmit = obesityAssessmentId.length > 0 && medicationId.length > 0;

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
              {enrolment.patient?.full_name ?? "Patient"}
            </p>
            {enrolment.patient?.patient_number ? (
              <span className="font-mono text-xs text-charcoal-ink/50 dark:text-night-ink/50">
                {enrolment.patient.patient_number}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            Enrolled{" "}
            {formatPatientDate(new Date(enrolment.created_at), {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {" · "}
            {enrolment.term_days}-day programme
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : "Review eligibility"}
        </Button>
      </div>

      {open ? (
        <div className="mt-3 space-y-3 rounded-md border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
          <div>
            <Label htmlFor={`assessment-${enrolment.id}`}>Obesity assessment</Label>
            {assessments.isLoading ? (
              <p className="mt-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>
            ) : (assessments.data ?? []).length === 0 ? (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                No obesity assessment on file for this patient yet. Record one before confirming
                eligibility.
              </p>
            ) : (
              <Select
                id={`assessment-${enrolment.id}`}
                value={obesityAssessmentId}
                onChange={(e) => setObesityAssessmentId(e.target.value)}
                className="mt-1"
              >
                <option value="">Select an assessment…</option>
                {(assessments.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {formatPatientDate(new Date(a.assessed_at), { day: "numeric", month: "short", year: "numeric" })}
                    {" — BMI "}
                    {a.bmi} ({a.bmi_category.replace(/_/g, " ")})
                  </option>
                ))}
              </Select>
            )}
          </div>

          <div>
            <Label htmlFor={`medication-${enrolment.id}`}>Patient&apos;s own medication</Label>
            {medications.isLoading ? (
              <p className="mt-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>
            ) : (medications.data ?? []).length === 0 ? (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                No self-supplied medication on file for this patient yet. Tarragon supervises
                medication the patient obtained themselves — record it on their medication list
                first.
              </p>
            ) : (
              <Select
                id={`medication-${enrolment.id}`}
                value={medicationId}
                onChange={(e) => setMedicationId(e.target.value)}
                className="mt-1"
              >
                <option value="">Select a medication…</option>
                {(medications.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.drug_name}
                    {m.dose ? ` (${m.dose})` : ""}
                    {m.prescriber_name ? ` — prescribed by ${m.prescriber_name}` : " — no prescriber recorded"}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <div>
            <Label htmlFor={`notes-${enrolment.id}`}>Notes (optional)</Label>
            <Textarea
              id={`notes-${enrolment.id}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Suitability, contraindications, anything the next reviewer should know"
              className="mt-1"
              rows={2}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={!canSubmit || confirm.isPending}
              onClick={() =>
                confirm.mutate(
                  {
                    enrolmentId: enrolment.id,
                    obesityAssessmentId,
                    medicationId,
                    notes,
                  },
                  { onSuccess: () => setOpen(false) }
                )
              }
            >
              {confirm.isPending ? "Confirming…" : "Confirm eligibility & start supervision"}
            </Button>
          </div>
          {confirm.isError ? (
            <p className="text-xs text-red-600 dark:text-red-400">{(confirm.error as Error).message}</p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function WeightManagementEligibilityQueue() {
  const { data, isLoading, isError } = usePendingEligibility();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Awaiting eligibility confirmation</CardTitle>
        <CardDescription>
          Patients who have paid for supervised weight management, oldest first. Nothing happens
          for them clinically until a doctor confirms they are a suitable candidate against an
          obesity assessment and links their own medication.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600 dark:text-red-400">Could not load the queue.</p>
        )}
        {!isLoading && !isError && (data ?? []).length === 0 && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            Nothing waiting on an eligibility decision.
          </p>
        )}
        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {(data ?? []).map((enrolment) => (
            <EnrolmentRow key={enrolment.id} enrolment={enrolment} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
