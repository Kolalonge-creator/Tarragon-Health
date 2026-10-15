import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionForm } from "@/components/partner-portal/action-form";
import { pharmacistReplyAction } from "@/lib/partner-network/actions";
import { conversationListSchema, conversationSchema } from "@/lib/partner-network/model";

export const metadata = { title: "Patient messages" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

/**
 * Patient messages (S74, 21.2). Only conversations on prescriptions sent to this pharmacy. A patient starts a conversation; the pharmacy replies.
 * Opening one is written to the audit log by the database. The words of a message never leave this page: notices only say that one arrived.
 */
export default async function PharmacistMessagesPage({ searchParams }: { searchParams: Promise<{ rx?: string }> }) {
  const { rx } = await searchParams;
  const supabase = loose(await createClient());
  const list = await supabase.rpc("pharmacist_conversation_list");
  const rows = list.error ? null : conversationListSchema.safeParse(list.data);
  const open = rx && UUID.test(rx) ? rx : null;
  const convo = open ? await supabase.rpc("pharmacist_conversation", { p_prescription: open }) : null;
  const messages = convo && !convo.error ? conversationSchema.safeParse(convo.data) : null;
  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <Card>
        <CardHeader><CardTitle className="text-base">Conversations</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {!rows?.success && <p role="alert" className="text-red-600">The list could not be loaded. This is not the same as there being none.</p>}
          {rows?.success && rows.data.length === 0 && <p className="text-charcoal-ink/60">No patient has written to you yet.</p>}
          {rows?.success && rows.data.map((r) => (
            <a key={r.prescription_id} href={`/pharmacist/messages?rx=${r.prescription_id}`} className="flex items-center justify-between rounded-md border border-charcoal-ink/10 p-2 hover:bg-charcoal-ink/5">
              <span>Prescription {r.prescription_id.slice(0, 8)}</span>
              <span className="flex items-center gap-2 text-xs text-charcoal-ink/60">{when(r.last_message_at)}{r.unread ? <Badge variant="amber">New</Badge> : null}</span>
            </a>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">{open ? `Prescription ${open.slice(0, 8)}` : "Choose a conversation"}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">If a patient describes an emergency, tell them to go to the nearest hospital or call emergency services. Do not manage it by message.</p>
          {convo?.error && <p role="alert" className="text-red-600">This conversation could not be loaded.</p>}
          {messages?.success && (
            <>
              <ul className="space-y-2">
                {messages.data.map((m) => (
                  <li key={m.message_id} className={m.sender_kind === "pharmacist" ? "ml-8 rounded-md bg-brand-green/10 p-2" : "mr-8 rounded-md bg-charcoal-ink/5 p-2"}>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    <p className="mt-1 text-xs text-charcoal-ink/60">{m.sender_kind === "pharmacist" ? "Your pharmacy" : "The patient"}, {when(m.sent_at)}</p>
                  </li>
                ))}
              </ul>
              {messages.data.length > 0 && messages.data[0]?.is_open ? (
                <ActionForm action={pharmacistReplyAction} hidden={{ prescription: open ?? "" }} fields={[{ name: "body", label: "Your reply", kind: "textarea", placeholder: "Write a short, clear answer" }]} submitLabel="Send" successText="Sent." />
              ) : messages.data.length > 0 ? <p className="text-charcoal-ink/60">This conversation is closed.</p> : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
