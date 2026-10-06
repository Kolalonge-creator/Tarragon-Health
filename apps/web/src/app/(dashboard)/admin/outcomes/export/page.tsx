import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Export outcomes" };

/**
 * Download the aggregate pilot report as a CSV file (S38d, Module 22.9). It is the same report as the Outcomes page: aggregate only,
 * small groups withheld, the definition and limits included, no individual. Each download is written to the audit log.
 */
export default async function OutcomesExportPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Export outcomes"
        backTo={{ href: "/admin/outcomes", label: "Outcomes" }}
        description="A file of the 90-day blood pressure report for a pilot or a renewal conversation. It holds the same figures as the Outcomes page, with the definition and the limits. It lists no individual and makes no claim about cause."
      />
      <form method="get" action="/admin/outcomes/export/download" className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-sm">Joined from</span>
          <input type="date" name="from" className="min-h-11 rounded border px-2" />
        </label>
        <label className="space-y-1">
          <span className="block text-sm">Joined to</span>
          <input type="date" name="to" className="min-h-11 rounded border px-2" />
        </label>
        <button type="submit" className="min-h-11 rounded border px-4">Download CSV</button>
      </form>
      <p className="text-sm">
        Ranges are by whole calendar month of joining. A group smaller than the minimum is shown as &quot;withheld&quot;. Share the file only
        with a sponsor who has agreed to receive aggregate figures, and do not combine it with other data that could identify a person.
      </p>
    </div>
  );
}
