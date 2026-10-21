"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { saveEmergencyCardCoverageAction } from "@/lib/emergency/actions";
import { t, type Locale } from "@tarragon/i18n";

/**
 * Optional HMO / NHIA cover for the emergency card (S09y). Typed by the patient, shown on the printed card and the live link only once filled in,
 * never on the lock-screen card, and said to be unchecked wherever it appears.
 */
export function CoverageForm({
  initial,
  locale = "en",
}: {
  initial: { scheme: "hmo" | "nhia"; memberNumber: string | null; planName: string | null } | null;
  locale?: Locale;
}) {
  const [scheme, setScheme] = useState<"hmo" | "nhia">(initial?.scheme ?? "hmo");
  const [memberNumber, setMemberNumber] = useState(initial?.memberNumber ?? "");
  const [planName, setPlanName] = useState(initial?.planName ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(clear: boolean) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const res = await saveEmergencyCardCoverageAction({ scheme, member_number: clear ? "" : memberNumber, plan_name: clear ? "" : planName });
      if (res.error) {
        setError(res.field === "member_number" ? t("ecf.coverage.error_member", locale) : res.field === "plan_name" ? t("ecf.coverage.error_plan", locale) : t("ecf.coverage.error", locale));
        return;
      }
      if (clear) {
        setMemberNumber("");
        setPlanName("");
      }
      setMessage(res.message === "removed" ? t("ecf.coverage.removed", locale) : t("ecf.coverage.saved", locale));
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("ecf.coverage.title", locale)}</CardTitle>
        <CardDescription>{t("ecf.coverage.description", locale)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="cov-scheme">{t("ecf.coverage.scheme", locale)}</Label>
            <Select id="cov-scheme" value={scheme} onChange={(e) => setScheme(e.target.value === "nhia" ? "nhia" : "hmo")}>
              <option value="hmo">{t("ecf.coverage.scheme_hmo", locale)}</option>
              <option value="nhia">{t("ecf.coverage.scheme_nhia", locale)}</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cov-member">{t("ecf.coverage.member_label", locale)}</Label>
            <Input id="cov-member" value={memberNumber} maxLength={40} autoComplete="off" onChange={(e) => setMemberNumber(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cov-plan">{t("ecf.coverage.plan_label", locale)}</Label>
            <Input id="cov-plan" value={planName} maxLength={80} autoComplete="off" onChange={(e) => setPlanName(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-charcoal-ink/65 dark:text-night-ink/65">{t("ecf.coverage.lock_screen_note", locale)}</p>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
            {message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => run(false)} disabled={pending || (memberNumber.trim() === "" && planName.trim() === "")}>
            {t("ecf.coverage.save", locale)}
          </Button>
          {initial ? (
            <Button type="button" variant="outline" onClick={() => run(true)} disabled={pending}>
              {t("ecf.coverage.clear", locale)}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
