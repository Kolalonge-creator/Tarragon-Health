import Link from "next/link";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect } = await searchParams;

  return (
    <div className="flex flex-1 items-center justify-center bg-charcoal-ink/[0.02] px-4 py-16">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="font-heading text-2xl font-semibold text-brand-green">
            TarragonHealth
          </h1>
          <p className="mt-1 text-sm text-charcoal-ink/60">Care that stays with you.</p>
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
