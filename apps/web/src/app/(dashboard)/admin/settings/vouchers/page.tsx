import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { VoucherManager } from "./voucher-manager";

export const metadata = { title: "Care vouchers" };

/**
 * Voucher administration: the validity window, and the two staff actions a
 * patient may need done for them.
 *
 * Extending is the one that matters commercially. A voucher is somebody's
 * prepaid care, not a coupon we hope goes unused, so "it expired" should
 * almost always be answerable with "we put it back".
 */
export default async function VouchersSettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const allowed = profile.role === "admin" || (await hasPermission("vouchers.manage"));
  if (!allowed) redirect("/admin");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Care vouchers</h1>
        <p className="pt-1 text-sm text-charcoal-ink/70">
          A care voucher is an entitlement to one named service for one named person. It is not an
          account balance, it cannot be transferred, and it is never exchangeable for cash. These
          settings control how long one stays valid and how often it can be extended.
        </p>
        <Link
          href="/admin/settings/vouchers/assisted-redeem"
          className="mt-2 inline-block text-sm font-medium text-tarragon-green underline"
        >
          Redeem a voucher by phone →
        </Link>
      </div>
      <VoucherManager />
    </div>
  );
}
