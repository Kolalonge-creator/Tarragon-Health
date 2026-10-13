import { createClient } from "@/lib/supabase/server";
import { readLabPanels } from "@/lib/lab-results/read-lab-panels";
import { LabPanelsView } from "../lab-panels/lab-panels-view";

/**
 * The lab ranges and release policy sign-off panel: loads its own data and renders the
 * real view, ranges and Sign control together. Shared by the CMO's own page and by the
 * sign-off hub, which opens it inline so a signature is given while looking at the actual
 * ranges. Access is gated by the page that renders it (both require canAssignCases).
 */
export async function LabPanelsPanel() {
  const { signoff, panels, loadFailed } = await readLabPanels(await createClient());
  return loadFailed ? (
    <p role="alert" className="text-sm text-red-700">
      The lab ranges could not be loaded. Please refresh.
    </p>
  ) : (
    <LabPanelsView signoff={signoff} panels={panels} canSign />
  );
}
