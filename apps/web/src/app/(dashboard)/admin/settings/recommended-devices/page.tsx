import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { BpDevicesList } from "@/app/(dashboard)/clinician/recommended-devices/devices-list";

/** Admin editor for the recommended blood pressure monitors (S07y). The Chief Medical Officer reviews each one at /clinician/recommended-devices. */
export default async function AdminRecommendedDevicesPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") redirect("/");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Recommended blood pressure monitors"
        description="Start from a public validation registry such as ValidateBP or STRIDE BP. The list begins empty and nothing is invented. A monitor counts only after the Chief Medical Officer reviews it."
      />
      <BpDevicesList mode="admin" />
    </div>
  );
}
