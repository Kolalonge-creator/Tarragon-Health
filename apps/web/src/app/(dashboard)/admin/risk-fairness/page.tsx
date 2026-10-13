import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isShownCell, parseFairness, type FairnessCell } from "@/lib/risk/worklist";

export const metadata = { title: "Risk fairness" };
export const dynamic = "force-dynamic";

function Group({ title, cells }: { title: string; cells: FairnessCell[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {cells.length === 0 ? (
          <p>Nobody scored yet.</p>
        ) : (
          <ul className="space-y-1">
            {cells.map((c) => (
              <li key={c.key}>
                {c.key}:{" "}
                {isShownCell(c) ? `${c.n} people, ${c.high} high, ${c.medium} medium, ${c.low} low (${c.high_pct}% high)` : "withheld, group too small"}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default async function RiskFairnessPage() {
  const profile = await getCurrentProfile();
  // proxy.ts keeps non-admins out of /admin; the database also refuses anyone but an admin or the CMO.
  if (profile?.role !== "admin") redirect("/admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("risk_distribution_report");
  const report = error ? null : parseFairness(data);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Risk fairness"
        backTo={{ href: "/admin", label: "Admin" }}
        description="How the worklist tiers fall across groups of patients, to check the ordering does not land unevenly on one group. No individual is listed."
      />
      {!report ? (
        <p role="alert">The report could not be read. Please refresh, or ask an admin or the CMO to open it.</p>
      ) : (
        <>
          <p className="text-sm">
            {report.total_scored === null ? "Too few people are scored to show a total." : `${report.total_scored} people scored.`} A group smaller than {report.minimum_cell} is
            withheld, and so is the next smallest, so a withheld group cannot be worked out by subtraction.
          </p>
          <Group title="By sex" cells={report.by.sex} />
          <Group title="By age" cells={report.by.age_band} />
          <Group title="By state" cells={report.by.state} />
          <p className="text-sm">{report.purpose} It makes no claim about cause and is never a reason to withhold care.</p>
        </>
      )}
    </div>
  );
}
