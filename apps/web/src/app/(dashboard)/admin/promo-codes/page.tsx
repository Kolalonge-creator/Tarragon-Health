import { PageHeader } from "@/components/ui/page-header";
import { PromoCodeManager } from "./promo-code-manager";

export default function AdminPromoCodesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Promo codes"
        description="Percentage or fixed-amount discounts a patient can apply to a lab, pharmacy, or referral order at checkout."
      />
      <PromoCodeManager />
    </div>
  );
}
