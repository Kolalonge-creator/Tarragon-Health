import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { getRoleHomePath } from "@/lib/auth/roles";

/**
 * Server guard for the finance console. Mirrors private.is_finance(): the
 * dedicated finance role and the super admin have full access; any other member
 * needs the delegated `finance.view` capability. The RPCs enforce this again at
 * the DB — this layer just redirects a non-finance caller to their own home
 * instead of rendering an empty console.
 */
export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const allowed =
    profile.role === "finance" || profile.role === "admin" || (await hasPermission("finance.view"));
  if (!allowed) redirect(getRoleHomePath(profile.role));

  return <>{children}</>;
}
