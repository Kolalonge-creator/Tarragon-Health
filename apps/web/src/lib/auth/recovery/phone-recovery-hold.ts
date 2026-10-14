import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { interpretPhoneRecoveryHold, type PhoneRecoveryHold } from "@tarragon/auth/recovery";

/**
 * Asks the database whether recovery by a text code is paused for the caller (signed in as of the code they just proved).
 * Fails closed: see interpretPhoneRecoveryHold.
 */
export async function phoneRecoveryHold(supabase: SupabaseClient<Database>): Promise<PhoneRecoveryHold> {
  const { data, error } = await supabase.rpc("my_phone_recovery_hold");
  return interpretPhoneRecoveryHold(data, error);
}
