import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@tarragon/auth/current-profile";

/**
 * NGO partner area guard. Only an ngo_admin (or the super admin) is here. The funded-cohort tools (the overview page) are behind the
 * ngo_funded_cohort module and that page checks it itself, so a partner whose module is not yet on can still read the group figures of
 * their own programmes (S38f), which do not depend on the module. Every table and RPC underneath still enforces its own gate.
 */
export default async function NgoLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "ngo_admin" && profile.role !== "admin") redirect("/");

  return (
    <div className="space-y-6">
      <nav aria-label="NGO partner" className="flex flex-wrap gap-1 border-b border-charcoal-ink/10">
        <Link href="/ngo" className="rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm font-medium text-charcoal-ink/70 hover:text-charcoal-ink">Overview</Link>
        <Link href="/ngo/programme-figures" className="rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm font-medium text-charcoal-ink/70 hover:text-charcoal-ink">Programme figures</Link>
      </nav>
      {children}
    </div>
  );
}
