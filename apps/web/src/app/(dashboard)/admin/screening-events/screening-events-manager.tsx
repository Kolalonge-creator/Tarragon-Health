"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ScreeningEventRow } from "@tarragon/shared";
import { createScreeningEventAction, recordBalanceAction, recordDepositAction } from "./actions";

function kobo(n: number) {
  return `₦${(n / 100).toLocaleString()}`;
}

const ORGANISER_TYPE_LABEL: Record<string, string> = {
  church: "Church",
  mosque: "Mosque",
  market_association: "Market association",
  alumni_association: "Alumni association",
  hometown_union: "Hometown union",
  cooperative_society: "Cooperative society",
  sme: "Small business",
  other: "Other",
};

function EventRow({ event }: { event: ScreeningEventRow }) {
  const [depositState, depositAction] = useActionState(recordDepositAction, undefined);
  const [balanceState, balanceAction] = useActionState(recordBalanceAction, undefined);
  const total = event.price_per_person_kobo * event.headcount_target;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>{event.organiser_name}</CardTitle>
          <p className="text-xs text-charcoal-ink/60">
            {ORGANISER_TYPE_LABEL[event.organiser_type] ?? event.organiser_type} · {event.location_text} ·{" "}
            {event.event_date}
          </p>
        </div>
        <Badge
          variant={
            event.status === "confirmed" || event.status === "completed"
              ? "green"
              : event.status === "cancelled"
                ? "grey"
                : "amber"
          }
        >
          {event.status}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          {event.registered_count} / {event.headcount_target} registered · {kobo(total)} total
        </p>

        {event.status === "proposed" && (
          <form action={depositAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="event_id" value={event.id} />
            <div className="space-y-1">
              <Label htmlFor={`deposit-${event.id}`}>Deposit received (₦)</Label>
              <Input id={`deposit-${event.id}`} name="amount_kobo" type="number" min={1} step={1} required />
            </div>
            <Button type="submit" size="sm">Record deposit</Button>
          </form>
        )}
        {depositState?.error && <p className="text-sm text-red-600">{depositState.error}</p>}

        {event.status === "deposit_paid" && (
          <form action={balanceAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="event_id" value={event.id} />
            <div className="space-y-1">
              <Label htmlFor={`balance-${event.id}`}>Balance received (₦)</Label>
              <Input id={`balance-${event.id}`} name="amount_kobo" type="number" min={1} step={1} required />
            </div>
            <Button type="submit" size="sm">Confirm event</Button>
          </form>
        )}
        {balanceState?.error && <p className="text-sm text-red-600">{balanceState.error}</p>}

        {event.status === "confirmed" && (
          <Button asChild size="sm" variant="outline">
            <Link href={`/admin/screening-events/${event.id}/register`}>Register participants</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function ScreeningEventsManager({
  events,
  panels,
}: {
  events: ScreeningEventRow[];
  panels: { id: string; code: string; name: string; price_kobo: number }[];
}) {
  const [createState, createAction, createPending] = useActionState(createScreeningEventAction, undefined);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-charcoal-ink">Group screening events</h1>
        <p className="text-sm text-charcoal-ink/70">
          Churches, mosques, market associations, alumni groups — one organiser, a bulk-priced headcount, one
          coordinator registering people on the day.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New event proposal</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createAction} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="organiser_phone">Organiser phone (E.164)</Label>
              <Input id="organiser_phone" name="organiser_phone" placeholder="+2348012345678" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="organiser_name">Organiser name</Label>
              <Input id="organiser_name" name="organiser_name" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="organiser_type">Organiser type</Label>
              <Select id="organiser_type" name="organiser_type" defaultValue="church">
                {Object.entries(ORGANISER_TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="panel_bundle_id">Panel</Label>
              <Select id="panel_bundle_id" name="panel_bundle_id" defaultValue="" required>
                <option value="" disabled>
                  Choose a panel
                </option>
                {panels.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="price_per_person_kobo">Group price per person (kobo)</Label>
              <Input id="price_per_person_kobo" name="price_per_person_kobo" type="number" min={1} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="headcount_target">Headcount</Label>
              <Input id="headcount_target" name="headcount_target" type="number" min={1} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="event_date">Event date</Label>
              <Input id="event_date" name="event_date" type="date" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="location_text">Location</Label>
              <Input id="location_text" name="location_text" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="deposit_kobo">Deposit expected (kobo, optional)</Label>
              <Input id="deposit_kobo" name="deposit_kobo" type="number" min={0} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="agent_code">Agent code (optional)</Label>
              <Input id="agent_code" name="agent_code" placeholder="TAR-AGT-00001" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="organiser_incentive_note">Organiser incentive (write it down)</Label>
              <Input
                id="organiser_incentive_note"
                name="organiser_incentive_note"
                placeholder="e.g. free check for the organiser at 30+ registered"
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={createPending}>
                {createPending ? "Creating…" : "Create event"}
              </Button>
              {createState?.error && <p className="mt-2 text-sm text-red-600">{createState.error}</p>}
              {createState?.message && <p className="mt-2 text-sm text-tarragon-green">{createState.message}</p>}
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {events.map((e) => (
          <EventRow key={e.id} event={e} />
        ))}
        {events.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No screening events yet.</p>
        )}
      </div>
    </div>
  );
}
