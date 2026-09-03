"use client";

import { useState } from "react";
import { koboToNaira } from "@tarragon/shared";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useAddScreeningDaySlot,
  useConfirmScreeningDay,
  useFindProfileByPhone,
  useIssueScreeningDayVoucher,
  useScreeningDays,
  useScreeningDaySlots,
  useSelfBookablePanelBundles,
  type ScreeningDay,
} from "@/lib/queries/screening-days";

const STATUS_BADGE: Record<ScreeningDay["status"], { variant: BadgeProps["variant"]; label: string }> = {
  requested: { variant: "amber", label: "Requested" },
  confirmed: { variant: "blue", label: "Confirmed" },
  completed: { variant: "green", label: "Completed" },
  cancelled: { variant: "grey", label: "Cancelled" },
};

function naira(kobo: number): string {
  return `₦${koboToNaira(kobo).toLocaleString("en-NG")}`;
}

function ConfirmForm({ day }: { day: ScreeningDay }) {
  const { data: bundles } = useSelfBookablePanelBundles();
  const bundle = bundles?.find((b) => b.id === day.panel_bundle_id);
  const [slots, setSlots] = useState(String(day.slots_requested));
  const [discount, setDiscount] = useState("10");
  const confirm = useConfirmScreeningDay();

  const preview =
    bundle?.price_kobo && Number(discount) >= 0 && Number(discount) < 100
      ? Math.round(bundle.price_kobo * (1 - Number(discount) / 100))
      : null;

  return (
    <form
      className="mt-3 space-y-3 border-t border-charcoal-ink/10 pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        confirm.mutate({
          screeningDayId: day.id,
          slotsConfirmed: Number(slots),
          discountPercent: Number(discount),
        });
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`slots-${day.id}`}>Slots to confirm</Label>
          <Input
            id={`slots-${day.id}`}
            type="number"
            min={1}
            value={slots}
            onChange={(e) => setSlots(e.target.value)}
            className="w-28"
          />
        </div>
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
        <Button type="submit" size="sm" disabled={confirm.isPending}>
          {confirm.isPending ? "Confirming…" : "Confirm & freeze price"}
        </Button>
      </div>
      {preview && bundle ? (
        <p className="text-sm text-charcoal-ink/60">
          {bundle.name} at {naira(preview)}/head × {slots || 0} = {naira(preview * Number(slots || 0))}
        </p>
      ) : null}
      {confirm.isError ? <p className="text-sm text-red-600">{(confirm.error as Error).message}</p> : null}
      {confirm.isSuccess ? <p className="text-sm text-brand-green">Confirmed — ready for payment.</p> : null}
    </form>
  );
}

function IssueVoucherRow({ day, slotId }: { day: ScreeningDay; slotId: string }) {
  const [phone, setPhone] = useState("");
  const lookup = useFindProfileByPhone();
  const issue = useIssueScreeningDayVoucher();
  const [found, setFound] = useState<{ id: string; full_name: string | null } | null | undefined>(undefined);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        placeholder="Their phone number"
        value={phone}
        onChange={(e) => {
          setPhone(e.target.value);
          setFound(undefined);
        }}
        className="w-44"
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={lookup.isPending || !phone}
        onClick={() => lookup.mutate(phone, { onSuccess: (data) => setFound(data) })}
      >
        Look up
      </Button>
      {found === null ? (
        <span className="text-xs text-red-600">No Tarragon account on that number yet.</span>
      ) : null}
      {found ? (
        <>
          <span className="text-sm text-charcoal-ink/70">{found.full_name ?? "Unnamed account"}</span>
          <Button
            type="button"
            size="sm"
            disabled={issue.isPending}
            onClick={() =>
              issue.mutate({ slotId, beneficiaryProfileId: found.id, screeningDayId: day.id })
            }
          >
            {issue.isPending ? "Issuing…" : "Issue voucher"}
          </Button>
        </>
      ) : null}
      {issue.isError ? <span className="text-xs text-red-600">{(issue.error as Error).message}</span> : null}
    </div>
  );
}

function SlotsList({ day }: { day: ScreeningDay }) {
  const { data: slots } = useScreeningDaySlots(day.id);
  const addSlot = useAddScreeningDaySlot();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const fullyPaid = (day.total_kobo ?? 0) > 0 && day.amount_paid_kobo >= (day.total_kobo ?? 0);
  const registered = (slots ?? []).filter((s) => s.status !== "removed").length;
  const remaining = (day.slots_confirmed ?? 0) - registered;

  return (
    <div className="mt-3 space-y-3 border-t border-charcoal-ink/10 pt-3">
      <p className="text-sm text-charcoal-ink/70">
        {naira(day.amount_paid_kobo)} paid of {naira(day.total_kobo ?? 0)}
        {fullyPaid ? " — paid in full" : ""}
      </p>
      <ul className="space-y-2">
        {(slots ?? []).map((slot) => (
          <li key={slot.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-40">{slot.full_name ?? slot.phone ?? "Unnamed"}</span>
            {slot.status === "issued" ? (
              <Badge variant="green">Voucher issued</Badge>
            ) : fullyPaid ? (
              <IssueVoucherRow day={day} slotId={slot.id} />
            ) : (
              <Badge variant="grey">Waiting on payment</Badge>
            )}
          </li>
        ))}
      </ul>
      {fullyPaid && remaining > 0 ? (
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
                { onSuccess: () => { setName(""); setPhone(""); } },
              )
            }
          >
            Register attendee
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ScreeningDayRow({ day }: { day: ScreeningDay }) {
  const badge = STATUS_BADGE[day.status];
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-heading text-base font-semibold text-charcoal-ink">{day.host_name}</h3>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        <p className="text-sm text-charcoal-ink/60">
          {day.location} ·{" "}
          {new Date(day.event_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          {day.contact_phone ? ` · ${day.contact_phone}` : ""}
        </p>
        <p className="text-sm text-charcoal-ink/70">{day.slots_requested} people requested</p>
        {day.notes ? <p className="text-sm text-charcoal-ink/60">{day.notes}</p> : null}
        {day.status === "requested" ? <ConfirmForm day={day} /> : null}
        {day.status === "confirmed" ? <SlotsList day={day} /> : null}
      </CardContent>
    </Card>
  );
}

export function ScreeningDaysDashboard() {
  const { data: days, isLoading } = useScreeningDays();

  return (
    <div className="space-y-4">
      {isLoading ? <p className="text-sm text-charcoal-ink/60">Loading…</p> : null}
      {days && days.length === 0 ? (
        <p className="text-sm text-charcoal-ink/60">No screening days requested yet.</p>
      ) : null}
      {(days ?? []).map((day) => (
        <ScreeningDayRow key={day.id} day={day} />
      ))}
    </div>
  );
}
