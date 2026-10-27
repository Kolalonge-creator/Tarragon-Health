import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { kindLabel, loadChaseList, scoreBand } from "@/lib/directory-freshness/chase";

export const metadata = { title: "Partner chase list" };
export const dynamic = "force-dynamic";

const lagos = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" }) : "never");
const BAND_CLASS = { fresh: "text-brand-green", ageing: "text-amber-700", stale: "text-red-700" } as const;

/**
 * S80 gap closure (25.9): who to chase first. Every listing has a freshness score that falls a little every day after it was last verified
 * (100 on the day, 50 at its due date, 0 at twice the cadence). Stalest first. Recording a check is done on the Directory freshness page.
 * Nothing here hides or switches off a listing; hiding a stale partner from the patient lab picker is a separate switch that is off.
 */
export default async function DirectoryChasePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const loaded = await loadChaseList();
  if (!loaded.ok && loaded.denied) redirect("/admin");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">Partner chase list</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">
          Active partner listings, stalest first. The score is worked out fresh every day from the last check. To record a check, use{" "}
          <Link href="/admin/ops/directory-freshness" className="font-medium text-brand-green hover:underline">Directory freshness</Link>.
        </p>
      </div>
      {!loaded.ok ? (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-charcoal-ink">
          The chase list could not be loaded. This is a loading problem, not an empty list.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-charcoal-ink/15 text-xs uppercase tracking-wide text-charcoal-ink/60">
                <th className="py-2 pr-3">Listing</th>
                <th className="py-2 pr-3">Kind</th>
                <th className="py-2 pr-3">Score</th>
                <th className="py-2 pr-3">Last checked</th>
                <th className="py-2 pr-3">Can be emailed</th>
                <th className="py-2">Last emailed</th>
              </tr>
            </thead>
            <tbody>
              {loaded.data.map((r) => (
                <tr key={`${r.listing_table}:${r.listing_id}`} className="border-b border-charcoal-ink/10">
                  <td className="py-2 pr-3 font-medium text-charcoal-ink">{r.name}</td>
                  <td className="py-2 pr-3">{kindLabel(r.listing_table)}</td>
                  <td className={`py-2 pr-3 font-semibold ${BAND_CLASS[scoreBand(r.freshness_score)]}`}>{r.freshness_score}</td>
                  <td className="py-2 pr-3">
                    {lagos(r.last_verified_at)}
                    {r.days_since_verified !== null && <span className="text-charcoal-ink/60"> ({r.days_since_verified} days ago)</span>}
                  </td>
                  <td className="py-2 pr-3">{r.can_notify ? "Yes" : "No contact address"}</td>
                  <td className="py-2">{r.last_partner_notice_on ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
