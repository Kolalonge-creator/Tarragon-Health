/**
 * Low supply to the pharmacy flow (S08y, item 6).
 *
 * S28 already owns choosing a pharmacy and the collection code for a prescription (web: /patient/pharmacy/collect/[id]). This only
 * decides whether to OFFER that existing page next to a "running low" note. It builds no pharmacy flow of its own and sends
 * nothing: it is a link the person chooses to open.
 *
 * Offered only when the supply is low, the medicine came from a prescription (a medicine the person added themselves has no
 * prescription to route), and the pharmacy flow is switched on (S28 keeps it behind the `prescribing_enabled` guard).
 */
export interface RefillHandoffInput {
  low: boolean;
  prescriptionId: string | null;
  /** The person whose medicine it is; carried as `for` so a caregiver acting for someone lands on the right record. */
  patientId: string;
  /** Is the S28 pharmacy flow open? `null`: the answer could not be read, which offers nothing rather than a dead link. */
  collectionOpen: boolean | null;
}

export type RefillHandoff = { offer: false } | { offer: true; path: string };

export function refillHandoff(input: RefillHandoffInput): RefillHandoff {
  if (!input.low || input.prescriptionId === null || input.collectionOpen !== true) return { offer: false };
  return { offer: true, path: `/patient/pharmacy/collect/${input.prescriptionId}?for=${input.patientId}` };
}
