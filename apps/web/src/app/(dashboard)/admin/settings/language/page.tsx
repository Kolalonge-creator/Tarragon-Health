import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { PIDGIN_SWITCH_KEY } from "@/lib/language/pidgin-switch";
import { PidginSwitchCard } from "./pidgin-switch-card";

export const metadata = { title: "Languages" };

/**
 * Admin-only. The one-click Pidgin kill switch: the Pidgin wording has not had a
 * native-speaker review, so an admin who finds something wrong turns it off for
 * everyone and the product falls back to English. The write is gated again at
 * the database (public.set_platform_switch requires private.is_admin()).
 */
export default async function LanguageSettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/admin");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("platform_switches")
    .select("is_on, changed_at, change_note")
    .eq("key", PIDGIN_SWITCH_KEY)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Languages"
        description="One switch for the Pidgin interface. Turn it off if any of the wording is wrong; English is used everywhere until you turn it back on."
      />
      {error && (
        <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">
          Could not read the current setting ({error.message}). The button below may show the wrong state; reload before using it.
        </p>
      )}
      <PidginSwitchCard
        isOn={data?.is_on === true}
        changedAt={data?.changed_at ?? null}
        changeNote={data?.change_note ?? null}
      />
    </div>
  );
}
