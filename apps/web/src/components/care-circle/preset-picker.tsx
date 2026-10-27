"use client";

import { t, type Locale } from "@tarragon/i18n";
import { permissionsForPreset, presetOfPermissions, type CirclePresetChoice } from "@tarragon/shared";
import { Label } from "@/components/ui/label";
import type { CirclePermission } from "@/lib/care-circle/model";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

/**
 * Two named presets over the existing permissions, plus "choose one by one" (the tick-boxes stay on the screen, so nothing about what
 * can be granted is hidden). Choosing a preset only fills the permission list; "Choose one by one" leaves it as it is.
 */
export function PresetPicker({ id, value, onChange, locale }: { id: string; value: readonly CirclePermission[]; onChange: (next: CirclePermission[]) => void; locale: Locale }) {
  const current: CirclePresetChoice = presetOfPermissions(value);
  const options: Array<{ choice: CirclePresetChoice; title: Parameters<typeof t>[0]; body: Parameters<typeof t>[0] }> = [
    { choice: "see", title: "cctools.preset.see.title", body: "cctools.preset.see.body" },
    { choice: "see_and_help", title: "cctools.preset.help.title", body: "cctools.preset.help.body" },
    { choice: "custom", title: "cctools.preset.custom.title", body: "cctools.preset.custom.body" },
  ];
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t("cctools.preset.legend", locale)}</legend>
      {options.map((o) => {
        const inputId = `${id}-preset-${o.choice}`;
        return (
          <div key={o.choice} className="flex min-h-11 items-start gap-3">
            <input
              id={inputId}
              type="radio"
              name={`${id}-preset`}
              className="mt-1 h-5 w-5"
              checked={current === o.choice}
              onChange={() => {
                if (o.choice === "custom") return;
                onChange(permissionsForPreset(o.choice) as CirclePermission[]);
              }}
            />
            <div>
              <Label htmlFor={inputId} className="font-medium leading-snug">{t(o.title, locale)}</Label>
              <p className={`text-sm ${MUTED}`}>{t(o.body, locale)}</p>
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}
