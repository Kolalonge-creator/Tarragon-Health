import { getCurrentProfile } from "@/lib/auth/current-profile";
import { RefundsWorkspace } from "../_components/refunds-workspace";
import { OrderRefundsAdmin } from "../../admin/refund-requests/order-refunds-admin";
import { RefundRequestsAdmin } from "../../admin/refund-requests/refund-requests-admin";

export const metadata = { title: "Refunds" };

/**
 * The shared refunds workspace (FIN-V2-2): finance staff and admins see the same queue and decide in the same
 * place. The finance layout gates entry; every action is checked again by the database. The two admin-only tools
 * (retrying or settling a stuck Paystack refund, and doctor-service guarantee claims) appear only for an admin,
 * because their functions accept only an admin.
 */
export default async function FinanceRefundsPage() {
  const profile = await getCurrentProfile();
  const isAdmin = profile?.role === "admin";
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink dark:text-night-ink">Refunds</h1>
        <p className="max-w-3xl text-charcoal-ink/60 dark:text-night-ink/60">
          Every refund request in one place, for finance and admin alike. Nobody decides a refund they asked for, and
          refunds above the amount set below need two different approvers. Every decision is logged.
        </p>
      </div>
      <RefundsWorkspace />
      {isAdmin && (
        <>
          <OrderRefundsAdmin decisions={false} />
          <RefundRequestsAdmin />
        </>
      )}
    </div>
  );
}
