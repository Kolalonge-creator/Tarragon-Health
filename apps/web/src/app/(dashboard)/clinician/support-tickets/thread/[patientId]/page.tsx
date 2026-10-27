import Link from "next/link";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { CHANNEL_WORDS, channelsIn, readingOrder, threadRowsSchema } from "@/lib/support/thread";

export const metadata = { title: "Patient support thread" };
export const dynamic = "force-dynamic";

/** S80d (25.4): everything one patient sent to support, across the app, phone and email, in one thread. Row-level security decides what staff may see. */
export default async function PatientSupportThreadPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const id = z.string().uuid().safeParse(patientId);
  if (!id.success) return <p className="text-sm text-charcoal-ink/70">That link is not valid.</p>;
  const { data, error } = await loose(await createClient()).rpc("support_patient_thread", { p_patient: id.data, p_limit: 200 });
  const parsed = threadRowsSchema.safeParse(data);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Patient support thread</h1>
        <p className="text-sm text-charcoal-ink/60">Tickets and replies from the app, the phone and email, oldest first.</p>
        <Link href="/clinician/support-tickets" className="text-sm underline underline-offset-2">Back to the queue</Link>
      </div>
      {error || !parsed.success ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">The thread could not be loaded. It is not empty: try again.</p>
      ) : parsed.data.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">Nothing from this patient that you can see.</p>
      ) : (
        <>
          <p className="text-sm text-charcoal-ink/80">Channels: {channelsIn(parsed.data).map((c) => CHANNEL_WORDS[c]).join(", ")}</p>
          <ol className="space-y-3">
            {readingOrder(parsed.data).map((r) => (
              <li key={`${r.kind}-${r.entry_id}`} className={`rounded-lg border p-3 text-sm ${r.red_flagged ? "border-red-300 bg-red-50" : "border-charcoal-ink/10 bg-white"}`}>
                <p className="text-xs text-charcoal-ink/60">
                  {new Date(r.at).toLocaleString("en-NG", { timeZone: "Africa/Lagos" })} · {CHANNEL_WORDS[r.channel]} · {r.kind === "ticket" ? "Ticket" : r.author === "patient" ? "Patient reply" : r.is_internal ? "Internal note" : "Care team reply"}
                  {r.red_flagged ? " · possible emergency" : ""}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-charcoal-ink">{r.body}</p>
                <Link href={`/clinician/support-tickets/${r.ticket_id}`} className="text-xs underline underline-offset-2">Open the ticket</Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
