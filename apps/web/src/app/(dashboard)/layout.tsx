import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { AppShell } from "@/components/shell/app-shell";
import { getNavSections } from "@/lib/navigation";
import { ROLE_DISPLAY_LABEL } from "@/lib/auth/roles";
import { isEmbeddedInApp } from "@/lib/embedded-webview";
import { Providers } from "./providers";
import { signOut } from "../auth/actions";

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
      "full_name, role, organisation_id, receives_care, patient_number, staff_number, avatar_url"
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
  if (profile?.role === "clinician" || profile?.role === "care_coordinator") {
    const { data: staff } = await supabase
      .from("clinical_staff")
      .select("staff_number")
      .eq("profile_id", user.id)
      .maybeSingle();
    staffNumber = staff?.staff_number ?? null;
  }

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
  const embedded = await isEmbeddedInApp();
  if (embedded) {
    return (
      <Providers>
        <main className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">{children}</main>
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
        signOutAction={signOut}
      >
        {children}
      </AppShell>
    </Providers>
  );
}
