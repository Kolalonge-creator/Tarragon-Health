"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { createImagingOrder } from "@/lib/imaging-orders/actions";
import { useImagingCatalogue } from "@/lib/queries/imaging";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * A clinician orders an imaging investigation for a patient (spec §59.4).
 * DB-level authority (private.has_imaging_ordering_authority) is the real
 * gate — a Care Coordinator viewing this page would have their submission
 * refused server-side with a friendly message, not hidden here, since
 * whether the viewer has ordering authority isn't known until the server
 * action checks their active clinical_staff record.
 */
export function OrderImagingForm({ patientId }: { patientId: string }) {
  const router = useRouter();
  const fieldId = useId();
  const { data: studies, isLoading } = useImagingCatalogue();
  const [studyId, setStudyId] = useState("");
  const [urgency, setUrgency] = useState<"routine" | "urgent" | "emergency">("routine");
  const [indication, setIndication] = useState("");
  const [clinicalInformation, setClinicalInformation] = useState("");
  const [success, setSuccess] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      const result = await createImagingOrder({
        patient_id: patientId,
        study_id: studyId,
        urgency,
        indication,
        clinical_information: clinicalInformation || undefined,
      });
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      setSuccess("Imaging order created.");
      setStudyId("");
      setIndication("");
      setClinicalInformation("");
      router.refresh();
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(null);
    submit.mutate();
  }

  const displayError = (submit.error as Error | null)?.message ?? null;

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded border border-charcoal-ink/10 p-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-study`} className="text-xs">
          Investigation
        </Label>
        {isLoading ? (
          <p className="text-xs text-charcoal-ink/50">Loading catalogue…</p>
        ) : !studies || studies.length === 0 ? (
          <p className="text-xs text-charcoal-ink/50">
            No imaging studies in the catalogue yet. Ask an admin to add one.
          </p>
        ) : (
          <Select
            id={`${fieldId}-study`}
            value={studyId}
            onChange={(event) => setStudyId(event.target.value)}
            required
          >
            <option value="">Select an investigation</option>
            {studies.map((study) => (
              <option key={study.id} value={study.id}>
                {study.name} ({study.modality})
              </option>
            ))}
          </Select>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-urgency`} className="text-xs">
          Urgency
        </Label>
        <Select
          id={`${fieldId}-urgency`}
          value={urgency}
          onChange={(event) => setUrgency(event.target.value as typeof urgency)}
        >
          <option value="routine">Routine</option>
          <option value="urgent">Urgent</option>
          <option value="emergency">Emergency</option>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-indication`} className="text-xs">
          Indication
        </Label>
        <Textarea
          id={`${fieldId}-indication`}
          value={indication}
          onChange={(event) => setIndication(event.target.value)}
          placeholder="Why is this investigation being ordered?"
          required
          rows={2}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-clinical-info`} className="text-xs">
          Relevant clinical information (optional)
        </Label>
        <Textarea
          id={`${fieldId}-clinical-info`}
          value={clinicalInformation}
          onChange={(event) => setClinicalInformation(event.target.value)}
          placeholder="Anything the reporting radiologist should know"
          rows={2}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={!studyId || !indication.trim() || submit.isPending}>
          {submit.isPending ? "Ordering…" : "Order imaging"}
        </Button>
        {success && <p className="text-xs font-medium text-brand-green">{success}</p>}
        {displayError && <p className="text-xs text-red-600">{displayError}</p>}
      </div>
    </form>
  );
}
