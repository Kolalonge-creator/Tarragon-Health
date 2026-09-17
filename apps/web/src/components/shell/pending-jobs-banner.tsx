"use client";

import Link from "next/link";
import { useWorklistCounts, type WorklistCountKey } from "@/lib/queries/worklist-counts";
import { useMyPendingAutoDraftedNotes } from "@/lib/queries/encounter-notes";
import { APP_ICON } from "@/lib/icons";

export type PendingJobLink = { label: string; href: string; countKey: WorklistCountKey };

/**
 * "What needs me today", surfaced as a persistent banner rather than
 * something a doctor has to return to the dashboard to see — every other
 * clinician page already carries the sidebar's per-item badges
 * (NavBadge/app-shell.tsx), but a badge two clicks into a collapsed group is
 * easy to miss; this puts the same numbers, plus a direct link to act on
 * each one, at the top of every page they're on.
 *
 * `jobs` is the exact {label, href, countKey} list navigation.ts's clinician
 * nav sections already carry (computed server-side in (dashboard)/layout.tsx
 * from getNavSections("clinician", null), never hand-duplicated here) so
 * this can never drift from what the sidebar itself shows — and reusing the
 * identical countKey set means this shares AppShell's own
 * useWorklistCounts(...) cache entry one-for-one rather than issuing a
 * second round of count queries.
 *
 * "Notes to complete" (auto-generated draft clinical_encounter_notes,
 * 20260917031004_auto_generated_continuous_clinical_note.sql) isn't a
 * sidebar countKey at all — it's scoped to THIS clinician's own
 * clinical_staff.id, not a shared org-wide queue — so it's fetched
 * separately via the same hook the dashboard's own "Notes to complete" card
 * uses, and folded into the same pending-job pill list here.
 *
 * Hidden entirely at zero, same "a wall of zero pills is louder than
 * silence" rule NavBadge follows. A failed count query never renders as
 * "nothing pending" — see the isError branch.
 */
export function PendingJobsBanner({
  jobs,
  staffId,
}: {
  jobs: PendingJobLink[];
  staffId: string | null;
}) {
  const countKeys = jobs.map((j) => j.countKey);
  const { data: counts, isError: countsFailed } = useWorklistCounts(countKeys);
  const { data: pendingNotes, isError: notesFailed } = useMyPendingAutoDraftedNotes(
    staffId ?? undefined
  );

  const failed = countsFailed || (!!staffId && notesFailed);

  const pills: { label: string; href: string; count: number }[] = jobs
    .map((job) => ({ label: job.label, href: job.href, count: counts?.[job.countKey] ?? 0 }))
    .filter((job) => job.count > 0);

  const notesCount = pendingNotes?.length ?? 0;
  if (notesCount > 0) {
    pills.push({ label: "Notes to complete", href: "/clinician", count: notesCount });
  }

  const total = pills.reduce((sum, job) => sum + job.count, 0);

  if (!failed && total === 0) return null;

  return (
    <div
      role="status"
      className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10"
    >
      <div className="flex items-start gap-3">
        <APP_ICON.approvals
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
          strokeWidth={2}
        />
        <div className="min-w-0 flex-1 space-y-2">
          {failed ? (
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              Some pending-job counts could not be loaded. Check the sidebar and your queue pages
              directly rather than assuming nothing is waiting.
            </p>
          ) : (
            <>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {total} pending {total === 1 ? "job needs" : "jobs need"} you today
              </p>
              <div className="flex flex-wrap gap-1.5">
                {pills.map((job) => (
                  <Link
                    key={job.label}
                    href={job.href}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-transparent dark:text-amber-300 dark:hover:bg-amber-500/15"
                  >
                    {job.label}
                    <span className="rounded-full bg-amber-200/80 px-1.5 text-amber-900 dark:bg-amber-500/25 dark:text-amber-200">
                      {job.count}
                    </span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
