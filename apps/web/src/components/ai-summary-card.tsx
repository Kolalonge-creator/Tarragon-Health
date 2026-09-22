"use client";

import type { ReactNode } from "react";
import type { Database } from "@tarragon/shared";

type AiSummaryStatus = Database["public"]["Enums"]["lab_result_ai_summary_status"];

/**
 * Shared presentational chrome for a deterministic, patient-visible AI
 * summary card — factored out of AiResultSummary/AiEcgSummary/
 * AiImagingSummary, which used to each carry a byte-for-byte copy of this
 * wrapper (pending/unavailable early returns, amber-flagged vs slate-ready
 * card styling). Each caller supplies only its own label text and body via
 * `children`, a render prop invoked with `isFlagged` only once status is
 * known to be 'ready' or 'flagged' — never for 'pending'/'unavailable', so a
 * caller's body content is never computed for a status where it won't be
 * shown.
 */
export function AiSummaryCard({
  status,
  label,
  children,
}: {
  status: AiSummaryStatus;
  label: string;
  children: (isFlagged: boolean) => ReactNode;
}) {
  if (status === "pending") {
    return (
      <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
        Preparing an automatic summary…
      </p>
    );
  }
  if (status === "unavailable") {
    return null;
  }

  const isFlagged = status === "flagged";

  return (
    <div
      className={`rounded-lg border p-3 ${
        isFlagged
          ? "border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/15"
          : "border-slate-200 dark:border-night-ink/15 bg-slate-50 dark:bg-night-ink/10"
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/55">
        {label}
      </p>
      {children(isFlagged)}
    </div>
  );
}
