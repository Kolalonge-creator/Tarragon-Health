import { z } from "zod";
import { medicineNames, parseMyPharmacy, type MyPharmacy } from "@/lib/pharmacy-collection/collection";
import { createClient } from "@/lib/supabase/server";

export type CollectionPrescription = {
  id: string;
  state: "signed" | "sent" | "dispensed";
  medicines: string[];
  pharmacy: MyPharmacy | null;
};
export type CollectionLoad = { ok: true; available: boolean; prescriptions: CollectionPrescription[] } | { ok: false };

const RowSchema = z.object({
  prescription_id: z.string().uuid(),
  state: z.enum(["signed", "sent", "dispensed"]),
  items: z.unknown(),
  is_current: z.boolean(),
});

/**
 * The signed-in patient's recent prescriptions and where each one stands, for the Medicines screen.
 *  - A prescription still waiting at a pharmacy, or already collected, is always shown, even if collection has since been
 *    switched off or no pharmacy can be chosen: a code she holds must stay visible and withdrawable.
 *  - A prescription not yet sent is offered only while collection is available AND it is still current (an amended or
 *    stopped medicine leaves its old prescription signed; offering it would send a stale dose).
 * A failed or unreadable read is reported, never turned into an empty list: an empty list would read as "nothing waiting".
 */
export async function loadMyCollection(): Promise<CollectionLoad> {
  const supabase = await createClient();
  const { data: available, error: availableError } = await supabase.rpc("pharmacy_collection_available");
  if (availableError) return { ok: false };

  const { data, error } = await supabase.rpc("my_collection_prescriptions");
  if (error) return { ok: false };
  const parsed = z.array(RowSchema).safeParse(data);
  if (!parsed.success) return { ok: false };

  const rows: CollectionPrescription[] = [];
  for (const row of parsed.data) {
    if (row.state === "signed" && !(available === true && row.is_current)) continue;
    let pharmacy: MyPharmacy | null = null;
    if (row.state !== "signed") {
      const { data: mine, error: mineError } = await supabase.rpc("my_prescription_pharmacy", { p_prescription: row.prescription_id });
      if (mineError) return { ok: false };
      pharmacy = parseMyPharmacy(mine);
      if (!pharmacy) return { ok: false };
    }
    rows.push({ id: row.prescription_id, state: row.state, medicines: medicineNames(row.items), pharmacy });
  }
  return { ok: true, available: available === true, prescriptions: rows };
}
