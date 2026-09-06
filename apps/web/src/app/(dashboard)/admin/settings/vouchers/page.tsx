import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader
        title="Care vouchers"
        description="A care voucher is an entitlement to one named service for one named person. It is not an account balance, it cannot be transferred, and it is never exchangeable for cash. These settings control how long one stays valid and how often it can be extended."
      />
      <VoucherManager />
    </div>
  );
}
