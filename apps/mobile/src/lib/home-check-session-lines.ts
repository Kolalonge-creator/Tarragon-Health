import type { SessionStep } from "@tarragon/clinical";
import type { MessageKey } from "@tarragon/i18n";

type Tr = (key: MessageKey, params?: Record<string, string | number>) => string;

/** The sentence for a guided-session step, in words (colour never carries it). Pure so the wording is tested without rendering. */
export function sessionLine(step: SessionStep, tr: Tr): string {
  switch (step.kind) {
    case "outside_window":
      return tr(step.next === "morning" ? "hc.session.outside_morning" : "hc.session.outside_evening");
    case "rest":
      return tr("hc.session.rest", { minutes: step.restMinutes, number: step.number, of: step.of });
    case "wait":
      return tr("hc.session.wait", { seconds: step.secondsLeft, number: step.number, of: step.of });
    case "next":
      return tr("hc.session.next", { number: step.number, of: step.of });
    case "done":
      return tr("hc.session.done", { count: step.readings, sys: step.mean.systolic, dia: step.mean.diastolic });
  }
}
