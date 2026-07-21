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
    .select("full_name, role, organisation_id")
    .eq("id", user.id)
    .single();

  return (
    <Providers>
      <AppShell
        userName={profile?.full_name ?? user.email ?? user.phone ?? "Account"}
        roleLabel={profile ? (ROLE_LABEL[profile.role] ?? "—") : "—"}
        navSections={getNavSections(profile?.role)}
        signOutAction={signOut}
      >
        {children}
      </AppShell>
    </Providers>
  );
}
