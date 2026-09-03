"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  useAvailableSpecialistSlots,
  useConsultationDurationDefaults,
  useCreateSpecialistProviderAvailabilityRule,
  useCreateSpecialistProviderTimeOff,
  useDeleteSpecialistProviderAvailabilityRule,
  useDeleteSpecialistProviderTimeOff,
  useSpecialistProviderAvailabilityRules,
  useSpecialistProviderLocations,
  useSpecialistProviderTimeOff,
  type ConsultationMethod,
} from "@/lib/queries/specialist-provider-network";
import type { ConsultationDurationType } from "@tarragon/shared";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * 66.5/66.6 — specialist availability & calendar. Admin-entered on the
 * specialist's behalf (specialist_providers rows have no login, see the
 * availability migration's header note), reusing the Appointment Engine's
 * table shape (rules + time off) rather than a bespoke design, so a future
 * move to real specialist self-service is a data migration, not a redesign.
 */
export function SpecialistCalendarManager({ specialistProviderId }: { specialistProviderId: string }) {
  const [open, setOpen] = useState(false);
  const { data: rules, isLoading: rulesLoading } = useSpecialistProviderAvailabilityRules(
    open ? specialistProviderId : ""
  );
  const { data: timeOff } = useSpecialistProviderTimeOff(open ? specialistProviderId : "");
  const { data: locations } = useSpecialistProviderLocations(open ? specialistProviderId : "");
  const { data: durationDefaults } = useConsultationDurationDefaults();
  const createRule = useCreateSpecialistProviderAvailabilityRule();
  const deleteRule = useDeleteSpecialistProviderAvailabilityRule();
  const createTimeOff = useCreateSpecialistProviderTimeOff();
  const deleteTimeOff = useDeleteSpecialistProviderTimeOff();

  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [weekAhead] = useState(() => new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const { data: slots } = useAvailableSpecialistSlots(open ? specialistProviderId : "", today, weekAhead);

  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("12:00");
  const [method, setMethod] = useState<ConsultationMethod>("telemedicine");
  const [durationType, setDurationType] = useState<ConsultationDurationType>("standard");
  const [slotMinutes, setSlotMinutes] = useState("20");
  const [bufferMinutes, setBufferMinutes] = useState("0");
  const [locationId, setLocationId] = useState("");

  const [toKind, setToKind] = useState<"leave" | "blocked" | "emergency_unavailable">("leave");
  const [toStart, setToStart] = useState("");
  const [toEnd, setToEnd] = useState("");
  const [toReason, setToReason] = useState("");

  const defaultMinutesFor = useMemo(
    () => (m: ConsultationMethod, d: ConsultationDurationType) =>
      (durationDefaults ?? []).find((row) => row.consultation_method === m && row.duration_type === d)
        ?.default_minutes ?? null,
    [durationDefaults]
  );

  const slotsByDay = useMemo(() => {
    const grouped = new Map<string, typeof slots>();
    for (const slot of slots ?? []) {
      const day = new Date(slot.slot_start).toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
      grouped.set(day, [...(grouped.get(day) ?? []), slot]);
    }
    return grouped;
  }, [slots]);

  if (!open) {
    return (
      <button type="button" className="text-xs text-charcoal-ink/60 underline" onClick={() => setOpen(true)}>
        Manage calendar
      </button>
    );
  }

  return (
    <div className="space-y-4 rounded-md border border-charcoal-ink/10 bg-warm-ivory p-3">
      <button type="button" className="text-xs text-charcoal-ink/60 underline" onClick={() => setOpen(false)}>
        Hide calendar
      </button>

      <div className="space-y-1">
        <p className="text-xs font-medium text-charcoal-ink/70">Working hours</p>
        {rulesLoading ? (
          <p className="text-xs text-charcoal-ink/60">Loading…</p>
        ) : (rules ?? []).length === 0 ? (
          <p className="text-xs text-charcoal-ink/60">No recurring availability set yet.</p>
        ) : (
          <ul className="space-y-1">
            {(rules ?? []).map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-charcoal-ink/10 p-2 text-xs">
                <span>
                  {DAY_LABELS[rule.day_of_week]} {rule.start_time.slice(0, 5)}–{rule.end_time.slice(0, 5)} ·{" "}
                  {rule.consultation_method === "telemedicine" ? "Telemedicine" : "Physical"} ·{" "}
                  {rule.slot_duration_minutes}min slots ({rule.duration_type})
                  {!rule.is_active && <Badge variant="grey">Inactive</Badge>}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={deleteRule.isPending}
                  onClick={() => deleteRule.mutate({ id: rule.id, specialistProviderId })}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="grid gap-2 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            createRule.mutate({
              specialistProviderId,
              specialistProviderLocationId: locationId || null,
              dayOfWeek: Number(dayOfWeek),
              startTime,
              endTime,
              consultationMethod: method,
              durationType,
              slotDurationMinutes: Number(slotMinutes),
              bufferMinutes: Number(bufferMinutes),
            });
          }}
        >
          <div className="space-y-1">
            <Label>Day</Label>
            <Select value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)}>
              {DAY_LABELS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Start</Label>
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>End</Label>
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Method</Label>
            <Select value={method} onChange={(e) => setMethod(e.target.value as ConsultationMethod)}>
              <option value="telemedicine">Telemedicine</option>
              <option value="in_person">Physical</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Consultation type</Label>
            <Select
              value={durationType}
              onChange={(e) => {
                const next = e.target.value as ConsultationDurationType;
                setDurationType(next);
                const def = defaultMinutesFor(method, next);
                if (def) setSlotMinutes(String(def));
              }}
            >
              <option value="standard">Standard</option>
              <option value="extended">Extended</option>
              {method === "telemedicine" && <option value="follow_up">Follow-up</option>}
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Slot length (min)</Label>
            <Input type="number" min="1" value={slotMinutes} onChange={(e) => setSlotMinutes(e.target.value)} />
            <p className="text-[10px] text-charcoal-ink/40">
              Platform default: {defaultMinutesFor(method, durationType) ?? "—"}min. Changing this is the
              governed exception (66.7).
            </p>
          </div>
          <div className="space-y-1">
            <Label>Buffer (min)</Label>
            <Input type="number" min="0" value={bufferMinutes} onChange={(e) => setBufferMinutes(e.target.value)} />
          </div>
          {(locations ?? []).length > 0 && (
            <div className="space-y-1">
              <Label>Location</Label>
              <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Any / not set</option>
                {(locations ?? []).map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="flex items-end sm:col-span-3">
            <Button type="submit" size="sm" disabled={createRule.isPending}>
              {createRule.isPending ? "Saving…" : "Add working hours"}
            </Button>
          </div>
        </form>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium text-charcoal-ink/70">Leave / blocked / unavailable</p>
        {(timeOff ?? []).length === 0 ? (
          <p className="text-xs text-charcoal-ink/60">Nothing recorded.</p>
        ) : (
          <ul className="space-y-1">
            {(timeOff ?? []).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-charcoal-ink/10 p-2 text-xs">
                <span>
                  <Badge variant={t.kind === "emergency_unavailable" ? "red" : "amber"}>{t.kind.replace(/_/g, " ")}</Badge>{" "}
                  {new Date(t.starts_at).toLocaleString()} – {new Date(t.ends_at).toLocaleString()}
                  {t.reason ? ` (${t.reason})` : ""}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={deleteTimeOff.isPending}
                  onClick={() => deleteTimeOff.mutate({ id: t.id, specialistProviderId })}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="grid gap-2 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!toStart || !toEnd) return;
            createTimeOff.mutate(
              {
                specialistProviderId,
                kind: toKind,
                startsAt: new Date(toStart).toISOString(),
                endsAt: new Date(toEnd).toISOString(),
                reason: toReason.trim() || null,
              },
              { onSuccess: () => { setToStart(""); setToEnd(""); setToReason(""); } }
            );
          }}
        >
          <div className="space-y-1">
            <Label>Kind</Label>
            <Select value={toKind} onChange={(e) => setToKind(e.target.value as typeof toKind)}>
              <option value="leave">Leave</option>
              <option value="blocked">Blocked</option>
              <option value="emergency_unavailable">Emergency / unavailable</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>From</Label>
            <Input type="datetime-local" value={toStart} onChange={(e) => setToStart(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label>To</Label>
            <Input type="datetime-local" value={toEnd} onChange={(e) => setToEnd(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label>Reason (optional)</Label>
            <Input value={toReason} onChange={(e) => setToReason(e.target.value)} />
          </div>
          <div className="sm:col-span-4">
            <Button type="submit" size="sm" disabled={createTimeOff.isPending}>
              {createTimeOff.isPending ? "Saving…" : "Add"}
            </Button>
          </div>
        </form>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium text-charcoal-ink/70">Next 7 days</p>
        {slotsByDay.size === 0 ? (
          <p className="text-xs text-charcoal-ink/60">No open slots in the next week.</p>
        ) : (
          <div className="space-y-2">
            {[...slotsByDay.entries()].map(([day, daySlots]) => (
              <div key={day}>
                <p className="text-xs font-medium text-charcoal-ink/60">{day}</p>
                <div className="flex flex-wrap gap-1">
                  {(daySlots ?? []).map((slot, i) => (
                    <Badge key={i} variant={slot.consultation_method === "telemedicine" ? "blue" : "grey"}>
                      {new Date(slot.slot_start).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
