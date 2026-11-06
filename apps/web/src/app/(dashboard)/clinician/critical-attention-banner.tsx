import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { CriticalBannerView } from "@tarragon/shared";

/**
 * Doctor workspace spec 8.2: a restrained safety banner, shown only while an emergency-level case is routed to
 * this doctor or still unassigned. It is not dismissible: it goes away when the case is started or resolved,
 * never because someone closed it. Colour is never the only signal: the words say "Emergency" and the count.
 */
export function CriticalAttentionBanner({ view }: { view: CriticalBannerView }) {
  if (view.kind === "none") return null;
  const { count, firstId } = view;
  const noun = count === 1 ? "emergency case needs" : "emergency cases need";
  return (
    <section
      role="alert"
      aria-label="Emergency cases"
      className="flex flex-col gap-3 rounded-2xl border border-red-300 bg-red-50 p-4 text-red-900 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="flex items-start gap-2 text-sm font-medium">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <span className="font-semibold">Emergency:</span> {count} {noun} review now.
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/clinician/escalations/${firstId}`}
          className="inline-flex min-h-11 items-center rounded-lg bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
        >
          Open the most urgent
        </Link>
        {count > 1 && (
          <Link
            href="/clinician/escalations"
            className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium underline"
          >
            See all {count}
          </Link>
        )}
      </div>
    </section>
  );
}
