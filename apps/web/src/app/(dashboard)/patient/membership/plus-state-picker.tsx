"use client";

import { t, type Locale } from "@tarragon/i18n";
import { Select } from "@/components/ui/select";
import { usePlusCollectionStates } from "@/lib/queries/service-regions";

/**
 * Membership Plus is bought for a state where Tarragon collects blood. The list is only the states an admin has approved
 * (service_regions.plus_collection_enabled); the database refuses anything else. The warning is shown BEFORE payment because the
 * state stays fixed (founder decision 2026-10-26).
 */
export function PlusStatePicker({ id, value, onChange, locale, forName }: { id: string; value: string; onChange: (state: string) => void; locale: Locale; forName?: string }) {
  const states = usePlusCollectionStates();
  const list = states.data ?? [];
  return (
    <div className="space-y-2 rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
      <label htmlFor={id} className="block font-medium">{forName ? t("shop.plus.state.label_for", locale, { name: forName }) : t("shop.plus.state.label", locale)}</label>
      {states.isSuccess && list.length === 0 ? (
        <p role="status">{t("shop.plus.state.none", locale)}</p>
      ) : (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={!states.isSuccess}>
          <option value="">{t("shop.plus.state.choose", locale)}</option>
          {list.map((s) => (
            <option key={s.state} value={s.state}>{s.display_name}</option>
          ))}
        </Select>
      )}
      <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{forName ? t("shop.plus.state.warning_for", locale, { name: forName }) : t("shop.plus.state.warning", locale)}</p>
    </div>
  );
}
