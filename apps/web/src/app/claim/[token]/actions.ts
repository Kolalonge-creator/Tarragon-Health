"use server";

import { createClient, getCurrentUser } from "@/lib/supabase/server";

export type ClaimReservationState =
  | { error: string }
  | { ok: true; skuName: string; faceValueKobo: number; voucherNumber: string }
  | undefined;

/**
 * The recipient's own claim — called with their session once they've signed
 * up and their profiles.phone matches the reservation's recipient_phone
 * exactly. All the real authorisation (phone match, status='invited',
 * not-expired) lives in claim_sponsored_service_reservation itself; this is
 * just a thin, typed wrapper so the page/client component don't touch
 * supabase.rpc directly. See that migration's header
 * (20260923013601_sponsored_service_reservation_rpcs.sql) for the full
 * mechanism.
 */
export async function claimReservation(token: string): Promise<ClaimReservationState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_sponsored_service_reservation", {
    p_token: token,
  });

  if (error) return { error: error.message };

  const result = data as {
    ok: boolean;
    voucher_number: string;
    sku_name: string;
    face_value_kobo: number;
  };
  return {
    ok: true,
    skuName: result.sku_name,
    faceValueKobo: result.face_value_kobo,
    voucherNumber: result.voucher_number,
  };
}
