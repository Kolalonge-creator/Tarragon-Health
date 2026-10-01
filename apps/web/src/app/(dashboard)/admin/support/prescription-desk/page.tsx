import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { PrescriptionDeskConsole } from "./prescription-desk-console";

export const metadata = { title: "Prescription desk" };

/**
 * The "no smartphone" route on the prescription PDF. A pharmacy that cannot scan phones or emails TarragonHealth quoting the Rx number
 * and verification code; whoever answers uses this screen to check the prescription and, if the pharmacist confirms they are supplying
 * it, record the supply. Admin only for now; the database functions behind it also admit active clinical staff.
 */
export default async function PrescriptionDeskPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prescription desk"
        description="A pharmacy that cannot scan the QR code phones or emails us with the Rx number and verification code printed on the prescription. Look it up here, read back the verdict, and check the patient's name as the pharmacist reads it from the paper (the screen only says whether it matches; it never shows the name). Every lookup and recording is audited."
      />
      <PrescriptionDeskConsole />
    </div>
  );
}
