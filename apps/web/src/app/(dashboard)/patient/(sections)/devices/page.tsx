import { DashboardSection } from "@/components/ui/dashboard-section";
import { NAV_ICON } from "@/lib/icons";
import { DeviceShop } from "@/app/(dashboard)/patient/device-shop";

export default function PatientDevicesPage() {
  return (
    <DashboardSection
      id="devices"
      title="Get a device"
      description="Clinically vetted BP monitors, scales and glucometers that connect straight into your Tarragon record."
      icon={NAV_ICON.devices}
    >
      <DeviceShop />
    </DashboardSection>
  );
}
