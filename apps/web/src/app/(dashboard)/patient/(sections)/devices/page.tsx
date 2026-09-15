import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { NAV_ICON } from "@/lib/icons";
import { DeviceShop } from "@/app/(dashboard)/patient/device-shop";
import { DeviceDataDeletionCard } from "@/app/(dashboard)/patient/device-data-deletion-card";

export default async function PatientDevicesPage() {
  const { subjectId } = await getPatientDashboardContext();

  return (
    <DashboardSection
      id="devices"
      title="Get a device"
      description="Clinically vetted BP monitors, scales and glucometers that connect straight into your Tarragon record."
      icon={NAV_ICON.devices}
    >
      <DeviceShop />
      <DeviceDataDeletionCard patientId={subjectId} />
    </DashboardSection>
  );
}
