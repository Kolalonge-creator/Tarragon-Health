import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import {
  DESCRIBE_DRAFT,
  EXPLAINER_DRAFT,
  SAFETY_NET_DRAFT,
  describeTableSchema,
  explainerConfigSchema,
  LIVE_UNREADABLE,
  resolveBundled,
  safetyNetConfigSchema,
  type DescribeTable,
  type ExplainerConfig,
  type SafetyNetConfig,
} from "@tarragon/symptom-triage-engine";
import { createClient } from "@/lib/supabase/server";

/**
 * S59c: which copy of each assessment-experience config the screens may use.
 *
 * Every config is an UNSIGNED DRAFT until the CMO signs a version (S59 pattern). The apps bundle a copy so the screens work offline; a
 * bundled copy is used only when it is signed AND equals the live signed version (`symptom_ux_active_config`). An unsigned bundle, a drift
 * between the bundle and the live signed version, or a malformed copy all mean: the feature falls back to its safe existing behaviour
 * (no match suggested, no explanation, only the generic safety net). A drift is reported to Sentry every time it is seen, because it
 * means someone signed a version and the bundled copy was not updated in the same release.
 *
 * If the live read itself fails the bundled copy is NOT trusted on its own word (the phone, which is offline, is the only place that judges a
 * bundle alone). A signed server version with an unsigned bundle (the release was not cut) is reported every time.
 */
export type AssessmentUx = {
  describe: DescribeTable | null;
  explainer: ExplainerConfig | null;
  safetyNet: SafetyNetConfig | null;
};

export const NO_ASSESSMENT_UX: AssessmentUx = { describe: null, explainer: null, safetyNet: null };

type Rpc = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> };

async function readLive(supabase: SupabaseClient, kind: string): Promise<unknown> {
  try {
    const { data, error } = await (supabase as unknown as Rpc).rpc("symptom_ux_active_config", { p_kind: kind });
    if (error) return LIVE_UNREADABLE; // asked and could not read: a bundle is not trusted on its own word
    return data ?? null;
  } catch {
    return LIVE_UNREADABLE;
  }
}

/** Every state that is not "in force" or the plain, expected "unsigned draft" is reported: each means a signature or a release is out of step. */
function report(kind: string, trust: string): void {
  if (trust === "drift" || trust === "invalid" || trust === "bundle_unsigned" || trust === "unverified") {
    const why =
      trust === "bundle_unsigned"
        ? "the server has a SIGNED version but this build still bundles the unsigned draft, so the feature stays off until the signed text is released"
        : trust === "unverified"
          ? "the live version could not be read, so the bundled copy is not trusted"
          : "the bundled copy does not match the live signed version";
    Sentry.captureException(new Error(`symptom assessment config "${kind}" (${trust}): ${why}; the feature stays on its safe default`));
  }
}

export async function loadAssessmentUx(client?: SupabaseClient): Promise<AssessmentUx> {
  try {
    const supabase = client ?? ((await createClient()) as unknown as SupabaseClient);
    const [d, e, s] = await Promise.all([readLive(supabase, "describe"), readLive(supabase, "explainer"), readLive(supabase, "safety_net")]);
    const describe = resolveBundled(describeTableSchema, DESCRIBE_DRAFT, d);
    const explainer = resolveBundled(explainerConfigSchema, EXPLAINER_DRAFT, e);
    const safetyNet = resolveBundled(safetyNetConfigSchema, SAFETY_NET_DRAFT, s);
    report("describe", describe.trust);
    report("explainer", explainer.trust);
    report("safety_net", safetyNet.trust);
    return { describe: describe.config, explainer: explainer.config, safetyNet: safetyNet.config };
  } catch {
    return NO_ASSESSMENT_UX;
  }
}
