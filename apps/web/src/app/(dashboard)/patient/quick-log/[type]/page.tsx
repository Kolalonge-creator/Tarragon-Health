import { redirect, notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
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
    <div className="mx-auto max-w-lg space-y-6 px-4 py-8">
      {/* The page's own h1. This is a deep-link destination from a reminder
          message, so it is often the first thing a patient sees after signing
          in; until now its only heading was the form card's own h3, leaving
          the page unnamed for a screen reader and for anyone scanning it. The
          back link replaces a hand-rolled "Go to my full dashboard" link that
          sat at the bottom and pointed at Vitals. */}
      <PageHeader
        title={`Log your ${TYPE_LABEL[type].toLowerCase()}`}
        backTo={{ href: "/patient/vitals", label: "All my vitals" }}
        description="A few seconds now, and it goes straight into your record."
      />
      <VitalsForm patientId={profile.id} lockedType={type} />
    </div>
  );
}
