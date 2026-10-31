"use client";

import { useLabPartnerDashboardStats } from "@/lib/queries/lab-specimens";
import { labPartnerFirstView } from "@/lib/lab-partner/first-view";
import { LoadFailure } from "@/components/ui/load-failure";
import { NeedsFirst } from "@/components/ui/needs-first";

/**
 * The first thing on the lab home. Which items show, in what order, and when
 * the view must refuse to say "nothing waiting" is decided in
 * lib/lab-partner/first-view.ts, where it is tested.
 */
export function LabPartnerFirst({ awaiting }: { awaiting: number | null }) {
  const { data: stats, isError } = useLabPartnerDashboardStats();
  const view = labPartnerFirstView({
    awaiting,
    delayed: stats?.samples_delayed,
    delayedFailed: isError && !stats,
  });

  if (view.kind === "unknown") {
    return (
      <LoadFailure>
        Some counts did not load, so we cannot say whether anything is waiting on you. Refresh the page to try again.
      </LoadFailure>
    );
  }
  if (view.kind === "loading") {
    return <NeedsFirst id="lab-first" body={{ kind: "loading", text: "Checking your orders and samples…" }} />;
  }
  if (view.kind === "clear") {
    return (
      <NeedsFirst
        id="lab-first"
        body={{ kind: "clear", text: "No delayed samples and no orders waiting for a result." }}
      />
    );
  }
  return (
    <NeedsFirst
      id="lab-first"
      body={{
        kind: "items",
        top: view.top,
        rest: view.rest,
        notice: view.incomplete
          ? "This list is incomplete: some counts did not load. Refresh the page to try again."
          : undefined,
      }}
    />
  );
}
