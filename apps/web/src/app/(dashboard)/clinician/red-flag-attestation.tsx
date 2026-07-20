import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isAttestationCurrent } from "@/lib/clinical/attestation";
import { AttestButton } from "./attest-button";

/**
 * Annual red-flag attestation status (§25) for the signed-in doctor. Surfaced,
 * not hard-blocking — mirrors the indemnity-badge pattern (ops acts on it).
 * Only rendered for a caller who actually has a clinical_staff row.
 */
export async function RedFlagAttestation() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("red_flag_attested_at")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!staff) return null;

  const attestedAt = staff.red_flag_attested_at ? new Date(staff.red_flag_attested_at) : null;
  const current = isAttestationCurrent(staff.red_flag_attested_at);

  return (
    <Card variant={current ? "soft" : undefined}>
      <CardHeader>
        <CardTitle className="text-base">Diabetes red-flag attestation (§25)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {current ? (
          <p className="text-charcoal-ink/70">
            Attested {attestedAt!.toLocaleDateString()} — current. You confirm you know and will act
            on the glucose, symptom, lab and medication red flags, and that a red flag overrides
            routine scheduling.
          </p>
        ) : (
          <p className="text-amber-800">
            {attestedAt
              ? "Your annual red-flag attestation is overdue."
              : "You have not yet completed your red-flag attestation."}{" "}
            You confirm you know and will act on the diabetes red flags (hypoglycaemia, DKA, HHS, the
            acute foot) and that a red flag overrides routine plans.
          </p>
        )}
        <AttestButton alreadyCurrent={current} />
      </CardContent>
    </Card>
  );
}
