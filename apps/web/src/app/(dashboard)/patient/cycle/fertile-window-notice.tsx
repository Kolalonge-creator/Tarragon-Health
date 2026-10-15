import Link from "next/link";
import { en, FERTILE_WINDOW_LABEL, FERTILE_WINDOW_LINK_TEXT } from "@tarragon/i18n";

/**
 * S85 D2 / OQ-12: the words every screen that shows the fertile window, estimated ovulation or a temperature-based
 * ovulation confirmation must carry. The text is never typed here: it comes from the one wording source in
 * `@tarragon/i18n` (`clinical-wording.json`, CMO signature pending), so a screen cannot drift from the others.
 * A missing label is the unsafe state, so this component has no prop that hides it.
 */
export function FertileWindowNotice({ className }: { className?: string }) {
  return (
    <div
      data-testid="fertile-window-notice"
      className={["rounded-lg border border-charcoal-ink/15 dark:border-night-ink/20 p-3 text-sm", className]
        .filter(Boolean)
        .join(" ")}
    >
      <p className="font-medium text-charcoal-ink dark:text-night-ink">{FERTILE_WINDOW_LABEL}</p>
      <Link
        href="/patient/womens-health"
        className="mt-1 inline-block font-medium text-brand-green dark:text-brand-green-bright underline"
      >
        {FERTILE_WINDOW_LINK_TEXT}
      </Link>
    </div>
  );
}

/**
 * The "Planning a pregnancy" switch. Off by default. Controlled: the tracker owns the value so the ring, calendar and
 * numbers all change together with it.
 */
export function PlanningModeSwitch({
  enabled,
  pending,
  error,
  onChange,
}: {
  enabled: boolean;
  pending: boolean;
  error: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p id="planning-mode-title" className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
          {en["cycle.planning_mode.title"]}
        </p>
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{en["cycle.planning_mode.description"]}</p>
        {enabled && (
          <p className="mt-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">{en["cycle.planning_mode.on_note"]}</p>
        )}
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {en["cycle.planning_mode.error"]}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-labelledby="planning-mode-title"
        disabled={pending}
        onClick={() => onChange(!enabled)}
        className={[
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60",
          enabled ? "bg-brand-green" : "bg-charcoal-ink/25 dark:bg-night-ink/30",
        ].join(" ")}
      >
        <span
          aria-hidden
          className={[
            "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
            enabled ? "left-[22px]" : "left-0.5",
          ].join(" ")}
        />
      </button>
    </div>
  );
}
