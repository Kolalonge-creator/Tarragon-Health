import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { kindLabel, loadChaseList, scoreBand } from "@/lib/directory-freshness/chase";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/ui/data-table";

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

  const columns: DataTableColumn[] = [
    { header: "Listing", sortable: true, className: "min-w-48" },
    { header: "Kind", sortable: true },
    { header: "Score", sortable: true, align: "right" },
    { header: "Last checked", sortable: true },
    { header: "Can be emailed", sortable: true },
    { header: "Last emailed", sortable: true, defaultDir: "desc" },
  ];
  const rows: DataTableRow[] = loaded.ok
    ? loaded.data.map((r) => ({
        key: `${r.listing_table}:${r.listing_id}`,
        searchText: `${r.name} ${kindLabel(r.listing_table)}`,
        sort: [r.name, kindLabel(r.listing_table), r.freshness_score, r.last_verified_at, r.can_notify ? 1 : 0, r.last_partner_notice_on],
        cells: [
          <span key="name" className="font-medium text-charcoal-ink">{r.name}</span>,
          kindLabel(r.listing_table),
          <span key="score" className={`font-semibold ${BAND_CLASS[scoreBand(r.freshness_score)]}`}>{r.freshness_score}</span>,
          <span key="checked">
            {lagos(r.last_verified_at)}
            {r.days_since_verified !== null && <span className="text-charcoal-ink/60"> ({r.days_since_verified} days ago)</span>}
          </span>,
          r.can_notify ? "Yes" : "No contact address",
          r.last_partner_notice_on ?? "-",
        ],
      }))
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Partner chase list"
        description={
          <>
            Active partner listings, stalest first. The score is worked out fresh every day from the last check. To record a check, use{" "}
            <Link href="/admin/ops/directory-freshness" className="font-medium text-brand-green hover:underline">Directory freshness</Link>.
          </>
        }
      />
      {!loaded.ok ? (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-charcoal-ink">
          The chase list could not be loaded. This is a loading problem, not an empty list.
        </p>
      ) : (
        // No initial sort: the list arrives stalest first from the loader, and that order is the point of the page.
        <DataTable
          caption="Partner chase list, stalest first"
          columns={columns}
          rows={rows}
          searchLabel="Search listings"
          emptyMessage="No active partner listings."
          noun={{ one: "listing", many: "listings" }}
        />
      )}
    </div>
  );
}
