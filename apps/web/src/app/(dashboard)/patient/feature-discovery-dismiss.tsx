"use client";

import { useTransition } from "react";
import { NAV_ICON } from "@/lib/icons";
import { recordFeatureView } from "@/app/(dashboard)/patient/feature-discovery-actions";

/**
 * "Not for me" on one suggestion. Small, unlabelled and low-contrast on
 * purpose: it should be findable by anybody who wants it and invisible to
 * anybody who does not, because a prominent dismiss control turns a quiet
 * mention into a decision the patient has to make.
 */
export function DismissFeatureButton({
  featureId,
  label,
}: {
  featureId: string;
  label: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Hide "${label}"`}
      title="Not for me"
      onClick={() =>
        startTransition(async () => {
          await recordFeatureView({ featureId, action: "dismissed" });
        })
      }
      className="shrink-0 rounded-lg p-1.5 text-charcoal-ink/25 transition-colors hover:bg-charcoal-ink/5 hover:text-charcoal-ink/60 disabled:opacity-40"
    >
      <NAV_ICON.close className="h-4 w-4" strokeWidth={2} />
    </button>
  );
}
