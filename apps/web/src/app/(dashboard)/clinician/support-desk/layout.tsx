import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getSupportDeskAccess } from "@/lib/auth/permissions";
import { DeskNav } from "./_components/desk-nav";

/**
 * Support desk (SUP-1/SUP-2). One workspace over the existing support stores. Open to support.agent, support.manage (the
 * super admin holds both) and an active Care Coordinator; the database gates (private.is_support_staff) enforce the same
 * rule on every read and write, so this guard only keeps others from a page that would load empty.
 */
export default async function SupportDeskLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const access = await getSupportDeskAccess();
  if (!access.canWork) redirect("/clinician");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink dark:text-night-ink">Support desk</h1>
        <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
          Technical tickets, help requests, support messages and complaints in one place. Clinical concerns stay on the clinical route.
        </p>
      </div>
      <DeskNav isLead={access.isLead} />
      {children}
    </div>
  );
}
