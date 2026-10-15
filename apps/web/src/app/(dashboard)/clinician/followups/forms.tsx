"use client";

import { useActionState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { offerTimes, withdrawOffer, type FollowupActionState } from "./actions";

const Err = ({ text }: { text?: string }) =>
  text ? (
    <p role="alert" className="text-sm text-red-600">
      {text}
    </p>
  ) : null;

export interface MemberChoice {
  patientId: string;
  label: string;
}

export function OfferForm({
  members,
  slotInputs,
  shortestRoutine,
  longestRoutine,
  hint,
  locale = "en",
}: {
  members: MemberChoice[];
  slotInputs: number;
  shortestRoutine: number;
  longestRoutine: number;
  hint: string;
  locale?: Locale;
}) {
  const [state, action, pending] = useActionState<FollowupActionState, FormData>(offerTimes, undefined);
  return (
    <form action={action} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-charcoal-ink">{t("followups.field.members", locale)}</legend>
        {members.map((m) => (
          <label key={m.patientId} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="patients" value={m.patientId} className="h-4 w-4" />
            <span>{m.label}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-charcoal-ink">{t("followups.field.times", locale)}</legend>
        <p className="text-xs text-charcoal-ink/60">{hint}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: slotInputs }, (_, i) => (
            <div key={i}>
              <Label htmlFor={`followup-time-${i}`}>{t("followups.field.time_n", locale, { n: i + 1 })}</Label>
              <Input id={`followup-time-${i}`} name="times" type="datetime-local" step={300} />
            </div>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="followup-kind">{t("followups.field.kind", locale)}</Label>
          <Select id="followup-kind" name="kind" defaultValue="monthly">
            <option value="monthly">{t("followups.kind.monthly", locale)}</option>
            <option value="yearly_results">{t("followups.kind.yearly_results", locale)}</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="followup-minutes">{t("followups.field.minutes", locale)}</Label>
          <Select id="followup-minutes" name="minutes" defaultValue="">
            <option value="">{t("followups.minutes.standard", locale)}</option>
            {Array.from({ length: longestRoutine - shortestRoutine }, (_, i) => shortestRoutine + i).map((n) => (
              <option key={n} value={String(n)}>
                {t("followups.minutes.shorter", locale, { n })}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <Err text={state?.error} />
      {state?.message && (
        <p role="status" className="text-sm text-brand-green">
          {state.message}
        </p>
      )}
      {state?.refused?.map((r) => (
        <p key={r} className="text-sm text-charcoal-ink/70">
          {r}
        </p>
      ))}
      <Button type="submit" disabled={pending || members.length === 0}>
        {pending ? t("followups.sending", locale) : t("followups.offer_button", locale)}
      </Button>
    </form>
  );
}

export function WithdrawForm({ offerId, locale = "en" }: { offerId: string; locale?: Locale }) {
  const [state, action, pending] = useActionState<FollowupActionState, FormData>(withdrawOffer, undefined);
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="offer_id" value={offerId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {t("followups.withdraw", locale)}
      </Button>
      <Err text={state?.error} />
    </form>
  );
}
