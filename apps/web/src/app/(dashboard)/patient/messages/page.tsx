import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { MessagesFlow } from "../messages-flow";
import { createClient } from "@/lib/supabase/server";
import { parseReplyTime, replyTimeSentence } from "@tarragon/shared";

export default async function MessagesPage() {
  // Resolved the same way as every other /patient/* section (and the way
  // your-care-team.tsx links here) so a supporter acting for someone sees
  // and sends THAT person's messages, not their own — see the acting-for bug
  // fixed alongside this route in the 2026-09-01 patient dashboard audit.
  const { subjectId } = await getPatientDashboardContext();
  // The recent reply time of the care team in this organisation, or nothing. A failed read or a thin sample shows no line at all,
  // never a guess and never "no wait".
  const supabase = await createClient();
  const { data: replyData, error: replyError } = await supabase.rpc("care_team_reply_time" as never);
  const replyTime = replyError ? null : parseReplyTime(replyData);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Messages"
        icon={NAV_ICON.messages}
        backTo={{ href: "/patient", label: "Dashboard" }}
        description="Message your care team in the app and they'll reply here. For anything urgent, use the emergency options on your dashboard rather than a message."
      />
      {replyTime ? <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{replyTimeSentence(replyTime)}</p> : null}
      <MessagesFlow patientId={subjectId} />
    </div>
  );
}
