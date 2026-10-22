"use client";

import { useState } from "react";
import { birthPlanToForm, buildBirthPlanFields, type BirthPlanForm } from "@tarragon/clinical";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBirthPlan, useSaveBirthPlan } from "@/lib/queries/pregnancy-tools";

/**
 * Birth-preparedness plan (S67, spec 16.7). Place, transport, a money NOTE in naira (stored as kobo; no wallet, nothing is held or moved,
 * INV-09), a blood donor, who goes with her, and the three answers the contraction timer reads. Phones are E.164. The validation and the
 * row shape are shared with the phone (`buildBirthPlanFields` in @tarragon/clinical).
 */
export function BirthPlanForm({ patientId, organisationId, pregnancyId }: { patientId: string; organisationId: string; pregnancyId: string | null }) {
  const plan = useBirthPlan(pregnancyId);
  if (pregnancyId === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("preg.plan.title")}</CardTitle>
          <CardDescription>{t("preg.ui.plan.no_pregnancy")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  // The form is not shown until the saved plan has been read (or the read has failed), so what is typed is never replaced afterwards.
  if (plan.isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("preg.plan.title")}</CardTitle>
        </CardHeader>
      </Card>
    );
  }
  return (
    <BirthPlanFields
      patientId={patientId}
      organisationId={organisationId}
      pregnancyId={pregnancyId}
      initial={birthPlanToForm(plan.data)}
      existingNote={plan.data?.money_plan_note ?? null}
    />
  );
}

function BirthPlanFields({
  patientId,
  organisationId,
  pregnancyId,
  initial,
  existingNote,
}: {
  patientId: string;
  organisationId: string;
  pregnancyId: string;
  initial: BirthPlanForm;
  existingNote: string | null;
}) {
  const save = useSaveBirthPlan();
  const [form, setForm] = useState<BirthPlanForm>(initial);
  const [errors, setErrors] = useState<{ money: boolean; donorPhone: boolean; escortPhone: boolean } | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const built = buildBirthPlanFields(form, { money_plan_note: existingNote });
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors(null);
    save.mutate({ patientId, organisationId, pregnancyId, plan: built.plan });
  }

  const text = (k: "place" | "transport" | "money" | "donorName" | "donorPhone" | "escortName" | "escortPhone" | "previousBirths") => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const check = (k: "longJourney" | "previousFastLabour") => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.checked }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("preg.plan.title")}</CardTitle>
        <CardDescription>{t("preg.ui.plan.intro")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1">
            <Label htmlFor="bp-place">{t("preg.plan.place")}</Label>
            <Input id="bp-place" value={form.place} maxLength={200} onChange={text("place")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bp-transport">{t("preg.plan.transport")}</Label>
            <Input id="bp-transport" value={form.transport} maxLength={300} onChange={text("transport")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bp-money">{t("preg.plan.money")}</Label>
            <Input id="bp-money" inputMode="numeric" value={form.money} onChange={text("money")} aria-describedby="bp-money-hint" aria-invalid={errors?.money || undefined} />
            <p id="bp-money-hint" className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("preg.ui.plan.money_hint")}</p>
            {errors?.money && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{t("preg.ui.plan.money_bad")}</p>}
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("preg.plan.blood_donor")}</legend>
            <Label htmlFor="bp-donor-name" className="sr-only">{t("preg.ui.plan.name")}</Label>
            <Input id="bp-donor-name" placeholder={t("preg.ui.plan.name")} value={form.donorName} maxLength={120} onChange={text("donorName")} />
            <Label htmlFor="bp-donor-phone" className="sr-only">{t("preg.ui.plan.phone")}</Label>
            <Input id="bp-donor-phone" type="tel" placeholder={t("preg.ui.plan.phone")} value={form.donorPhone} onChange={text("donorPhone")} aria-invalid={errors?.donorPhone || undefined} />
            {errors?.donorPhone && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{t("preg.ui.plan.phone_bad")}</p>}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("preg.plan.escort")}</legend>
            <Label htmlFor="bp-escort-name" className="sr-only">{t("preg.ui.plan.name")}</Label>
            <Input id="bp-escort-name" placeholder={t("preg.ui.plan.name")} value={form.escortName} maxLength={120} onChange={text("escortName")} />
            <Label htmlFor="bp-escort-phone" className="sr-only">{t("preg.ui.plan.phone")}</Label>
            <Input id="bp-escort-phone" type="tel" placeholder={t("preg.ui.plan.phone")} value={form.escortPhone} onChange={text("escortPhone")} aria-invalid={errors?.escortPhone || undefined} />
            {errors?.escortPhone && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{t("preg.ui.plan.phone_bad")}</p>}
          </fieldset>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.longJourney} onChange={check("longJourney")} />
              {t("preg.plan.long_journey")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.previousFastLabour} onChange={check("previousFastLabour")} />
              {t("preg.ui.plan.previous_fast_labour")}
            </label>
            <div className="space-y-1">
              <Label htmlFor="bp-births">{t("preg.ui.plan.previous_births")}</Label>
              <Input id="bp-births" type="number" min={0} max={20} value={form.previousBirths} onChange={text("previousBirths")} className="w-24" />
            </div>
          </div>
          <Button type="submit" disabled={save.isPending}>{t("preg.ui.plan.save")}</Button>
          {save.isSuccess && <p role="status" className="text-sm">{t("preg.ui.plan.saved")}</p>}
          {save.isError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{t("preg.ui.plan.save_failed")}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
