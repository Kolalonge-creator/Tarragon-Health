import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
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
      <div className="flex min-h-screen flex-col bg-warm-ivory">
        <header className="flex items-center justify-between border-b border-charcoal-ink/10 bg-white px-6 py-4">
          <span className="font-heading text-lg font-semibold text-brand-green">
            TarragonHealth
          </span>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-charcoal-ink/70">
              {profile?.full_name ?? user.email ?? user.phone}
            </span>
            <span className="rounded-full bg-brand-green/10 px-2.5 py-1 font-medium text-brand-green">
              {profile ? ROLE_LABEL[profile.role] : "—"}
            </span>
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </header>
        <main className="flex flex-1 flex-col px-6 py-8">{children}</main>
      </div>
    </Providers>
  );
}
