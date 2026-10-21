import { createClient } from "@/lib/supabase/server";
import { readLabFallback } from "@/lib/lab-results/read-lab-fallback";
import { LabFallbackView } from "../lab-fallback/lab-fallback-view";

/** The disclosure fallback wording sign-off panel; shared by the CMO's own page and the sign-off hub. Gated by the page that renders it. */
export async function LabFallbackPanel() {
  const { signoff, loadFailed } = await readLabFallback(await createClient());
  return loadFailed ? (
    <p role="alert" className="text-sm text-red-700">
      The fallback wording could not be loaded. Please refresh.
    </p>
  ) : (
    <LabFallbackView signoff={signoff} canSign />
  );
}
