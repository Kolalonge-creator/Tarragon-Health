import Link from "next/link";

/**
 * The one next step after a free tool's result. There are two plans, Free and Membership, so this names the Membership and sends the
 * visitor to the pricing page, which is the only place the Membership price is shown (read from versioned config). It quotes no
 * price itself.
 */
export function MembershipCtaCard({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-2xl border-2 border-brand-green/30 bg-soft-sage p-6 ${className}`}>
      <h3 className="font-heading text-lg font-semibold text-charcoal-ink">Membership</h3>
      <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/75">
        A yearly blood test and a video call with your care team every month, so a doctor looks at this with you.
      </p>
      <Link
        href="/pricing"
        className="mt-4 inline-flex h-10 items-center justify-center rounded-full bg-brand-green px-5 text-sm font-medium text-white transition-colors hover:bg-brand-green/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
      >
        See Membership
      </Link>
    </div>
  );
}
