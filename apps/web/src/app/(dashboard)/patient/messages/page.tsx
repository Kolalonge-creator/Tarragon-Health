import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { MessagesFlow } from "../messages-flow";

export default async function MessagesPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }
  if (!profile.onboarding_completed_at) {
    redirect("/onboarding");
  }

  return (
    <DashboardPlaceholder greeting="Messages" roleLabel="Patient" comingUp={[]}>
      <div className="flex justify-end">
        <Link href="/patient" className="text-sm font-medium text-brand-green hover:underline">
          ← Back to dashboard
        </Link>
      </div>
      <p className="max-w-2xl text-sm text-charcoal-ink/70">
        Message your care team in the app and they&apos;ll reply here. For anything urgent, use the
        emergency options on your dashboard rather than a message.
      </p>
      <MessagesFlow patientId={profile.id} />
    </DashboardPlaceholder>
  );
}
