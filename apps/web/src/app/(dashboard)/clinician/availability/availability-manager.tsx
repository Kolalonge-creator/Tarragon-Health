"use client";

import { useState } from "react";
import {
  useMyConsultSlots,
  usePublishConsultSlot,
  useDeleteConsultSlot,
} from "@/lib/queries/consult-slots";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Every video visit is a fixed 15-minute telemedicine consultation — not a
 * clinician-selectable length (founder decision, 2026-07-24). */
const SLOT_DURATION_MINUTES = 15;

/**
 * Clinician publishes open video check-in slots that any patient in the org
 * can self-book (the annual-review propose/confirm handshake, opened up).
 * Booked slots can't be deleted here — cancelling a confirmed patient time is
 * a conversation, not a row delete.
 */
export function AvailabilityManager({ organisationId }: { organisationId: string }) {
  const { data: slots, isLoading } = useMyConsultSlots();
  const publish = usePublishConsultSlot();
  const remove = useDeleteConsultSlot();
  const [slotStart, setSlotStart] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle>My video check-in availability</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-charcoal-ink/60">
          Openings you publish here appear on every patient&apos;s dashboard as bookable,
          15-minute telemedicine video consultations.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="slot-start">Date &amp; time</Label>
            <Input
              id="slot-start"
              type="datetime-local"
              value={slotStart}
              onChange={(e) => setSlotStart(e.target.value)}
            />
          </div>
          <Button
            disabled={!slotStart || publish.isPending}
            onClick={() =>
              publish.mutate(
                {
                  organisationId,
                  slotStart,
                  durationMinutes: SLOT_DURATION_MINUTES,
                },
                { onSuccess: () => setSlotStart("") }
              )
            }
          >
            {publish.isPending ? "Publishing…" : "Publish 15-minute slot"}
          </Button>
        </div>
        {publish.isError && (
          <p className="text-sm text-red-600">
            {(publish.error as Error).message || "Could not publish that slot."}
          </p>
        )}
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {slots && slots.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No upcoming slots published yet.</p>
        )}
        {slots && slots.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {slots.map((slot) => (
              <li key={slot.id} className="flex items-center gap-2 py-2">
                <p className="text-sm text-charcoal-ink">
                  {new Date(slot.slot_start).toLocaleString(undefined, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
                {slot.booked_consultation_id ? (
                  <Badge variant="green">Booked</Badge>
                ) : (
                  <>
                    <Badge variant="grey">Open</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(slot.id)}
                    >
                      Remove
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
