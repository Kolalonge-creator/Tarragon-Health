"use client";

import { useState } from "react";
import { t, type MessageKey } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/client";

const tr = (key: string) => t(key as MessageKey, "en");

/**
 * Tells the patient, in plain words, what the care team's follow-up list uses, and lets them opt out of the two parts that read their activity
 * (check-ins and the sleep diary). Shown only once that list is switched on for them. The words (wnotice.*) are under the CMO's fingerprint attestation.
 */
export function WorklistNotice({ enabled, optedOut }: { enabled: boolean; optedOut: boolean }) {
  const [value, setValue] = useState(optedOut);
  const [failed, setFailed] = useState(false);
  if (!enabled) return null;
  async function change(next: boolean) {
    setFailed(false);
    const { error } = await createClient().rpc("set_worklist_activity_opt_out", { p_opt_out: next });
    if (error) setFailed(true);
    else setValue(next);
  }
  return (
    <div className="space-y-2 rounded-lg border border-charcoal-ink/15 p-3 text-sm dark:border-night-ink/20">
      <p>{tr("wnotice.text")}</p>
      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <input type="checkbox" className="h-5 w-5" checked={value} onChange={(e) => void change(e.target.checked)} />
        {tr("wnotice.opt_out")}
      </label>
      <p className="text-xs text-charcoal-ink/65 dark:text-night-ink/65">{tr("wnotice.opt_out_note")}</p>
      {failed && <p role="alert" className="text-red-600 dark:text-red-400">{tr("wnotice.error")}</p>}
    </div>
  );
}
