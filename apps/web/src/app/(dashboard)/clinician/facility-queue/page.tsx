import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { FacilityQueueBoard } from "./facility-queue-board";

export default async function FacilityQueuePage() {
  const profile = await getCurrentProfile();
  if (!profile?.organisation_id) {
    redirect("/login");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Facility queue</h1>
        <p className="text-sm text-charcoal-ink/60">
          Check patients in — by QR/barcode scan, patient app, or here directly — call them from the
          waiting room, and see today&apos;s capacity at a glance (69.7&ndash;69.9, 69.12).
        </p>
      </div>
      <FacilityQueueBoard />
    </div>
  );
}
