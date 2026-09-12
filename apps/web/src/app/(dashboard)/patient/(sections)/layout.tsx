import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { ActingForBanner } from "@/app/(dashboard)/patient/acting-for-banner";
import { EmergencyAlert } from "@/app/(dashboard)/patient/emergency-alert";
import { DangerSymptomCheck } from "@/app/(dashboard)/patient/danger-symptom-check";
import { ageFromDateOfBirth } from "@tarragon/shared";
import { GlucoseUnitProvider } from "@/components/glucose-unit-provider";

/**
 * Shared chrome for the patient dashboard's routed sections (Overview,
 * Vitals, Medications, Prevention, Labs, Care & support, Profile, Devices,
 * Women's Health, Wellbeing, Healthy ageing, Support, plus the contextual
 * Cycle tracker) — a route group so this layout applies only to those
 * routes, not to every other page nested under /patient/* (supporting,
 * family, health-check, quick-log, etc.), which keep their own independent
 * behaviour. Splitting the old single 511-line anchor-scroll mega-page into
 * real routes means each section now only fetches and renders when it's
 * actually the one selected — the previous version mounted and
 * server-rendered every section's content on every request regardless of
 * which one the reader was looking at.
 *
 * The second-level PatientNav pill-tab bar that used to live here was
 * retired 2026-08-09: every section here except Cycle (reached contextually,
 * e.g. from the reproductive-health card, rather than from the sidebar) is a
 * top-level entry in the main sidebar (see lib/navigation.ts), so a second
 * in-page nav for the same links was pure duplication.
 */
export default async function PatientSectionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    profile,
    acting,
    subjectId,
    subjectState,
    subjectDateOfBirth,
    subjectHasEmergencyContact,
    glucoseUnit,
  } = await getPatientDashboardContext();

  return (
    <DashboardPlaceholder
      greeting={
        acting
          ? `${acting.fullName ?? "Their"}'s account`
          : `Hi${profile.full_name ? `, ${profile.full_name}` : ""}`
      }
      roleLabel={acting ? "Acting for them" : "Patient"}
    >
      {/* Whose account this is must never be in doubt. It sits above the
          safety surfaces because mistaking one person's record for another is
          itself the safety problem. */}
      <ActingForBanner acting={acting} />

      {/* Safety surfaces stay above everything, outside any section. */}
      <EmergencyAlert
        patientId={subjectId}
        hasEmergencyContact={subjectHasEmergencyContact}
        state={subjectState}
      />
      <DangerSymptomCheck patientId={subjectId} ageYears={ageFromDateOfBirth(subjectDateOfBirth)} />

      {/* Every glucose figure below this point renders in the reader's own
          unit. Wrapping the section content rather than each card: the cards
          are reached from several parents, and one parent forgetting a prop
          is a card silently back on mmol/L. */}
      <GlucoseUnitProvider unit={glucoseUnit}>
        <div className="space-y-6">{children}</div>
      </GlucoseUnitProvider>
    </DashboardPlaceholder>
  );
}
