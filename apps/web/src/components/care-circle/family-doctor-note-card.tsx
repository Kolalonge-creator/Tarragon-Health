import { t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/avatar";
import { formatPatientDate } from "@/lib/format-date";
import type { DoctorNote } from "@/lib/care-circle/model";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

/**
 * Who wrote the family note: the same null-gated rule as ReviewedByDoctor (docs/CLINICAL_TRUST_MODEL_SPEC.md §2), for a supporter who
 * cannot read clinical_staff themselves. A name is shown ONLY when the database sent both the author's staff id and name (it sends them
 * only for an active, named clinician) and the note has a date; anything less is "your care team". Never a hardcoded name, and no link to
 * a profile page (a supporter-only account cannot open one).
 */
export function FamilyNoteAttribution({ note, locale }: { note: Pick<DoctorNote, "author_staff_id" | "author_name" | "written_at">; locale: Locale }) {
  const named = note.author_staff_id && note.author_name && note.written_at ? note.author_name : null;
  return (
    <div className="flex items-center gap-3">
      {named ? <Avatar fullName={named} photoUrl={null} size="lg" alt="" /> : null}
      <p className="text-sm">
        <span className="font-medium text-charcoal-ink dark:text-night-ink">
          {named ? t("familynote.view.from", locale, { name: named }) : t("familynote.view.from_team", locale)}
        </span>
        <span className={`block ${MUTED}`}>
          <time dateTime={note.written_at}>{t("familynote.view.written", locale, { date: formatPatientDate(note.written_at) })}</time>
        </span>
      </p>
    </div>
  );
}

/**
 * The doctor's line for the family (2026-11-03), on the supporter's page and the patient's "see what they see" preview. `note` absent
 * means not shared (render nothing, the caller never asks for it another way); `null` means shared but nothing written yet.
 */
export function FamilyDoctorNoteCard({ note, locale }: { note: DoctorNote | null; locale: Locale }) {
  return (
    <Card variant="sage" aria-labelledby="family-note-title">
      <CardHeader className="pb-3">
        <CardTitle id="family-note-title" className="text-lg">{t("familynote.view.title", locale)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {note ? (
          <figure className="space-y-4">
            <blockquote className="border-l-4 border-brand-green pl-4 text-base leading-relaxed text-charcoal-ink sm:text-lg dark:text-night-ink">
              <p className="whitespace-pre-line break-words">{note.body}</p>
            </blockquote>
            <figcaption>
              <FamilyNoteAttribution note={note} locale={locale} />
            </figcaption>
          </figure>
        ) : (
          <p className={MUTED}>{t("familynote.view.none", locale)}</p>
        )}
      </CardContent>
    </Card>
  );
}
