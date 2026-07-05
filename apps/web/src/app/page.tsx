import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRoleHomePath } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    redirect(profile ? getRoleHomePath(profile.role) : "/patient");
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-charcoal-ink/[0.02] px-4 py-32 text-center">
      <h1 className="font-heading text-4xl font-semibold text-brand-green">
        TarragonHealth
      </h1>
      <p className="max-w-md text-lg text-charcoal-ink/70">Care that stays with you.</p>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/login">Sign in</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/signup">Create an account</Link>
        </Button>
      </div>
    </main>
  );
}
