import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { formatPatientDate } from "@/lib/format-date";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import { RatingModerationForm, RecordCheckForm } from "./queue-forms";

export const metadata = { title: "Directory queues" };
export const dynamic = "force-dynamic";

const PERMISSION_DENIED = "42501";

/**
 * The two staff queues behind the patient directory (S65): ratings waiting for moderation (15.11) and listings that patients reported as
 * wrong, waiting for a person to check them (15.17). Both are read through database functions that decide who may see them; a refusal
 * (42501) sends the person back to the admin home rather than showing an empty queue, because an empty list would read as "nothing waiting".
 * The rating queue shows no patient identity, and reading it is audited by the function.
 */
export default async function AdminDirectoryQueuesPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const [ratings, reports] = await Promise.all([supabase.rpc("facility_rating_queue"), supabase.rpc("directory_reverification_list")]);
  if (ratings.error?.code === PERMISSION_DENIED && reports.error?.code === PERMISSION_DENIED) redirect("/admin");

  const ratingRows = ratings.data ?? [];
  const reportRows = reports.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Directory queues"
        description="Ratings waiting for moderation and listings patients reported as wrong. A report never changes a listing: a person checks it and records the check."
      />

      <Card>
        <CardHeader>
          <CardTitle>Reported listings{reports.error ? "" : ` (${reportRows.length})`}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {reports.error ? (
            <LoadFailure>
              {reports.error.code === PERMISSION_DENIED
                ? "You do not have access to the verification queue."
                : "The verification queue could not be loaded. This is not a report that nothing is waiting. Reload to try again."}
            </LoadFailure>
          ) : reportRows.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">Nothing waiting.</p>
          ) : (
            reportRows.map((r) => (
              <div key={r.queue_id} className="rounded-md border border-charcoal-ink/10 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-charcoal-ink">{r.name}</p>
                  {r.priority === "immediate" ? <Badge variant="red">Check now</Badge> : <Badge variant="grey">Routine</Badge>}
                  <span className="text-xs text-charcoal-ink/60">
                    {r.reports} {r.reports === 1 ? "report" : "reports"}, opened {formatPatientDate(r.opened_at)}
                  </span>
                </div>
                {r.fields.length > 0 ? <p className="pt-1 text-xs text-charcoal-ink/70">Reported wrong: {r.fields.join(", ")}</p> : null}
                {r.listing_table === "facilities" || r.listing_table === "specialist_providers" ? (
                  <RecordCheckForm table={r.listing_table} listing={r.listing_id} />
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ratings to moderate{ratings.error ? "" : ` (${ratingRows.length})`}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {ratings.error ? (
            <LoadFailure>
              {ratings.error.code === PERMISSION_DENIED
                ? "You do not have access to the moderation queue."
                : "The moderation queue could not be loaded. This is not a report that nothing is waiting. Reload to try again."}
            </LoadFailure>
          ) : ratingRows.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">Nothing waiting.</p>
          ) : (
            ratingRows.map((r) => (
              <div key={r.rating_id} className="rounded-md border border-charcoal-ink/10 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-charcoal-ink">{r.facility_name}</p>
                  <Badge variant="grey">{r.rating} of 5</Badge>
                  {r.overdue ? <Badge variant="red">Past its reply date</Badge> : null}
                  <span className="text-xs text-charcoal-ink/60">Reply by {formatPatientDate(r.respond_by)}</span>
                </div>
                {r.comment ? <p className="pt-1 text-sm text-charcoal-ink">{r.comment}</p> : null}
                {r.held_reason ? (
                  <p className="pt-1 text-xs text-amber-700">Held: {r.held_reason}. It can be published without the comment, or rejected.</p>
                ) : null}
                <RatingModerationForm ratingId={r.rating_id} held={r.held_reason !== null} />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
