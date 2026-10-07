import type { TriageAction } from "./types.ts";

/** The spec's compact form of an action, for example `show_emergency_guidance:EMG-001` or `create_task:urgent_bp_review`. */
export function actionToString(action: TriageAction): string {
  switch (action.kind) {
    case "show_emergency_guidance":
    case "show_message":
    case "prompt_recheck":
    case "ask_symptoms":
      return `${action.kind}:${action.code}`;
    case "route_referral":
      return `route_referral:${action.reason}`;
    case "create_task":
      return `create_task:${action.task}`;
    case "page_on_call":
      return "page_on_call";
  }
}
