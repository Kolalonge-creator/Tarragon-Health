import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import type { EmergencyCardPayload } from "@/lib/emergency/card";
import { EmergencyCardBody } from "@/components/emergency/emergency-card-body";

/**
 * The card a stranger doctor reads at 2am, when a patient has explicitly opted
 * in to a live link ON TOP OF their printed/offline card — see
 * `/patient/emergency-card/print`, which is the DEFAULT this platform points
 * a patient to first. This page is deliberately the higher-exposure, opt-in
 * extra, not the primary path (founder decision, 2026-08-03).
 *
 * NO LOGIN, BY DESIGN — the person this protects may be unconscious, so
 * requiring them to authenticate would defeat the entire purpose. The token in
 * the URL is the credential, it is 32 random bytes, the patient created it
 * deliberately, and they can revoke it instantly.
 *
 * Reached through `emergency_card_by_token`, the one anon-executable function
 * on this platform that returns PHI. Hardened three ways (2026-08-03): a
 * `Referrer-Policy: no-referrer` (see proxy.ts) so the token can never leak via
 * an outbound Referer header, a 12-month expiry enforced inside the function
 * itself, and a per-day-deduped in-app+email notification to the patient every
 * time the card is actually viewed. The dataset itself is fixed inside that
 * function, so this page cannot widen it however it is called.
 *
 * Rendered with a bare anon supabase-js client and no platform/auth imports —
 * the same boundary discipline `lib/marketing/*` holds, for the same reason:
 * this page must not be able to reach anything the token does not entitle.
 */

export const metadata: Metadata = {
  title: "Emergency health card",
  // Never indexed. A search engine should not hold these, and a token in a
  // crawler's index would outlive any revocation.
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

// Always fresh: a revoked or expired card must stop resolving on the very next
// request, and a cached page would keep serving one the patient has withdrawn.
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadCard(token: string): Promise<EmergencyCardPayload | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const supabase = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("emergency_card_by_token", { p_token: token });
  if (error || !data) return null;
  return data as unknown as EmergencyCardPayload;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default async function EmergencyCardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const card = await loadCard(token);

  if (!card) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-lg font-semibold text-charcoal-ink">This card is not available</h1>
        <p className="mt-2 text-sm text-charcoal-ink/70">
          This emergency card link is not valid, has expired, or the person it belongs to has
          withdrawn it. If you are treating someone right now, rely on your own assessment.
        </p>
      </main>
    );
  }

  return (
    <EmergencyCardBody
      facts={card}
      headerLabel="Emergency health card"
      headerSubline={`Issued ${formatDate(card.issued_at)} · Valid until ${formatDate(card.expires_at)}`}
      footer={
        <>
          <p>
            Shared by the patient through TarragonHealth. This is a summary the patient chose to
            carry, not a complete medical record, and it may be out of date. It does not replace
            your own assessment. The patient can withdraw it at any time.
          </p>
          <p className="mt-1">Viewing this card is recorded and shown to the patient.</p>
        </>
      }
    />
  );
}
