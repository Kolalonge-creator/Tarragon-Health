import type { MessageKey } from "@tarragon/i18n";
import type { WrittenQuestion } from "./types";

export type WrittenQuestionStage = "waiting" | "answered" | "info_needed" | "call";

export interface WrittenQuestionView {
  stage: WrittenQuestionStage;
  labelKey: MessageKey;
  /** The care team was late; the allowance is returned. Shown in addition to the stage. */
  missed: boolean;
  showAnswer: boolean;
  /** Reply box open: the care team is waiting on the patient, or the follow-up window is still running. */
  canReply: boolean;
  followUpOpen: boolean;
  followUpEnded: boolean;
}

export function viewWrittenQuestion(q: WrittenQuestion, now: Date): WrittenQuestionView {
  const followUpUntil = q.follow_up_until ? new Date(q.follow_up_until) : null;
  const followUpOpen = followUpUntil !== null && now.getTime() <= followUpUntil.getTime();
  const followUpEnded = followUpUntil !== null && !followUpOpen;
  const missed = q.window_missed_at !== null;

  if (q.answer_kind === "needs_call") {
    return { stage: "call", labelKey: "wq.status.call", missed, showAnswer: Boolean(q.answer), canReply: false, followUpOpen: false, followUpEnded: false };
  }
  if (q.answer_kind === "needs_more_information") {
    return { stage: "info_needed", labelKey: "wq.status.info_needed", missed, showAnswer: Boolean(q.answer), canReply: true, followUpOpen: false, followUpEnded: false };
  }
  if (q.answer_kind === "guidance" && q.answer) {
    return { stage: "answered", labelKey: "wq.status.answered", missed, showAnswer: true, canReply: followUpOpen, followUpOpen, followUpEnded };
  }
  return { stage: "waiting", labelKey: "wq.status.waiting", missed, showAnswer: false, canReply: false, followUpOpen: false, followUpEnded: false };
}
