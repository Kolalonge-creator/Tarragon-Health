"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPatientDateTime } from "@/lib/format-date";
import { retryConfirm } from "./actions";

type PhoneBooking = {
  id: string;
  scheduled_for: string;
  status: string;
  hold_expires_at: string | null;
  payment_confirm_error: string | null;
  patient: { full_name: string | null; phone: string | null } | null;
};

const KEY = ["care-coordinator", "phone-bookings"] as const;

/**
 * The coordinator's own phone bookings that still need something: waiting for payment (with when the slot is released), released
 * because nobody paid, or paid but not confirmed automatically (with the reason, and a retry). Without this a lost pay link, or a
 * payment whose confirmation failed, would be invisible to everyone.
 */
export function PhoneBookingsList() {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const { data: rows, error } = await supabase
        .from("appointments")
        .select("id, scheduled_for, status, hold_expires_at, payment_confirm_error, patient:profiles!appointments_patient_id_fkey(full_name, phone)")
        .eq("booked_by", user.id)
        .eq("booked_via", "coordinator_phone")
        .eq("payment_status", "pending")
        .in("status", ["booked", "expired"])
        .gte("created_at", since)
        .order("scheduled_for", { ascending: true });
      if (error) throw error;
      return rows as unknown as PhoneBooking[];
    },
    refetchInterval: 60_000,
  });

  async function retry(id: string) {
    setBusyId(id);
    setMessage(null);
    const r = await retryConfirm(id);
    setBusyId(null);
    setMessage("error" in r ? r.error : r.status === "confirmed" ? "Confirmed." : "Still waiting for payment.");
    await queryClient.invalidateQueries({ queryKey: KEY });
  }

  if (isLoading) return null;
  if (isError) {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        Could not load your phone bookings. Reload the page.
      </p>
    );
  }
  if (!data || data.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your phone bookings that need attention</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {message && (
          <p role="status" className="text-sm text-charcoal-ink dark:text-night-ink">
            {message}
          </p>
        )}
        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {data.map((b) => {
            const failed = b.payment_confirm_error !== null;
            return (
              <li key={b.id} className="flex flex-wrap items-center gap-3 py-2">
                <div>
                  <p className="text-sm text-charcoal-ink dark:text-night-ink">
                    {b.patient?.full_name ?? "Patient"}, {formatPatientDateTime(b.scheduled_for, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {b.patient?.phone && (
                      <>
                        {" "}
                        ·{" "}
                        <a className="underline" href={`tel:${b.patient.phone}`}>
                          {b.patient.phone}
                        </a>
                      </>
                    )}
                  </p>
                  <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                    {b.status === "expired"
                      ? "Released: it was not paid in time. Book again if the patient still wants it."
                      : failed
                        ? `Payment received but the booking was not confirmed: ${b.payment_confirm_error}`
                        : b.hold_expires_at
                          ? `Waiting for payment. The time is released ${formatPatientDateTime(b.hold_expires_at, { weekday: "short", hour: "2-digit", minute: "2-digit" })} if it is not paid.`
                          : "Waiting for payment."}
                  </p>
                </div>
                <Badge variant={b.status === "expired" || failed ? "red" : "amber"}>{b.status === "expired" ? "Released" : failed ? "Needs you" : "Awaiting payment"}</Badge>
                {b.status === "booked" && (
                  <Button size="sm" variant="outline" className="ml-auto" disabled={busyId === b.id} onClick={() => retry(b.id)}>
                    {busyId === b.id ? "Checking…" : "Check payment and confirm"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
