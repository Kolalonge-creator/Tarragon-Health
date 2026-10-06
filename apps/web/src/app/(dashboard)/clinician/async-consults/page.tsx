import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ASYNC_CONSULT_CATEGORIES } from "@/lib/validation/async-consults";
import {
  ANSWER_KIND_LABEL,
  WRITTEN_QUESTION_READ_REASON,
  claimedQuestionsSchema,
  describeRpcError,
  heldCallTasksSchema,
  openQuestionParamsSchema,
  writtenQuestionSchema,
  type AnswerKind,
  type ClaimedQuestion,
  type HeldCallTask,
} from "@/lib/clinician/written-questions";
import { AnswerForm, CallDoneForm, HandBackForm, TakeNextForm } from "./forms";

export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(ASYNC_CONSULT_CATEGORIES.map((c) => [c.value, c.label]));

const dateTime = (value: string): string =>
  new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function WrittenQuestionsPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const params = openQuestionParamsSchema.safeParse({
    open: first(raw.open),
    held: first(raw.held),
    type: first(raw.type),
  });
  const { open, held, type } = params.success ? params.data : { open: undefined, held: undefined, type: undefined };
  const none = first(raw.none) === "1";

  const supabase = await createClient();
  const claimsRes = await supabase.rpc("my_written_question_claims");
  const claimsParsed = claimsRes.error ? null : claimedQuestionsSchema.safeParse(claimsRes.data);
  const claims: ClaimedQuestion[] = claimsParsed?.success ? claimsParsed.data : [];
  const claimsFailed = Boolean(claimsRes.error) || (claimsParsed !== null && !claimsParsed.success);
  // Flagged first, then as returned (the function already orders by window).
  const ordered = [...claims].sort((a, b) => Number(b.safety_flagged) - Number(a.safety_flagged));

  const callsRes = await supabase.rpc("my_held_call_tasks");
  const callsParsed = callsRes.error ? null : heldCallTasksSchema.safeParse(callsRes.data);
  const calls: HeldCallTask[] = callsParsed?.success ? callsParsed.data : [];
  const callsFailed = Boolean(callsRes.error) || (callsParsed !== null && !callsParsed.success);

  let openQuestion: ReturnType<typeof writtenQuestionSchema.parse> | null = null;
  let openError: string | null = null;
  if (open) {
    const res = await supabase.rpc("read_written_question_audited", { p_consult: open, p_reason: WRITTEN_QUESTION_READ_REASON });
    if (res.error) {
      openError = describeRpcError(res.error, "This question could not be opened.");
    } else {
      const parsed = writtenQuestionSchema.safeParse(res.data);
      if (parsed.success) openQuestion = parsed.data;
      else openError = "This question could not be read. Please try again.";
    }
  }
  const openClaim = open ? claims.find((c) => c.id === open) : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Written questions</h1>
        <p className="text-sm text-charcoal-ink/60">
          Questions members have sent to the care team. The queue picks the next one for you; you can only read a
          question you hold.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Next written question</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <TakeNextForm />
          {none && <p className="text-sm text-charcoal-ink/60">Nothing is waiting for you right now.</p>}
          {held && (
            <div role="status" className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-charcoal-ink">
              <p>
                You are holding the most tasks you can at once, and one of them is not written-question work
                {type ? ` (type: ${type.replace(/_/g, " ")})` : ""}. It is held for you until the hold runs out and
                then returns to the queue. You can hand it back below if it is not right for you. The full task screen
                is coming; until then this page cannot open it.
              </p>
              <HandBackForm taskId={held} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Questions you hold</CardTitle>
        </CardHeader>
        <CardContent>
          {claimsFailed && (
            <p role="alert" className="text-sm text-red-600">
              Your held questions could not be loaded. This is not the same as having none.
            </p>
          )}
          {!claimsFailed && ordered.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">You are not holding any written questions.</p>
          )}
          {ordered.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {ordered.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 py-3">
                  {c.safety_flagged && <Badge variant="red">Flagged by the safety screen</Badge>}
                  {c.is_follow_up && <Badge variant="blue">Follow-up</Badge>}
                  <span className="text-sm font-medium text-charcoal-ink">{CATEGORY_LABEL[c.category] ?? c.category}</span>
                  {c.window_due_at && (
                    <span className="text-xs text-charcoal-ink/60">Reply by {dateTime(c.window_due_at)}</span>
                  )}
                  <Link
                    href={`/clinician/async-consults?open=${c.id}`}
                    className="ml-auto text-sm font-medium text-brand-green underline"
                  >
                    {open === c.id ? "Open" : "Read and reply"}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Calls to make</CardTitle>
        </CardHeader>
        <CardContent>
          {callsFailed && (
            <p role="alert" className="text-sm text-red-600">
              Your calls could not be loaded. This is not the same as having none.
            </p>
          )}
          {!callsFailed && calls.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">You are not holding any calls to make.</p>
          )}
          {calls.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {calls.map((c) => (
                <li key={c.task_id} className="space-y-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="blue">Call</Badge>
                    {c.due_at && <span className="text-xs text-charcoal-ink/60">Call by {dateTime(c.due_at)}</span>}
                    <Link
                      href={`/clinician/patients/${c.patient_id}`}
                      className="ml-auto text-sm font-medium text-brand-green underline"
                    >
                      Open the patient chart
                    </Link>
                  </div>
                  <CallDoneForm taskId={c.task_id} />
                  <HandBackForm taskId={c.task_id} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {open && openError && (
        <p role="alert" className="text-sm text-red-600">
          {openError}
        </p>
      )}

      {openQuestion && (
        <Card>
          <CardHeader>
            <CardTitle>{CATEGORY_LABEL[openQuestion.category] ?? openQuestion.category}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {openQuestion.safety_flagged && <Badge variant="red">Flagged by the safety screen</Badge>}
              {openQuestion.window_due_at && (
                <Badge variant="amber">Reply by {dateTime(openQuestion.window_due_at)}</Badge>
              )}
            </div>
            <p className="whitespace-pre-wrap text-sm text-charcoal-ink">{openQuestion.question}</p>
            {openQuestion.duration_note && (
              <p className="text-xs text-charcoal-ink/60">Going on for: {openQuestion.duration_note}</p>
            )}

            {openQuestion.photos.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {openQuestion.photos.map((p) => (
                  <a
                    key={p.id}
                    href={`/api/written-questions/attachments/${p.id}?consult=${openQuestion.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-brand-green underline"
                  >
                    Open photo ({Math.max(1, Math.round(p.size_bytes / 1024))} KB)
                  </a>
                ))}
              </div>
            )}

            {openQuestion.answer && (
              <div className="rounded-md bg-charcoal-ink/5 p-3 text-sm text-charcoal-ink">
                <p className="mb-1 text-xs text-charcoal-ink/60">
                  Earlier reply
                  {openQuestion.answer_kind && openQuestion.answer_kind in ANSWER_KIND_LABEL
                    ? ` (${ANSWER_KIND_LABEL[openQuestion.answer_kind as AnswerKind]})`
                    : ""}
                </p>
                <p className="whitespace-pre-wrap">{openQuestion.answer}</p>
              </div>
            )}

            {openQuestion.messages.length > 0 && (
              <ul className="space-y-2">
                {openQuestion.messages.map((m) => (
                  <li key={m.id} className="rounded-md border border-charcoal-ink/10 p-2 text-sm text-charcoal-ink">
                    <p className="text-xs text-charcoal-ink/60">
                      {m.author_role === "patient" ? "Patient" : "Care team"} · {dateTime(m.created_at)}
                    </p>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                  </li>
                ))}
              </ul>
            )}

            <AnswerForm consultId={openQuestion.id} />
            {(openClaim?.task_id ?? openQuestion.task_id) && (
              <HandBackForm taskId={(openClaim?.task_id ?? openQuestion.task_id) as string} />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
