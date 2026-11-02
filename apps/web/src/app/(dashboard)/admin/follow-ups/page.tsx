import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { fdRpcData } from "@/lib/frontdesk/raw-db";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import { Badge } from "@/components/ui/badge";
import { BackToDryRun, ConfirmBasis, GoLive, MasterSwitch } from "./follow-up-controls";

export const metadata = { title: "Follow-ups" };

interface Overview {
  followups_enabled: boolean | null;
  followups_dry_run: boolean | null;
  basis_confirmed: boolean | null;
  in_quiet_hours: boolean;
  approved_steps: number;
  total_steps: number;
  by_state: Record<string, number>;
  skipped_last_7d: Record<string, number>;
  sent_last_7d: number;
  contacts: number;
  suppressed: number;
  recent: { id: string; step_key: string; state: string; skip_reason: string | null; dry_run: boolean; at: string; who: string }[];
}

const SKIP_LABEL: Record<string, string> = {
  dry_run: "held back by dry-run",
  stale: "too late to send",
  goal_reached: "already did the thing",
  weekly_cap: "over the weekly limit",
  no_consent: "no consent",
  suppressed: "unsubscribed or bounced",
  no_email: "no email address",
};

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "short", timeStyle: "short" });

export default async function FollowUpsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const { isSuperAdmin } = await getCallerPermissions();
  if (!isSuperAdmin) redirect("/admin");

  const { data, error } = await fdRpcData<Overview>(await createClient(), "fd_followup_overview");
  const enabled = data?.followups_enabled === true;
  const dryRun = data?.followups_dry_run !== false; // anything but an explicit false is dry-run, as in the database
  const held = data?.skipped_last_7d?.dry_run ?? 0;
  const basisConfirmed = data?.basis_confirmed === true;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Follow-ups"
        description="The emails that go to people who stall or go quiet. The database decides who may be emailed; nothing is sent without approved wording, consent, and the right hour."
      />

      {error || !data ? (
        <LoadFailure>The follow-up state could not be loaded. This is not a report that nothing is happening. Reload to try again.</LoadFailure>
      ) : (
        <>
          <section aria-label="State" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Tile label="Follow-ups" value={enabled ? "On" : "Off"} tone={enabled ? "green" : "grey"} />
            <Tile label="Mode" value={dryRun ? "Dry-run (nothing sent)" : "Live"} tone={dryRun ? "amber" : "green"} />
            <Tile label="Lawful basis" value={basisConfirmed ? "Confirmed by DPO" : "Not confirmed"} tone={basisConfirmed ? "green" : "amber"} />
            <Tile label="Approved emails" value={`${data.approved_steps} of ${data.total_steps}`} tone={data.approved_steps > 0 ? "green" : "amber"} />
            <Tile label="Right now" value={data.in_quiet_hours ? "Quiet hours (21:00 to 07:00)" : "Sending hours"} tone="grey" />
          </section>

          <section aria-label="Controls" className="space-y-4">
            <h2 className="font-heading text-xl font-semibold">Controls</h2>
            <div className="flex flex-wrap items-start gap-6">
              <MasterSwitch enabled={enabled} />
              {enabled && !dryRun && <BackToDryRun />}
            </div>
            {!basisConfirmed && <ConfirmBasis />}
            {enabled && dryRun && basisConfirmed && <GoLive heldBack={held} />}
            {!enabled && <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">Turn follow-ups on to start finding people to follow up. It starts in dry-run, so nothing is sent until you go live.</p>}
          </section>

          <section aria-label="Numbers" className="space-y-3">
            <h2 className="font-heading text-xl font-semibold">What has happened</h2>
            <ul className="grid gap-2 text-sm sm:grid-cols-2">
              <li>Sent in the last 7 days: <strong>{data.sent_last_7d}</strong></li>
              <li>People on the list: <strong>{data.contacts}</strong> ({data.suppressed} unsubscribed or bounced)</li>
              {Object.entries(data.by_state).map(([k, v]) => <li key={k}>Runs {k}: <strong>{v}</strong></li>)}
            </ul>
            {Object.keys(data.skipped_last_7d).length > 0 && (
              <div>
                <h3 className="text-sm font-semibold">Not sent in the last 7 days, and why</h3>
                <ul className="mt-1 list-disc pl-5 text-sm">
                  {Object.entries(data.skipped_last_7d).map(([k, v]) => <li key={k}>{SKIP_LABEL[k] ?? k}: {v}</li>)}
                </ul>
              </div>
            )}
          </section>

          <section aria-label="Recent" className="space-y-3">
            <h2 className="font-heading text-xl font-semibold">Latest 30</h2>
            {data.recent.length === 0 ? (
              <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">Nothing yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-charcoal-ink/60 dark:text-night-ink/60">
                    <tr><th className="py-1 pr-3">Due</th><th className="pr-3">Who</th><th className="pr-3">Email</th><th>Result</th></tr>
                  </thead>
                  <tbody>
                    {data.recent.map((r) => (
                      <tr key={r.id} className="border-t border-charcoal-ink/10 dark:border-night-ink/15">
                        <td className="py-1 pr-3">{when(r.at)}</td>
                        <td className="pr-3">{r.who}</td>
                        <td className="pr-3">{r.step_key}</td>
                        <td>{r.state}{r.skip_reason ? `: ${SKIP_LABEL[r.skip_reason] ?? r.skip_reason}` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone: "green" | "amber" | "grey" }) {
  return (
    <div className="rounded-xl border border-charcoal-ink/15 bg-white p-4 dark:border-night-ink/20 dark:bg-night-card">
      <p className="text-xs uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">{label}</p>
      <p className="mt-1"><Badge variant={tone}>{value}</Badge></p>
    </div>
  );
}
