"use client";

import { useState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FormError } from "@/components/ui/form-error";
import { FamilyNoteAttribution } from "@/components/care-circle/family-doctor-note-card";
import { useMyFamilyNotes, useSetFamilyNoteShared } from "@/lib/queries/care-circle";
import type { MyFamilyNote } from "@/lib/care-circle/model";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const PILL = "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium";

type Notice = "familynote.mine.shared_done" | "familynote.mine.unshared_done";

/**
 * The patient's own card (2026-11-03, review fix): every line a doctor writes for the family reaches the PATIENT first. Family sees a
 * note only after the patient presses "Share with my Care Circle" on that note, and the patient can stop sharing at any time. Nothing
 * here is shared by default; "Don't share" is remembered so the card stops asking. A failed read shows nothing, which shares nothing.
 */
export function MyFamilyNoteCard({ locale }: { locale: Locale }) {
  const notes = useMyFamilyNotes();
  const setShared = useSetFamilyNoteShared();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [failed, setFailed] = useState(false);

  if (notes.isLoading) {
    return (
      <div role="status" aria-label={t("familynote.mine.loading", locale)} className="space-y-3">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  const rows = notes.data ?? [];
  const latest = rows[0];
  if (!latest) return null;
  // when the latest note is private, family may still see an earlier one the patient shared: say so, and let them stop it
  const earlierShared = latest.shared ? undefined : rows.slice(1).find((n) => n.shared);

  async function decide(note: MyFamilyNote, share: boolean) {
    setFailed(false);
    setNotice(null);
    try {
      const nowShared = await setShared.mutateAsync({ noteId: note.note_id, share });
      setNotice(nowShared ? "familynote.mine.shared_done" : "familynote.mine.unshared_done");
    } catch {
      setFailed(true);
    }
  }

  return (
    <Card aria-labelledby="my-family-note-title" className="overflow-hidden">
      <CardHeader className="gap-2 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle as="h2" id="my-family-note-title" className="text-lg">{t("familynote.mine.title", locale)}</CardTitle>
          <span
            className={`${PILL} ${latest.shared ? "bg-soft-sage text-deep-forest dark:bg-brand-green/20 dark:text-brand-green-bright" : "bg-charcoal-ink/[0.06] text-charcoal-ink dark:bg-night-ink/10 dark:text-night-ink"}`}
          >
            {latest.shared ? t("familynote.mine.shared", locale) : t("familynote.mine.private", locale)}
          </span>
        </div>
        <p className={`text-sm leading-relaxed ${MUTED}`}>{t("familynote.mine.intro", locale)}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <figure className="space-y-4 rounded-xl bg-warm-ivory p-4 dark:bg-night-ink/10">
          <blockquote className="border-l-4 border-brand-green pl-4 text-base leading-relaxed text-charcoal-ink sm:text-lg dark:text-night-ink">
            <p className="whitespace-pre-line break-words">{latest.body}</p>
          </blockquote>
          <figcaption>
            <FamilyNoteAttribution note={latest} locale={locale} />
          </figcaption>
        </figure>
        <p className={`text-sm ${MUTED}`}>{t("familynote.mine.who", locale)}</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {latest.shared ? (
            <Button type="button" variant="outline" className="min-h-11" disabled={setShared.isPending} onClick={() => void decide(latest, false)}>
              {t("familynote.mine.stop", locale)}
            </Button>
          ) : (
            <>
              <Button type="button" className="min-h-11" disabled={setShared.isPending} aria-busy={setShared.isPending} onClick={() => void decide(latest, true)}>
                {t("familynote.mine.share", locale)}
              </Button>
              {!latest.decided ? (
                <Button type="button" variant="ghost" className="min-h-11" disabled={setShared.isPending} onClick={() => void decide(latest, false)}>
                  {t("familynote.mine.dont_share", locale)}
                </Button>
              ) : null}
            </>
          )}
        </div>
        {notice ? <p role="status" className="text-sm">{t(notice, locale)}</p> : null}
        <FormError id="my-family-note-error" message={failed ? t("familynote.mine.error", locale) : null} />

        {earlierShared ? (
          <section aria-labelledby="my-family-note-earlier" className="space-y-3 rounded-xl border border-charcoal-ink/10 p-4 dark:border-night-ink/15">
            <h3 id="my-family-note-earlier" className="text-sm font-semibold">{t("familynote.mine.earlier", locale)}</h3>
            <p className="whitespace-pre-line break-words text-sm">{earlierShared.body}</p>
            <FamilyNoteAttribution note={earlierShared} locale={locale} />
            <Button type="button" variant="outline" className="min-h-11" disabled={setShared.isPending} onClick={() => void decide(earlierShared, false)}>
              {t("familynote.mine.stop", locale)}
            </Button>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
