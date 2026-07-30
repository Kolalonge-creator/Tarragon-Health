import Link from "next/link";
import { Check } from "lucide-react";
import { SignupForm } from "./signup-form";
import { GuardLeafMark } from "@/components/brand/guard-leaf-mark";

const BENEFITS = [
  "Free to start, no card required",
  "Track vitals, medications and screenings in one place",
  "Your care team follows up when something needs attention",
  "Add a parent or next of kin at no extra cost",
];

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;

  return (
    <div className="flex flex-1 items-center justify-center bg-warm-ivory px-4 py-12 sm:py-16">
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
            Create your account
          </h1>
          <p className="mt-2 text-sm text-charcoal-ink/60">
            A couple of minutes to set up. Your care team takes it from there.
          </p>
        </div>

        <div className="rounded-2xl border border-brand-green/15 bg-soft-sage/50 p-5">
          <ul className="space-y-2.5">
            {BENEFITS.map((benefit) => (
              <li key={benefit} className="flex items-start gap-2.5 text-sm text-charcoal-ink/80">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" strokeWidth={2.5} />
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm sm:p-7">
          <SignupForm refCode={ref} />
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
