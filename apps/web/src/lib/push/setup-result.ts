/**
 * Outcome of turning on push alerts on this device. Every step that can fail reports which one it was and why, because the browser
 * and the server fail in different ways and a silent "nothing happened" (the previous behaviour: the chip simply disappeared) leaves
 * nobody able to tell a blocked permission from a service worker that never started or a server that refused the save.
 */
export type PushSetupStep = "unsupported" | "service_worker" | "subscribe" | "details" | "save";

export type PushSetupResult = { ok: true } | { ok: false; step: PushSetupStep; detail: string };

const STEP_TEXT: Record<PushSetupStep, string> = {
  unsupported: "This browser cannot receive alerts",
  service_worker: "The app's background worker did not start",
  subscribe: "The browser would not create an alert subscription",
  details: "The browser returned an incomplete subscription",
  save: "Your subscription could not be saved",
};

/** One short line for the person; the detail stays short because it sits in the top bar. */
export function pushSetupMessage(result: Extract<PushSetupResult, { ok: false }>): string {
  const detail = result.detail.replace(/\s+/g, " ").trim().slice(0, 120);
  return detail ? `${STEP_TEXT[result.step]}: ${detail}` : STEP_TEXT[result.step];
}

export function errorDetail(err: unknown): string {
  if (err instanceof Error) return err.name && err.name !== "Error" ? `${err.name}: ${err.message}` : err.message;
  return typeof err === "string" ? err : "unknown error";
}
