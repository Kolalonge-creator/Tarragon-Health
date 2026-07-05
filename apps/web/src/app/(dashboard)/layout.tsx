import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";

const ROLE_LABEL: Record<string, string> = {
  patient: "Patient",
  nurse: "Nurse",
  clinician: "Clinician",
  admin: "Admin",
  hmo_admin: "HMO admin",
  corporate_admin: "Corporate admin",
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, organisation_id")
    .eq("id", user.id)
    .single();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-charcoal-ink/10 px-6 py-4">
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
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className="flex flex-1 flex-col px-6 py-8">{children}</main>
    </div>
  );
}
