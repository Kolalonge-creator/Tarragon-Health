import { NeedsFirst } from "@/components/ui/needs-first";
import type { FirstView } from "@/lib/care-coordinator/first-view";

/**
 * The first thing on the coordinator home. Which items show, in what order,
 * and when the view must refuse to say "nothing waiting" is decided in
 * lib/care-coordinator/first-view.ts, where it is tested.
 *
 * When the read failed it draws nothing: the page already shows a failure
 * notice above it, and a second one would only repeat it.
 */
export function CoordinatorFirst({ view }: { view: FirstView }) {
  if (view.kind === "unknown") return null;
  if (view.kind === "loading") {
    return <NeedsFirst id="coordinator-first" body={{ kind: "loading", text: "Checking your outreach tasks…" }} />;
  }
  if (view.kind === "clear") {
    return (
      <NeedsFirst
        id="coordinator-first"
        body={{ kind: "clear", text: "No act-first tasks and no test results being awaited." }}
      />
    );
  }
  return <NeedsFirst id="coordinator-first" body={{ kind: "items", top: view.top, rest: view.rest }} />;
}
