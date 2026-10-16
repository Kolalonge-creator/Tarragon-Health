"use client";

import { useState, type FormEvent } from "react";
import { t } from "@tarragon/i18n";
import { useSetScreeningState } from "@/lib/queries/screening";
import { SCREENING_REASON_CODES, screeningStateSchema } from "@/lib/validation/screening-decline";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * Lets a patient close a recommended screening as declined or not applicable, with a reason code and a few words, instead of leaving it
 * pending forever. The reason is stored (S45, function 3.5), the reminder ladder stops, and a later scheduler run never brings it back.
 */
export function DeclineScreeningForm({
  patientId,
  scheduleId,
}: {
  patientId: string;
  scheduleId: string;
}) {
  const setState = useSetScreeningState();
  const [open, setOpen] = useState(false);
  const [state, setStateChoice] = useState<"declined" | "not_applicable">("declined");
  const [reasonCode, setReasonCode] = useState<(typeof SCREENING_REASON_CODES)[number]>("other");
  const [note, setNote] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saved, setSaved] = useState<"declined" | "not_applicable" | null>(null);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setValidationError(null);

    const parsed = screeningStateSchema.safeParse({ schedule_id: scheduleId, state, reason_code: reasonCode, note });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? t("screening.state.note_required", "en"));
      return;
    }

    try {
      await setState.mutateAsync({ ...parsed.data, patientId });
      setSaved(parsed.data.state);
    } catch {
      // Mutation error surfaces via setState.error below.
    }
  }

  if (saved) {
    return (
      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        {t(saved === "declined" ? "screening.state.saved_declined" : "screening.state.saved_not_applicable", "en")}
      </p>
    );
  }

  const error = validationError ?? (setState.error as Error | null)?.message ?? null;

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {t("screening.state.open", "en")}
      </Button>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-2 rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
      <fieldset className="space-y-1">
        <legend className="text-xs font-medium">{t("screening.state.choose", "en")}</legend>
        {(["declined", "not_applicable"] as const).map((s) => (
          <label key={s} className="flex items-center gap-2 text-sm">
            <input type="radio" name={`state-${scheduleId}`} checked={state === s} onChange={() => setStateChoice(s)} />
            {t(s === "declined" ? "screening.state.declined" : "screening.state.not_applicable", "en")}
          </label>
        ))}
      </fieldset>
      <select
        aria-label={t("screening.state.choose", "en")}
        value={reasonCode}
        onChange={(event) => setReasonCode(event.target.value as (typeof SCREENING_REASON_CODES)[number])}
        className="w-full rounded-md border border-charcoal-ink/20 bg-transparent p-2 text-sm"
      >
        {SCREENING_REASON_CODES.map((code) => (
          <option key={code} value={code}>
            {t(`screening.reason.${code}`, "en")}
          </option>
        ))}
      </select>
      <Textarea
        placeholder={t("screening.state.note_placeholder", "en")}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
      />
      {error && <p className="text-xs text-red-600 dark:text-red-300">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="outline" disabled={setState.isPending}>
          {setState.isPending ? t("screening.state.saving", "en") : t("screening.state.save", "en")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          {t("common.cancel", "en")}
        </Button>
      </div>
    </form>
  );
}
