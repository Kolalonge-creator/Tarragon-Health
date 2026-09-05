import Link from "next/link";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
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
  // Every read here is destructured with its error. A card whose read failed
  // is not a card that isn't there, and a blood profile whose read failed is
  // not a blank one — this page is the thing a patient carries into a hospital
  // that has never seen them, so "we don't know" has to say so rather than
  // quietly render as "nothing recorded".
  const { data: card, error: cardError } = await supabase
    .from("emergency_cards")
    .select("id, token, is_active, created_at, expires_at, view_count, last_viewed_at")
    .eq("patient_id", user.id)
    .maybeSingle();

  const active = card?.is_active ? card : null;
  const qrSvg = active ? await emergencyCardQrSvg(active.token) : null;
  const url = active ? emergencyCardUrl(active.token) : null;

  const { data: blood, error: bloodError } = await supabase
    .from("patient_blood_profile")
    .select("blood_group, genotype, genotype_note, provenance")
    .eq("patient_id", user.id)
    .maybeSingle();

  const { data: lookups, error: lookupsError } = active
    ? await supabase
        .from("emergency_card_lookups")
        .select("id, looked_up_at")
        .eq("card_id", active.id)
        .order("looked_up_at", { ascending: false })
        .limit(10)
    : { data: null, error: null };

  const expiresSoon = active ? isExpiringSoon(active.expires_at) : false;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Emergency card"
        icon={NAV_ICON.siren}
        description="The few things that matter most if you are ever treated somewhere that has never seen you before: your blood group and genotype, allergies, current medicines, ongoing conditions, and your emergency contact."
        actions={
          <Button asChild className="shrink-0 bg-red-700 hover:bg-red-800">
            <Link href="/patient/emergency-card/print" target="_blank">
              View / print my card
            </Link>
          </Button>
        }
      />

      {/* Sits before either card option: both the print and live paths depend
          on this being filled in, and it is the field most likely to be blank. */}
      {bloodError ? (
        <Card>
          <CardHeader>
            <CardTitle>Blood group and genotype</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
              We could not load your blood group and genotype just now. That is not the same as
              us having none on file, so please refresh and try again before you add anything.
            </p>
          </CardContent>
        </Card>
      ) : (
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
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {/* THE DEFAULT: a printed card, no new exposure, nothing to consent to. */}
        <Card>
          <CardHeader>
            <CardTitle>Your printable card</CardTitle>
            <CardDescription>
              Print it, fold it into your wallet, or save the page to your phone. This is just
              your own record (the same as printing your Health Passport), so there is nothing
              extra to agree to here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-1 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
              <li>Your name, date of birth and sex</li>
              <li>Your blood group and genotype, if we have them</li>
              <li>Your allergies</li>
              <li>The medicines you are currently taking</li>
              <li>Any ongoing conditions you are being treated for</li>
              <li>Your emergency contact</li>
            </ul>
            <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
              Nothing else: no test results, no notes from your care team, no history. A QR code
              on the printed card carries the same facts as plain text, so any phone&rsquo;s
              camera can read it with no app and no internet.
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
                ? `Active. Anyone with this card or link can see it, without signing in. Valid until ${new Date(active.expires_at).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" })}.`
                : "Optional, and separate from your printed card. Useful if someone abroad wants to check your details are current, but unlike the printed card, this stays reachable by anyone who has the link, for as long as it's active."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {expiresSoon ? (
              <p className="rounded border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/15 p-2 text-xs text-amber-900 dark:text-amber-200">
                This link expires soon. Replace it below to keep it working, or let it lapse.
                Your printed card is unaffected either way.
              </p>
            ) : null}

            {active && qrSvg && url ? (
              <div className="flex flex-col gap-4 rounded-lg border border-charcoal-ink/15 dark:border-night-ink/20 p-4 sm:flex-row sm:items-center">
                <div
                  className="shrink-0"
                  aria-label="QR code linking to your emergency card"
                  // Locally generated SVG from a token this server just minted —
                  // no user input reaches it.
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                />
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                    Scan this, or open the link below.
                  </p>
                  <p className="break-all text-xs text-charcoal-ink/60 dark:text-night-ink/60">{url}</p>
                  <Link
                    href={`/emergency/${active.token}`}
                    target="_blank"
                    className="inline-block text-sm font-medium text-brand-green dark:text-brand-green-bright hover:underline"
                  >
                    See exactly what a stranger would see →
                  </Link>
                </div>
              </div>
            ) : null}

            {/* With the read failed we don't know whether a live link already
                exists, and offering to create one is the wrong thing to offer:
                it would replace a working link the patient still has out
                there. The controls come back on a successful refresh. */}
            {cardError ? (
              <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
                We could not check whether you have a live link just now. Please refresh and try
                again. Your printed card is unaffected either way.
              </p>
            ) : (
              <EmergencyCardControls hasActiveCard={Boolean(active)} />
            )}
          </CardContent>
        </Card>
      </div>

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
            {lookupsError ? (
              // "Nobody has opened it yet" is a claim about who has seen this
              // patient's record. We only make it when we actually read the log.
              <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
                We could not load this just now, so we can&apos;t tell you either way. Please
                refresh and try again.
              </p>
            ) : !lookups || lookups.length === 0 ? (
              <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">Nobody has opened it yet.</p>
            ) : (
              <>
                <p className="mb-2 text-sm text-charcoal-ink dark:text-night-ink">
                  Opened {active.view_count} time{active.view_count === 1 ? "" : "s"}.
                </p>
                <ul className="space-y-1">
                  {lookups.map((l) => (
                    <li key={l.id} className="text-sm text-charcoal-ink/75 dark:text-night-ink/75">
                      {new Date(l.looked_up_at).toLocaleString("en-GB", { timeZone: "Africa/Lagos",
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-charcoal-ink/55 dark:text-night-ink/60">
                  If any of these look wrong, replace your link. The old one stops working
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
