import { NeedsFirst } from "@/components/ui/needs-first";
import type { FirstView } from "./_lib/first-view";

/**
 * Draws the pharmacist "Needs you first" block. What it says is decided in
 * _lib/first-view.ts.
 *
 * When the view cannot answer (loading, failed, or stale with nothing to
 * show) this draws nothing rather than a second notice: the orders, history
 * and pharmacy cards below already carry the loading, failed and out-of-date
 * messages for the same reads. It never draws "clear" in those states.
 */
export function PharmacistFirst({ view }: { view: FirstView }) {
  if (view.kind === "clear") {
    return (
      <NeedsFirst id="pharmacist-first" body={{ kind: "clear", text: "No orders waiting and your licence is in date." }} />
    );
  }
  if (view.kind !== "items") return null;
  const notice =
    view.caveat === "incomplete"
      ? "This list is incomplete: some figures did not load. Reload the page to try again."
      : view.caveat === "stale"
        ? "This list may be out of date: the last refresh failed. Reload the page to try again."
        : undefined;
  return <NeedsFirst id="pharmacist-first" body={{ kind: "items", top: view.top, rest: view.rest, notice }} />;
}
