"use client";

import { useState, type FormEvent } from "react";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAddSideEffectNote } from "@/lib/queries/medicine-catalogue";

/**
 * "Side effects to share" (spec 8.7): a short note, in the person's own words, that their care team sees at the next consultation.
 * It is a note, not a report: it changes no medicine, dose or schedule and raises no alert. A person who feels very unwell is
 * pointed at the emergency steps and the existing side-effect report above, not asked to wait for a visit.
 */
export function SideEffectNote({ patientId, medicationId }: { patientId: string; medicationId: string }) {
  const add = useAddSideEffectNote(patientId);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const inputId = `side-effect-note-${medicationId}`;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (note.trim().length === 0) return;
    add.mutate(
      { medicationId, note },
      {
        onSuccess: () => {
          setNote("");
          setSaved(true);
          setOpen(false);
        },
      },
    );
  }

  if (!open) {
    return (
      <div className="mt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 px-2 text-xs text-charcoal-ink/70 dark:text-night-ink/70"
          onClick={() => {
            setSaved(false);
            setOpen(true);
          }}
        >
          {t("medicines.sideeffect.add")}
        </Button>
        {saved ? (
          <p role="status" className="px-2 text-xs text-charcoal-ink/70 dark:text-night-ink/70">
            {t("medicines.sideeffect.saved")}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-1 space-y-2 rounded-md border border-charcoal-ink/15 p-2 dark:border-night-ink/20">
      <Label htmlFor={inputId}>{t("medicines.sideeffect.title")}</Label>
      <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("medicines.sideeffect.hint")}</p>
      <Input id={inputId} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
      <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("medicines.sideeffect.urgent")}</p>
      {add.isError ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-300">
          We could not save that just now. Please try again.
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="min-h-11" disabled={add.isPending || note.trim().length === 0}>
          {t("medicines.sideeffect.add")}
        </Button>
        <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  );
}
