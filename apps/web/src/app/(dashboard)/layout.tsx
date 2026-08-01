import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { AppShell } from "@/components/shell/app-shell";
import { getNavSections } from "@/lib/navigation";
import { Providers } from "./providers";
import { signOut } from "../auth/actions";

const ROLE_LABEL: Record<string, string> = {
  patient: "Patient",
  clinician: "Care Team Doctor",
  doctor: "Escalation Doctor",
  admin: "Admin",
  hmo_admin: "HMO admin",
  corporate_admin: "Corporate admin",
  care_coordinator: "Care Coordinator",
  pharmacist: "Partner Pharmacy",
  analyst: "Platform Analytics",
  finance: "Finance",
  lab_liaison: "Lab Liaison",
  lab_partner: "Partner Laboratory",
};

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
    .select("full_name, role, organisation_id, account_purpose")
    .eq("id", user.id)
    .single();

  const supporting = profile?.account_purpose === "support";

  return (
    <Providers>
      <AppShell
        userName={profile?.full_name ?? user.email ?? user.phone ?? "Account"}
        // "Patient" is wrong for somebody who is not one, and it is the first
        // word they see about themselves every time they sign in.
        roleLabel={
          supporting ? "Supporter" : profile ? (ROLE_LABEL[profile.role] ?? "—") : "—"
        }
        navSections={getNavSections(profile?.role, profile?.account_purpose)}
        signOutAction={signOut}
      >
        {children}
      </AppShell>
    </Providers>
  );
}
