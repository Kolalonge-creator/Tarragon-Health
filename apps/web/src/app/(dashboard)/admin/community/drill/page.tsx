import Link from "next/link";
import { DrillRuns, DrillSteps } from "@/components/community/drill-runs";
import { getCommunityStaffContext } from "@/components/community/staff-rpc";
import { CommunityNav, LoadFailed } from "../community-nav";
import { loadTabletopRuns, requireAdmin } from "../load";
import { card, h1, h2, link } from "../ui";

export const metadata = { title: "Safety drill" };
export const dynamic = "force-dynamic";

export default async function CommunityDrillPage() {
  await requireAdmin();
  const [runs, ctx] = await Promise.all([loadTabletopRuns(), getCommunityStaffContext()]);
  return (
    <div className="space-y-8">
      <h1 className={h1}>Safety drill</h1>
      <CommunityNav />
      <p className="max-w-3xl text-sm text-charcoal-ink/80">
        Before the community goes live, the Chief Medical Officer rehearses the safety hand-off with a test account and records the result here.
        Use a test account only. Never a real member.
      </p>

      <section aria-labelledby="steps" className={card}>
        <h2 id="steps" className={h2}>The steps</h2>
        <div className="mt-3"><DrillSteps /></div>
      </section>

      <section aria-labelledby="record" className={card}>
        <h2 id="record" className={h2}>Record a drill</h2>
        <p className="mt-2 max-w-3xl text-sm text-charcoal-ink">
          Only the Chief Medical Officer can record a drill, so you can read the steps and past runs here but not add one. The Chief Medical Officer records it on the{" "}
          <Link href="/clinician/community/drill" className={link}>drill page in the clinician area</Link>.
          {ctx?.is_cmo ? " You are signed in as the Chief Medical Officer, so use that page." : ""}
        </p>
      </section>

      <section aria-labelledby="runs" className="space-y-3">
        <h2 id="runs" className={h2}>Past runs</h2>
        {runs.ok ? <DrillRuns runs={runs.data.runs} /> : <LoadFailed what="The past runs" />}
      </section>
    </div>
  );
}
