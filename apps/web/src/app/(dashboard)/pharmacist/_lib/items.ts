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
  payable_kobo: number | null;
  confirmed_quantity: string | null;
  confirmed_price_kobo: number | null;
  estimated_fulfilment_at: string | null;
  cancellation_reason: string | null;
};
