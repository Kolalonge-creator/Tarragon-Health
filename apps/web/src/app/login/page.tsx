import Link from "next/link";
import { LoginForm } from "./login-form";
import { GuardLeafMark } from "@/components/brand/guard-leaf-mark";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect } = await searchParams;

  return (
    <div className="flex flex-1 items-center justify-center bg-white px-4 py-12 sm:py-16">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center text-center">
          <GuardLeafMark className="h-11 w-11" />
          <p className="mt-3 font-heading text-2xl font-semibold text-charcoal-ink">
            Tarragon<span className="text-brand-green">Health</span>
          </p>
          <p className="mt-1 text-sm text-charcoal-ink/60">Care that stays with you.</p>
        </div>

        <div className="text-center">
          <h1 className="font-heading text-xl font-semibold text-charcoal-ink sm:text-2xl">
            Welcome back
          </h1>
          <p className="mt-2 text-sm text-charcoal-ink/60">
            Sign in to pick up where you left off.
          </p>
        </div>

        <LoginForm redirectTo={redirect} />

        <p className="text-center text-sm text-charcoal-ink/60">
          New here?{" "}
          <Link href="/signup" className="font-medium text-brand-green hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
