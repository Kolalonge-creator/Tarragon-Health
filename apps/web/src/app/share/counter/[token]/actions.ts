"use server";

import { headers } from "next/headers";
import { openShare, isWellFormedPin } from "@/lib/my-health/open-share";
import type { CounterData } from "./counter-view";

export type CounterUnlockState =
  | { status: "pin_required"; attemptsLeft: number | null; message?: "format" }
  | { status: "try_later" }
  | { status: "unavailable" }
  | { status: "ok"; record: CounterData };

async function clientKey(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip") || null;
}

/**
 * Opens a pharmacy-counter page. Same rules as the share link: the PIN travels in the form body, never in the address, and only this explicit
 * submit counts as an open (the landing page only peeks). The database door checks the PIN, the lockout, the expiry and whether the feature is open.
 */
export async function unlockCounter(token: string, _prev: CounterUnlockState, formData: FormData): Promise<CounterUnlockState> {
  const pin = String(formData.get("pin") ?? "").trim();
  if (!isWellFormedPin(pin)) return { status: "pin_required", attemptsLeft: null, message: "format" };
  const result = await openShare(token, pin, await clientKey(), "pharmacy_snapshot_by_token");
  switch (result.kind) {
    case "ok":
      return { status: "ok", record: result.record as unknown as CounterData };
    case "pin_required":
      return { status: "pin_required", attemptsLeft: result.attemptsLeft };
    case "try_later":
      return { status: "try_later" };
    default:
      return { status: "unavailable" };
  }
}
