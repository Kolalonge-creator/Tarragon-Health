"use client";

import { useState, type FormEvent } from "react";
import { useCreateBookingRequest, type Facility } from "@/lib/queries/facilities";
import { bookingRequestSchema } from "@/lib/validation/booking";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function BookingRequestForm({
  patientId,
  facility,
  onDone,
}: {
  patientId: string;
  facility: Facility;
  onDone: () => void;
}) {
  const createBookingRequest = useCreateBookingRequest();

  const [serviceType, setServiceType] = useState("");
  const [requestedDate, setRequestedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = bookingRequestSchema.safeParse({
      facility_id: facility.id,
      service_type: serviceType,
      requested_date: requestedDate,
      notes: notes || undefined,
    });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setValidationError(null);
    createBookingRequest.mutate(
      { ...parsed.data, patientId },
      { onSuccess: () => onDone() }
    );
  }

  const mutationError = (createBookingRequest.error as Error | null)?.message ?? null;
  const displayError = validationError ?? mutationError;

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-md bg-charcoal-ink/5 p-3">
      <p className="text-xs text-charcoal-ink/60">
        This sends a request to {facility.name} — they&apos;ll confirm the date directly with you.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor={`service_type_${facility.id}`}>What do you need?</Label>
        <Input
          id={`service_type_${facility.id}`}
          placeholder="e.g. Blood pressure check, HbA1c test"
          value={serviceType}
          onChange={(event) => setServiceType(event.target.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`requested_date_${facility.id}`}>Preferred date</Label>
        <Input
          id={`requested_date_${facility.id}`}
          type="date"
          value={requestedDate}
          onChange={(event) => setRequestedDate(event.target.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`notes_${facility.id}`}>Notes (optional)</Label>
        <Input
          id={`notes_${facility.id}`}
          placeholder="Anything the facility should know"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>
      {displayError && <p className="text-sm text-red-600">{displayError}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={createBookingRequest.isPending}>
          {createBookingRequest.isPending ? "Sending…" : "Send request"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
