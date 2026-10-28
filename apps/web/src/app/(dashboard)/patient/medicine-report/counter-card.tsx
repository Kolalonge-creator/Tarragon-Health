"use client";

import { useActionState } from "react";
import { t } from "@tarragon/i18n";
import { makeCounterPage, type CounterState } from "./counter-actions";

/** "Show at the pharmacy counter": only rendered when the courtesy check says the feature is open. The PIN and link are shown once, here. */
export function CounterCard() {
  const [state, action, pending] = useActionState<CounterState, FormData>(makeCounterPage, { status: "idle" });
  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <section className="rounded-lg border border-mist-grey/40 p-4">
      <h2 className="text-base font-semibold text-charcoal-ink">{t("pharm_snapshot.title")}</h2>
      <p className="mt-1 text-sm text-charcoal-ink/70">{t("pharm_snapshot.intro")}</p>
      <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm text-charcoal-ink">
          {t("pharm_snapshot.hours")}
          <select name="hours" defaultValue="2" className="mt-1 block rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm">
            {[1, 2, 4, 8, 24].map((h) => (
              <option key={h} value={h}>
                {t("pharm_snapshot.hours_option", "en", { hours: h })}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending} className="rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {t("pharm_snapshot.button")}
        </button>
      </form>
      {state.status === "made" && (
        <div role="status" className="mt-4 space-y-2 text-sm text-charcoal-ink">
          <p className="font-medium">{t("pharm_snapshot.link")}</p>
          <input readOnly aria-label={t("pharm_snapshot.link")} value={`${typeof window === "undefined" ? "" : window.location.origin}${state.path}`} onFocus={(e) => e.currentTarget.select()} className="w-full rounded border border-charcoal-ink/20 bg-white px-2 py-1 text-xs" />
          <p className="font-medium">{t("pharm_snapshot.pin")}</p>
          <p className="text-2xl font-semibold tracking-widest">{state.pin}</p>
          <p className="text-xs text-charcoal-ink/70">{t("pharm_snapshot.expires", "en", { when: when(state.expiresAt) })}</p>
        </div>
      )}
      {state.status === "failed" && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {t(`pharm_snapshot.${state.reason}` as const)}
        </p>
      )}
    </section>
  );
}
