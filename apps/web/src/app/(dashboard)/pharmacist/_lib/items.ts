export function itemsSummary(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return items
    .map((i) => {
      const it = i as { drug_name?: string; quantity?: number };
      return it.drug_name ? `${it.drug_name}${it.quantity ? ` × ${it.quantity}` : ""}` : "";
    })
    .filter(Boolean)
    .join(", ");
}

export type PharmacistOrderRow = {
  order_id: string;
  order_number: string | null;
  status: string;
  patient_name: string | null;
  patient_number: string | null;
  items: unknown;
  requested_at: string;
};
