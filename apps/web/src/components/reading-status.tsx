import { STATUS_ICON } from "@/lib/icons";
import { VITAL_LEVEL_BADGE_CLASSNAME, type VitalLevel } from "@/lib/rules/vital-level-style";

/**
 * Design principle 2 (every number comes with a word, a colour and an icon). Shows a reading's status as icon + plain word on a tinted
 * chip. Colour is never the only signal: the icon shape differs per level and the word is always printed. The classification itself
 * comes from `readingStatus()` (existing deterministic classifiers); this component only displays it.
 *
 * Pass `value` to render the number too, so the number and its word cannot drift apart (for example "150/95 mmHg" then the chip).
 */
export function ReadingStatus({
  level,
  word,
  value,
  className = "",
}: {
  level: Exclude<VitalLevel, "unknown">;
  word: string;
  value?: string;
  className?: string;
}) {
  const Icon = STATUS_ICON[level];
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`} data-testid="reading-status" data-level={level}>
      {value ? <span>{value}</span> : null}
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${VITAL_LEVEL_BADGE_CLASSNAME[level]}`}
      >
        <Icon className="h-3 w-3 shrink-0" aria-hidden />
        {word}
      </span>
    </span>
  );
}
