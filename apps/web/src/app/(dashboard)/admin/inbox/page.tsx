import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { fdRpcData } from "@/lib/frontdesk/raw-db";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import { Badge } from "@/components/ui/badge";
import { CloseButton, ReplyForm } from "./inbox-forms";

export const metadata = { title: "Inbox" };

interface InboxItem {
  id: string;
  status: "open" | "replied" | "closed";
  urgency: "normal" | "urgent";
  reason: string;
  summary: string | null;
  suggested_reply: string | null;
  founder_reply: string | null;
  reply_state: string;
  alert_state: string;
  created_at: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  can_reply: boolean;
  transcript: { role: string; content: string; at: string; flags: string[] }[];
}

const REASON: Record<string, string> = {
  visitor_asked: "Asked for a person",
  cannot_answer: "The assistant could not answer",
  ai_unavailable: "The assistant was unavailable",
  clinical_request: "Asked for medical advice",
  emergency: "Used emergency wording",
  complaint: "Made a complaint",
  form_fallback: "Left a message on the contact form",
};
const ROLE: Record<string, string> = { visitor: "Visitor", assistant: "Assistant", founder: "You", system: "System" };
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "short", timeStyle: "short" });

export default async function InboxPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  // Conversations can hold health details a visitor typed, so the inbox is admin only (the database enforces it too).
  const { isSuperAdmin } = await getCallerPermissions();
  if (!isSuperAdmin) redirect("/admin");

  const { data, error } = await fdRpcData<InboxItem[]>(await createClient(), "fd_inbox");
  const items = data ?? [];
  const open = items.filter((i) => i.status === "open");

  return (
    <div className="space-y-8">
      <PageHeader
        title="Inbox"
        description="Conversations from the website chat that need a person. Urgent ones come first. Each has a summary and a suggested reply you can edit and send."
      />
      {error ? (
        <LoadFailure>The inbox could not be loaded. This is not a report that nothing is waiting. Reload to try again.</LoadFailure>
      ) : items.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">Nothing yet. When a visitor asks for a person, or the assistant cannot answer, it appears here.</p>
      ) : (
        <>
          <p className="text-sm">{open.length} waiting for a reply.</p>
          <ul className="space-y-6">
            {items.map((i) => (
              <li key={i.id} className="space-y-4 rounded-xl border border-charcoal-ink/15 bg-white p-5 dark:border-night-ink/20 dark:bg-night-card">
                <div className="flex flex-wrap items-center gap-2">
                  {i.urgency === "urgent" && <Badge variant="red">URGENT</Badge>}
                  <Badge variant={i.status === "open" ? "amber" : "grey"}>{i.status}</Badge>
                  <span className="text-sm font-medium">{REASON[i.reason] ?? i.reason}</span>
                  <span className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{when(i.created_at)}</span>
                  {i.alert_state !== "sent" && <span className="text-xs text-red-700">alert email {i.alert_state}</span>}
                </div>
                <p className="text-sm">
                  <strong>{i.contact_name ?? "Name not given"}</strong>
                  {i.contact_email ? ` · ${i.contact_email}` : ""}
                  {i.contact_phone ? ` · ${i.contact_phone}` : ""}
                  {!i.contact_email && !i.contact_phone ? " · no contact details left" : ""}
                </p>
                {i.summary && <p className="text-sm"><strong>Summary:</strong> {i.summary}</p>}
                <details className="text-sm">
                  <summary className="cursor-pointer text-deep-forest">Conversation ({i.transcript.length} messages)</summary>
                  <ul className="mt-2 space-y-2">
                    {i.transcript.map((m, idx) => (
                      <li key={idx} className="rounded-lg bg-charcoal-ink/5 p-2 dark:bg-night-ink/10">
                        <span className="text-xs font-semibold">{ROLE[m.role] ?? m.role}</span>{m.flags.length > 0 && <span className="ml-2 text-xs text-red-700">{m.flags.join(", ")}</span>}
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      </li>
                    ))}
                  </ul>
                </details>
                {i.status === "open" ? (
                  <>
                    <ReplyForm handoffId={i.id} suggested={i.suggested_reply} canReply={i.can_reply} />
                    <CloseButton handoffId={i.id} />
                  </>
                ) : i.founder_reply ? (
                  <p className="text-sm"><strong>Your reply ({i.reply_state}):</strong> {i.founder_reply}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
