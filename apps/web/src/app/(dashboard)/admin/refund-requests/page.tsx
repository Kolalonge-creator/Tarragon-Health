import { redirect } from "next/navigation";

/** Refunds moved to the shared finance workspace (FIN-V2-2). Kept as a redirect so old links and notifications still land. */
export default function AdminRefundRequestsPage() {
  redirect("/finance/refunds");
}
