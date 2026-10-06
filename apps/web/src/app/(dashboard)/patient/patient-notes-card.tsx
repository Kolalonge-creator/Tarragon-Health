"use client";

import { useState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import {
  useMyNoteIndex,
  useMyReleasedNotes,
  useRequestNoteCorrection,
  useRequestNoteRelease,
} from "@/lib/queries/patient-notes";
import {
  AMENDMENT_KEYS,
  CORRECTION_STATE_KEYS,
  groupNotes,
  noteSections,
  type ReleasedNote,
} from "@/lib/written-questions/notes";
import { formatPatientDate } from "@/lib/format-date";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormError, FormSuccess, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const TOUCH = "min-h-11";
const MIN_CORRECTION = 10;

function Sections({ note, locale }: { note: ReleasedNote; locale: Locale }) {
  return (
    <dl className="space-y-2">
      {noteSections(note).map((s) => (
        <div key={s.key}>
          <dt className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">{t(s.key, locale)}</dt>
          <dd className="whitespace-pre-line text-sm text-charcoal-ink dark:text-night-ink">{s.text}</dd>
        </div>
      ))}
    </dl>
  );
}

function CorrectionForm({ note, locale }: { note: ReleasedNote; locale: Locale }) {
  const request = useRequestNoteCorrection();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState(false);
  const [sent, setSent] = useState(false);
  const id = `note-correction-${note.id}`;
  const errId = fieldErrorId(id);

  async function send() {
    setError(false);
    setSent(false);
    try {
      await request.mutateAsync({ noteId: note.id, text: text.trim() });
      setText("");
      setSent(true);
      setOpen(false);
    } catch {
      setError(true);
    }
  }

  return (
    <div className="space-y-2">
      {(note.corrections ?? []).map((c) => (
        <div key={c.id} className="rounded-md bg-charcoal-ink/5 p-2 text-sm dark:bg-night-ink/10">
          <p className="whitespace-pre-line">{c.request_text}</p>
          <p className={`text-xs ${MUTED}`}>{t(CORRECTION_STATE_KEYS[c.state] ?? "notes.correction.open", locale)}</p>
          {c.response && <p className="text-sm">{t("notes.correction.reply", locale, { text: c.response })}</p>}
        </div>
      ))}
      <FormSuccess message={sent && t("notes.correction.sent", locale)} />
      {open ? (
        <div className="space-y-2">
          <Label htmlFor={id}>{t("notes.correction.label", locale)}</Label>
          <Textarea id={id} rows={3} value={text} onChange={(e) => setText(e.target.value)} {...fieldErrorProps(errId, error)} />
          <FormError id={errId} message={error && t("wq.error.generic", locale)} />
          <Button className={TOUCH} onClick={send} disabled={request.isPending || text.trim().length < MIN_CORRECTION}>
            {t("notes.correction.send", locale)}
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" className={TOUCH} onClick={() => setOpen(true)}>
          {t("notes.correction.cta", locale)}
        </Button>
      )}
    </div>
  );
}

/** Index first (never any clinical text); a note's content appears only once a clinician has released it. */
export function PatientNotesCard({ locale }: { locale: Locale }) {
  const index = useMyNoteIndex();
  const released = useMyReleasedNotes();
  const requestRelease = useRequestNoteRelease();

  const groups = groupNotes(index.data ?? [], released.data ?? []);

  return (
    <Card id="your-notes">
      <CardHeader>
        <CardTitle>{t("notes.title", locale)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className={`text-sm ${MUTED}`}>{t("notes.intro", locale)}</p>
        {requestRelease.isError && <FormError id={fieldErrorId("notes-release")} message={t("wq.error.generic", locale)} />}
        {groups.length === 0 && !index.isLoading && <p className={`text-sm ${MUTED}`}>{t("notes.empty", locale)}</p>}
        <ul className="space-y-4">
          {groups.map(({ entry, note, amendments }) => (
            <li key={entry.id} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
              <div className="flex flex-wrap items-center gap-2">
                {entry.signed_at && <p className="text-sm font-medium">{t("notes.signed_on", locale, { date: formatPatientDate(entry.signed_at) })}</p>}
                {entry.release_state === "released" && <Badge variant="green">{t("notes.released_badge", locale)}</Badge>}
              </div>
              {entry.release_state === "not_requested" && (
                <Button size="sm" variant="outline" className={TOUCH} onClick={() => requestRelease.mutate(entry.id)} disabled={requestRelease.isPending}>
                  {t("notes.request", locale)}
                </Button>
              )}
              {entry.release_state === "requested" && <p className={`text-sm ${MUTED}`}>{t("notes.requested", locale)}</p>}
              {entry.release_state === "declined" && (
                <p className={`text-sm ${MUTED}`}>{t("notes.declined", locale, { reason: entry.withhold_reason ?? "" })}</p>
              )}
              {note && (
                <div className="space-y-3">
                  {amendments.length > 0 && amendments[0].signed_at && (
                    <p className="text-xs font-medium">{t("notes.amended", locale, { date: formatPatientDate(amendments[0].signed_at) })}</p>
                  )}
                  <Sections note={note} locale={locale} />
                  {amendments.map((a) => (
                    <div key={a.id} className="space-y-2 border-l-2 border-brand-green/40 pl-3">
                      <p className="text-sm font-medium">
                        {t(AMENDMENT_KEYS[a.amendment_kind ?? ""] ?? "notes.amendment.addendum", locale)}
                        {a.signed_at ? `, ${formatPatientDate(a.signed_at)}` : ""}
                      </p>
                      {a.amendment_reason && <p className={`text-xs ${MUTED}`}>{t("notes.amendment.reason", locale, { reason: a.amendment_reason })}</p>}
                      <Sections note={a} locale={locale} />
                    </div>
                  ))}
                  <CorrectionForm note={note} locale={locale} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
