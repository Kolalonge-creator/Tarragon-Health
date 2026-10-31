import { LoadFailure } from "@/components/ui/load-failure";
import { NeedsFirst } from "@/components/ui/needs-first";
import type { FirstView } from "@/lib/payer/first-view";

/** Draws the payer "Needs you first" block. What it says is decided in lib/payer/first-view.ts. */
export function PayerFirst({ view }: { view: FirstView }) {
  if (view.kind === "unknown") {
    return (
      <LoadFailure>
        Your work queues could not be loaded, so we cannot say whether anything is waiting on you. Refresh the page to
        try again.
      </LoadFailure>
    );
  }
  if (view.kind === "clear") {
    return (
      <NeedsFirst
        id="payer-first"
        body={{
          kind: "clear",
          text: "No pre-authorisations to decide, no claims to adjudicate and no approved claims to pay.",
        }}
      />
    );
  }
  return (
    <NeedsFirst
      id="payer-first"
      body={{
        kind: "items",
        top: view.top,
        rest: view.rest,
        notice: view.incomplete
          ? "This list is incomplete: some queues did not load. Refresh the page to try again."
          : undefined,
      }}
    />
  );
}
