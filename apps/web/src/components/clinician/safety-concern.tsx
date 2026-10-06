"use client";

import { useActionState } from "react";
import { usePathname } from "next/navigation";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SAFETY_CONCERN_CATEGORIES, SAFETY_CONCERN_SEVERITIES } from "@/lib/clinician/queue-console";
import { raiseSafetyConcern, type SafetyConcernState } from "./safety-concern-actions";

/**
 * "Raise a safety concern" (spec 9.1: always visible). A native <details> so it opens with no script, works on a slow
 * link and never depends on the state of the page behind it. The screen path is sent so the lead can see where it came from.
 */
export function SafetyConcernButton() {
  const pathname = usePathname();
  const taskId = /^\/clinician\/tasks\/([0-9a-f-]{36})/i.exec(pathname)?.[1];
  const [state, action, pending] = useActionState<SafetyConcernState, FormData>(raiseSafetyConcern, undefined);
  return (
    <details className="fixed bottom-20 right-4 z-40 max-h-[70vh] max-w-sm overflow-y-auto rounded-md border sm:bottom-4 border-charcoal-ink/20 bg-white p-2 shadow-lg dark:bg-night-surface">
      <summary className="cursor-pointer text-sm font-medium text-charcoal-ink">{t("concern.button", "en")}</summary>
      {state?.sent ? (
        <p role="status" className="p-2 text-sm text-brand-green">{t("concern.thanks", "en")}</p>
      ) : (
        <form action={action} className="space-y-2 p-2">
          <input type="hidden" name="screen" value={pathname} />
          {taskId && <input type="hidden" name="task_id" value={taskId} />}
          <div>
            <Label htmlFor="concern-category">{t("concern.category", "en")}</Label>
            <Select id="concern-category" name="category" defaultValue="patient_safety">
              {SAFETY_CONCERN_CATEGORIES.map((c) => (
                <option key={c} value={c}>{t(`concern.category.${c}`, "en")}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="concern-severity">{t("concern.severity", "en")}</Label>
            <Select id="concern-severity" name="severity" defaultValue="medium">
              {SAFETY_CONCERN_SEVERITIES.map((s) => (
                <option key={s} value={s}>{t(`concern.severity.${s}`, "en")}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="concern-description">{t("concern.description", "en")}</Label>
            <Textarea id="concern-description" name="description" rows={4} minLength={20} maxLength={4000} required />
          </div>
          {state?.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
          <Button type="submit" size="sm" disabled={pending}>{t("concern.submit", "en")}</Button>
        </form>
      )}
    </details>
  );
}
