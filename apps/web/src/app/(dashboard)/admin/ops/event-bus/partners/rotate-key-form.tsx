"use client";

import { useActionState } from "react";
import { t } from "@tarragon/i18n";
import { rotateKeyAction, type RotateState } from "@/lib/event-bus/partner-actions";

/**
 * Rotates one endpoint's signing key. The new key comes back in this action's response only and is shown once, in this panel: it is not in an
 * address, a log or a cache, and it disappears when the page is left. The text field is read-only so it can be selected and copied.
 */
export function RotateKeyForm({ endpointId, graceOpen }: { endpointId: string; graceOpen: boolean }) {
  const [state, action, pending] = useActionState<RotateState, FormData>(rotateKeyAction, { status: "idle" });

  return (
    <div className="space-y-2">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="endpoint_id" value={endpointId} />
        <label className="text-xs text-charcoal-ink/70">
          {t("busp.rotate.hours")}
          <input
            name="grace_hours"
            type="number"
            min={1}
            max={168}
            defaultValue={24}
            className="mt-1 block w-24 rounded-lg border border-charcoal-ink/20 bg-white px-2 py-1 text-sm text-charcoal-ink"
          />
        </label>
        <button
          type="submit"
          disabled={pending || graceOpen}
          className="rounded-lg border border-charcoal-ink/20 px-3 py-1 text-xs font-semibold text-charcoal-ink disabled:opacity-50"
        >
          {t("busp.rotate.button")}
        </button>
      </form>
      <p className="text-xs text-charcoal-ink/60">{graceOpen ? t("busp.rotate.window_open") : t("busp.rotate.help")}</p>
      {state.status === "rotated" && (
        <div role="status" className="rounded-lg border border-brand-green/40 bg-brand-green/5 p-3 text-sm">
          <p className="font-medium text-charcoal-ink">{t("busp.rotate.shown_once")}</p>
          <input
            readOnly
            aria-label={t("busp.rotate.shown_once")}
            value={state.secret}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-2 w-full rounded border border-charcoal-ink/20 bg-white px-2 py-1 font-mono text-xs text-charcoal-ink"
          />
        </div>
      )}
      {(state.status === "failed" || state.status === "window_open" || state.status === "invalid" || state.status === "forbidden") && (
        <p role="alert" className="text-sm text-red-700">
          {t(`busp.rotate.${state.status}` as const)}
        </p>
      )}
    </div>
  );
}
