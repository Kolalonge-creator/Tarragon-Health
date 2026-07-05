import Link from "next/link";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-charcoal-ink/[0.02] px-4 py-16">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="font-heading text-2xl font-semibold text-brand-green">
            TarragonHealth
          </h1>
          <p className="mt-1 text-sm text-charcoal-ink/60">Care that stays with you.</p>
        </div>
        <div className="rounded-xl border border-charcoal-ink/10 bg-white p-6 shadow-sm">
          <SignupForm />
        </div>
        <p className="text-center text-sm text-charcoal-ink/60">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-brand-green hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
