import { redirect } from "next/navigation";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { GoLivePage } from "@/components/go-live/go-live-page";

export const metadata = { title: "Go-live guards (view)" };
export const dynamic = "force-dynamic";

/**
 * S36b: the operations team's read-only door to the go-live guards (spec 9.4). It shows each guard, what it blocks, its
 * conditions and the last changes, with no button of any kind. Someone who can switch a guard uses /admin/go-live (the founder)
 * or /clinician/go-live (the CMO); the database refuses a write from an operations user whatever this screen shows.
 */
export default async function OpsGoLive() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "admin") redirect("/admin/go-live");
  if (!(await hasPermission("ops.console.view"))) redirect("/admin");
  const locale = DEFAULT_UI_LANGUAGE;
  return <GoLivePage viewer="ops" locale={locale} />;
}
