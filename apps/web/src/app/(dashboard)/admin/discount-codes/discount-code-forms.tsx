"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError, FormSuccess } from "@/components/ui/form-error";
import { createDiscountCode, setDiscountCodeStatus, type DiscountCodeActionState } from "./actions";

/** T2-01/T2-13 (2026-11-04): Membership Plus and the upgrade are retired; the database refuses a new code that names either. */
const NEVER_A_TARGET: ReadonlySet<string> = new Set(["membership_annual", "membership_upgrade_plus"]);

export function CreateDiscountCodeForm({
  items,
  cohorts,
  today,
}: {
  items: readonly { code: string; active: boolean }[];
  cohorts: readonly { id: string; name: string; sponsor: string }[];
  /** Today's date in Lagos as YYYY-MM-DD, read by the server page so this form stays a pure function of its props. */
  today: string;
}) {
  const [state, action, pending] = useActionState<DiscountCodeActionState, FormData>(createDiscountCode, undefined);
  const [kind, setKind] = useState<"percent" | "fixed">("percent");
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor="dc-code">Code (optional)</Label>
        <Input id="dc-code" name="code" maxLength={24} pattern="[A-Za-z0-9]{4,24}" autoCapitalize="characters" placeholder="Leave blank to generate one" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="dc-kind">Kind</Label>
        <select id="dc-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value === "fixed" ? "fixed" : "percent")} className="mt-1 min-h-11 w-full rounded-md border px-3 py-2 text-sm">
          <option value="percent">Percentage off</option>
          <option value="fixed">Fixed amount off (naira)</option>
        </select>
      </div>
      {kind === "percent" ? (
        <div className="space-y-1">
          <Label htmlFor="dc-percent">Percent off (1 to 100)</Label>
          <Input id="dc-percent" name="percent" inputMode="numeric" required pattern="\d{1,3}" />
        </div>
      ) : (
        <div className="space-y-1">
          <Label htmlFor="dc-naira">Amount off (whole naira)</Label>
          <Input id="dc-naira" name="naira" inputMode="numeric" required pattern="\d{1,9}" />
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="dc-max">Most it can take off (naira, optional)</Label>
        <Input id="dc-max" name="max_naira" inputMode="numeric" pattern="\d{1,9}" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="dc-total">Total uses allowed</Label>
        <Input id="dc-total" name="max_total_uses" inputMode="numeric" required pattern="\d{1,7}" defaultValue="100" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="dc-per">Uses per person</Label>
        <Input id="dc-per" name="max_per_person" inputMode="numeric" required pattern="\d{1,3}" defaultValue="1" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="dc-from">First day</Label>
        <Input id="dc-from" name="valid_from" type="date" required defaultValue={today} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="dc-to">Last day</Label>
        <Input id="dc-to" name="valid_to" type="date" required />
      </div>
      <fieldset className="space-y-1 sm:col-span-2">
        <legend className="font-medium">Only for these items (none ticked means every item)</legend>
        {items.length === 0 ? <p>No catalogue items yet.</p> : null}
        <div className="grid gap-1 sm:grid-cols-2">
          {items.filter((i) => !NEVER_A_TARGET.has(i.code)).map((i) => (
            <label key={i.code} className="flex min-h-11 items-center gap-2">
              <input type="checkbox" name="item" value={i.code} className="h-5 w-5" />
              {i.code}{i.active ? "" : " (off)"}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="dc-cohort">Only for a sponsor cohort (optional)</Label>
        <select id="dc-cohort" name="cohort_id" defaultValue="" className="mt-1 min-h-11 w-full rounded-md border px-3 py-2 text-sm">
          <option value="">Anyone</option>
          {cohorts.map((c) => (
            <option key={c.id} value={c.id}>{c.name} ({c.sponsor})</option>
          ))}
        </select>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="dc-note">Note (optional, for staff)</Label>
        <Input id="dc-note" name="note" maxLength={500} />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <label className="flex min-h-11 items-center gap-2 font-medium">
          <input type="checkbox" name="badge" value="founding_member" className="h-5 w-5" aria-describedby="dc-badge-hint" />
          Founding member badge
        </label>
        <p id="dc-badge-hint" className="text-sm text-muted-foreground">
          Everyone whose year is paid with this code is shown as a founding member in the app, and the public site shows how many places are left (its total uses).
          Tick exactly one item above, the Membership (membership_annual_no_panel). Membership Plus is retired and no longer sold, so a
          founding code is for the Membership only. The offer closes by itself when its places run out, so the last day can be set well ahead. Only one founding member code can be active at a time. The badge cannot be added or removed later.
        </p>
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending} className="min-h-11">{pending ? "Creating…" : "Create code"}</Button>
        <FormError id="err-dc-create" message={state?.error ?? null} />
        <FormSuccess message={state?.message ?? null} />
      </div>
    </form>
  );
}

export function DiscountCodeStatusForm({ id, status }: { id: string; status: "active" | "paused" | "ended" }) {
  const [state, action, pending] = useActionState<DiscountCodeActionState, FormData>(setDiscountCodeStatus, undefined);
  if (status === "ended") return <p>Ended. A code that has ended cannot come back; create a new one.</p>;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <Label htmlFor={`reason-${id}`}>Reason</Label>
      <Input id={`reason-${id}`} name="reason" required minLength={10} maxLength={500} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="status" value={status === "active" ? "paused" : "active"} variant="outline" disabled={pending} className="min-h-11">
          {status === "active" ? "Pause" : "Resume"}
        </Button>
        <Button type="submit" name="status" value="ended" variant="outline" disabled={pending} className="min-h-11">End now</Button>
      </div>
      <FormError id={`err-${id}`} message={state?.error ?? null} />
      <FormSuccess message={state?.message ?? null} />
    </form>
  );
}
