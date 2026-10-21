import { createClient } from "@/lib/supabase/server";
import { readCuffCheckRules } from "@/lib/cuff-check/read-cuff-check-rules";
import { CuffCheckRulesView } from "../cuff-check-rules/cuff-check-rules-view";

/**
 * The home cuff vs clinic cuff sign-off panel: loads its own data and renders the real view, values and Sign control together.
 * Shared by the CMO's own page and by the sign-off hub, which opens it inline so a signature is given while looking at the actual numbers.
 */
export async function CuffCheckRulesPanel() {
  const { live, pending, loadFailed } = await readCuffCheckRules(await createClient());
  return loadFailed ? (
    <p role="alert" className="text-sm text-red-700">
      The cuff check rules could not be loaded. Please refresh.
    </p>
  ) : (
    <CuffCheckRulesView live={live} pending={pending} canSign />
  );
}
