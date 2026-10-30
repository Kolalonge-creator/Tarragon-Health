"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatLagos, visibleOfferSlots } from "@/lib/followups/followups";
import { getMonthlyMeeting, pickMonthlySlot } from "./actions";

/**
 * A Member's monthly meeting is included in Membership and is booked from times the patient's doctor has offered (the same times the
 * patient sees in their own app). The coordinator picks one for the patient on the call. Nothing is paid for it. A Free patient has no
 * monthly meeting, and says so rather than showing an empty list.
 */
export function MonthlyMeeting({ patientId, patientName, isMember }: { patientId: string; patientName: string; isMember: boolean }) {
  const queryClient = useQueryClient();
  const key = ["care-coordinator", "monthly-meeting", patientId] as const;
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: key,
    enabled: isMember,
    queryFn: async () => {
      const r = await getMonthlyMeeting(patientId);
      if ("error" in r) throw new Error(r.error);
      return r.meeting;
    },
  });

  async function pick(slotId: string) {
    setBusySlot(slotId);
    setResult(null);
    const r = await pickMonthlySlot(slotId);
    setBusySlot(null);
    setResult("error" in r ? { tone: "error", text: r.error } : { tone: "success", text: r.message });
    await queryClient.invalidateQueries({ queryKey: key });
  }

  if (!isMember) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Monthly meeting</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            The monthly meeting is part of Membership. {patientName} is on the Free plan and needs to join Membership first.
          </p>
        </CardContent>
      </Card>
    );
  }

  const current = data?.entitlement?.current ?? null;
  const offers = (data?.offers ?? []).map((o) => ({ ...o, slots: visibleOfferSlots(o, new Date()) })).filter((o) => o.slots.length > 0);
  const alreadyBooked = current?.state === "booked";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Monthly meeting (included in Membership)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Looking for offered times…</p>}
        {alreadyBooked && (
          <p role="status" className="text-sm text-charcoal-ink dark:text-night-ink">
            This month&apos;s meeting for {patientName} is already booked. It is under their appointments.
          </p>
        )}
        {isError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            Could not load {patientName}&apos;s monthly meeting. Do not tell them there are no times: reload the page and try again before booking
            an extra meeting.
          </p>
        )}
        {!isLoading && !isError && !alreadyBooked && offers.length === 0 && (
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            No times have been offered yet for {patientName}. Their doctor offers the times, and they appear here as soon as they do. For a meeting
            now, book an extra meeting below (₦5,000).
          </p>
        )}
        {!alreadyBooked &&
          offers.map((offer) => (
            <div key={offer.offer_id} className="space-y-2">
              <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                {offer.call_minutes} minute meeting. These times are held for {patientName} until{" "}
                {formatLagos(offer.expires_at)}.
              </p>
              <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
                {offer.slots.map((slot) => (
                  <li key={slot.slot_id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="text-sm text-charcoal-ink dark:text-night-ink">{formatLagos(slot.starts_at)}</span>
                    <Button size="sm" className="ml-auto" disabled={busySlot !== null} onClick={() => pick(slot.slot_id)}>
                      {busySlot === slot.slot_id ? "Booking…" : "Book this time"}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        {result && (
          <p
            role={result.tone === "error" ? "alert" : "status"}
            className={`text-sm ${result.tone === "success" ? "text-brand-green dark:text-brand-green-bright" : "text-red-600 dark:text-red-400"}`}
          >
            {result.text}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
