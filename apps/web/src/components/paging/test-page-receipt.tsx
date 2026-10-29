"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { deviceId } from "./on-call-alarm";

/**
 * Renders nothing. When the On call screen shows a pending test page it records that it did (a delivered receipt on the
 * in-app route), so a clinician whose pushes arrive somewhere this console cannot see is not locked out of readiness: the test
 * page counts as shown once it has been shown on screen, and acknowledging it needs that receipt (S19c).
 *
 * The Supabase query builder is lazy: it sends nothing until something awaits it or calls `.then`. A bare `void client.rpc(...)`
 * never made the request, so the receipt was never recorded and "Acknowledge the test page" always refused with "has not been shown".
 */
export function TestPageReceipt({ testId }: { testId: string }) {
  useEffect(() => {
    const client = createClient() as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
    };
    void client
      .rpc("record_page_delivered", { p_ref: testId, p_channel: "in_app", p_device: deviceId() })
      .then(
        () => undefined,
        () => undefined,
      );
  }, [testId]);
  return null;
}
