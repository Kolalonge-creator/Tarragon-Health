"use client";

import { useState } from "react";
import { FacilitySelector, type PatientLocation } from "./facility-selector";
import type { FacilityWithServices } from "@/lib/queries/facilities";
import { useRequestLabOrderPartnerVisit } from "@/lib/queries/lab-orders";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { Database } from "@tarragon/shared";

type TimeOfDay = Database["public"]["Enums"]["lab_order_time_of_day"];

const TIME_OF_DAY_OPTIONS: { value: TimeOfDay; label: string }[] = [
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
];

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * An opt-in upgrade for a self-arranged order, not a required step — the
 * default "take this to any lab you like" path above still works with zero
 * partners on file. `FacilitySelector` naturally shows its own "no
 * facilities match yet" empty state (its default `emptyText`) when there
 * are no `is_active` lab facilities in range, which today is every lab
 * facility everywhere — so this is fully wired, but genuinely inert, until
 * a real lab's `facilities.is_active` flips to true. No fabricated
 * real-time slot grid: a preferred date + a coarse time-of-day only, the
 * facility confirms the real time manually (see the migration's own
 * reasoning, 20260820055147).
 */
export function RequestPartnerLabVisit({
  patientId,
  orderId,
  patientLocation,
}: {
  patientId: string;
  orderId: string;
  patientLocation?: PatientLocation | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [facility, setFacility] = useState<FacilityWithServices | null>(null);
  const [scheduledDate, setScheduledDate] = useState(todayIsoDate());
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>("morning");
  const [confirmed, setConfirmed] = useState(false);
  const requestVisit = useRequestLabOrderPartnerVisit(patientId);

  if (confirmed) {
    return (
      <p className="text-xs text-charcoal-ink/60">
        Request sent — the lab will confirm your {timeOfDay} visit on{" "}
        {new Date(scheduledDate).toLocaleDateString()}.
      </p>
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="text-xs font-medium text-deep-forest hover:underline"
      >
        Prefer to book at a specific lab instead?
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-charcoal-ink/10 bg-warm-ivory/50 p-3">
      <FacilitySelector
        type="lab"
        patientLocation={patientLocation}
        selectedFacilityId={facility?.id ?? null}
        onSelect={setFacility}
        idPrefix={`partner-lab-${orderId}`}
      />
      {facility && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`visit-date-${orderId}`}>Preferred date</Label>
            <input
              id={`visit-date-${orderId}`}
              type="date"
              min={todayIsoDate()}
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="flex h-10 w-full rounded-md border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`visit-time-${orderId}`}>Preferred time</Label>
            <Select
              id={`visit-time-${orderId}`}
              value={timeOfDay}
              onChange={(e) => setTimeOfDay(e.target.value as TimeOfDay)}
            >
              {TIME_OF_DAY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      )}
      {requestVisit.isError && (
        <p className="text-xs text-red-600">
          Could not set that up just now. Please try again.
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!facility || requestVisit.isPending}
          onClick={() =>
            requestVisit.mutate(
              { orderId, facilityId: facility!.id, scheduledDate, preferredTimeOfDay: timeOfDay },
              { onSuccess: () => setConfirmed(true) }
            )
          }
        >
          {requestVisit.isPending ? "Sending…" : "Request this visit"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setExpanded(false)}>
          Never mind
        </Button>
      </div>
    </div>
  );
}
