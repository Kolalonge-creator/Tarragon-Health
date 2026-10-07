import { redirect } from "next/navigation";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";

export const dynamic = "force-dynamic";

/**
 * A role-aware doorway for rota and paging notifications that reach reviewers. The same notice reaches an admin (who works
 * under /admin) and the Chief Medical Officer (whose account role is `clinician`, working under /clinician): neither can open
 * the other's area, so one link would bounce one of them. Any other clinician goes to their own hours page.
 */
export default async function RotaDoorway() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "admin") redirect("/admin/rota");
  if (profile.role === "clinician") {
    const staff = await getCurrentClinicalStaff();
    redirect(canAssignCases(staff) ? "/clinician/team-rota" : "/clinician/rota");
  }
  redirect("/");
}
