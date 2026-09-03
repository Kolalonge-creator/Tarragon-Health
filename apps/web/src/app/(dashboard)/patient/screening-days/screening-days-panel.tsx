"use client";

import { useActionState, useState } from "react";
import { koboToNaira } from "@tarragon/shared";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  useScreeningDays,
  useScreeningDaySlots,
  useSelfBookablePanelBundles,
  type ScreeningDay,
} from "@/lib/queries/screening-days";
import { requestScreeningDay, payTowardScreeningDay, addScreeningDaySlot } from "./actions";

const STATUS_BADGE: Record<ScreeningDay["status"], { variant: BadgeProps["variant"]; label: string }> = {
  requested: { variant: "amber", label: "Awaiting confirmation" },
  confirmed: { variant: "blue", label: "Confirmed" },
  completed: { variant: "green", label: "Completed" },
  cancelled: { variant: "grey", label: "Cancelled" },
};

function naira(kobo: number): string {
  return `₦${koboToNaira(kobo).toLocaleString("en-NG")}`;
}

function RequestForm() {
  const { data: bundles } = useSelfBookablePanelBundles();
  const [state, action, pending] = useActionState(requestScreeningDay, undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Request a screening day</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hostName">Group name</Label>
              <Input id="hostName" name="hostName" placeholder="e.g. Redeemer's Church, Lekki" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contactPhone">Contact phone</Label>
              <Input id="contactPhone" name="contactPhone" placeholder="+234..." />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="location">Location</Label>
              <Input id="location" name="location" placeholder="Where will this happen?" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eventDate">Event date</Label>
              <Input id="eventDate" name="eventDate" type="date" required />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="panelBundleId">Which check?</Label>
              <Select id="panelBundleId" name="panelBundleId" required defaultValue="">
                <option value="" disabled>
                  Choose a screening package
                </option>
                {(bundles ?? []).map((bundle) => (
                  <option key={bundle.id} value={bundle.id}>
                    {bundle.name} — {bundle.price_kobo ? naira(bundle.price_kobo) : "price on request"}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slotsRequested">How many people?</Label>
              <Input id="slotsRequested" name="slotsRequested" type="number" min={1} required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Anything else we should know?</Label>
            <Textarea id="notes" name="notes" rows={2} />
          </div>
          {state?.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
          {state?.message ? <p className="text-sm text-brand-green">{state.message}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Sending…" : "Request a discounted rate"}
          </Button>
          <p className="text-xs text-charcoal-ink/50">
            This reserves nothing and costs nothing yet. Our team confirms the discounted price and
            headcount with you before any payment is needed.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

function PayForm({ day }: { day: ScreeningDay }) {
  const [state, action, pending] = useActionState(payTowardScreeningDay, undefined);
  const outstanding = (day.total_kobo ?? 0) - day.amount_paid_kobo;
  if (outstanding <= 0) return null;

  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
      <input type="hidden" name="screeningDayId" value={day.id} />
      <div className="space-y-1.5">
        <Label htmlFor={`amount-${day.id}`}>Amount (₦)</Label>
        <Input
          id={`amount-${day.id}`}
          name="amountNaira"
          type="number"
          min={1}
          max={koboToNaira(outstanding)}
          defaultValue={koboToNaira(outstanding)}
          className="w-40"
        />
      </div>
      {state?.error ? <p className="w-full text-sm text-red-600">{state.error}</p> : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Redirecting…" : "Pay"}
      </Button>
    </form>
  );
}

function AddSlotForm({ day }: { day: ScreeningDay }) {
  const [state, action, pending] = useActionState(addScreeningDaySlot, undefined);
  const { data: slots } = useScreeningDaySlots(day.id);
  const remaining = (day.slots_confirmed ?? 0) - (slots?.filter((s) => s.status !== "removed").length ?? 0);
  const fullyPaid = (day.total_kobo ?? 0) > 0 && day.amount_paid_kobo >= (day.total_kobo ?? 0);

  if (!fullyPaid) return null;

  return (
    <div className="mt-4 space-y-3 border-t border-charcoal-ink/10 pt-4">
      <p className="text-sm text-charcoal-ink/70">
        {slots?.length ?? 0} of {day.slots_confirmed} slots registered ({remaining} left).
      </p>
      <ul className="space-y-1 text-sm text-charcoal-ink/70">
        {(slots ?? []).map((slot) => (
          <li key={slot.id} className="flex items-center gap-2">
            <span>{slot.full_name ?? "Unnamed"}</span>
            <Badge variant={slot.status === "issued" ? "green" : "grey"}>
              {slot.status === "issued" ? "Voucher issued" : "Registered"}
            </Badge>
          </li>
        ))}
      </ul>
      {remaining > 0 ? (
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="screeningDayId" value={day.id} />
          <div className="space-y-1.5">
            <Label htmlFor={`name-${day.id}`}>Attendee name</Label>
            <Input id={`name-${day.id}`} name="fullName" required className="w-48" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`phone-${day.id}`}>Phone (optional)</Label>
            <Input id={`phone-${day.id}`} name="phone" placeholder="+234..." className="w-48" />
          </div>
          {state?.error ? <p className="w-full text-sm text-red-600">{state.error}</p> : null}
          {state?.message ? <p className="w-full text-sm text-brand-green">{state.message}</p> : null}
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? "Adding…" : "Add to the list"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function ScreeningDayCard({ day }: { day: ScreeningDay }) {
  const badge = STATUS_BADGE[day.status];
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-heading text-base font-semibold text-charcoal-ink">{day.host_name}</h3>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        <p className="text-sm text-charcoal-ink/60">
          {day.location} · {new Date(day.event_date).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>
        <p className="text-sm text-charcoal-ink/70">
          {day.slots_requested} people requested
          {day.slots_confirmed ? ` · ${day.slots_confirmed} confirmed` : ""}
          {day.price_per_head_kobo ? ` at ${naira(day.price_per_head_kobo)} each` : ""}
        </p>
        {day.status === "confirmed" ? (
          <p className="text-sm text-charcoal-ink/70">
            {naira(day.amount_paid_kobo)} paid of {naira(day.total_kobo ?? 0)}
          </p>
        ) : null}
        {day.status === "confirmed" ? <PayForm day={day} /> : null}
        {day.status === "confirmed" ? <AddSlotForm day={day} /> : null}
      </CardContent>
    </Card>
  );
}

export function ScreeningDaysPanel() {
  const { data: days, isLoading } = useScreeningDays();
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-6">
      {days && days.length > 0 ? (
        <div className="space-y-4">
          {days.map((day) => (
            <ScreeningDayCard key={day.id} day={day} />
          ))}
        </div>
      ) : isLoading ? (
        <p className="text-sm text-charcoal-ink/60">Loading…</p>
      ) : (
        <p className="text-sm text-charcoal-ink/60">
          No screening days yet. Request one below and our team will confirm a discounted rate.
        </p>
      )}

      {showForm ? (
        <RequestForm />
      ) : (
        <Button variant="outline" onClick={() => setShowForm(true)}>
          Request a screening day
        </Button>
      )}
    </div>
  );
}
