import { employerPilotText } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { nairaFromKobo, parsePilotReport, type PilotReport } from "@/lib/employer-pilot/model";
import { PrintButton } from "./print-button";

export const metadata = { title: "Membership seat pilot" };
export const dynamic = "force-dynamic";

/**
 * The employer's view of its seat pilot. Rule I9: this page shows what `employer_seat_pilot_report` returns and nothing else. It reads
 * no patient-scoped table and no per-person row; usage figures are withheld below the minimum group and rounded.
 */
export default async function CorporatePilotPage() {
  const profile = await getCurrentProfile();
  if (!profile?.organisation_id) return null;
  const supabase = await createClient();

  // RLS lets this account read its own organisation's pilots only. The newest pilot that was not cancelled is the one in play.
  const { data: pilots, error: pilotsError } = await supabase
    .from("employer_seat_pilots")
    .select("id, state")
    .eq("organisation_id", profile.organisation_id)
    .neq("state", "cancelled")
    .order("created_at", { ascending: false })
    .limit(1);
  if (pilotsError) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p role="alert" className="text-sm text-status-red">
            We could not load your seat pilot just now. Please try again in a moment.
          </p>
        </CardContent>
      </Card>
    );
  }
  const pilot = pilots?.[0];
  if (!pilot) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{employerPilotText("pilot.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-charcoal-ink/70">{employerPilotText("pilot.none")}</p>
        </CardContent>
      </Card>
    );
  }

  const { data } = await supabase.rpc("employer_seat_pilot_report", { p_pilot: pilot.id });
  const report = parsePilotReport(data);
  if (!report) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p role="alert" className="text-sm text-status-red">
            We could not load the report just now. Please try again in a moment.
          </p>
        </CardContent>
      </Card>
    );
  }
  return <PilotReportView report={report} />;
}

function PilotReportView({ report }: { report: PilotReport }) {
  const u = report.usage;
  const withheld = employerPilotText("pilot.withheld");
  const figure = (n: number | null) => (n === null ? withheld : String(n));
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {employerPilotText("pilot.title")}
            <Badge variant="grey">{employerPilotText(`pilot.state.${report.pilot.state}` as const)}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-charcoal-ink/70">{employerPilotText("pilot.intro")}</p>
          <p className="text-sm text-charcoal-ink/70">{employerPilotText("pilot.privacy")}</p>
          <p className="text-sm text-charcoal-ink/60">
            Claim window {report.pilot.starts_on} to {report.pilot.ends_on}. Invoice total {nairaFromKobo(report.pilot.total_kobo)} at{" "}
            {nairaFromKobo(report.pilot.seat_price_kobo)} a seat. Terms version {report.pilot.terms_version}.
          </p>
          <div className="flex flex-wrap gap-2 print:hidden">
            <a
              className="rounded-md border border-charcoal-ink/20 px-3 py-1.5 text-sm font-medium hover:bg-charcoal-ink/5"
              href={`/dashboard/corporate/pilot/export?pilot=${report.pilot.id}`}
            >
              {employerPilotText("pilot.export.csv")}
            </a>
            <PrintButton label={employerPilotText("pilot.export.print")} />
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="pilot-seats" className="space-y-3">
        <h2 id="pilot-seats" className="font-heading text-lg font-semibold text-charcoal-ink">
          {employerPilotText("pilot.seats.heading")}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-4">
          <Stat label="Purchased" value={report.seats.purchased} />
          <Stat label="Claimed" value={report.seats.claimed} />
          <Stat label="Active" value={report.seats.active} />
          <Stat label="Not yet claimed" value={report.seats.unclaimed} />
        </dl>
        <p className="text-sm text-charcoal-ink/60">{employerPilotText("pilot.unclaimed.body")}</p>
        {report.seats.claims_without_seat > 0 ? (
          <div className="rounded-md border border-charcoal-ink/15 p-3">
            <p className="text-sm font-medium text-charcoal-ink">
              {employerPilotText("pilot.waiting.heading")}: {report.seats.claims_without_seat}
            </p>
            <p className="text-sm text-charcoal-ink/70">{employerPilotText("pilot.waiting.body")}</p>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="pilot-usage" className="space-y-3">
        <h2 id="pilot-usage" className="font-heading text-lg font-semibold text-charcoal-ink">
          {employerPilotText("pilot.usage.heading")}
        </h2>
        {u.suppressed ? (
          <p className="text-sm text-charcoal-ink/70">
            {employerPilotText(u.reason === "not_enabled" ? "pilot.usage.off" : "pilot.usage.suppressed")}
          </p>
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-3">
              <Stat label="Members who had a consultation" value={figure(u.members_with_consultation)} />
              <Stat label="Consultations completed" value={figure(u.consultations_completed)} />
              <Stat label="Members who logged a check-in" value={figure(u.members_with_check_in)} />
            </dl>
            <p className="text-sm text-charcoal-ink/60">
              {employerPilotText("pilot.usage.note", { rounded: report.rounded_to, through: report.usage_through, min: report.min_cell })}
            </p>
          </>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <dt className="text-sm text-charcoal-ink/60">{label}</dt>
        <dd className="font-heading text-2xl font-semibold text-charcoal-ink">{value}</dd>
      </CardContent>
    </Card>
  );
}
