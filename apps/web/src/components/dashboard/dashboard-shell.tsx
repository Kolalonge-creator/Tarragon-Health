import Image from "next/image";
import Link from "next/link";
import { signOut } from "@/lib/auth/actions";
import { Button } from "@/components/ui/auth-ui";

export function DashboardShell({
  title,
  roleLabel,
  children,
}: {
  title: string;
  roleLabel: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-h-full bg-brand-ivory">
      <header className="border-b border-brand-navy/10 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/brand/logo-mark.png"
              alt="TarragonHealth"
              width={32}
              height={32}
            />
            <span className="text-lg font-semibold text-brand-navy">
              Tarragon<span className="text-brand-green">Health</span>
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <span className="rounded-full bg-brand-sage px-3 py-1 text-xs font-medium text-brand-navy">
              {roleLabel}
            </span>
            <form action={signOut}>
              <Button type="submit" variant="ghost">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-3xl font-semibold text-brand-navy">{title}</h1>
        <p className="mt-2 max-w-2xl text-brand-ink/70">
          This dashboard is a Sprint 1 placeholder. Patient vitals, nurse
          worklists, and screening flows arrive in Sprint 2.
        </p>
        {children ? <div className="mt-8">{children}</div> : null}
      </main>
    </div>
  );
}
