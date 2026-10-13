import type { SectionId } from "./sections";

/**
 * Where a tap on a notification should land. The phone's own reminders carry `data.kind`; a push from the server carries the
 * web path it was written for in `data.url`. Anything not recognised opens the app where it was (null), never a wrong screen.
 */
export function sectionForNotification(data: unknown): SectionId | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as { kind?: unknown; url?: unknown };
  if (d.kind === "triage_recheck" || d.kind === "bp") return "vitals";
  if (typeof d.url === "string" && (d.url === "/patient/vitals" || d.url.startsWith("/patient/vitals/") || d.url.startsWith("/patient/vitals?"))) {
    return "vitals";
  }
  return null;
}

export interface NotificationResponse {
  /** The notification's own id, used so one tap is never acted on twice (the OS returns the last response on every launch). */
  id: string;
  data: unknown;
}

export interface NotificationTapPort {
  /** The tap that launched the app from closed, if there was one. */
  lastResponse(): Promise<NotificationResponse | null>;
  /** Taps while the app is running or in the background. Returns a way to stop listening. */
  onResponse(handler: (r: NotificationResponse) => void): () => void;
  clearLast(): void;
}

/** Ids already acted on, for the life of the app process. */
const handled = new Set<string>();
export const resetHandledNotificationTaps = (): void => handled.clear();

/**
 * Opens the right section when a reminder or a push is tapped, from a cold start or while running. Never throws; a tap that
 * is not ours, or was already handled, does nothing. Returns a function that stops listening.
 */
export function startNotificationTaps(port: NotificationTapPort, open: (section: SectionId) => void): () => void {
  const act = (r: NotificationResponse | null): void => {
    if (!r || handled.has(r.id)) return;
    const section = sectionForNotification(r.data);
    if (section === null) return;
    handled.add(r.id);
    open(section);
  };
  let stopped = false;
  void port
    .lastResponse()
    .then((r) => {
      if (stopped) return;
      act(r);
      if (r) port.clearLast();
    })
    .catch(() => {});
  const off = port.onResponse(act);
  return () => {
    stopped = true;
    off();
  };
}

/** The real port, from expo-notifications. Loaded on use so nothing here needs the native module at import time. */
export function expoNotificationTapPort(): NotificationTapPort {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const N = require("expo-notifications") as typeof import("expo-notifications");
  const toResponse = (r: import("expo-notifications").NotificationResponse): NotificationResponse => ({
    id: r.notification.request.identifier,
    data: r.notification.request.content.data,
  });
  return {
    lastResponse: async () => {
      const r = await N.getLastNotificationResponseAsync();
      return r ? toResponse(r) : null;
    },
    onResponse: (handler) => {
      const sub = N.addNotificationResponseReceivedListener((r) => handler(toResponse(r)));
      return () => sub.remove();
    },
    clearLast: () => {
      try {
        N.clearLastNotificationResponse();
      } catch {
        // an older native build without the call: the handled-id set still stops a repeat
      }
    },
  };
}
