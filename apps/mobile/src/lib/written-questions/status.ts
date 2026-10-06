import type { MessageKey } from "@tarragon/i18n";
import type { WrittenQuestion } from "./types";

export interface QuestionView {
  /** Headline for the state, one of the wq.status.* keys. */
  statusKey: MessageKey;
  tone: "waiting" | "answered" | "attention" | "call" | "missed";
  /** Show the answer text. */
  showAnswer: boolean;
  /** Show the explanation that a call is coming. */
  showCallNote: boolean;
  /** The patient may reply: care team asked for more, or inside the follow-up window. */
  canReply: boolean;
  /** The follow-up window closed (so a "start a new message" line shows). */
  followUpEnded: boolean;
  /** Show the follow-up "reply until" line. */
  showFollowUpUntil: boolean;
}

/**
 * One place that turns a question row into what the patient sees (S22 design
 * section 2). No clinician name is ever produced here; the answered-by line is
 * not part of the written-question payload.
 */
export function viewQuestion(q: WrittenQuestion, now: Date): QuestionView {
  const followUpOpen = q.followUpUntil !== null && new Date(q.followUpUntil).getTime() > now.getTime();
  const answered = q.status === "answered" || q.status === "closed";

  if (q.answerKind === "needs_call") {
    return base(q, "wq.status.call", "call", { showCallNote: true, showAnswer: !!q.answer });
  }
  if (q.answerKind === "needs_more_information" && q.status !== "closed") {
    return base(q, "wq.status.info_needed", "attention", { canReply: true, showAnswer: !!q.answer });
  }
  if (answered) {
    return base(q, "wq.status.answered", "answered", {
      showAnswer: !!q.answer,
      canReply: followUpOpen && q.status === "answered",
      showFollowUpUntil: followUpOpen,
      followUpEnded: q.followUpUntil !== null && !followUpOpen,
    });
  }
  if (q.windowMissedAt) {
    return base(q, "wq.status.missed", "missed", {});
  }
  return base(q, "wq.status.waiting", "waiting", {});
}

function base(
  _q: WrittenQuestion,
  statusKey: MessageKey,
  tone: QuestionView["tone"],
  over: Partial<QuestionView>,
): QuestionView {
  return {
    statusKey,
    tone,
    showAnswer: false,
    showCallNote: false,
    canReply: false,
    followUpEnded: false,
    showFollowUpUntil: false,
    ...over,
  };
}
