import { createClient } from "@/lib/supabase/server";
import { readMyThresholdNotice } from "@/lib/queries/threshold-overrides";

/**
 * "Your care team set personal targets." A bare note, shown only to the patient it is about (never a caregiver acting for them, because the
 * database answers for the signed-in account). No number, no reason, no domain and no notification is ever sent about it (INV-07).
 */
export async function ThresholdOverrideNotice() {
  const show = await readMyThresholdNotice(await createClient());
  if (!show) return null;
  return (
    <p className="rounded-lg border border-brand-green/30 bg-brand-green/5 p-3 text-sm text-charcoal-ink" role="note">
      Your care team has set personal targets for you. Your readings are checked against them, and the usual safety checks always stay on.
    </p>
  );
}
