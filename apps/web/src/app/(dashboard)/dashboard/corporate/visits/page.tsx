import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionForm } from "@/components/testing-days/action-form";
import { employerVisitSummarySchema } from "@/lib/testing-days/model";
import { requestEmployerVisit } from "@/lib/testing-days/actions";

export const metadata = { title: "On-site health check visits" };

const STATUS_LABEL: Record<string, string> = {
  requested: "Requested: awaiting our confirmation",
  scheduled: "Scheduled",
  open: "Scheduled",
  closed: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

/**
 * Request an on-site visit from the Tarragon team and follow it. The employer sees counts only (rule I9): a count under the
 * minimum cell size is not shown at all, and nothing here names an employee or a result.
 */
export default async function CorporateVisitsPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("employer_visit_summary");
  const visits = employerVisitSummarySchema.catch([]).parse(data ?? []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Request an on-site visit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-charcoal-ink/70">
            Our team comes to your site for the yearly health check for the employees who hold a Membership through you. Choose a date
            at least a week away. We will confirm the date, the team and what we need on site.
          </p>
          <ActionForm action={requestEmployerVisit} submitLabel="Send request">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="eventDate">Preferred date</Label>
                <Input id="eventDate" name="eventDate" type="date" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="headcount">How many employees</Label>
                <Input id="headcount" name="headcount" type="number" min={1} max={500} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="city">City</Label>
                <Input id="city" name="city" required />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="address">Site address</Label>
                <Input id="address" name="address" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="lga">LGA</Label>
                <Input id="lga" name="lga" />
              </div>
              <div className="space-y-1 sm:col-span-3">
                <Label htmlFor="notes">Anything we should know (a room, access, timing)</Label>
                <Input id="notes" name="notes" maxLength={500} />
              </div>
            </div>
          </ActionForm>
        </CardContent>
      </Card>

      <section aria-labelledby="your-visits" className="space-y-3">
        <h2 id="your-visits" className="font-heading text-lg font-semibold text-charcoal-ink">
          Your visits
        </h2>
        {visits.length === 0 ? <p className="text-sm text-charcoal-ink/60">No visits yet.</p> : null}
        {visits.map((v) => (
          <Card key={v.id}>
            <CardContent className="space-y-1 pt-6">
              <p className="flex flex-wrap items-center gap-2 font-medium text-charcoal-ink">
                {v.event_date} · {v.city}
                <Badge variant={v.status === "requested" ? "amber" : v.status === "completed" ? "green" : "blue"}>
                  {STATUS_LABEL[v.status] ?? v.status}
                </Badge>
              </p>
              <p className="text-sm text-charcoal-ink/70">{v.address}</p>
              <p className="text-sm text-charcoal-ink/70">
                {v.headcount_requested ? `You asked for ${v.headcount_requested} people. ` : ""}
                {v.registered !== null ? `Registered: ${v.registered}. ` : ""}
                {v.checked_in !== null ? `Checked in: ${v.checked_in}. ` : ""}
                {v.suppressed ? "Figures appear once there are enough people to keep individuals private." : ""}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
