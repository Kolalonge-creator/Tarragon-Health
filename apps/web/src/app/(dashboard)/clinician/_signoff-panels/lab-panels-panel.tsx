import { createClient } from "@/lib/supabase/server";
import { readLabPanels } from "@/lib/lab-results/read-lab-panels";
import { LabPanelsView } from "../lab-panels/lab-panels-view";

/**
 * The lab ranges and release policy sign-off panel: loads its own data and
 * renders the same view the CMO's own page for this config does (values and
 * Sign control together), so a signature is always given while looking at the
 * actual ranges. Shared by /clinician/lab-panels and the sign-off hub
 * (/clinician/clinical-signoff). Access is gated by the page that renders it
 * (both require canAssignCases) and, for the signature itself, by the database.
 */
export async function LabPanelsPanel() {
  const { signoff, panels, loadFailed } = await readLabPanels(await createClient());
  if (loadFailed) {
    return (
      <p role="alert" className="text-sm text-red-700">
        The lab ranges could not be loaded. Please refresh.
      </p>
    );
  }
  return <LabPanelsView signoff={signoff} panels={panels} canSign />;
}
