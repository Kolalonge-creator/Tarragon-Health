import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex flex-1 items-center justify-center bg-charcoal-ink/[0.02] px-4 py-16">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="font-heading text-2xl font-semibold text-brand-green">
            Reset your password
          </h1>
          <p className="mt-1 text-sm text-charcoal-ink/60">
            We&apos;ll send a reset link to your email, or a code to your phone.
          </p>
        </div>
        {error === "invalid_or_expired_link" && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-center text-sm text-red-600">
            That reset link is invalid or has expired. Request a new one below.
          </p>
        )}
        <ForgotPasswordForm />
        <p className="text-center text-sm text-charcoal-ink/60">
          Remembered it?{" "}
          <Link href="/login" className="font-medium text-brand-green hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
