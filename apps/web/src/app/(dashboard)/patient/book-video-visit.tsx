"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useOpenConsultSlots,
  useUpcomingVideoVisits,
  consultSlotKeys,
} from "@/lib/queries/consult-slots";
import { bookVideoVisit, type BookVideoVisitState } from "./video-visit-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function formatSlot(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Self-serve video-visit slot picker — the One Medical "book like a
 * restaurant" grid, generalised from the annual-review propose/confirm
 * handshake. Renders nothing when no doctor has published availability
 * (null-gated: no fake openings, ever).
 */
export function BookVideoVisit({ patientId }: { patientId: string }) {
  const { data: slots } = useOpenConsultSlots();
  const { data: upcoming } = useUpcomingVideoVisits(patientId);
  const queryClient = useQueryClient();
  const [result, setResult] = useState<BookVideoVisitState>(undefined);
  const [isPending, startTransition] = useTransition();

  const hasSlots = (slots ?? []).length > 0;
  const hasUpcoming = (upcoming ?? []).length > 0;
  if (!hasSlots && !hasUpcoming) return null;

  const book = (slotId: string) => {
    startTransition(async () => {
      const res = await bookVideoVisit(slotId);
      setResult(res);
      queryClient.invalidateQueries({ queryKey: consultSlotKeys.open });
      queryClient.invalidateQueries({ queryKey: consultSlotKeys.upcoming(patientId) });
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Book a video check-in</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasUpcoming && (
          <div className="space-y-1">
            {(upcoming ?? []).map((visit) => (
              <p key={visit.id} className="text-sm text-charcoal-ink">
                Booked: <span className="font-medium">{visit.scheduled_at ? formatSlot(visit.scheduled_at) : "time TBC"}</span>
                {visit.join_url && (
                  <>
                    {" "}
                    ·{" "}
                    <a
                      href={visit.join_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-green hover:underline"
                    >
                      Join link
                    </a>
                  </>
                )}
              </p>
            ))}
          </div>
        )}
        {hasSlots && (
          <>
            <p className="text-sm text-charcoal-ink/70">
              Pick a time that suits you — a doctor on your care team holds these openings
              for video check-ins.
            </p>
            <div className="flex flex-wrap gap-2">
              {(slots ?? []).map((slot) => (
                <Button
                  key={slot.id}
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => book(slot.id)}
                >
                  {formatSlot(slot.slot_start)}
                  {slot.clinician?.full_name ? ` · Dr. ${slot.clinician.full_name}` : ""}
                </Button>
              ))}
            </div>
          </>
        )}
        {result && "error" in result && (
          <p className="text-sm text-red-600">{result.error}</p>
        )}
        {result && "success" in result && (
          <p className="text-sm text-brand-green">
            Booked for {formatSlot(result.scheduledAt)}.
            {result.hasLink
              ? " Your join link is above."
              : " You'll get the join link before the call."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
