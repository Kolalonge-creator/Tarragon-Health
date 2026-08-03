import Link from "next/link";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { emergencyCardQrSvg, emergencyCardUrl } from "@/lib/emergency/card";
import { EmergencyCardControls } from "./emergency-card-controls";
import { BloodAttestationForm } from "./blood-attestation-form";

/**
 * "Be the record they carry into any hospital."
 *
 * REDESIGNED 2026-08-03: the printed/offline card is now the default — no new
 * anon-readable surface, nothing to consent to beyond what viewing your own
 * record already needs. The live QR/link (this page's original design) is now
 * a clearly separate, explicitly-opted-into EXTRA, framed as such below.
 *
 * The token itself is rendered ONLY in the opt-in section, to the patient's
 * own authenticated session. No other surface exposes it.
 */
export default async function EmergencyCardPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data: card } = await supabase
    .from("emergency_cards")
    .select("id, token, is_active, created_at, expires_at, view_count, last_viewed_at")
    .eq("patient_id", user.id)
    .maybeSingle();

  const active = card?.is_active ? card : null;
  const qrSvg = active ? await emergencyCardQrSvg(active.token) : null;
  const url = active ? emergencyCardUrl(active.token) : null;

  const { data: blood } = await supabase
    .from("patient_blood_profile")
    .select("blood_group, genotype, genotype_note, provenance")
    .eq("patient_id", user.id)
    .maybeSingle();

  const { data: lookups } = active
    ? await supabase
        .from("emergency_card_lookups")
        .select("id, looked_up_at")
        .eq("card_id", active.id)
        .order("looked_up_at", { ascending: false })
        .limit(10)
    : { data: null };

  const expiresSoon = active ? isExpiringSoon(active.expires_at) : false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-charcoal-ink">Emergency card</h1>
        <p className="mt-1 text-sm text-charcoal-ink/70">
          The few things that matter most if you are ever treated somewhere that has never seen you
          before: your blood group and genotype, allergies, current medicines, ongoing conditions,
          and your emergency contact.
        </p>
      </div>

      {/* Sits before either card option: both the print and live paths depend
          on this being filled in, and it is the field most likely to be blank. */}
      <BloodAttestationForm
        initial={
          blood
            ? {
                bloodGroup: blood.blood_group,
                genotype: blood.genotype,
                genotypeNote: blood.genotype_note,
                provenance: blood.provenance,
              }
            : null
        }
      />

      {/* THE DEFAULT: a printed card, no new exposure, nothing to consent to. */}
      <Card>
        <CardHeader>
          <CardTitle>Your printable card</CardTitle>
          <CardDescription>
            Print it, fold it into your wallet, or save the page to your phone. This is just your
            own record — the same as printing your Health Passport — so there is nothing extra to
            agree to here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-1 text-sm text-charcoal-ink/80">
            <li>Your name, date of birth and sex</li>
            <li>Your blood group and genotype, if we have them</li>
            <li>Your allergies</li>
            <li>The medicines you are currently taking</li>
            <li>Any ongoing conditions you are being treated for</li>
            <li>Your emergency contact</li>
          </ul>
          <p className="text-sm text-charcoal-ink/70">
            Nothing else — no test results, no notes from your care team, no history. A QR code on
            the printed card carries the same facts as plain text, so any phone&rsquo;s camera can
            read it with no app and no internet.
          </p>
          <Button asChild>
            <Link href="/patient/emergency-card/print" target="_blank">
              View / print my card
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* THE OPT-IN EXTRA: a live link, clearly separated and consented to on
          its own terms — a genuinely different, always-current exposure. */}
      <Card>
        <CardHeader>
          <CardTitle>Also want a live link?</CardTitle>
          <CardDescription>
            {active
              ? `Active. Anyone with this card or link can see it, without signing in. Valid until ${new Date(active.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.`
              : "Optional, and separate from your printed card. Useful if someone abroad wants to check your details are current — but unlike the printed card, this stays reachable by anyone who has the link, for as long as it's active."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {expiresSoon ? (
            <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              This link expires soon. Replace it below to keep it working, or let it lapse — your
              printed card is unaffected either way.
            </p>
          ) : null}

          {active && qrSvg && url ? (
            <div className="flex flex-col gap-4 rounded-lg border border-charcoal-ink/15 p-4 sm:flex-row sm:items-center">
              <div
                className="shrink-0"
                aria-label="QR code linking to your emergency card"
                // Locally generated SVG from a token this server just minted —
                // no user input reaches it.
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium text-charcoal-ink">
                  Scan this, or open the link below.
                </p>
                <p className="break-all text-xs text-charcoal-ink/60">{url}</p>
                <Link
                  href={`/emergency/${active.token}`}
                  target="_blank"
                  className="inline-block text-sm font-medium text-brand-green hover:underline"
                >
                  See exactly what a stranger would see →
                </Link>
              </div>
            </div>
          ) : null}

          <EmergencyCardControls hasActiveCard={Boolean(active)} />
        </CardContent>
      </Card>

      {active ? (
        <Card>
          <CardHeader>
            <CardTitle>Who has looked at your live link</CardTitle>
            <CardDescription>
              You&rsquo;re also notified the moment it&rsquo;s viewed, so you don&rsquo;t need to
              check back here to know.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!lookups || lookups.length === 0 ? (
              <p className="text-sm text-charcoal-ink/70">Nobody has opened it yet.</p>
            ) : (
              <>
                <p className="mb-2 text-sm text-charcoal-ink">
                  Opened {active.view_count} time{active.view_count === 1 ? "" : "s"}.
                </p>
                <ul className="space-y-1">
                  {lookups.map((l) => (
                    <li key={l.id} className="text-sm text-charcoal-ink/75">
                      {new Date(l.looked_up_at).toLocaleString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-charcoal-ink/55">
                  If any of these look wrong, replace your link — the old one stops working
                  straight away.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Badge variant="grey">The live link is never indexed by search engines</Badge>
    </div>
  );
}

/** A plain helper, not inlined in the component body — Date.now() called
 * directly inside a component's render is flagged as impure by this
 * codebase's lint config, same reason emergency-card-body.tsx's formatDob
 * lives outside its component. */
function isExpiringSoon(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000;
}
