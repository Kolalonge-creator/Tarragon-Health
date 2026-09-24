import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import {
  listFundingProgrammesForCaller,
  listFundingProgrammeInvitations,
  getFundingProgrammeStats,
  type FundingProgrammeInvitation,
  type FundingProgrammeStats,
} from "@/lib/ngo/funding-programmes";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NgoConsole } from "./ngo-console";

/**
 * The ngo_admin/admin self-serve console (PR #713 shipped the RPC plumbing
 * with deliberately zero UI on top — see funding-programmes.ts's header).
 * RLS already scopes listFundingProgrammesForCaller/listFundingProgrammeInvitations
 * to the caller's own organisation (or every row for a superadmin), so this
 * page never needs its own organisation filter. Programme creation stays
 * superadmin-only at /admin/settings/ngo-programmes — this page is the
 * everyday, self-serve half (invite a roster, see who's claimed, revoke an
 * unclaimed invitation, see aggregate progress against the funded cap).
 */
export default async function NgoDashboardPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const programmes = await listFundingProgrammesForCaller(supabase);

  const statsEntries: [string, FundingProgrammeStats][] = [];
  const invitationEntries: [string, FundingProgrammeInvitation[]][] = [];
  await Promise.all(
    programmes.map(async (p) => {
      const [stats, invitations] = await Promise.all([
        getFundingProgrammeStats(supabase, p.id).catch(() => null),
        listFundingProgrammeInvitations(supabase, p.id).catch(() => []),
      ]);
      if (stats) statsEntries.push([p.id, stats]);
      invitationEntries.push([p.id, invitations]);
    })
  );

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
        <NgoConsole
          programmes={programmes}
          statsByProgrammeId={Object.fromEntries(statsEntries)}
          invitationsByProgrammeId={Object.fromEntries(invitationEntries)}
        />
      )}
    </div>
  );
}
