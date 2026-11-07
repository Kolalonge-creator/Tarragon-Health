import Link from "next/link";
import type { JourneyStage } from "@tarragon/shared";

/**
 * The service-delivery pipeline: every journey stage as a step with the number of patients who reached it, linking to where the work
 * for that step is done. A horizontal row on wide screens, a vertical list on a phone. Each share is of all registered patients, not a completion rate, because not
 * every patient needs every step and longitudinal care has no finish line. The steps are not nested, so a share of the previous
 * step could pass 100%.
 */
export function JourneyPipeline({ stages }: { stages: readonly JourneyStage[] }) {
  return (
    <ol className="grid gap-2 sm:grid-cols-3 lg:grid-cols-9" aria-label="Patient journey stages">
      {stages.map((s, i) => (
        <li key={s.key} className="relative">
          <Link
            href={s.href}
            className="flex h-full flex-col rounded-xl bg-white p-3 ring-1 ring-charcoal-ink/10 hover:ring-brand-green/50 focus-visible:outline-2 focus-visible:outline-brand-green"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-ink/50">Step {i + 1}</span>
            <span className="text-sm font-medium leading-snug text-charcoal-ink">{s.label}</span>
            <span className="mt-1 font-heading text-2xl font-semibold tabular-nums text-charcoal-ink">{s.reached.toLocaleString("en-NG")}</span>
            <span className="text-xs text-charcoal-ink/60">{s.ofRegistered ? `${s.ofRegistered.pct}% of registered (${s.ofRegistered.text})` : i === 0 ? "patients" : "nobody registered yet"}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
