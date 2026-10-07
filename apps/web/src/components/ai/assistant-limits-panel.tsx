import { ASSISTANT_LIMITS } from "@tarragon/shared";

/**
 * S52 (spec 7.9): the visible limits of the assistant, on every assistant screen, from the same bundled copy the mobile app uses.
 * A native <details> so it works with no script and is keyboard and screen-reader friendly.
 */
export function AssistantLimitsPanel() {
  return (
    <details className="rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 p-2 text-xs text-charcoal-ink/70 dark:text-night-ink/70">
      <summary className="cursor-pointer font-medium">{ASSISTANT_LIMITS.title}</summary>
      <ul className="list-disc space-y-1 pl-5 pt-1">
        {ASSISTANT_LIMITS.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </details>
  );
}
