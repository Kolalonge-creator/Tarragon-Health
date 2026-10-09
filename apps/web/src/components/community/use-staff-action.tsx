"use client";

import { useState, useTransition } from "react";
import type { StaffActionResult } from "./staff-types";

/** Runs a server action and keeps its plain-English result for an aria-live line. A thrown action becomes a calm generic line. */
export function useStaffAction() {
  const [message, setMessage] = useState<StaffActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  function run(fn: () => Promise<StaffActionResult>, after?: (r: StaffActionResult) => void) {
    startTransition(async () => {
      let result: StaffActionResult;
      try {
        result = await fn();
      } catch {
        result = { ok: false, message: "That could not be done. Please try again." };
      }
      setMessage(result);
      after?.(result);
    });
  }
  return { message, pending, run };
}

/** The result line. The live region is always mounted so a screen reader announces the text when it appears. */
export function StaffMessage({ message }: { message: StaffActionResult | null }) {
  return (
    <div role="status" aria-live="polite" className="min-h-5 text-sm">
      {message && (
        <p className={message.ok ? "text-brand-green" : "text-red-700"}>
          {message.ok ? "Done: " : "Not done: "}
          {message.message}
        </p>
      )}
    </div>
  );
}
