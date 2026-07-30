import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Aggregate lifestyle programme outcomes for an org (spec §13), read from the
 * security_invoker view public.lpe_programme_outcomes.
 *
 * The caller supplies the client rather than this component opening its own
 * session, because an institution admin's session reads zero rows from that
 * view under I9. The institution dashboards pass the verified aggregate client
 * from requireInstitutionAggregateAccess, and only render this card once the
 * cohort clears the org's suppression threshold. Renders nothing when there
 * are no enrolments yet.
 */
export async function LifestyleOutcomesCard({
  supabase,
  organisationId,
}: {
  supabase: SupabaseClient<Database>;
  organisationId: string;
}) {
  const { data: rows } = await supabase
    .from("lpe_programme_outcomes")
    .select("condition, enrolled, active, paused, maintenance, disengaged, reviews_overdue")
    .eq("organisation_id", organisationId);

  if (!rows || rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Lifestyle programmes</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="py-1 pr-4 font-medium">Condition</th>
                <th className="py-1 pr-4 font-medium">Enrolled</th>
                <th className="py-1 pr-4 font-medium">Active</th>
                <th className="py-1 pr-4 font-medium">Paused</th>
                <th className="py-1 pr-4 font-medium">Reviews overdue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.condition} className="border-t">
                  <td className="py-1 pr-4 capitalize">{r.condition}</td>
                  <td className="py-1 pr-4">{r.enrolled}</td>
                  <td className="py-1 pr-4">{r.active}</td>
                  <td className="py-1 pr-4">{r.paused}</td>
                  <td className="py-1 pr-4">{r.reviews_overdue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground mt-3 text-xs">
          Aggregate programme engagement across enrolled members. Individual
          readings stay private to the member and their care team.
        </p>
      </CardContent>
    </Card>
  );
}
