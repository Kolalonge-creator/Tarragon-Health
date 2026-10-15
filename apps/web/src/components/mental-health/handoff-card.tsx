"use client";

import { useState } from "react";
import { pickHandoffScreen } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/client";
import { useMentalHealthScreenHistory } from "@/lib/queries/mental-health";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Hand-off from a screen to a consultation (function 10.13). The patient chooses to send their latest answers; a task is raised for
 * the care team (request_mental_health_handoff). Onward referral to local mental health services (Module 15) is not built: the
 * hand-off row is the documented seam it will read.
 */
export function MentalHealthHandoffCard({ patientId }: { patientId: string }) {
  const history = useMentalHealthScreenHistory(patientId);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const screen = pickHandoffScreen(history.data ?? []);
  if (!screen) return null;

  async function send() {
    setState("sending");
    const { error } = await createClient().rpc("request_mental_health_handoff", { p_screen: screen?.id });
    setState(error ? "error" : "sent");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("crisis.handoff_title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{t("crisis.handoff_body")}</p>
        {state === "sent" ? (
          <p role="status" className="text-sm font-medium">{t("crisis.handoff_sent")}</p>
        ) : (
          <Button type="button" onClick={send} disabled={state === "sending"}>
            {state === "sending" ? t("crisis.handoff_sending") : t("crisis.handoff_button")}
          </Button>
        )}
        {state === "error" && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{t("crisis.handoff_error")}</p>}
      </CardContent>
    </Card>
  );
}
