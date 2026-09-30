import { redirect } from "next/navigation";
import { getCurrentProfile } from "@tarragon/auth/current-profile";
import { ROLE_DISPLAY_LABEL } from "@tarragon/auth/roles";
import { GuardLeafMark } from "@tarragon/ui/components/guard-leaf-mark";
import { t } from "@tarragon/i18n";
import { signOut } from "@/app/actions";

/**
 * Shell for every extracted staff area. proxy.ts has already decided this
 * caller may be here; this only renders the frame and fails closed if the
 * profile cannot be read.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  return (
    <div className="flex min-h-screen flex-col bg-warm-ivory">
      <header className="border-b border-charcoal-ink/10 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <GuardLeafMark className="h-8 w-8" />
            <div className="leading-tight">
              <p className="font-heading text-base font-semibold text-charcoal-ink">
                Tarragon<span className="text-brand-green">Health</span>
              </p>
              <p className="text-xs text-charcoal-ink/60">{t("console.shell.staff_area")}</p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-charcoal-ink/70 sm:inline">
              {profile.full_name ? `${profile.full_name} · ` : ""}
              {ROLE_DISPLAY_LABEL[profile.role]}
            </span>
            <form action={signOut}>
              <button type="submit" className="font-medium text-brand-green hover:underline">
                {t("console.signout")}
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
