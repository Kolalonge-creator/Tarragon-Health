"use client";

import { useId, useState, useTransition } from "react";
import { FAMILY_NOTE_MAX, t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormError } from "@/components/ui/form-error";
import { formatPatientDate } from "@/lib/format-date";
import { saveFamilyNoteAction } from "@/lib/consultations/family-note-actions";
import type { FamilyNoteFailReason, SavedFamilyNote } from "@/lib/consultations/family-note";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

const FAIL_KEYS: Readonly<Record<FamilyNoteFailReason, "familynote.form.empty" | "familynote.form.too_long" | "familynote.form.not_allowed" | "familynote.form.error">> = {
  invalid: "familynote.form.empty",
  too_long: "familynote.form.too_long",
  signed_out: "familynote.form.not_allowed",
  not_allowed: "familynote.form.not_allowed",
  failed: "familynote.form.error",
};

/**
 * Where the doctor finishes a consultation (2026-11-03): an OPTIONAL single short line for the patient's family. The hint tells the doctor
 * what not to write. The family sees it only through the Care Circle, only if the patient has shared "a line from the doctor" with them,
 * and only the latest line. Saving again adds a new line (a correction); nothing is edited in place.
 */
export function FamilyNoteForm({ encounterId, latest, locale }: { encounterId: string; latest: SavedFamilyNote | null; locale: Locale }) {
  const id = useId();
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const [fail, setFail] = useState<FamilyNoteFailReason | null>(null);
  const [saved, setSaved] = useState<SavedFamilyNote | null>(latest);
  const [justSaved, setJustSaved] = useState(false);
  const used = body.trim().length;
  const over = used > FAMILY_NOTE_MAX;

  function save() {
    setFail(null);
    setJustSaved(false);
    if (used === 0) {
      setFail("invalid");
      return;
    }
    if (over) {
      setFail("too_long");
      return;
    }
    start(async () => {
      const r = await saveFamilyNoteAction({ encounterId, body });
      if (r.ok) {
        setSaved({ body: body.trim(), created_at: new Date().toISOString() });
        setBody("");
        setJustSaved(true);
      } else {
        setFail(r.reason);
      }
    });
  }

  const errorId = `${id}-error`;
  return (
    <Card aria-labelledby={`${id}-title`}>
      <CardHeader className="pb-3">
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle as="h2" id={`${id}-title`} className="text-lg">{t("familynote.form.title", locale)}</CardTitle>
          <span className={`text-xs uppercase tracking-wide ${MUTED}`}>{t("familynote.form.optional", locale)}</span>
        </div>
        <p className={`text-sm ${MUTED}`}>{t("familynote.form.who", locale)}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {saved ? (
          <div className="space-y-2 rounded-lg border border-brand-green/25 bg-soft-sage/50 p-3 dark:bg-brand-green/10">
            <p className="whitespace-pre-line break-words">{saved.body}</p>
            <p className={`text-xs ${MUTED}`}>
              <time dateTime={saved.created_at}>{t("familynote.view.written", locale, { date: formatPatientDate(saved.created_at) })}</time>
            </p>
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor={`${id}-body`}>{t("familynote.form.label", locale)}</Label>
          <p id={`${id}-hint`} className={`text-sm ${MUTED}`}>{t("familynote.form.hint", locale)}</p>
          <Textarea
            id={`${id}-body`}
            value={body}
            rows={3}
            maxLength={FAMILY_NOTE_MAX + 40}
            aria-describedby={`${id}-hint ${id}-count${fail ? ` ${errorId}` : ""}`}
            aria-invalid={over || fail === "too_long" || undefined}
            onChange={(e) => {
              setFail(null);
              setJustSaved(false);
              setBody(e.target.value);
            }}
          />
          <p id={`${id}-count`} className={`text-right text-xs ${over ? "font-medium text-red-700 dark:text-red-400" : MUTED}`} aria-live="polite">
            {t("familynote.form.count", locale, { used, max: FAMILY_NOTE_MAX })}
          </p>
        </div>
        <FormError id={errorId} message={fail ? t(FAIL_KEYS[fail], locale, { max: FAMILY_NOTE_MAX }) : null} />
        {justSaved ? <p role="status" className="text-sm">{t("familynote.form.saved", locale)}</p> : null}
        <Button type="button" className="min-h-11" disabled={pending} aria-busy={pending} onClick={save}>
          {pending ? t("familynote.form.saving", locale) : t("familynote.form.save", locale)}
        </Button>
      </CardContent>
    </Card>
  );
}
