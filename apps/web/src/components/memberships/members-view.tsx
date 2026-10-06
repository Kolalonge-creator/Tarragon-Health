import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MEMBERSHIP_SOURCE_LABEL,
  describeMembershipError,
  membershipRowsSchema,
  type MembershipRow,
  type MembersBasePath,
} from "@/lib/memberships/members";
import { EndMembershipForm, GrantMembershipForm } from "./member-forms";

const date = (value: string): string =>
  new Date(value).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Africa/Lagos" });

/**
 * The members page body, shared by /admin/memberships (admin) and /clinician/memberships (Chief Medical Officer, whose
 * account role cannot open /admin). The caller does the access check; the database checks it again on every call.
 * No price or amount appears anywhere (INV-09).
 */
export async function MembersView({ base, search }: { base: MembersBasePath; search: string }) {
  const supabase = await createClient();
  const res = await supabase.rpc("list_memberships", search ? { p_search: search } : {});
  let rows: MembershipRow[] = [];
  let error: string | null = null;
  if (res.error) {
    error = describeMembershipError(res.error, "The list could not be loaded. This is not the same as having none.");
  } else {
    const parsed = membershipRowsSchema.safeParse(res.data);
    if (parsed.success) rows = parsed.data;
    else error = "The list gave an answer this page could not read. Please try again.";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Memberships</h1>
        <p className="text-sm text-charcoal-ink/60">
          Grant or end a Membership by hand until checkout is built. Every change needs a reason and is recorded.
          Search by name or patient number; with no search this shows current members.
        </p>
      </div>

      <form method="get" action={base} className="flex flex-wrap items-end gap-2">
        <div className="min-w-60 flex-1">
          <Label htmlFor="members-search">Name or patient number</Label>
          <Input id="members-search" name="q" defaultValue={search} maxLength={100} />
        </div>
        <Button type="submit">Search</Button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {!error && rows.length === 0 && (
        <p className="text-sm text-charcoal-ink/60">
          {search ? "Nobody matched that search." : "There are no current members."}
        </p>
      )}

      {rows.map((r) => (
        <Card key={r.patient_id}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {r.full_name ?? "Unnamed patient"}
              {r.patient_number && <span className="text-sm font-normal text-charcoal-ink/60">{r.patient_number}</span>}
              {r.is_member ? <Badge variant="green">Member</Badge> : <Badge variant="grey">Not a member</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {r.membership_id && (
              <p className="text-sm text-charcoal-ink">
                {MEMBERSHIP_SOURCE_LABEL[r.source ?? ""] ?? r.source}
                {r.starts_at ? `, since ${date(r.starts_at)}` : ""}
                {r.ends_at ? `, ends ${date(r.ends_at)}` : ", no end date"}
                {r.grant_reason ? `. Reason: ${r.grant_reason}` : ""}
              </p>
            )}
            {!r.membership_id && r.is_member && (
              <p className="text-sm text-charcoal-ink/60">
                This person has access through an older plan, not a recorded membership.
              </p>
            )}
            {r.membership_id ? (
              <EndMembershipForm patientId={r.patient_id} base={base} />
            ) : (
              <GrantMembershipForm patientId={r.patient_id} base={base} />
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
