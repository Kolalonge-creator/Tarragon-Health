"use client";

import { useState, useTransition, type FormEvent } from "react";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmMyLabReport } from "./actions";

export interface ReportDraftRow {
  code: string;
  label: string;
  value: number;
  unit: string | null;
}

export interface ReportDraft {
  document_id: string;
  extraction_id: string;
  filename: string | null;
  report_date: string | null;
  confirmed: boolean;
  rows: ReportDraftRow[];
}

type UiLanguage = Parameters<typeof t>[1];

/**
 * The numbers read from a report the person uploaded themselves, for them to check and confirm. Confirming puts them on their own
 * chart marked as reported by them; a doctor has not checked them and the page says so. Nothing here grades, flags or explains a
 * number. Only shown for the person's own record.
 */
export function ReportedValuesConfirm({ drafts, uiLanguage }: { drafts: ReportDraft[]; uiLanguage: UiLanguage }) {
  if (drafts.length === 0) return null;
  return (
    <section aria-labelledby="reported-values-title" className="space-y-3">
      <div className="space-y-1">
        <h2 id="reported-values-title" className="text-base font-semibold">
          {t("biomarkers.reported.title", uiLanguage)}
        </h2>
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("biomarkers.reported.intro", uiLanguage)}</p>
      </div>
      {drafts.map((d) => (
        <DraftForm key={d.extraction_id} draft={d} uiLanguage={uiLanguage} />
      ))}
      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("biomarkers.reported.note", uiLanguage)}</p>
    </section>
  );
}

function DraftForm({ draft, uiLanguage }: { draft: ReportDraft; uiLanguage: UiLanguage }) {
  const [date, setDate] = useState(draft.report_date ?? "");
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(draft.rows.map((r) => [r.code, String(r.value)])));
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(draft.confirmed ? { kind: "ok", text: t("biomarkers.reported.done", uiLanguage) } : null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const readings = draft.rows.map((r) => ({ code: r.code, value: Number(values[r.code]), unit: r.unit }));
    if (readings.some((r) => values[r.code] === "" || !Number.isFinite(r.value))) {
      setMessage({ kind: "error", text: t("biomarkers.reported.error", uiLanguage) });
      return;
    }
    startTransition(async () => {
      const result = await confirmMyLabReport({ extractionId: draft.extraction_id, reportDate: date, readings });
      setMessage(result.ok ? { kind: "ok", text: t("biomarkers.reported.done", uiLanguage) } : { kind: "error", text: result.error || t("biomarkers.reported.error", uiLanguage) });
    });
  }

  const dateId = `report-date-${draft.extraction_id}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{draft.filename ?? ""}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor={dateId}>{t("biomarkers.reported.date", uiLanguage)}</Label>
            <Input id={dateId} type="date" required value={date} min="1990-01-01" onChange={(e) => setDate(e.target.value)} className="max-w-[12rem]" />
          </div>
          <ul className="space-y-3">
            {draft.rows.map((r) => {
              const id = `reported-${draft.extraction_id}-${r.code}`;
              return (
                <li key={r.code} className="grid items-end gap-2 sm:grid-cols-[1fr_9rem_5rem]">
                  <Label htmlFor={id}>{r.label}</Label>
                  <Input id={id} type="number" inputMode="decimal" step="any" min="0" required value={values[r.code] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [r.code]: e.target.value }))} />
                  <span className="pb-2 text-sm text-charcoal-ink/70 dark:text-night-ink/70">{r.unit ?? ""}</span>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? t("biomarkers.reported.saving", uiLanguage) : t("biomarkers.reported.confirm", uiLanguage)}
            </Button>
            {message && (
              <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm ${message.kind === "error" ? "text-red-700" : "text-deep-forest dark:text-brand-green-bright"}`}>
                {message.text}
              </p>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
