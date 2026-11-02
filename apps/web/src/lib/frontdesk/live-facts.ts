import "server-only";
import { membershipPriceLabel, paidProductName, refundWindowDays } from "@/lib/marketing/membership";
import { formatLaunchDate } from "./config";
import type { LiveFacts } from "./knowledge";

/** Today's price, product name and refund window from the same versioned configuration the pricing page reads. Nothing is typed here. */
export function readLiveFacts(launchDateIso: string | null): LiveFacts {
  return {
    membershipPrice: membershipPriceLabel(),
    paidProductName: paidProductName(),
    refundDays: String(refundWindowDays()),
    launchDate: formatLaunchDate(launchDateIso),
  };
}
