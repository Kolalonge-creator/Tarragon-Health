import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { OperationsWall } from "@/components/ops-wall/operations-wall";

export const metadata = { title: "Operations wall" };
export const dynamic = "force-dynamic";

/** SR5: the live board for whoever is watching the platform. Aggregate only; the database leaves out every patient reference. */
export default async function OpsWallPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!(await hasPermission("ops.console.view"))) redirect("/admin");
  return <OperationsWall />;
}
