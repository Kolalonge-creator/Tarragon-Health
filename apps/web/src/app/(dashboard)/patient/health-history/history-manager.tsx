"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { addFamilyHistoryAction, addProcedureAction, removeHistoryItemAction } from "@/lib/health-history/actions";
import { FAMILY_RELATIONSHIPS } from "@/lib/health-history/schemas";
import { t, type Locale } from "@tarragon/i18n";

export interface ProcedureItem {
  id: string;
  name: string;
  approximate_year: number | null;
  performed_on: string | null;
  facility: string | null;
  verified_by_clinician: boolean;
}
export interface FamilyItem {
  id: string;
  condition_name: string;
  relationship: string;
  age_of_onset_years: number | null;
  verified_by_clinician: boolean;
}

function whenOf(p: ProcedureItem): string {
  if (p.performed_on) return new Date(p.performed_on).getFullYear().toString();
  return p.approximate_year ? String(p.approximate_year) : "";
}

export function HistoryManager({ procedures, family, canEdit, locale }: { procedures: ProcedureItem[]; family: FamilyItem[]; canEdit: boolean; locale: Locale }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ error?: string; success?: boolean }>, reset?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) setError(res.error);
      else {
        reset?.();
        router.refresh();
      }
    });
  }

  const [pName, setPName] = useState("");
  const [pYear, setPYear] = useState("");
  const [pWhere, setPWhere] = useState("");
  const [fCondition, setFCondition] = useState("");
  const [fRelative, setFRelative] = useState<string>("mother");
  const [fOnset, setFOnset] = useState("");

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("healthhistory.procedures_title", locale)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {procedures.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">{t("healthhistory.none", locale)}</p>
          ) : (
            <ul className="space-y-2">
              {procedures.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 rounded-lg border border-charcoal-ink/10 p-3">
                  <div className="text-sm">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-charcoal-ink/60">
                      {[whenOf(p), p.facility].filter(Boolean).join(" · ")}
                      {" · "}
                      {p.verified_by_clinician ? t("healthhistory.verified", locale) : t("healthhistory.not_verified", locale)}
                    </p>
                  </div>
                  {canEdit && (
                    <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => removeHistoryItemAction({ kind: "procedure", id: p.id }))}>
                      {t("healthhistory.remove", locale)}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <form
              className="grid gap-3 sm:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => addProcedureAction({ name: pName, year: pYear || undefined, facility: pWhere || undefined }), () => {
                  setPName("");
                  setPYear("");
                  setPWhere("");
                });
              }}
            >
              <div className="sm:col-span-3">
                <Label htmlFor="proc-name">{t("healthhistory.name_label", locale)}</Label>
                <Input id="proc-name" value={pName} onChange={(e) => setPName(e.target.value)} maxLength={200} required />
              </div>
              <div>
                <Label htmlFor="proc-year">{t("healthhistory.year_label", locale)}</Label>
                <Input id="proc-year" inputMode="numeric" maxLength={4} value={pYear} onChange={(e) => setPYear(e.target.value.replace(/\D/g, ""))} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="proc-where">{t("healthhistory.facility_label", locale)}</Label>
                <Input id="proc-where" value={pWhere} onChange={(e) => setPWhere(e.target.value)} maxLength={200} />
              </div>
              <Button type="submit" disabled={pending || !pName.trim()} className="sm:col-span-3 sm:w-fit">
                {t("healthhistory.add", locale)}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("healthhistory.family_title", locale)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {family.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">{t("healthhistory.none", locale)}</p>
          ) : (
            <ul className="space-y-2">
              {family.map((f) => (
                <li key={f.id} className="flex items-start justify-between gap-3 rounded-lg border border-charcoal-ink/10 p-3">
                  <div className="text-sm">
                    <p className="font-medium">{f.condition_name}</p>
                    <p className="text-xs text-charcoal-ink/60">
                      {f.relationship.replace(/_/g, " ")}
                      {f.age_of_onset_years ? `, from age ${f.age_of_onset_years}` : ""}
                      {" · "}
                      {f.verified_by_clinician ? t("healthhistory.verified", locale) : t("healthhistory.not_verified", locale)}
                    </p>
                  </div>
                  {canEdit && (
                    <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => removeHistoryItemAction({ kind: "family_history", id: f.id }))}>
                      {t("healthhistory.remove", locale)}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <form
              className="grid gap-3 sm:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => addFamilyHistoryAction({ condition: fCondition, relationship: fRelative, onsetAge: fOnset || undefined }), () => {
                  setFCondition("");
                  setFOnset("");
                });
              }}
            >
              <div className="sm:col-span-3">
                <Label htmlFor="fam-condition">{t("healthhistory.condition_label", locale)}</Label>
                <Input id="fam-condition" value={fCondition} onChange={(e) => setFCondition(e.target.value)} maxLength={120} required />
              </div>
              <div>
                <Label htmlFor="fam-relative">{t("healthhistory.relationship_label", locale)}</Label>
                <Select id="fam-relative" value={fRelative} onChange={(e) => setFRelative(e.target.value)}>
                  {FAMILY_RELATIONSHIPS.map((r) => (
                    <option key={r} value={r}>
                      {r.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="fam-onset">{t("healthhistory.onset_label", locale)}</Label>
                <Input id="fam-onset" inputMode="numeric" maxLength={3} value={fOnset} onChange={(e) => setFOnset(e.target.value.replace(/\D/g, ""))} />
              </div>
              <Button type="submit" disabled={pending || !fCondition.trim()} className="sm:col-span-3 sm:w-fit">
                {t("healthhistory.add", locale)}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
