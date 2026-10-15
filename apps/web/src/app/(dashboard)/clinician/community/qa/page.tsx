import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { qaDoctorQuestionsSchema, qaDoctorSessionsSchema, type QaDoctorQuestion } from "@/lib/community/model";
import { QaAnswerForm } from "@/components/community/qa-answer-form";
import { formatWhen } from "@/components/community/staff-format";
import { getCommunityStaffContext } from "@/components/community/staff-rpc";
import { answerQuestionAction } from "./actions";

export const metadata = { title: "Doctor question sessions" };
export const dynamic = "force-dynamic";

const LOAD_FAILED = "We could not load this just now. Please reload the page in a moment.";
/** The database says when answering ends (session end plus its grace setting); the page never carries its own copy of the number. */
const answersOpenUntil = (session: { closes_at: string; answer_until?: string }): string => formatWhen(session.answer_until ?? session.closes_at);

/** Unanswered questions first, then oldest first within each group. */
function ordered(questions: QaDoctorQuestion[]): QaDoctorQuestion[] {
  return [...questions].sort((a, b) => {
    const au = a.answers.length === 0 ? 0 : 1;
    const bu = b.answers.length === 0 ? 0 : 1;
    return au - bu || a.created_at.localeCompare(b.created_at);
  });
}

export default async function ClinicianQaPage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const ctx = await getCommunityStaffContext();
  const h1 = <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Doctor question sessions</h1>;
  if (!ctx || (!ctx.is_clinician && !ctx.is_cmo)) {
    return (
      <div className="space-y-2">
        {h1}
        <p className="text-sm text-charcoal-ink/70">This page is for doctors who are named on a question session.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const sessionsRes = await supabase.rpc("community_qa_doctor_sessions");
  const sessionsParsed = qaDoctorSessionsSchema.safeParse(sessionsRes.data);
  if (sessionsRes.error || !sessionsParsed.success) {
    return (
      <div className="space-y-2">
        {h1}
        <p role="alert" className="text-sm text-red-700">{LOAD_FAILED}</p>
      </div>
    );
  }
  const sessions = sessionsParsed.data.sessions;
  const back = (
    <Link href="/clinician/community" className="font-medium text-brand-green underline">
      Back to Community
    </Link>
  );

  if (sessions.length === 0) {
    return (
      <div className="space-y-2">
        {h1}
        <p className="text-sm text-charcoal-ink/70">
          You are not named on any question session. When an administrator names you on one, it will appear here. {back}
        </p>
      </div>
    );
  }

  const requested = (await searchParams).session;
  const selected = sessions.find((s) => s.series_id === requested) ?? null;

  let questionsBlock: React.ReactNode = null;
  if (selected) {
    const qRes = await supabase.rpc("community_qa_doctor_questions", { p_series_id: selected.series_id });
    const qParsed = qaDoctorQuestionsSchema.safeParse(qRes.data);
    if (qRes.error || !qParsed.success) {
      questionsBlock = <p role="alert" className="text-sm text-red-700">{LOAD_FAILED}</p>;
    } else {
      const list = ordered(qParsed.data.questions);
      questionsBlock = (
        <section aria-labelledby="q-h" className="space-y-4">
          <h2 id="q-h" className="font-heading text-lg font-semibold text-charcoal-ink">
            Questions in {selected.title}
          </h2>
          <p className="text-sm text-charcoal-ink">
            {selected.can_answer
              ? `Answers open until ${answersOpenUntil(selected)} (answering stays open a little after the session ends).`
              : "This session is not open for answers right now."}
          </p>
          <div className="rounded-lg border border-charcoal-ink/15 bg-warm-ivory p-4 text-sm text-charcoal-ink">
            <p className="font-medium">Before you answer</p>
            <ul className="list-disc pl-5">
              <li>These are general answers for everyone in the group, not advice for one person.</li>
              <li>Do not ask for or give contact details.</li>
              <li>If a question describes an emergency, tell them to go to the nearest hospital.</li>
              <li>You do not see who asked. You see a community name only.</li>
            </ul>
          </div>
          {list.length === 0 ? (
            <p className="rounded-lg border border-charcoal-ink/10 bg-white p-6 text-sm text-charcoal-ink/70">No questions have been published yet.</p>
          ) : (
            <ul className="space-y-4">
              {list.map((q) => (
                <li key={q.post_id} className="space-y-3 rounded-lg border border-charcoal-ink/10 bg-white p-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <h3 className="font-semibold text-charcoal-ink">{q.group_name}</h3>
                    <span className="text-charcoal-ink/70">
                      asked by <span className="font-medium">{q.author_handle}</span>
                    </span>
                    <span className="rounded-full border border-charcoal-ink/20 px-2 py-0.5 text-xs">
                      {q.answers.length === 0 ? "Not answered yet" : `${q.answers.length} ${q.answers.length === 1 ? "answer" : "answers"}`}
                    </span>
                    <time className="ml-auto text-xs text-charcoal-ink/60" dateTime={q.created_at}>
                      {formatWhen(q.created_at)}
                    </time>
                  </div>
                  <p className="whitespace-pre-wrap break-words rounded-md bg-warm-ivory p-3 text-sm text-charcoal-ink">{q.body}</p>
                  {q.answers.length > 0 && (
                    <ul className="space-y-2">
                      {q.answers.map((a) => (
                        <li key={`${a.doctor_name}-${a.created_at}`} className="rounded-md border border-charcoal-ink/10 p-3 text-sm text-charcoal-ink">
                          <p className="font-medium">
                            {a.doctor_name}
                            {a.mine ? " (you)" : ""}
                            <span className="ml-2 text-xs font-normal text-charcoal-ink/60">{formatWhen(a.created_at)}</span>
                          </p>
                          <p className="mt-1 whitespace-pre-wrap break-words">{a.body}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  {selected.can_answer && <QaAnswerForm postId={q.post_id} onAnswer={answerQuestionAction} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      );
    }
  }

  return (
    <div className="space-y-6">
      <div>
        {h1}
        <p className="text-sm text-charcoal-ink/70">Sessions where you are named to answer members&apos; questions. {back}</p>
      </div>
      <section aria-labelledby="s-h" className="space-y-3">
        <h2 id="s-h" className="font-heading text-lg font-semibold text-charcoal-ink">
          Your sessions
        </h2>
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li key={s.series_id} className="rounded-lg border border-charcoal-ink/10 bg-white p-3 text-sm text-charcoal-ink">
              <Link
                href={`/clinician/community/qa?session=${s.series_id}`}
                aria-current={selected?.series_id === s.series_id ? "page" : undefined}
                className="font-semibold text-brand-green underline"
              >
                {s.title}
              </Link>
              <p>
                {formatWhen(s.opens_at)} to {formatWhen(s.closes_at)}. {s.questions} {s.questions === 1 ? "question" : "questions"}, {s.unanswered} not answered yet.
                {s.can_answer ? " Open for answers." : " Not open for answers."}
              </p>
              {s.intro && <p className="text-charcoal-ink/70">{s.intro}</p>}
            </li>
          ))}
        </ul>
      </section>
      {questionsBlock}
    </div>
  );
}
