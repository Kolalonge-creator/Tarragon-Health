import type { Enums } from "@tarragon/shared";

/** MSG-3 inbox views. A thread's queue and doctor flag are set by the database (private.route_care_thread_on_message); this only filters. */
export type InboxView = "all" | "support" | "clinical" | "needs_doctor";

export const INBOX_VIEW_LABEL: Record<InboxView, string> = {
  all: "All",
  support: "Support",
  clinical: "Clinical",
  needs_doctor: "Needs a doctor",
};

export const QUEUE_LABEL: Record<Enums<"care_thread_queue">, string> = {
  support: "Support",
  clinical: "Clinical",
};

export interface QueuedThread {
  queue: Enums<"care_thread_queue">;
  needs_doctor: boolean;
}

export function inView(thread: QueuedThread, view: InboxView): boolean {
  if (view === "all") return true;
  if (view === "needs_doctor") return thread.needs_doctor;
  return thread.queue === view;
}

/** True when the database refused to close a thread because it still needs a doctor (hint 'needs_doctor'). */
export function isNeedsDoctorCloseError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "hint" in error && (error as { hint?: unknown }).hint === "needs_doctor";
}
