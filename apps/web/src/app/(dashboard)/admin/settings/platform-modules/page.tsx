import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { listPlatformModules } from "@/lib/platform-modules";
import { PageHeader } from "@/components/ui/page-header";
import { PlatformModulesManager } from "./platform-modules-manager";

/**
 * Superadmin-only console for activating module 27 (insurer/payer platform)
 * and module 28 (provider organisation platform) — both built fully, both
 * shipped dormant per the founder's instruction. Activation itself is
 * gated again at the database (public.set_platform_module requires
 * private.is_admin()), this page only needs a signed-in super admin to
 * render, matching every other admin/settings page's guard shape.
 */
export default async function PlatformModulesPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/admin");

  const modules = await listPlatformModules();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform modules"
        description="Whole platforms built ahead of the business that will use them. Each ships switched off; activating one is a deliberate, audited act that needs a reason (a signed contract, a go-live date). Switching one off never does."
      />
      <PlatformModulesManager modules={modules} />
    </div>
  );
}
