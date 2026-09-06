import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { getVisibleItemsForTab } from "@/lib/admin-settings-nav";
import { SettingsHubGrid } from "@/components/shell/settings-hub-grid";
import { createClient } from "@/lib/supabase/server";
import { getSignoffQueue } from "@/lib/queries/signoff-queue";
import { SignoffQueueList } from "./signoff-queue-list";
import { LoadFailure } from "@/components/ui/load-failure";

export default async function ClinicalProtocolsSettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const perms = await getCallerPermissions();
  const items = getVisibleItemsForTab("clinical-protocols", perms);
  if (items.length === 0) redirect("/admin/settings");

  const supabase = await createClient();
  let queue: Awaited<ReturnType<typeof getSignoffQueue>> | null = null;
  let queueFailed = false;
  try {
    queue = await getSignoffQueue(supabase);
  } catch {
    queueFailed = true;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">Clinical Protocols</h2>
        <p className="text-charcoal-ink/60">
          The signed clinical configuration behind escalations, risk scoring, and every
          doctor-reviewed claim.
        </p>
      </div>
      {/* A failed read here must never render as an empty queue — that would
          say "nothing to sign" about state nobody actually checked, the same
          failure mode LoadFailure exists to prevent elsewhere on this page's
          own tiles (triage-protocols, clinical-rules). */}
      {queueFailed || !queue ? (
        <LoadFailure>
          The sign-off queue could not be loaded. This is not a report that nothing needs signing —
          check each tile below directly until this loads.
        </LoadFailure>
      ) : (
        <SignoffQueueList items={queue} />
      )}
      <SettingsHubGrid items={items} />
    </div>
  );
}
