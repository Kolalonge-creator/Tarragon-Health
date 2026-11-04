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

/** The ?view= value from a care operations tile link; anything unknown falls back to "all". */
export function parseInboxView(raw: string | string[] | undefined): InboxView {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "support" || v === "clinical" || v === "needs_doctor" ? v : "all";
}

export function inView(thread: QueuedThread, view: InboxView): boolean {
  if (view === "all") return true;
  if (view === "needs_doctor") return thread.needs_doctor;
  return thread.queue === view;
}

/** True when flagging failed because no doctor in the organisation can take the thread (hint 'no_doctor_available'). */
export function isNoDoctorAvailableError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "hint" in error && (error as { hint?: unknown }).hint === "no_doctor_available";
}

/** True when the database refused to close a thread because it still needs a doctor (hint 'needs_doctor'). */
export function isNeedsDoctorCloseError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "hint" in error && (error as { hint?: unknown }).hint === "needs_doctor";
}
