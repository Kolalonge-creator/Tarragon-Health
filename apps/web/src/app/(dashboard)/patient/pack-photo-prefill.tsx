"use client";

import { useRef, useState, useTransition } from "react";
import { t } from "@tarragon/i18n";
import { prefillFromPackReading, type AddFormPrefill } from "@tarragon/medicines";
import { Button } from "@/components/ui/button";
import { checkMedicationPack } from "@/lib/medications/pack-actions";

/**
 * "Fill this in from a photo of the pack" (spec 8.1).
 *
 * The photo is read by the governed pack reader (AI-007) and the result only FILLS THE FORM. Nothing is saved from it: the
 * parent form keeps the Add button off until the patient ticks "I have checked these details against my pack" (see
 * `canSubmitAddForm` in @tarragon/medicines). The reader never judges whether a pack is genuine; that stays NAFDAC's.
 * The server action is stateless: no image and no reading is stored.
 */
export function PackPhotoPrefill({ onPrefill }: { onPrefill: (prefill: AddFormPrefill) => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    const formData = new FormData();
    formData.set("photo", file);
    startTransition(async () => {
      const result = await checkMedicationPack(formData);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      const prefill = prefillFromPackReading(result.reading);
      if (!prefill) {
        setError(t("medicines.pack.unreadable"));
        return;
      }
      onPrefill(prefill);
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <div className="space-y-1.5">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        disabled={pending}
        onChange={(event) => onFile(event.target.files?.[0])}
      />
      <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={pending} onClick={() => inputRef.current?.click()}>
        {pending ? "…" : t("medicines.pack.read_button")}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
