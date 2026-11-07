import { Suspense } from "react";
import { UnifiedWorklist } from "./unified-worklist";

export const metadata = { title: "My worklist" };

/** Suspense: the saved view lives in the URL (?view=), read with useSearchParams. */
export default function CareCoordinationWorklistPage() {
  return (
    <Suspense fallback={<p className="text-sm text-charcoal-ink/60">Loading…</p>}>
      <UnifiedWorklist />
    </Suspense>
  );
}
