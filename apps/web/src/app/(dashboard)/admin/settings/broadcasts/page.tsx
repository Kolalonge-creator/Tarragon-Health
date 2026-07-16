import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { BroadcastComposer } from "./broadcast-composer";

export default async function BroadcastsSettingsPage() {
  const profile = await getCurrentProfile();

  // proxy.ts already blocks non-admins from any /admin/** route at the routing
  // layer — this is defense-in-depth, matching the other admin settings pages.
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Broadcasts &amp; announcements
        </h1>
        <p className="text-charcoal-ink/60">
          Send a one-off announcement by email, WhatsApp, or SMS to a targeted audience —
          all patients, patients in a state, subscribers on a plan, all partners, or a
          specific partner group. Messages are queued into the notification pipeline and
          delivered as its credentials allow; this is an outbound announcement only.
        </p>
      </div>
      <BroadcastComposer />
    </div>
  );
}
