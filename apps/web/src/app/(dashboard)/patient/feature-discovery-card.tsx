import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { APP_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { getPatientSignals } from "@/lib/patient/feature-signals";
import { suggestableFeatures } from "@/lib/patient/feature-registry";
import { DismissFeatureButton } from "@/app/(dashboard)/patient/feature-discovery-dismiss";

/** Never more than this on screen at once. Three suggestions is a to-do list
 * somebody else wrote; two is a mention. */
const MAX_SUGGESTIONS = 2;

/**
 * "You might not know this is here."
 *
 * The piece that actually closes the discovery gap for the patient who was
 * never going to search, because she does not know there is anything to
 * search for. Cycle tracking is the case that motivated it: real, live,
 * useful, four levels deep, and mentioned nowhere a woman would ever see it.
 *
 * Rules it holds itself to, all of which exist to keep this from becoming the
 * upsell strip every health app eventually grows:
 *   - Two at a time, maximum.
 *   - Only what the registry's relevance predicate says fits this patient.
 *   - Never something they have already opened or dismissed
 *     (patient_feature_views).
 *   - Never a paid feature they do not have (the registry's `feature` gate) —
 *     this suggests things to use, not things to buy.
 *   - Never the safety-critical or everyday surfaces (`neverSuggest`), which
 *     are either always in front of them anyway or would be tasteless to
 *     nudge somebody toward.
 *   - Renders nothing at all once there is nothing left to say, which for a
 *     settled patient is most days.
 */
export async function FeatureDiscoveryCard({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const signals = await getPatientSignals(patientId);

  const { data: views } = await supabase
    .from("patient_feature_views")
    .select("feature_id")
    .eq("patient_id", patientId);

  const seen = (views ?? []).map((v) => v.feature_id);
  const suggestions = suggestableFeatures(signals, seen).slice(0, MAX_SUGGESTIONS);

  if (suggestions.length === 0) return null;

  return (
    <Card className="border-brand-green/25 bg-soft-sage/30">
      <CardContent className="space-y-3 p-5">
        <p className="font-heading text-sm font-semibold text-charcoal-ink">
          You might not know this is here
        </p>
        <ul className="space-y-2">
          {suggestions.map((feature) => {
            const Icon = APP_ICON[feature.icon];
            return (
              <li
                key={feature.id}
                className="flex items-start gap-3 rounded-xl bg-white p-3.5"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-soft-sage">
                  <Icon className="h-4.5 w-4.5 text-deep-forest" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={feature.href}
                    prefetch={false}
                    className="font-heading text-sm font-semibold text-charcoal-ink hover:text-deep-forest hover:underline"
                  >
                    {feature.label}
                  </Link>
                  <p className="mt-0.5 text-sm leading-snug text-charcoal-ink/65">
                    {feature.blurb}
                  </p>
                </div>
                <DismissFeatureButton featureId={feature.id} label={feature.label} />
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-charcoal-ink/45">
          Everything the app can do is listed under{" "}
          <Link href="/patient/health" className="underline hover:text-charcoal-ink/70">
            Your health
          </Link>
          ,{" "}
          <Link href="/patient/stay-well" className="underline hover:text-charcoal-ink/70">
            Stay well
          </Link>
          ,{" "}
          <Link href="/patient/support" className="underline hover:text-charcoal-ink/70">
            Support
          </Link>{" "}
          and{" "}
          <Link href="/patient/account" className="underline hover:text-charcoal-ink/70">
            Your account
          </Link>
          , or search from the top of any page.
        </p>
      </CardContent>
    </Card>
  );
}
