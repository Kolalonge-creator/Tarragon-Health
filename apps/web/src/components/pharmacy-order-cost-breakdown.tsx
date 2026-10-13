import { koboToNaira } from "@tarragon/shared";
import type { PharmacyOrderItem } from "@/lib/queries/pharmacy-orders";

/**
 * Itemised medicine / total cost view (spec §63.14). Purely presentational,
 * never changes what's actually charged (pharmacy_orders.total_kobo, set
 * once at order creation). Orders are collection only, so there is no
 * delivery line.
 */
export function PharmacyOrderCostBreakdown({
  items,
  totalKobo,
}: {
  items: PharmacyOrderItem[];
  totalKobo: number;
}) {
  const medicineKobo = items.reduce((sum, item) => sum + item.price_kobo * item.quantity, 0);

  return (
    <div className="rounded-lg border border-charcoal-ink/10 bg-white p-3 text-xs">
      <div className="flex items-center justify-between py-0.5">
        <span className="text-charcoal-ink/60">Medicine</span>
        <span className="text-charcoal-ink">₦{koboToNaira(medicineKobo).toLocaleString()}</span>
      </div>
      <div className="mt-1 flex items-center justify-between border-t border-charcoal-ink/10 pt-1.5 font-semibold">
        <span className="text-charcoal-ink">Total charged via Tarragon</span>
        <span className="text-charcoal-ink">₦{koboToNaira(totalKobo).toLocaleString()}</span>
      </div>
    </div>
  );
}
