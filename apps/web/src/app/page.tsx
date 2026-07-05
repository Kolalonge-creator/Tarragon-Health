import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getHomePathForRole } from "@/lib/auth/redirect";
import { fetchUserRole } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const role = await fetchUserRole(supabase, user.id);
    if (role) {
      redirect(getHomePathForRole(role));
    }
  }

  return (
    <div className="flex min-h-full flex-col bg-brand-ivory">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <Image
            src="/brand/logo-mark.png"
            alt="TarragonHealth"
            width={40}
            height={40}
          />
          <span className="font-display text-xl font-semibold text-brand-navy">
            Tarragon<span className="text-brand-green">Health</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-medium text-brand-navy transition-colors hover:bg-brand-sage"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex h-11 items-center justify-center rounded-lg bg-brand-green px-4 text-sm font-medium text-white transition-colors hover:bg-brand-green/90"
          >
            Get started
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-16">
        <p className="text-sm font-medium text-brand-green">
          Care that stays with you.
        </p>
        <h1 className="mt-4 max-w-2xl font-display text-5xl font-semibold leading-tight text-brand-navy">
          Clinician-led health monitoring for you and your loved ones.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-brand-ink/75">
          Track readings, stay on top of medications, and get gentle follow-up
          from a nurse who knows your name — on WhatsApp or here in the app.
        </p>
        <div className="mt-10 flex flex-wrap gap-4">
          <Link
            href="/sign-up"
            className="inline-flex h-11 items-center justify-center rounded-lg bg-brand-green px-6 text-sm font-medium text-white transition-colors hover:bg-brand-green/90"
          >
            Create your account
          </Link>
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-lg border border-brand-navy/20 bg-white px-6 text-sm font-medium text-brand-navy transition-colors hover:bg-brand-ivory"
          >
            Sign in
          </Link>
        </div>
      </main>
    </div>
  );
}
