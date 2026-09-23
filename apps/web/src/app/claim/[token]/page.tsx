import Link from "next/link";
import { GuardLeafMark } from "@/components/brand/guard-leaf-mark";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/supabase/server";
import { ClaimCard } from "./claim-card";

/**
 * Where the neutral invite SMS points (Termii, sent from the paystack-webhook
 * Edge Function once the sponsor's payment lands — see
 * sponsored_service_reservations.invite_token). Deliberately requires the
 * visitor's OWN account, signed up the normal app/web way: this is not a
 * WhatsApp/SMS-driven signup path (CLAUDE.md's standing rule), just a link
 * that happens to arrive by SMS. claim_sponsored_service_reservation itself
 * re-checks that the signed-in caller's phone matches the reservation's
 * recipient_phone, so there's nothing to authorise here beyond "are they
 * signed in at all" — everything else fails closed inside the RPC.
 */
export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getCurrentUser();

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

        {user ? (
          <ClaimCard token={token} />
        ) : (
          <div className="space-y-4 text-center">
            <h1 className="font-heading text-xl font-semibold text-charcoal-ink sm:text-2xl">
              Someone paid for care for you
            </h1>
            <p className="text-sm text-charcoal-ink/60">
              Sign in or create an account with the same phone number this was sent to, then come
              back to this link to claim it.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Link href={`/login?redirect=${encodeURIComponent(`/claim/${token}`)}`}>
                <Button type="button" variant="outline" className="w-full sm:w-auto">
                  I already have an account
                </Button>
              </Link>
              <Link href="/signup">
                <Button type="button" className="w-full sm:w-auto">
                  Create an account
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
