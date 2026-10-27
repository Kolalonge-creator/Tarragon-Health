import { formatNaira } from "@tarragon/commerce";
import type { PlainStatementInput } from "@tarragon/i18n";
import { getProposedConfig } from "@tarragon/shared";

/**
 * The figures the plain statement quotes, read from versioned configuration and never typed. It follows the same switch as the public
 * pricing page (`marketing.membership_ladder_public`): off, one Membership at `commerce.membership_prices`; on, Membership and
 * Membership Plus at `commerce.membership_ladder`. A figure that cannot be read becomes null and the statement then points at the
 * Membership screen instead of showing a guess. The phone makes no renewal claim (it cannot read the auto-renew switch offline).
 */
function kobo(read: () => unknown): string | null {
  try {
    const v = read();
    return typeof v === "number" && Number.isFinite(v) ? formatNaira(v) : null;
  } catch {
    return null;
  }
}

export function readPlainStatementInput(): PlainStatementInput {
  let refundDays: number | null = null;
  try {
    const r = getProposedConfig("membership.refund").value as { window_days?: unknown };
    if (typeof r.window_days === "number" && Number.isFinite(r.window_days)) refundDays = r.window_days;
  } catch {
    refundDays = null;
  }
  let ladderOn = false;
  try {
    ladderOn = (getProposedConfig("marketing.membership_ladder_public").value as { enabled?: unknown }).enabled === true;
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
  return { price, refundDays, surface: "app", ladder, renewalLine: null };
}
