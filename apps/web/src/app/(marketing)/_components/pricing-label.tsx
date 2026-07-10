import { cn } from "@/lib/utils";
import { PRICING_LABELS, type PricingLabel } from "../_content/pricing";

export function PricingLabelBadge({ label }: { label: PricingLabel }) {
  const config = PRICING_LABELS[label];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        config.className
      )}
    >
      {config.title}
    </span>
  );
}
