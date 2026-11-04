"use client";

import { useState } from "react";
import { activeOutreachDangerousReadingWording } from "@tarragon/i18n";
import { koboToNaira } from "@tarragon/shared";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  isOutreachDay,
  screeningDayKind,
  screeningDayReadyForAttendees,
  useActiveOutreachPrice,
  useAddScreeningDaySlot,
  useConfirmScreeningDay,
  useCreateOutreachDay,
  useEnrolOutreachAttendee,
  useFindProfileByPhone,
  useIssueScreeningDayVoucher,
  useOutreachEnrolments,
  useRecordOutreachVitals,
  useScreeningDays,
  useScreeningDaySlots,
  useSelfBookablePanelBundles,
  type OutreachKind,
  type OutreachVitals,
  type ScreeningDay,
  type ScreeningDayKind,
} from "@/lib/queries/screening-days";

const STATUS_BADGE: Record<ScreeningDay["status"], { variant: BadgeProps["variant"]; label: string }> = {
  requested: { variant: "amber", label: "Requested" },
  confirmed: { variant: "blue", label: "Confirmed" },
  completed: { variant: "green", label: "Completed" },
  cancelled: { variant: "grey", label: "Cancelled" },
};

const KIND_LABEL: Record<ScreeningDayKind, string> = {
  bundle: "Test bundle",
  outreach_free: "Free community check",
  outreach_paid: "Paid outreach check",
};

function naira(kobo: number): string {
  return `₦${koboToNaira(kobo).toLocaleString("en-NG")}`;
}

function CreateOutreachForm() {
  const create = useCreateOutreachDay();
  const { data: price } = useActiveOutreachPrice();
  const [kind, setKind] = useState<OutreachKind>("outreach_free");
  const [hostName, setHostName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [location, setLocation] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [slots, setSlots] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle>New outreach check</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(
              {
                kind,
                hostName,
                contactPhone,
                location,
                eventDate,
                slotsRequested: Number(slots),
                notes: notes || undefined,
              },
              {
                onSuccess: () => {
                  setHostName("");
                  setContactPhone("");
                  setLocation("");
                  setEventDate("");
                  setSlots("");
                  setNotes("");
                },
              },
            );
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="outreach-kind">Kind</Label>
              <Select id="outreach-kind" value={kind} onChange={(e) => setKind(e.target.value as OutreachKind)}>
                <option value="outreach_free">Free community check (vitals and a lab form)</option>
                <option value="outreach_paid">
                  Paid outreach check (adds one results consultation
                  {price ? `, ${naira(price.price_per_head_kobo)} a head` : ""})
                </option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="outreach-host">Host</Label>
              <Input id="outreach-host" value={hostName} onChange={(e) => setHostName(e.target.value)} placeholder="Church, company or association" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="outreach-location">Location</Label>
              <Input id="outreach-location" value={location} onChange={(e) => setLocation(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="outreach-contact">Host contact phone</Label>
              <Input id="outreach-contact" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+234..." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="outreach-date">Date</Label>
              <Input id="outreach-date" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="outreach-slots">People expected</Label>
              <Input id="outreach-slots" type="number" min={1} value={slots} onChange={(e) => setSlots(e.target.value)} required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="outreach-notes">Notes</Label>
            <Input id="outreach-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {create.isError ? <p className="text-sm text-red-600">{(create.error as Error).message}</p> : null}
          {create.isSuccess ? <p className="text-sm text-brand-green">Created. Confirm it below to open it for attendees.</p> : null}
          <Button type="submit" size="sm" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create outreach check"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** Finds an account by phone number; used for the payer of a paid day and for each attendee. */
function PhoneLookup({
  label,
  onFound,
  initialPhone = "",
}: {
  label: string;
  onFound: (profile: { id: string; full_name: string | null } | null) => void;
  initialPhone?: string;
}) {
  const [phone, setPhone] = useState(initialPhone);
  const lookup = useFindProfileByPhone();
  const [found, setFound] = useState<{ id: string; full_name: string | null } | null | undefined>(undefined);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        aria-label={label}
        placeholder={label}
        value={phone}
        onChange={(e) => {
          setPhone(e.target.value);
          setFound(undefined);
          onFound(null);
        }}
        className="w-44"
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={lookup.isPending || !phone}
        onClick={() =>
          lookup.mutate(phone, {
            onSuccess: (data) => {
              setFound(data);
              onFound(data);
            },
          })
        }
      >
        Look up
      </Button>
      {found === null ? <span className="text-xs text-red-600">No Tarragon account on that number yet.</span> : null}
      {found ? <span className="text-sm text-charcoal-ink/70">{found.full_name ?? "Unnamed account"}</span> : null}
    </div>
  );
}

function ConfirmForm({ day }: { day: ScreeningDay }) {
  const kind = screeningDayKind(day);
  const { data: bundles } = useSelfBookablePanelBundles();
  const { data: outreachPrice } = useActiveOutreachPrice();
  const bundle = bundles?.find((b) => b.id === day.panel_bundle_id);
  const [slots, setSlots] = useState(String(day.slots_requested));
  const [discount, setDiscount] = useState(kind === "bundle" ? "10" : "0");
  const [payer, setPayer] = useState<{ id: string; full_name: string | null } | null>(null);
  const confirm = useConfirmScreeningDay();

  const basePrice = kind === "outreach_paid" ? outreachPrice?.price_per_head_kobo : bundle?.price_kobo;
  const preview =
    basePrice && Number(discount) >= 0 && Number(discount) < 100 ? Math.round(basePrice * (1 - Number(discount) / 100)) : null;
  // A paid outreach day is paid by someone at the host (often an employer's contact), never by the staff member who created it.
  const needsPayer = kind === "outreach_paid";

  return (
    <form
      className="mt-3 space-y-3 border-t border-charcoal-ink/10 pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        confirm.mutate({
          screeningDayId: day.id,
          slotsConfirmed: Number(slots),
          // ignored by the database for a free day, which has no price
          discountPercent: kind === "outreach_free" ? 0 : Number(discount),
          payerProfileId: payer?.id,
        });
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`slots-${day.id}`}>{kind === "outreach_free" ? "Places" : "Slots to confirm"}</Label>
          <Input id={`slots-${day.id}`} type="number" min={1} value={slots} onChange={(e) => setSlots(e.target.value)} className="w-28" />
        </div>
        {kind !== "outreach_free" ? (
          <div className="space-y-1.5">
            <Label htmlFor={`discount-${day.id}`}>Discount %</Label>
            <Input
              id={`discount-${day.id}`}
              type="number"
              min={0}
              max={99}
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              className="w-28"
            />
          </div>
        ) : null}
        <Button type="submit" size="sm" disabled={confirm.isPending || (needsPayer && !payer)}>
          {confirm.isPending ? "Confirming…" : kind === "outreach_free" ? "Confirm" : "Confirm & freeze price"}
        </Button>
      </div>
      {needsPayer ? (
        <div className="space-y-1.5">
          <p className="text-sm text-charcoal-ink/70">Who pays? Their own Tarragon account pays from Group screening days in the app.</p>
          <PhoneLookup label="Payer's phone number" onFound={setPayer} />
        </div>
      ) : null}
      {preview && basePrice ? (
        <p className="text-sm text-charcoal-ink/60">
          {kind === "outreach_paid" ? "Outreach place" : bundle?.name} at {naira(preview)}/head × {slots || 0} ={" "}
          {naira(preview * Number(slots || 0))}
        </p>
      ) : null}
      {kind === "outreach_free" ? (
        <p className="text-sm text-charcoal-ink/60">Free: no price and no payer. Attendees can be enrolled as soon as it is confirmed.</p>
      ) : null}
      {confirm.isError ? <p className="text-sm text-red-600">{(confirm.error as Error).message}</p> : null}
      {confirm.isSuccess ? <p className="text-sm text-brand-green">Confirmed.</p> : null}
    </form>
  );
}

function IssueVoucherRow({ day, slotId }: { day: ScreeningDay; slotId: string }) {
  const issue = useIssueScreeningDayVoucher();
  const [found, setFound] = useState<{ id: string; full_name: string | null } | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <PhoneLookup label="Their phone number" onFound={setFound} />
      {found ? (
        <Button
          type="button"
          size="sm"
          disabled={issue.isPending}
          onClick={() => issue.mutate({ slotId, beneficiaryProfileId: found.id, screeningDayId: day.id })}
        >
          {issue.isPending ? "Issuing…" : "Issue voucher"}
        </Button>
      ) : null}
      {issue.isError ? <span className="text-xs text-red-600">{(issue.error as Error).message}</span> : null}
    </div>
  );
}

function EnrolRow({ day, slotId, registeredPhone }: { day: ScreeningDay; slotId: string; registeredPhone: string | null }) {
  const enrol = useEnrolOutreachAttendee();
  const [found, setFound] = useState<{ id: string; full_name: string | null } | null>(null);

  // A slot registered with a phone number can only be linked to the account holding that number (checked in the database).
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PhoneLookup label="Their phone number" onFound={setFound} initialPhone={registeredPhone ?? ""} />
      {found ? (
        <Button
          type="button"
          size="sm"
          disabled={enrol.isPending}
          onClick={() => enrol.mutate({ slotId, patientId: found.id, screeningDayId: day.id })}
        >
          {enrol.isPending ? "Enrolling…" : "Enrol"}
        </Button>
      ) : null}
      {enrol.isError ? <span className="text-xs text-red-600">{(enrol.error as Error).message}</span> : null}
    </div>
  );
}

function optionalNumber(value: string): number | undefined {
  return value.trim() === "" ? undefined : Number(value);
}

/** OUT-001, the CMO-signed on-site wording (packages/i18n clinical-wording.json), shown when a saved reading was an emergency. */
export function DangerousReadingPanel({ name, onDone }: { name: string; onDone: () => void }) {
  const words = activeOutreachDangerousReadingWording();
  return (
    <div role="alert" className="w-full space-y-2 rounded-md border-2 border-red-600 bg-red-50 p-4 text-sm text-charcoal-ink dark:bg-red-950/40 dark:text-night-ink">
      <p className="font-heading text-base font-semibold">
        {words.title}: {name}
      </p>
      <ol className="list-decimal space-y-1 pl-5">
        {words.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <Button type="button" size="sm" variant="outline" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

function VitalsForm({ day, slotId, onEmergency }: { day: ScreeningDay; slotId: string; onEmergency: () => void }) {
  const record = useRecordOutreachVitals();
  const [sys1, setSys1] = useState("");
  const [dia1, setDia1] = useState("");
  const [sys2, setSys2] = useState("");
  const [dia2, setDia2] = useState("");
  const [glucose, setGlucose] = useState("");
  const [fasting, setFasting] = useState(false);
  const [weight, setWeight] = useState("");
  const [pulse, setPulse] = useState("");
  const [spo2, setSpo2] = useState("");

  const bp: OutreachVitals["bp_readings"] = [];
  if (sys1 && dia1) bp.push({ systolic: Number(sys1), diastolic: Number(dia1) });
  if (sys2 && dia2) bp.push({ systolic: Number(sys2), diastolic: Number(dia2) });
  const vitals: OutreachVitals = {
    bp_readings: bp,
    glucose_mmol_l: optionalNumber(glucose),
    glucose_context: glucose ? (fasting ? "fasting" : "random") : undefined,
    weight_kg: optionalNumber(weight),
    pulse_bpm: optionalNumber(pulse),
    spo2_pct: optionalNumber(spo2),
  };
  const hasAny = bp.length > 0 || [glucose, weight, pulse, spo2].some((v) => v.trim() !== "");

  return (
    <form
      className="w-full space-y-2 rounded-md border border-charcoal-ink/10 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        // mutateAsync, not a per-call onSuccess: saving makes this form unmount (the row turns to "Readings saved"), and TanStack
        // Query drops per-call callbacks of an unmounted observer. The promise still resolves, and onEmergency belongs to the list.
        record
          .mutateAsync({ slotId, screeningDayId: day.id, vitals })
          .then((data) => {
            if (data.emergency) onEmergency();
          })
          .catch(() => {
            // shown below from record.error while the form is still on screen
          });
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <Input aria-label="First blood pressure, top number" placeholder="BP 1 top" value={sys1} onChange={(e) => setSys1(e.target.value)} className="w-24" inputMode="numeric" />
        <Input aria-label="First blood pressure, bottom number" placeholder="BP 1 bottom" value={dia1} onChange={(e) => setDia1(e.target.value)} className="w-24" inputMode="numeric" />
        <Input aria-label="Second blood pressure, top number" placeholder="BP 2 top" value={sys2} onChange={(e) => setSys2(e.target.value)} className="w-24" inputMode="numeric" />
        <Input aria-label="Second blood pressure, bottom number" placeholder="BP 2 bottom" value={dia2} onChange={(e) => setDia2(e.target.value)} className="w-24" inputMode="numeric" />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Input aria-label="Blood sugar in mmol/L" placeholder="Sugar mmol/L" value={glucose} onChange={(e) => setGlucose(e.target.value)} className="w-28" inputMode="decimal" />
        <label className="flex items-center gap-1 text-xs text-charcoal-ink/70">
          <input type="checkbox" checked={fasting} onChange={(e) => setFasting(e.target.checked)} /> Fasting
        </label>
        <Input aria-label="Weight in kg" placeholder="Weight kg" value={weight} onChange={(e) => setWeight(e.target.value)} className="w-24" inputMode="decimal" />
        <Input aria-label="Pulse per minute" placeholder="Pulse" value={pulse} onChange={(e) => setPulse(e.target.value)} className="w-20" inputMode="numeric" />
        <Input aria-label="Oxygen saturation percent" placeholder="SpO2 %" value={spo2} onChange={(e) => setSpo2(e.target.value)} className="w-20" inputMode="numeric" />
        <Button type="submit" size="sm" disabled={record.isPending || !hasAny}>
          {record.isPending ? "Saving…" : "Save readings"}
        </Button>
      </div>
      <p className="text-xs text-charcoal-ink/60">
        Readings go into the person&apos;s own record. A dangerous reading raises the same alert as any other reading, so follow the
        on-the-day plan for anyone who needs urgent care.
      </p>
      {record.isError ? <p className="text-xs text-red-600">{(record.error as Error).message}</p> : null}
    </form>
  );
}

function SlotsList({ day }: { day: ScreeningDay }) {
  const kind = screeningDayKind(day);
  const outreach = isOutreachDay(day);
  const { data: slots } = useScreeningDaySlots(day.id);
  const { data: enrolments } = useOutreachEnrolments(outreach ? day.id : undefined);
  const addSlot = useAddScreeningDaySlot();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  // Slots whose saved readings crossed the emergency threshold; the panel stays until the staff member taps Done.
  const [emergencySlots, setEmergencySlots] = useState<ReadonlySet<string>>(new Set());
  const ready = screeningDayReadyForAttendees(day);
  const registered = (slots ?? []).filter((s) => s.status !== "removed").length;
  const remaining = (day.slots_confirmed ?? 0) - registered;
  const enrolmentBySlot = new Map((enrolments ?? []).map((e) => [e.slot_id, e]));

  return (
    <div className="mt-3 space-y-3 border-t border-charcoal-ink/10 pt-3">
      {kind !== "outreach_free" ? (
        <p className="text-sm text-charcoal-ink/70">
          {naira(day.amount_paid_kobo)} paid of {naira(day.total_kobo ?? 0)}
          {ready ? " (paid in full)" : ""}
        </p>
      ) : null}
      <p className="text-sm text-charcoal-ink/60">
        {registered} of {day.slots_confirmed ?? 0} places registered.
      </p>
      <ul className="space-y-2">
        {(slots ?? []).map((slot) => {
          const enrolment = enrolmentBySlot.get(slot.id);
          return (
            <li key={slot.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-40">{slot.full_name ?? slot.phone ?? "Unnamed"}</span>
              {!ready ? (
                <Badge variant="grey">Waiting on payment</Badge>
              ) : !outreach ? (
                slot.status === "issued" ? <Badge variant="green">Voucher issued</Badge> : <IssueVoucherRow day={day} slotId={slot.id} />
              ) : !enrolment ? (
                <EnrolRow day={day} slotId={slot.id} registeredPhone={slot.phone} />
              ) : (
                <>
                  <Badge variant="green">Enrolled</Badge>
                  {enrolment.consult_purchase_id ? <Badge variant="blue">Consultation included</Badge> : null}
                  {enrolment.vitals_recorded_at ? (
                    <Badge variant="green">Readings saved</Badge>
                  ) : (
                    <VitalsForm
                      day={day}
                      slotId={slot.id}
                      onEmergency={() => setEmergencySlots((prev) => new Set(prev).add(slot.id))}
                    />
                  )}
                  {emergencySlots.has(slot.id) ? (
                    <DangerousReadingPanel
                      name={slot.full_name ?? "this person"}
                      onDone={() =>
                        setEmergencySlots((prev) => {
                          const next = new Set(prev);
                          next.delete(slot.id);
                          return next;
                        })
                      }
                    />
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {ready && remaining > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <Input placeholder="Attendee name" value={name} onChange={(e) => setName(e.target.value)} className="w-40" />
          <Input placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-40" />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={addSlot.isPending || !name.trim()}
            onClick={() =>
              addSlot.mutate(
                { screeningDayId: day.id, fullName: name, phone: phone || undefined },
                {
                  onSuccess: () => {
                    setName("");
                    setPhone("");
                  },
                },
              )
            }
          >
            Register attendee
          </Button>
        </div>
      ) : null}
      {addSlot.isError ? <p className="text-sm text-red-600">{(addSlot.error as Error).message}</p> : null}
    </div>
  );
}

function ScreeningDayRow({ day, canManage }: { day: ScreeningDay; canManage: boolean }) {
  const badge = STATUS_BADGE[day.status];
  const kind = screeningDayKind(day);
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-heading text-base font-semibold text-charcoal-ink">{day.host_name}</h3>
          <div className="flex gap-2">
            <Badge variant={kind === "bundle" ? "grey" : "blue"}>{KIND_LABEL[kind]}</Badge>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
        </div>
        <p className="text-sm text-charcoal-ink/60">
          {day.location} ·{" "}
          {new Date(day.event_date).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "long", year: "numeric" })}
          {day.contact_phone ? ` · ${day.contact_phone}` : ""}
        </p>
        <p className="text-sm text-charcoal-ink/70">{day.slots_requested} people expected</p>
        {day.notes ? <p className="text-sm text-charcoal-ink/60">{day.notes}</p> : null}
        {day.status === "requested" ? (
          canManage ? <ConfirmForm day={day} /> : <p className="text-sm text-charcoal-ink/60">Waiting for confirmation.</p>
        ) : null}
        {day.status === "confirmed" ? <SlotsList day={day} /> : null}
      </CardContent>
    </Card>
  );
}

export function ScreeningDaysDashboard({ canManage }: { canManage: boolean }) {
  const { data: days, isLoading } = useScreeningDays();

  return (
    <div className="space-y-4">
      {canManage ? <CreateOutreachForm /> : null}
      {isLoading ? <p className="text-sm text-charcoal-ink/60">Loading…</p> : null}
      {days && days.length === 0 ? <p className="text-sm text-charcoal-ink/60">No screening days yet.</p> : null}
      {(days ?? []).map((day) => (
        <ScreeningDayRow key={day.id} day={day} canManage={canManage} />
      ))}
    </div>
  );
}
