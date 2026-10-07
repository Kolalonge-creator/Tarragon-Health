"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmDocumentFieldsAction, rejectDocumentReadingAction, requestDocumentReadingAction } from "@/lib/document-capture/actions";
import { decisionsForRpc, summariseDecisions, type FieldDecision, type SuggestedField } from "@/lib/document-capture/suggestions";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";

export interface DocumentRow {
  id: string;
  documentType: string;
  filename: string | null;
  createdAt: string;
  ocrState: string | null;
  fields: SuggestedField[];
  photoUrl: string | null;
}

function typeLabel(type: string, locale: Locale): string {
  return t(`passport.documents.type.${type}` as MessageKey, locale);
}

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Per-field review: nothing is kept until a field is accepted, and an edit replaces what was read. */
function SuggestionReview({ row, canConfirm, locale }: { row: DocumentRow; canConfirm: boolean; locale: Locale }) {
  const router = useRouter();
  const [decisions, setDecisions] = useState<Record<string, FieldDecision>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const list = Object.values(decisions);
  const summary = summariseDecisions(row.fields, list);

  function setField(key: string, patch: Partial<FieldDecision>) {
    setDecisions((prev) => ({ ...prev, [key]: { key, accept: patch.accept ?? prev[key]?.accept ?? false, value: patch.value ?? prev[key]?.value } }));
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const res = await confirmDocumentFieldsAction(row.id, decisionsForRpc(row.fields, list));
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }
  function reject() {
    setError(null);
    startTransition(async () => {
      const res = await rejectDocumentReadingAction(row.id);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{t("passport.documents.review_title", locale)}</p>
      <p className="text-xs text-charcoal-ink/65 dark:text-night-ink/65">{t("passport.documents.review_help", locale)}</p>
      <ul className="space-y-2">
        {row.fields.map((f) => {
          const d = decisions[f.key];
          return (
            <li key={f.key} className="rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-brand-green"
                  checked={d?.accept ?? false}
                  disabled={!canConfirm || pending}
                  onChange={(e) => setField(f.key, { accept: e.target.checked })}
                  aria-label={t("passport.documents.keep_aria", locale, { label: f.label })}
                />
                <span className="flex-1 text-sm">
                  <span className="block font-medium">{f.label}</span>
                  <span className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                    {t(`passport.documents.confidence.${f.confidence}` as MessageKey, locale)}
                  </span>
                </span>
              </label>
              <div className="mt-2 flex items-center gap-2 pl-7">
                <Input
                  aria-label={t("passport.documents.value_aria", locale, { label: f.label })}
                  defaultValue={f.value}
                  disabled={!canConfirm || pending}
                  onChange={(e) => setField(f.key, { value: e.target.value })}
                  className="h-9"
                />
                {f.unit && <span className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{f.unit}</span>}
              </div>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={confirm} disabled={!canConfirm || pending || !summary.canConfirm}>
          {t("passport.documents.confirm", locale, { count: String(summary.accepted) })}
        </Button>
        <Button type="button" variant="outline" onClick={reject} disabled={!canConfirm || pending}>
          {t("passport.documents.reject", locale)}
        </Button>
      </div>
      {summary.dropped > 0 && <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("passport.documents.dropped_note", locale, { count: String(summary.dropped) })}</p>}
    </div>
  );
}

/** A photo that is still waiting: the person can ask again, or decide it should not be read. It never waits with no way out. */
function PendingActions({ row, canConfirm, locale }: { row: DocumentRow; canConfirm: boolean; locale: Locale }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function run(action: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) setError(res.error);
      router.refresh();
    });
  }
  return (
    <div className="mt-2 space-y-2">
      <p className="text-xs text-charcoal-ink/65 dark:text-night-ink/65">{t("passport.documents.state.pending", locale)}</p>
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
      {canConfirm && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={pending} onClick={() => run(() => requestDocumentReadingAction(row.id))}>
            {t("passport.documents.read_now", locale)}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => rejectDocumentReadingAction(row.id))}>
            {t("passport.documents.not_now", locale)}
          </Button>
        </div>
      )}
    </div>
  );
}

export function DocumentList({ rows, canConfirm, locale }: { rows: DocumentRow[]; canConfirm: boolean; locale: Locale }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("passport.documents.list_title", locale)}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{t("passport.documents.none", locale)}</p>
        ) : (
          <ul className="space-y-4">
            {rows.map((row) => (
              <li key={row.id} className="rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm">
                    <p className="font-medium">{typeLabel(row.documentType, locale)}</p>
                    <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                      {formatDate(row.createdAt)}
                      {row.filename ? ` · ${row.filename}` : ""}
                    </p>
                  </div>
                  {row.photoUrl && (
                    <a href={row.photoUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-brand-green hover:underline dark:text-brand-green-bright">
                      {t("passport.documents.view_photo", locale)}
                    </a>
                  )}
                </div>
                {row.ocrState === "suggested" && <SuggestionReview row={row} canConfirm={canConfirm} locale={locale} />}
                {row.ocrState === "pending" && <PendingActions row={row} canConfirm={canConfirm} locale={locale} />}
                {row.ocrState === "confirmed" && (
                  <div className="mt-3 space-y-1">
                    <p className="text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">{t("passport.documents.state.confirmed", locale)}</p>
                    <ul className="text-sm">
                      {row.fields.map((f) => (
                        <li key={f.key}>
                          {f.label}: {f.value}
                          {f.unit ? ` ${f.unit}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(row.ocrState === "failed" || row.ocrState === "rejected") && (
                  <p className="mt-2 text-xs text-charcoal-ink/65 dark:text-night-ink/65">{t(`passport.documents.state.${row.ocrState}` as MessageKey, locale)}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
