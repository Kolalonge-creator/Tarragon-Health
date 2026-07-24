import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ObesityAttestButton } from "./obesity-attest-button";

/**
 * Obesity red-flag attestation (§26). A doctor attests, on joining and
 * annually, that they know and will act on the pathway's red flags — the
 * eating-disorder / mental-health flags especially. Shown once per clinician
 * (not per patient); it just happens to render on the patient worklist page.
 */
export async function ObesityAttestationCard() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createClient();
  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("id")
    .eq("profile_id", profile.id)
    .eq("active", true)
    .maybeSingle();
  if (!staff?.id) return null; // non-clinical caller: nothing to attest

  const { data } = await supabase
    .from("pathway_attestations")
    .select("attested_at")
    .eq("clinical_staff_id", staff.id)
    .eq("protocol_slug", "chronic_obesity_who")
    .eq("pathway_version", 1)
    .maybeSingle();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Obesity pathway attestation</CardTitle>
      </CardHeader>
      <CardContent>
        {data?.attested_at ? (
          <p className="text-sm text-brand-green">
            Attested on {new Date(data.attested_at).toLocaleDateString()}. You have confirmed you will
            act on the red flags in §16.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-charcoal-ink/70">
              You have not yet signed the obesity pathway attestation. By signing, you confirm you will
              practise non-stigmatising, person-first care and act on the §16 red flags — pausing
              weight-loss treatment and referring on any eating-disorder or mental-health flag.
            </p>
            <ObesityAttestButton />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
