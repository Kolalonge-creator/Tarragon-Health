import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { VitalsForm } from "../../vitals-form";
import { VITAL_TYPES, type VitalType } from "@/lib/vitals/vital-types";

const TYPE_LABEL: Record<VitalType, string> = Object.fromEntries(
  VITAL_TYPES.map(({ value, label }) => [value, label])
) as Record<VitalType, string>;

function isVitalType(value: string): value is VitalType {
  return (VITAL_TYPES as readonly { value: string }[]).some((t) => t.value === value);
}

/**
 * A one-purpose, no-hunting-through-the-dashboard page for a specific vital
 * type — the destination for the deep link now carried in vitals_reminder's
 * WhatsApp/SMS body. This does NOT relax the app/web-only entry rule
 * (Non-Negotiable Business Rules: no WhatsApp-driven data entry, ever) —
 * the message only ever links here, it never accepts a reply as data.
 * Proxy.ts already preserves this exact path through a login bounce
 * (isRoleHomePrefixed + redirect-after-login), so a signed-out tap on the
 * reminder still lands here, not on the generic dashboard, after signing in.
 */
export default async function QuickLogPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  if (!isVitalType(type)) notFound();

  const profile = await getCurrentProfile();
  if (!profile) redirect(`/login?redirect=/patient/quick-log/${type}`);
  if (profile.role !== "patient") redirect("/");

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-8">
      <VitalsForm
        patientId={profile.id}
        lockedType={type}
        title={`Log your ${TYPE_LABEL[type].toLowerCase()}`}
      />
      <Link
        href="/patient/vitals"
        className="block text-center text-sm text-charcoal-ink/60 hover:underline"
      >
        Go to my full dashboard
      </Link>
    </div>
  );
}
