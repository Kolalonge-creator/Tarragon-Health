"use client";

import { useState } from "react";
import {
  useMyAvailabilityRules,
  useCreateAvailabilityRule,
  useDeleteAvailabilityRule,
  useMyTimeOff,
  useCreateProviderTimeOff,
  type AppointmentType,
} from "@/lib/queries/appointments";
import { APPOINTMENT_TYPE_LABELS } from "@/app/(dashboard)/patient/appointments/appointment-labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * A provider's recurring weekly availability ("every Monday 9-1", 10.4/10.9)
 * plus leave/blocked time (10.5/10.10) — separate from and additive to the
 * existing one-off video-visit slot publisher at /clinician/availability.
 */
export function AvailabilityRulesManager({
  organisationId,
  clinicianId,
}: {
  organisationId: string;
  clinicianId: string;
}) {
  const { data: rules, isLoading: rulesLoading } = useMyAvailabilityRules(clinicianId);
  const createRule = useCreateAvailabilityRule();
  const deleteRule = useDeleteAvailabilityRule();
  const { data: timeOff, isLoading: timeOffLoading } = useMyTimeOff(clinicianId);
  const createTimeOff = useCreateProviderTimeOff();

  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("13:00");
  const [consultationMethod, setConsultationMethod] = useState<"telemedicine" | "in_person">("telemedicine");
  const [appointmentType, setAppointmentType] = useState<AppointmentType>("gp");
  const [slotDuration, setSlotDuration] = useState(30);
  const [buffer, setBuffer] = useState(0);
  const [ruleError, setRuleError] = useState<string | null>(null);

  const [leaveKind, setLeaveKind] = useState<"leave" | "blocked">("leave");
  const [leaveStart, setLeaveStart] = useState("");
  const [leaveEnd, setLeaveEnd] = useState("");
  const [leaveReason, setLeaveReason] = useState("");
  const [leaveError, setLeaveError] = useState<string | null>(null);

  async function handleCreateRule() {
    setRuleError(null);
    try {
      await createRule.mutateAsync({
        organisationId,
        clinicianId,
        dayOfWeek,
        startTime,
        endTime,
        consultationMethod,
        appointmentTypes: [appointmentType],
        slotDurationMinutes: slotDuration,
        bufferMinutes: buffer,
      });
    } catch (e) {
      setRuleError((e as Error).message || "Could not create that availability window.");
    }
  }

  async function handleCreateTimeOff() {
    setLeaveError(null);
    if (!leaveStart || !leaveEnd) return;
    try {
      await createTimeOff.mutateAsync({
        organisationId,
        clinicianId,
        kind: leaveKind,
        startsAt: new Date(leaveStart).toISOString(),
        endsAt: new Date(leaveEnd).toISOString(),
        reason: leaveReason || undefined,
      });
      setLeaveStart("");
      setLeaveEnd("");
      setLeaveReason("");
    } catch (e) {
      setLeaveError((e as Error).message || "Could not save that time off.");
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Recurring availability</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-charcoal-ink/60">
            Define a weekly window once. The engine generates bookable slots automatically, netting out
            your leave/blocked time and existing bookings.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="rule-day">Day</Label>
              <Select id="rule-day" value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}>
                {DAY_LABELS.map((label, index) => (
                  <option key={label} value={index}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="rule-start">Start</Label>
              <Input id="rule-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rule-end">End</Label>
              <Input id="rule-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rule-method">Method</Label>
              <Select
                id="rule-method"
                value={consultationMethod}
                onChange={(e) => setConsultationMethod(e.target.value as "telemedicine" | "in_person")}
              >
                <option value="telemedicine">Telemedicine</option>
                <option value="in_person">In person</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="rule-type">Appointment type</Label>
              <Select id="rule-type" value={appointmentType} onChange={(e) => setAppointmentType(e.target.value as AppointmentType)}>
                {Object.entries(APPOINTMENT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="rule-duration">Duration (min)</Label>
              <Input
                id="rule-duration"
                type="number"
                min={5}
                max={240}
                value={slotDuration}
                onChange={(e) => setSlotDuration(Number(e.target.value))}
                className="w-24"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rule-buffer">Buffer (min)</Label>
              <Input
                id="rule-buffer"
                type="number"
                min={0}
                max={120}
                value={buffer}
                onChange={(e) => setBuffer(Number(e.target.value))}
                className="w-24"
              />
            </div>
            <Button disabled={createRule.isPending} onClick={handleCreateRule}>
              {createRule.isPending ? "Saving…" : "Add window"}
            </Button>
          </div>
          {ruleError && <p className="text-sm text-red-600">{ruleError}</p>}

          {rulesLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {rules && rules.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No recurring availability defined yet.</p>
          )}
          {rules && rules.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {rules.map((rule) => (
                <li key={rule.id} className="flex flex-wrap items-center gap-2 py-2">
                  <p className="text-sm text-charcoal-ink">
                    {DAY_LABELS[rule.day_of_week]} {rule.start_time.slice(0, 5)}–{rule.end_time.slice(0, 5)} ·{" "}
                    {rule.consultation_method === "telemedicine" ? "Telemedicine" : "In person"} ·{" "}
                    {rule.appointment_types.map((t) => APPOINTMENT_TYPE_LABELS[t] ?? t).join(", ")}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    disabled={deleteRule.isPending}
                    onClick={() => deleteRule.mutate(rule.id)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Leave &amp; blocked time</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-charcoal-ink/60">
            Any already-booked appointment this overlaps is cancelled automatically, the patient is
            notified, and they&apos;re placed on the waiting list for a replacement slot.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="leave-kind">Type</Label>
              <Select id="leave-kind" value={leaveKind} onChange={(e) => setLeaveKind(e.target.value as "leave" | "blocked")}>
                <option value="leave">Leave</option>
                <option value="blocked">Blocked time</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="leave-start">From</Label>
              <Input id="leave-start" type="datetime-local" value={leaveStart} onChange={(e) => setLeaveStart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="leave-end">Until</Label>
              <Input id="leave-end" type="datetime-local" value={leaveEnd} onChange={(e) => setLeaveEnd(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="leave-reason">Reason (optional)</Label>
              <Input id="leave-reason" value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} />
            </div>
            <Button disabled={!leaveStart || !leaveEnd || createTimeOff.isPending} onClick={handleCreateTimeOff}>
              {createTimeOff.isPending ? "Saving…" : "Add"}
            </Button>
          </div>
          {leaveError && <p className="text-sm text-red-600">{leaveError}</p>}

          {timeOffLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {timeOff && timeOff.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No upcoming leave or blocked time.</p>
          )}
          {timeOff && timeOff.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {timeOff.map((row) => (
                <li key={row.id} className="py-2 text-sm text-charcoal-ink">
                  {row.kind === "leave" ? "Leave" : "Blocked"}:{" "}
                  {new Date(row.starts_at).toLocaleString()} – {new Date(row.ends_at).toLocaleString()}
                  {row.reason ? ` (${row.reason})` : ""}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
