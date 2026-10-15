import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { tabletopRunsSchema } from "@/lib/community/model";
import { DrillRuns, DrillSteps } from "@/components/community/drill-runs";
import { DrillForm } from "@/components/community/drill-form";
import { getCommunityStaffContext } from "@/components/community/staff-rpc";
import { recordDrillAction } from "../actions";

export const metadata = { title: "Safety drill" };
export const dynamic = "force-dynamic";

export default async function ClinicianDrillPage() {
  const ctx = await getCommunityStaffContext();
  if (!ctx?.is_cmo) {
    return (
      <div className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Safety drill</h1>
        <p className="text-sm text-charcoal-ink/70">Only the Chief Medical Officer records the safety drill.</p>
      </div>
    );
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_tabletop_runs");
  const parsed = tabletopRunsSchema.safeParse(data);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Safety drill</h1>
        <p className="text-sm text-charcoal-ink/70">
          Rehearse the safety hand-off with a test account, then record what happened. Never use a real member.{" "}
          <Link href="/clinician/community" className="font-medium text-brand-green underline">Back to Community</Link>
        </p>
      </div>
      <section aria-labelledby="steps-h" className="space-y-2 rounded-lg border border-charcoal-ink/10 bg-white p-4">
        <h2 id="steps-h" className="font-heading text-lg font-semibold text-charcoal-ink">The steps</h2>
        <DrillSteps />
      </section>
      <section aria-labelledby="rec-h" className="space-y-3 rounded-lg border border-charcoal-ink/10 bg-white p-4">
        <h2 id="rec-h" className="font-heading text-lg font-semibold text-charcoal-ink">Record a drill</h2>
        <DrillForm onRecord={recordDrillAction} />
      </section>
      <section aria-labelledby="runs-h" className="space-y-3">
        <h2 id="runs-h" className="font-heading text-lg font-semibold text-charcoal-ink">Past runs</h2>
        {error || !parsed.success ? (
          <p role="alert" className="text-sm text-red-700">We could not load this just now. Please reload the page in a moment.</p>
        ) : (
          <DrillRuns runs={parsed.data.runs} />
        )}
      </section>
    </div>
  );
}
