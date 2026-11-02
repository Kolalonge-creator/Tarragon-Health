import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { fdRpcData } from "@/lib/frontdesk/raw-db";
import type { Dashboard } from "@/lib/frontdesk/dashboard-model";
import { topicLabel } from "@/lib/frontdesk/dashboard-model";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import { Badge } from "@/components/ui/badge";
import { CloseIncidentForm, ReviewForm } from "./review-forms";

export const metadata = { title: "Review conversations" };

interface ReviewItem {
  id: string;
  reason: "flagged" | "random_sample" | "handoff" | "pilot_full_review";
  status: "pending" | "reviewed";
  verdict: "ok" | "wrong" | "unsafe" | null;
  note: string | null;
  created_at: string;
  reviewed_at: string | null;
  conversation: { id: string; started_at: string; status: string; intent: string | null; summary: string | null; red_flag: boolean; purged: boolean };
  messages: { role: string; content: string; flags: string[]; at: string }[];
}

const WHY: Record<ReviewItem["reason"], string> = {
  flagged: "Flagged by a safety rule",
  handoff: "Handed to a person",
  random_sample: "Random sample",
  pilot_full_review: "Pilot: everything is reviewed",
};
const ROLE: Record<string, string> = { visitor: "Visitor", assistant: "Assistant", founder: "You", system: "System" };
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "short", timeStyle: "short" });

export default async function ReviewsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  // These are visitors' own words and can include health details, so admin only (the database enforces it too).
  const { isSuperAdmin } = await getCallerPermissions();
  if (!isSuperAdmin) redirect("/admin");

  const supabase = await createClient();
  const [pending, dash] = await Promise.all([
    fdRpcData<ReviewItem[]>(supabase, "fd_review_list", { p_status: "pending", p_limit: 20 }),
    fdRpcData<Dashboard>(supabase, "fd_dashboard"),
  ]);
  const items = pending.data ?? [];
  const incidents = dash.data?.incidents ?? [];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Review conversations"
        description="Read what the assistant said and mark it fine, wrong or unsafe. Flagged conversations come first. Nothing here is sent to anyone."
      />
      <p className="text-sm"><Link href="/admin/front-desk" className="text-deep-forest underline">Back to the front desk</Link></p>

      <section id="incidents" aria-label="Safety incidents" className="space-y-3">
        <h2 className="font-heading text-xl font-semibold">Open safety incidents</h2>
        {dash.error ? (
          <LoadFailure>Incidents could not be loaded. This is not a report that there are none. Reload to try again.</LoadFailure>
        ) : incidents.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">None open.</p>
        ) : (
          <ul className="space-y-4">
            {incidents.map((i) => (
              <li key={i.id} className="space-y-3 rounded-xl border border-red-300 bg-red-50 p-5 dark:bg-night-card">
                <p className="text-sm"><strong>Opened {when(i.opened_at)}.</strong> {i.opened_note}</p>
                <CloseIncidentForm incidentId={i.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Waiting for review" className="space-y-3">
        <h2 className="font-heading text-xl font-semibold">Waiting for review</h2>
        {pending.error ? (
          <LoadFailure>The review queue could not be loaded. This is not a report that nothing is waiting. Reload to try again.</LoadFailure>
        ) : items.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">Nothing is waiting. Conversations appear here after they have been quiet for half an hour.</p>
        ) : (
          <ul className="space-y-6">
            {items.map((i) => (
              <li key={i.id} className="space-y-4 rounded-xl border border-charcoal-ink/15 bg-white p-5 dark:border-night-ink/20 dark:bg-night-card">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={i.reason === "flagged" ? "red" : "grey"}>{WHY[i.reason]}</Badge>
                  {i.conversation.intent && <Badge variant="grey">{topicLabel(i.conversation.intent)}</Badge>}
                  {i.conversation.red_flag && <Badge variant="red">Emergency wording</Badge>}
                  <span className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{when(i.conversation.started_at)}</span>
                </div>
                {i.conversation.purged ? (
                  <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">The messages were removed after the retention period. Only the summary is left: {i.conversation.summary}</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {i.messages.map((m, idx) => (
                      <li key={idx} className="rounded-lg bg-charcoal-ink/5 p-2 dark:bg-night-ink/10">
                        <span className="text-xs font-semibold">{ROLE[m.role] ?? m.role}</span>
                        {m.flags.length > 0 && <span className="ml-2 text-xs text-red-700">{m.flags.join(", ")}</span>}
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      </li>
                    ))}
                  </ul>
                )}
                <ReviewForm reviewId={i.id} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
