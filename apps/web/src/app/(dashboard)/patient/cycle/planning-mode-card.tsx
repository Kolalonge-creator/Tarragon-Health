"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { t } from "@tarragon/i18n";

/**
 * The "planning a pregnancy" switch (S66, 16.2 and decision A14). OFF by default. While it is off the tracker shows no fertile window, no
 * ovulation date and no temperature or ovulation test fields, on any screen or export. Only the patient can switch it on (the database
 * refuses anyone else), and switching it off hides everything again without touching a logged day.
 */
export function PlanningModeCard({ planning, canChange, onChange }: { planning: boolean; canChange: boolean; onChange: (on: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function set(on: boolean) {
    setBusy(true);
    setFailed(false);
    const { error } = await createClient().rpc("set_conception_planning_mode", { p_on: on });
    setBusy(false);
    if (error) return setFailed(true);
    onChange(on);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("cycle.planning.title")}</CardTitle>
        <CardDescription>{t("cycle.planning.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80" role="status">
          {planning ? t("cycle.planning.on_label") : t("cycle.planning.off_label")}
        </p>
        {!planning && <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("cycle.planning.off_note")}</p>}
        {planning && <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("cycle.planning.turn_off_note")}</p>}
        {canChange && (
          <Button type="button" size="sm" variant={planning ? "outline" : "default"} disabled={busy} onClick={() => void set(!planning)}>
            {planning ? t("cycle.planning.turn_off") : t("cycle.planning.turn_on")}
          </Button>
        )}
        {failed && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {t("cycle.planning.save_failed")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
