import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { listFundingProgrammesForCaller } from "@/lib/ngo/funding-programmes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Deliberately read-only and minimal: this reads the caller's own org's
 * funding_programmes (RLS already scopes it — see
 * funding_programmes_select's policy) so an ngo_admin login has somewhere
 * real to land once the module is active, not a management console. Create/
 * activate/invite/revoke are superadmin- or ngo_admin-authorised RPCs (see
 * apps/web/src/lib/ngo/funding-programmes.ts) with no UI built on top of
 * them yet — see that file's header for why.
 */
export default async function NgoDashboardPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const programmes = await listFundingProgrammesForCaller(supabase);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink dark:text-night-ink sm:text-3xl">
          Welcome{profile?.full_name ? `, ${profile.full_name}` : ""}
        </h1>
        <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">NGO partner admin dashboard</p>
      </div>

      {programmes.length === 0 ? (
        <Card variant="soft">
          <CardHeader>
            <CardTitle>No funded programme yet</CardTitle>
            <CardDescription>
              Your Tarragon contact will set one up once your organisation&apos;s contract is signed.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3">
          {programmes.map((programme) => (
            <Card key={programme.id}>
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <div>
                  <CardTitle>{programme.name}</CardTitle>
                  <CardDescription>Contract {programme.contract_reference}</CardDescription>
                </div>
                <Badge>{programme.status}</Badge>
              </CardHeader>
              <CardContent className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
                Funded places: {programme.funded_unit_cap}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
