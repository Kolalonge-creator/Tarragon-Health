import { formatNaira } from "@tarragon/commerce";
import type { PlainStatementInput } from "@tarragon/i18n";
import { getProposedConfig } from "@tarragon/shared";
import { membershipAutoRenews, membershipLadderPublic, renewalCopy } from "@/lib/marketing/membership";

/**
 * The figures the plain statement quotes, read from versioned configuration and never typed into a page. It follows the same switch
 * as the pricing page (`marketing.membership_ladder_public`): off, one Membership at `commerce.membership_prices`; on, Membership and
 * Membership Plus at `commerce.membership_ladder`. A figure that cannot be read becomes null and the statement then says
 * "See the price in the app before you pay" rather than showing a guess. The renewal sentence is the pricing page's own
 * `renewalCopy`, so the statement can never disagree with the pricing page about auto-renewal.
 */
function kobo(read: () => unknown): string | null {
  try {
    const v = read();
    return typeof v === "number" && Number.isFinite(v) ? formatNaira(v) : null;
  } catch {
    return null;
  }
}

export async function readPlainStatementInput(surface: "public" | "app"): Promise<PlainStatementInput> {
  let refundDays: number | null = null;
  try {
    const r = getProposedConfig("membership.refund").value as { window_days?: unknown };
    if (typeof r.window_days === "number" && Number.isFinite(r.window_days)) refundDays = r.window_days;
  } catch {
    refundDays = null;
  }

  let ladderOn = false;
  try {
    ladderOn = membershipLadderPublic();
  } catch {
    ladderOn = false;
  }

  const price = kobo(() => (getProposedConfig("commerce.membership_prices").value as { individual_kobo?: unknown }).individual_kobo);
  const ladder = ladderOn
    ? {
        membership: kobo(() => (getProposedConfig("commerce.membership_ladder").value as { evergreen_kobo?: unknown }).evergreen_kobo),
        plus: kobo(() => (getProposedConfig("commerce.membership_ladder").value as { evergreen_plus_kobo?: unknown }).evergreen_plus_kobo),
      }
    : undefined;

  const renewalLine = refundDays === null ? null : renewalCopy(await membershipAutoRenews(), refundDays).short;
  return { price, refundDays, surface, ladder, renewalLine };
}
