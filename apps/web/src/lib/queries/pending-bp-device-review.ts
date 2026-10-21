import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export type PendingBpDeviceReview = {
  /** Active blood pressure monitors an admin has entered, with evidence, that the Chief Medical Officer has not reviewed. */
  waiting: number;
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

/**
 * S07y: recommended blood pressure monitors (public.device_catalog, S70a 18.2) that an admin has entered with a validation source and that are
 * waiting for the Chief Medical Officer's review. Only a reviewed row is ever shown to a patient or used to say a cuff model is on the checked
 * list. Never throws; a failed read says so.
 */
export async function readPendingBpDeviceReview(supabase: SupabaseClient<Database>): Promise<PendingBpDeviceReview> {
  try {
    const { count, error } = await supabase
      .from("device_catalog")
      .select("id", { count: "exact", head: true })
      .eq("category", "blood_pressure")
      .eq("active", true)
      .eq("clinically_reviewed", false)
      .not("validated_source_url", "is", null);
    if (error || count === null) return { waiting: 0, failed: true };
    return { waiting: count, failed: false };
  } catch {
    return { waiting: 0, failed: true };
  }
}
