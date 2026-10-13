"use server";

import { headers } from "next/headers";
import { openShare, isWellFormedPin } from "@/lib/my-health/open-share";
import type { SharedData } from "./shared-record-view";

export type UnlockState =
  | { status: "pin_required"; attemptsLeft: number | null; message?: "format"; needsPin?: true }
  | { status: "try_later" }
  | { status: "unavailable" }
  | { status: "ok"; record: SharedData };

/** The viewer's address as the platform proxy reports it. Only ever hashed by the database, only ever used to slow down wrong PINs. */
async function clientKey(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip") || null;
}

/**
 * Bound to the link's token on the page. The PIN travels in the form body, never in a URL. This explicit submit is the only thing that counts as
 * an open: the landing page itself only peeks, so a link preview or prefetch never does.
 */
export async function unlockShare(token: string, needsPin: boolean, _prev: UnlockState, formData: FormData): Promise<UnlockState> {
  const pin = needsPin ? String(formData.get("pin") ?? "").trim() : "";
  if (needsPin && !isWellFormedPin(pin)) return { status: "pin_required", attemptsLeft: null, message: "format" };
  const result = await openShare(token, needsPin ? pin : null, await clientKey());
  switch (result.kind) {
    case "ok":
      return { status: "ok", record: result.record as unknown as SharedData };
    case "pin_required":
      // needsPin: true tells the form to show the PIN field even if the page loaded without one (the link gained a PIN since).
      return { status: "pin_required", attemptsLeft: result.attemptsLeft, needsPin: true };
    case "try_later":
      return { status: "try_later" };
    default:
      return { status: "unavailable" };
  }
}
