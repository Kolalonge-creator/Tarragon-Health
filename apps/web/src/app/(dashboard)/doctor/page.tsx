import { getCurrentProfile } from "@/lib/auth/current-profile";
import { EscalationWorklist } from "./escalation-worklist";

export default async function DoctorPage() {
  const profile = await getCurrentProfile();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Welcome{profile?.full_name ? `, ${profile.full_name}` : ""}
        </h1>
        <p className="text-charcoal-ink/60">Doctor dashboard</p>
      </div>
      <EscalationWorklist />
    </div>
  );
}
