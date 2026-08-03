import Link from "next/link";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { emergencyCardQrSvg, emergencyCardUrl } from "@/lib/emergency/card";
import { EmergencyCardControls } from "./emergency-card-controls";
import { BloodAttestationForm } from "./blood-attestation-form";

/**
 * "Be the record they carry into any hospital."
 *
 * Tarragon owns no clinics, so the durable thing it can be for a patient is the
 * record that travels with them — especially at a facility that has never seen
 * them before.
 *
 * The token is rendered ONLY here, to the patient's own authenticated session.
 * No other surface exposes it.
 */
export default async function EmergencyCardPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data: card } = await supabase
    .from("emergency_cards")
    .select("id, token, is_active, created_at, view_count, last_viewed_at")
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-charcoal-ink">Emergency card</h1>
        <p className="mt-1 text-sm text-charcoal-ink/70">
          A card you can print or keep on your phone. If you are ever treated somewhere that has
          never seen you before, whoever is looking after you can scan it and see the few things
          that matter most in an emergency.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your card</CardTitle>
          <CardDescription>
            {active
              ? "Active. Anyone with this card or link can see it, without signing in."
              : "You do not have a card yet."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {active && qrSvg && url ? (
            <div className="flex flex-col gap-4 rounded-lg border border-charcoal-ink/15 p-4 sm:flex-row sm:items-center">
              {/* Inline SVG so it prints crisply and needs no network at print time. */}
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

      {/* Sits directly under the card: it is the field most likely to be blank
          and the one that most changes what a receiving team does. */}
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

      {active ? (
        <Card>
          <CardHeader>
            <CardTitle>Who has looked at it</CardTitle>
            <CardDescription>
              Every time your card is opened it is recorded here, so you can see if it is being read
              when you did not expect it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!lookups || lookups.length === 0 ? (
              <p className="text-sm text-charcoal-ink/70">Nobody has opened your card yet.</p>
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
                  If any of these look wrong, replace your card — the old link stops working
                  straight away.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>What is on it</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm text-charcoal-ink/80">
            <li>Your name, date of birth and sex</li>
            <li>Your blood group and genotype, if we have them</li>
            <li>Your allergies</li>
            <li>The medicines you are currently taking</li>
            <li>Any ongoing conditions you are being treated for</li>
            <li>Your emergency contact</li>
          </ul>
          <p className="mt-3 text-sm text-charcoal-ink/70">
            Nothing else. No test results, no notes from your care team, no history. If you would
            rather not carry any of this, do not create a card.
          </p>
          <Badge variant="grey" className="mt-3">
            Not indexed by search engines
          </Badge>
        </CardContent>
      </Card>
    </div>
  );
}
