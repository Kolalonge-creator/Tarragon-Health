import { z } from "zod";
import { medicineNames, parseMyPharmacy, type MyPharmacy } from "@/lib/pharmacy-collection/collection";
import { createClient } from "@/lib/supabase/server";

export type CollectionPrescription = {
  id: string;
  state: "signed" | "sent" | "dispensed";
  medicines: string[];
  pharmacy: MyPharmacy | null;
  /** A collected prescription that the medicine still permits another supply of (a repeat). It is sent again as a new send. */
  canRepeat: boolean;
};
export type CollectionLoad = { ok: true; available: boolean; prescriptions: CollectionPrescription[] } | { ok: false };

const RowSchema = z.object({
  prescription_id: z.string().uuid(),
  state: z.enum(["signed", "sent", "dispensed"]),
  items: z.unknown(),
  is_current: z.boolean(),
  supplies_remaining: z.number().int().nonnegative(),
});

/**
 * The signed-in patient's recent prescriptions and where each one stands, for the Medicines screen.
 *  - A prescription still waiting at a pharmacy, or already collected, is always shown, even if collection has since been
 *    switched off or no pharmacy can be chosen: a code she holds must stay visible and withdrawable.
 *  - A prescription not yet sent is offered only while collection is available AND it is still current (an amended or
 *    stopped medicine leaves its old prescription signed; offering it would send a stale dose).
 * A failed or unreadable read is reported, never turned into an empty list: an empty list would read as "nothing waiting".
 */
export async function loadMyCollection(beneficiaryId?: string): Promise<CollectionLoad> {
  const supabase = await createClient();
  const { data: available, error: availableError } = await supabase.rpc("pharmacy_collection_available");
  if (availableError) return { ok: false };

  const who = beneficiaryId ? { p_beneficiary: beneficiaryId } : {};
  const { data, error } = await supabase.rpc("my_collection_prescriptions", who);
  // Acting for someone without the pharmacy permission is not an error to show: the card is simply not offered.
  if (error && beneficiaryId && error.message.includes("not_permitted_for_this_person")) return { ok: true, available: false, prescriptions: [] };
  if (error) return { ok: false };
  const parsed = z.array(RowSchema).safeParse(data);
  if (!parsed.success) return { ok: false };

  const rows: CollectionPrescription[] = [];
  for (const row of parsed.data) {
    // A prescription already supplied elsewhere (the QR check or the phone desk) has no supply left to send: not offered.
    if (row.state === "signed" && !(available === true && row.is_current && row.supplies_remaining > 0)) continue;
    let pharmacy: MyPharmacy | null = null;
    if (row.state !== "signed") {
      const { data: mine, error: mineError } = await supabase.rpc("my_prescription_pharmacy", { p_prescription: row.prescription_id, ...who });
      if (mineError) return { ok: false };
      pharmacy = parseMyPharmacy(mine);
      if (!pharmacy) return { ok: false };
    }
    const canRepeat = row.state === "dispensed" && available === true && row.is_current && row.supplies_remaining > 0;
    rows.push({ id: row.prescription_id, state: row.state, medicines: medicineNames(row.items), pharmacy, canRepeat });
  }
  return { ok: true, available: available === true, prescriptions: rows };
}
