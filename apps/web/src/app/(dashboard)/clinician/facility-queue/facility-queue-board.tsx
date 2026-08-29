"use client";

import { useState, type FormEvent } from "react";
import {
  useAppointmentFacilities,
  useFacilityUpcomingToday,
  useFacilityQueueToday,
  useFacilityCapacityToday,
  useAdvanceAppointmentStatus,
} from "@/lib/queries/appointments";
import { APPOINTMENT_TYPE_LABELS } from "@/app/(dashboard)/patient/appointments/appointment-labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** 69.7 check-in (QR/barcode scan, app, or reception), 69.8 queue
 * (checked-in/waiting -> called -> in progress -> completed), 69.9 late
 * arrival, 69.12 today's capacity — all for one facility at a time, since a
 * front desk works one physical location. */
export function FacilityQueueBoard() {
  const { data: facilities } = useAppointmentFacilities();
  const [facilityId, setFacilityId] = useState("");
  const [scanCode, setScanCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const upcoming = useFacilityUpcomingToday(facilityId);
  const queue = useFacilityQueueToday(facilityId);
  const capacity = useFacilityCapacityToday(facilityId);
  const advance = useAdvanceAppointmentStatus();

  async function checkIn(appointmentId: string) {
    setError(null);
    try {
      await advance.mutateAsync({ appointmentId, to: "checked_in" });
    } catch (e) {
      setError((e as Error).message || "Could not check in that appointment.");
    }
  }

  async function handleScan(event: FormEvent) {
    event.preventDefault();
    const code = scanCode.trim();
    if (!code) return;
    await checkIn(code);
    setScanCode("");
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="space-y-1.5">
            <Label htmlFor="facility-queue-select">Facility</Label>
            <Select id="facility-queue-select" value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
              <option value="">Select a facility…</option>
              {(facilities ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} — {f.city}, {f.state}
                </option>
              ))}
            </Select>
          </div>
          {facilityId && (
            <form onSubmit={handleScan} className="flex items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="facility-queue-scan">Scan QR / barcode, or enter appointment code</Label>
                <Input
                  id="facility-queue-scan"
                  autoFocus
                  value={scanCode}
                  onChange={(e) => setScanCode(e.target.value)}
                  placeholder="Scan here…"
                  className="w-72"
                />
              </div>
              <Button type="submit" disabled={!scanCode.trim() || advance.isPending}>
                Check in
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {facilityId && capacity.data && (
        <Card>
          <CardHeader>
            <CardTitle>Today</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {(
                [
                  ["Available slots", capacity.data.available_slots],
                  ["Booked", capacity.data.booked],
                  ["Cancelled", capacity.data.cancelled],
                  ["No-show", capacity.data.no_show],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-charcoal-ink/60">{label}</dt>
                  <dd className="text-2xl font-semibold text-charcoal-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}

      {facilityId && (
        <Card>
          <CardHeader>
            <CardTitle>Waiting room</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {queue.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
            {queue.data && queue.data.length === 0 && (
              <p className="text-sm text-charcoal-ink/60">Nobody checked in yet.</p>
            )}
            {queue.data && queue.data.length > 0 && (
              <ul className="divide-y divide-charcoal-ink/10">
                {queue.data.map((entry) => (
                  <li key={entry.appointment_id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="w-6 text-sm font-semibold text-charcoal-ink/60">{entry.queue_position}</span>
                    <div>
                      <p className="text-sm text-charcoal-ink">
                        {entry.patient_name ?? "Patient"}
                        {entry.patient_number ? ` (${entry.patient_number})` : ""}
                      </p>
                      <p className="text-xs text-charcoal-ink/60">
                        {APPOINTMENT_TYPE_LABELS[entry.appointment_type] ?? entry.appointment_type} ·{" "}
                        {entry.clinician_name ?? "Unassigned"} · scheduled {formatTime(entry.scheduled_for)}
                      </p>
                    </div>
                    {entry.is_high_priority && <Badge variant="red">Priority</Badge>}
                    {entry.is_late_arrival && <Badge variant="amber">Arrived late</Badge>}
                    <Badge variant={entry.status === "called" ? "blue" : "grey"}>
                      {entry.status === "called" ? "Called" : "Waiting"}
                    </Badge>
                    <div className="ml-auto flex gap-2">
                      {entry.status === "checked_in" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={advance.isPending}
                          onClick={() => advance.mutate({ appointmentId: entry.appointment_id, to: "called" })}
                        >
                          Call
                        </Button>
                      )}
                      <Button
                        size="sm"
                        disabled={advance.isPending}
                        onClick={() => advance.mutate({ appointmentId: entry.appointment_id, to: "in_progress" })}
                      >
                        Start
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {facilityId && (
        <Card>
          <CardHeader>
            <CardTitle>Today&apos;s remaining appointments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {upcoming.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
            {upcoming.data && upcoming.data.length === 0 && (
              <p className="text-sm text-charcoal-ink/60">Nothing else booked today.</p>
            )}
            {upcoming.data && upcoming.data.length > 0 && (
              <ul className="divide-y divide-charcoal-ink/10">
                {upcoming.data.map((appt) => (
                  <li key={appt.id} className="flex flex-wrap items-center gap-2 py-2">
                    <div>
                      <p className="text-sm text-charcoal-ink">
                        {appt.patient?.full_name ?? "Patient"}
                        {appt.patient?.patient_number ? ` (${appt.patient.patient_number})` : ""}
                      </p>
                      <p className="text-xs text-charcoal-ink/60">
                        {APPOINTMENT_TYPE_LABELS[appt.appointment_type] ?? appt.appointment_type} ·{" "}
                        {formatTime(appt.scheduled_for)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      disabled={advance.isPending}
                      onClick={() => checkIn(appt.id)}
                    >
                      Check in
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
