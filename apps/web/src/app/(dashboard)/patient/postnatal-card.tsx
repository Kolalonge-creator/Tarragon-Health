"use client";

import { useActionState, useEffect, useState } from "react";
import { recordDelivery, logPostnatalCheckin } from "./womens-health-actions";
import {
  usePostnatalProfiles,
  usePostnatalCheckins,
  useInvalidateWomensHealth,
} from "@/lib/queries/womens-health";
import { CHECKIN_WINDOWS, BREASTFEEDING_STATUSES } from "@/lib/validation/womens-health";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

import { formatPatientDate } from "@/lib/format-date";
const CHECKIN_LABEL: Record<(typeof CHECKIN_WINDOWS)[number], string> = {
  week_1: "Week 1",
  week_6: "Week 6",
  month_3: "Month 3",
  month_6: "Month 6",
  month_12: "Month 12",
  other: "Other",
};

const BREASTFEEDING_LABEL: Record<(typeof BREASTFEEDING_STATUSES)[number], string> = {
  not_started: "Not started",
  exclusive: "Exclusive breastfeeding",
  mixed: "Mixed feeding",
  formula_only: "Formula only",
  stopped: "Stopped",
};

/**
 * Postnatal programme (§44.9): delivery -> postnatal check-ins covering
 * maternal recovery, breastfeeding support and contraception follow-up.
 * Mental wellbeing screening reuses the existing mental-health check-in
 * (see /patient — MentalHealthForm) rather than a parallel form; a check-in
 * here can be linked to a screen result once one exists.
 */
export function PostnatalCard({ patientId }: { patientId: string }) {
  const profiles = usePostnatalProfiles(patientId);
  const invalidate = useInvalidateWomensHealth(patientId);
  const [deliveryState, deliveryAction, deliveryPending] = useActionState(recordDelivery, undefined);
  const [showDeliveryForm, setShowDeliveryForm] = useState(false);

  useEffect(() => {
    if (!deliveryState?.success) return;
    invalidate();
    // setShowDeliveryForm is called from inside this callback, not
    // synchronously in the effect body — the sanctioned pattern
    // (react-hooks/set-state-in-effect).
    const id = setTimeout(() => setShowDeliveryForm(false), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryState?.success]);

  const latest = profiles.data?.[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Postnatal care</CardTitle>
        <CardDescription>
          Maternal recovery, breastfeeding support and follow-up after delivery.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {latest ? (
          <div className="rounded-md border border-charcoal-ink/10 p-3 text-sm">
            <p className="font-medium">Delivered {formatPatientDate(latest.delivery_date)}</p>
            <p className="text-charcoal-ink/70 capitalize">{latest.delivery_mode.replace("_", " ")}</p>
          </div>
        ) : (
          <p className="text-sm text-charcoal-ink/60">No delivery recorded yet.</p>
        )}

        {!showDeliveryForm ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setShowDeliveryForm(true)}>
            {latest ? "Record another delivery" : "Record a delivery"}
          </Button>
        ) : (
          <form action={deliveryAction} className="space-y-3 rounded-md border border-charcoal-ink/10 p-3">
            <p className="text-xs text-charcoal-ink/60">
              This also updates your pregnancy status to &quot;not pregnant&quot;.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="delivery_date">Delivery date</Label>
                <Input id="delivery_date" name="delivery_date" type="date" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="delivery_mode">Delivery mode</Label>
                <Select id="delivery_mode" name="delivery_mode" defaultValue="unknown">
                  <option value="unknown">Prefer not to say</option>
                  <option value="vaginal">Vaginal</option>
                  <option value="assisted">Assisted</option>
                  <option value="caesarean">Caesarean</option>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="complications">Complications (optional)</Label>
              <Input id="complications" name="complications" />
            </div>
            {deliveryState?.error && <p className="text-sm text-red-600">{deliveryState.error}</p>}
            <Button type="submit" size="sm" disabled={deliveryPending}>
              {deliveryPending ? "Saving…" : "Save"}
            </Button>
          </form>
        )}

        {latest && <PostnatalCheckinSection patientId={patientId} postnatalProfileId={latest.id} />}
      </CardContent>
    </Card>
  );
}

function PostnatalCheckinSection({
  patientId,
  postnatalProfileId,
}: {
  patientId: string;
  postnatalProfileId: string;
}) {
  const checkins = usePostnatalCheckins(postnatalProfileId);
  const invalidate = useInvalidateWomensHealth(patientId);
  const boundAction = logPostnatalCheckin.bind(null, postnatalProfileId);
  const [state, formAction, pending] = useActionState(boundAction, undefined);

  useEffect(() => {
    if (state?.success) invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <div className="space-y-3 border-t border-charcoal-ink/10 pt-4">
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">Check-ins</p>

      {checkins.data && checkins.data.length > 0 && (
        <ul className="space-y-1.5">
          {checkins.data.map((c) => (
            <li key={c.id} className="text-sm text-charcoal-ink/80">
              {CHECKIN_LABEL[c.checkin_window as (typeof CHECKIN_WINDOWS)[number]]}
              {c.breastfeeding_status ? ` · ${BREASTFEEDING_LABEL[c.breastfeeding_status]}` : ""}
              {c.contraception_discussed ? " · Contraception discussed" : ""}
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="checkin_window">Check-in</Label>
          <Select id="checkin_window" name="checkin_window" defaultValue="week_1">
            {CHECKIN_WINDOWS.map((w) => (
              <option key={w} value={w}>
                {CHECKIN_LABEL[w]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="breastfeeding_status">Breastfeeding</Label>
          <Select id="breastfeeding_status" name="breastfeeding_status" defaultValue="">
            <option value="">Not recorded</option>
            {BREASTFEEDING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {BREASTFEEDING_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="maternal_recovery_notes">How are you recovering?</Label>
          <Input id="maternal_recovery_notes" name="maternal_recovery_notes" />
        </div>
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" name="contraception_discussed" value="true" />
          We discussed contraception at this check-in
        </label>
        {state?.error && <p className="col-span-2 text-sm text-red-600">{state.error}</p>}
        <div className="col-span-2">
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? "Saving…" : "Log check-in"}
          </Button>
        </div>
      </form>
    </div>
  );
}
