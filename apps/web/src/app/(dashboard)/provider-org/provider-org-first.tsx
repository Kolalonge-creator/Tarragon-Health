import { NeedsFirst } from "@/components/ui/needs-first";
import type { FirstView } from "@/lib/provider-org/first-view";

/**
 * Draws the provider organisation "Needs you first" block. What it says is
 * decided in lib/provider-org/first-view.ts.
 *
 * When the figures did not load this draws nothing: the page already shows the
 * failure notice, and a second one would say the same thing twice.
 */
export function ProviderOrgFirst({ view }: { view: FirstView }) {
  if (view.kind === "unknown") return null;
  if (view.kind === "clear") {
    return (
      <NeedsFirst
        id="provider-org-first"
        body={{ kind: "clear", text: "No referrals are paid and waiting, and none are on the waitlist." }}
      />
    );
  }
  return <NeedsFirst id="provider-org-first" body={{ kind: "items", top: view.top, rest: view.rest }} />;
}
