import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { AppShell } from "@/components/shell/app-shell";
import { asUiLanguage } from "@tarragon/shared";
import { MfaNudgeBanner } from "@/components/shell/mfa-nudge-banner";
import { ConsentNudgeBanner } from "@/components/shell/consent-nudge-banner";
import { PendingJobsBanner } from "@/components/shell/pending-jobs-banner";
import { OfflineBanner } from "@/components/shell/offline-banner";
import { getNavSections } from "@/lib/navigation";
import { ROLE_DISPLAY_LABEL } from "@/lib/auth/roles";
import { isEmbeddedInApp } from "@/lib/embedded-webview";
import { cookies } from "next/headers";
import { THEME_COOKIE, parseThemePreference } from "@/lib/theme";
import { Providers } from "./providers";
import { signOut } from "../auth/actions";
import { updateUiLanguage } from "./patient/ui-language-actions";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "full_name, role, organisation_id, receives_care, patient_number, staff_number, avatar_url, language, onboarding_completed_at"
    )
    .eq("id", user.id)
    .single();

  // Supporter-only: they fund somebody else's care and receive none here.
  // Somebody who is BOTH keeps the full patient app, with People you support
  // already sitting third in it.
  const supporterOnly = profile?.receives_care === false;

  // Staff ID (EMP-NNNNNN): clinician/care_coordinator carry it on
  // clinical_staff (tied to their clinical record — 20260719214625); every
  // other staff role carries it directly on profiles instead
  // (20260806115556_profiles_staff_number.sql), since they have no
  // clinical_staff row to hang it off.
  let staffNumber: string | null = profile?.staff_number ?? null;
  let clinicalStaffId: string | null = null;
  if (profile?.role === "clinician" || profile?.role === "care_coordinator") {
    const { data: staff } = await supabase
      .from("clinical_staff")
      .select("id, staff_number")
      .eq("profile_id", user.id)
      .maybeSingle();
    staffNumber = staff?.staff_number ?? null;
    clinicalStaffId = staff?.id ?? null;
  }

  // "Notes to complete" (pending-jobs banner, doctor only) — the exact
  // {label, href, countKey} list navigation.ts's clinician nav already
  // carries, computed once here so the banner can never drift from what the
  // sidebar itself links to. Always the full doctor nav (role literal
  // "clinician", not care_coordinator) regardless of this caller's own tier
  // — matches navigation.ts's own "shown to every clinician tier" gating
  // philosophy.
  const pendingJobItems =
    profile?.role === "clinician"
      ? getNavSections("clinician", null)
          .flatMap((section) => section.items)
          .filter((item) => item.countKey)
          .map((item) => ({ label: item.label, href: item.href, countKey: item.countKey! }))
      : [];

  const isPatient = profile?.role === "patient" && !supporterOnly;
  const idLabel = isPatient ? "Patient ID" : staffNumber ? "Staff ID" : undefined;
  const idValue = isPatient ? profile?.patient_number : staffNumber;
  // Patients keep their fuller, editable profile section on their own
  // dashboard (location, emergency contact, wording preference); every other
  // signed-in account, including a supporter-only login (who gets redirected
  // straight off plain /patient to /patient/supporting, so this route is
  // unreachable for them), lands on the shared /account page.
  const profileHref = isPatient ? "/patient/profile" : "/account";

  // Inside the native app's WebView the shell is drawn natively around this
  // page, so rendering ours too gives the patient two headers and two tab
  // bars stacked. Content only.
  // Cookie-persisted so the very first server render carries the right
  // data-theme attribute (no flash). Only the patient surface consumes it.
  const theme = parseThemePreference((await cookies()).get(THEME_COOKIE)?.value);

  const embedded = await isEmbeddedInApp();
  if (embedded) {
    // The native shell paints #FAF7F2 around this WebView; the patient's
    // embedded content carries the same warm ground so web pages don't sit
    // as a white patch inside it. Staff roles have no native app, but the
    // guard keeps this honest if that ever changes.
    return (
      <Providers>
        <main
          className={`mx-auto min-h-screen w-full max-w-6xl px-4 py-5 sm:px-6 ${
            profile?.role === "patient" ? "bg-warm-ivory" : "bg-white"
          }`}
        >
          {children}
        </main>
      </Providers>
    );
  }

  return (
    <Providers>
      <AppShell
        userName={profile?.full_name ?? user.email ?? user.phone ?? "Account"}
        avatarUrl={profile?.avatar_url}
        // "Patient" is wrong for somebody who is not one, and it is the first
        // word they see about themselves every time they sign in.
        roleLabel={
          supporterOnly ? "Supporter" : profile ? (ROLE_DISPLAY_LABEL[profile.role] ?? "—") : "—"
        }
        idLabel={idLabel}
        idValue={idValue}
        profileHref={profileHref}
        navSections={getNavSections(profile?.role, profile?.receives_care)}
        // Patient accounts (supporters included — they share the patient
        // role) get the Warm Ivory ground the mobile app already ships;
        // staff and clinical consoles keep the white canvas.
        surface={profile?.role === "patient" ? "warm" : "default"}
        // Patients only. Staff consoles stay English: the clinical vocabulary
        // they work in has no Pidgin register, and a half-translated clinical
        // console is a safety problem rather than an accessibility win.
        uiLanguage={profile?.role === "patient" ? asUiLanguage(profile?.language) : "en"}
        uiLanguageAction={profile?.role === "patient" ? updateUiLanguage : undefined}
        initialTheme={theme}
        signOutAction={signOut}
      >
        <OfflineBanner />
        <MfaNudgeBanner role={profile?.role ?? null} />
        {/* Reachable at /patient/privacy for any signed-in patient, supporter-only
            accounts included (they consent to terms_of_service and can go stale
            same as anyone else) — gated here on onboarding_completed_at so this
            never doubles up with ConsentStep's own gate for a patient still
            mid-onboarding (who can't reach this shared layout with a completed
            profile anyway, since every /patient/* route redirects to /onboarding
            first — see getPatientDashboardContext). */}
        {profile?.role === "patient" && profile?.onboarding_completed_at && (
          <ConsentNudgeBanner patientId={user.id} />
        )}
        {profile?.role === "clinician" && (
          <PendingJobsBanner jobs={pendingJobItems} staffId={clinicalStaffId} />
        )}
        {children}
      </AppShell>
    </Providers>
  );
}
