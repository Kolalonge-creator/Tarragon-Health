import { DEFAULT_LOCALE, OUTPUT_KIND_KEYS, outputKindHintKey, t, type Locale, type OutputAudience, type OutputKind } from "@tarragon/i18n";

/**
 * The one label for what kind of output this is (spec D.4, audit G-02b): automated information, reviewed by the care team, or a
 * clinician decision. Every screen that shows AI output uses this instead of its own badge wording, so the same three words mean the
 * same thing everywhere. The words carry the meaning, not the colour; the longer explanation is in the title and in text for screen
 * readers. `note` keeps a screen's own specific caveat ("not yet filed") beside the label rather than replacing it.
 *
 * Choose `kind` with `outputKindFor({ reviewedByClinician, signedByClinician })` from the record, never by hand, so a screen cannot
 * show a stronger kind than its record supports.
 */
export function OutputKindLabel({
  kind,
  note,
  audience = "patient",
  locale = DEFAULT_LOCALE,
}: {
  kind: OutputKind;
  note?: string;
  /** "staff" on screens only clinicians and admins see, so the explanation does not say "your record". */
  audience?: OutputAudience;
  locale?: Locale;
}) {
  const keys = OUTPUT_KIND_KEYS[kind];
  const label = t(keys.label, locale);
  const hint = t(outputKindHintKey(kind, audience), locale);
  return (
    <span
      data-output-kind={kind}
      title={hint}
      className="inline-flex flex-wrap items-center gap-x-2 rounded-full border border-charcoal-ink/20 px-2.5 py-0.5 text-xs font-medium text-charcoal-ink dark:border-night-ink/30 dark:text-night-ink"
    >
      <span>{label}</span>
      {note ? <span className="font-normal text-charcoal-ink/70 dark:text-night-ink/70">{note}</span> : null}
      <span className="sr-only">{hint}</span>
    </span>
  );
}
