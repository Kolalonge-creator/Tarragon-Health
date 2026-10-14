import { createClient } from "@/lib/supabase/server";
import { RecoveryDutiesPanel, type RecoveryDuties } from "./recovery-duties-panel";

/**
 * What the people who named you as their recovery contact have asked of you (S03b). Renders nothing when there is nothing to
 * answer, so a supporter with no such role never sees it. Reads the caller's own rows through an RPC that re-checks the
 * Care Circle membership, so a removed member's duties disappear.
 */
export async function RecoveryDutiesCard() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_recovery_contact_duties");
  const duties = (data ?? null) as RecoveryDuties | null;
  if (!duties || (duties.proposals.length === 0 && duties.standing.length === 0 && duties.requests.length === 0)) return null;
  return <RecoveryDutiesPanel duties={duties} />;
}
