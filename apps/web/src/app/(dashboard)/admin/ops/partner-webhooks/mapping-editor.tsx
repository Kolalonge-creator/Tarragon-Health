"use client";

import { useState, useTransition } from "react";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { removeMappingAction, saveMappingAction } from "@/lib/partner-admin/actions";
import type { ActionError } from "@/lib/partner-admin/model";

const locale = DEFAULT_UI_LANGUAGE;
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink";
const ghost = "rounded-lg border border-charcoal-ink/20 px-3 py-1 text-xs font-semibold text-charcoal-ink";
const solid = "rounded-lg bg-brand-green px-3 py-1 text-xs font-semibold text-white disabled:opacity-60";

const ERRORS: Record<ActionError, "partnerops.error.not_found" | "partnerops.error.forbidden" | "partnerops.error.grace_open" | "partnerops.error.reason" | "partnerops.error.invalid" | "partnerops.error.generic"> = {
  forbidden: "partnerops.error.forbidden",
  not_found: "partnerops.error.not_found",
  grace_open: "partnerops.error.grace_open",
  reason: "partnerops.error.reason",
  invalid: "partnerops.error.invalid",
  generic: "partnerops.error.generic",
};

/** Edit, add or remove the mapping of one bus event type. The database function validates the id keys again and audits every write. */
export function MappingEditor({
  busEventType,
  isMapped,
  partnerEventType,
  idKeys,
  partnerEventTypes,
}: {
  busEventType: string;
  isMapped: boolean;
  partnerEventType: string | null;
  idKeys: string[];
  partnerEventTypes: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const [partner, setPartner] = useState(partnerEventType ?? "");
  const [keys, setKeys] = useState(idKeys.join(", "));
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pending, start] = useTransition();

  const run = (work: () => Promise<{ ok: true } | { ok: false; error: ActionError }>, okKey: "partnerops.result.mapping_saved" | "partnerops.result.mapping_removed") =>
    start(async () => {
      setMessage(null);
      let r: { ok: true } | { ok: false; error: ActionError };
      try {
        r = await work();
      } catch {
        return setMessage({ tone: "error", text: t(ERRORS.generic, locale) });
      }
      setConfirmRemove(false);
      if (!r.ok) return setMessage({ tone: "error", text: t(ERRORS[r.error], locale) });
      setOpen(false);
      setMessage({ tone: "ok", text: t(okKey, locale) });
    });

  return (
    <div className="space-y-2">
      {!open && (
        <div className="flex gap-2">
          <button type="button" className={ghost} onClick={() => setOpen(true)} disabled={pending}>
            {isMapped ? t("partnerops.map.edit", locale) : t("partnerops.map.add", locale)}
          </button>
          {isMapped && !confirmRemove && (
            <button type="button" className={ghost} onClick={() => setConfirmRemove(true)} disabled={pending}>
              {t("partnerops.map.remove", locale)}
            </button>
          )}
          {isMapped && confirmRemove && (
            <span className="flex flex-wrap items-center gap-2 text-xs">
              {t("partnerops.map.remove_confirm", locale)}
              <button type="button" className={solid} onClick={() => run(() => removeMappingAction(busEventType), "partnerops.result.mapping_removed")} disabled={pending}>
                {t("partnerops.map.remove", locale)}
              </button>
              <button type="button" className={ghost} onClick={() => setConfirmRemove(false)} disabled={pending}>{t("partnerops.cancel", locale)}</button>
            </span>
          )}
        </div>
      )}
      {open && (
        <div className="space-y-2">
          <label className="block text-xs">
            {t("partnerops.map.partner_event", locale)}
            <select value={partner} onChange={(e) => setPartner(e.target.value)} className={field}>
              {!partnerEventType && <option value="">{t("partnerops.map.choose", locale)}</option>}
              {partnerEventTypes.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            {t("partnerops.map.id_keys", locale)}
            <input value={keys} onChange={(e) => setKeys(e.target.value)} maxLength={400} className={`${field} font-mono`} />
          </label>
          <div className="flex gap-2">
            <button type="button" className={solid} onClick={() => run(() => saveMappingAction(busEventType, partner, keys), "partnerops.result.mapping_saved")} disabled={pending || !partner || keys.trim().length === 0}>
              {t("partnerops.map.save", locale)}
            </button>
            <button type="button" className={ghost} onClick={() => setOpen(false)} disabled={pending}>{t("partnerops.cancel", locale)}</button>
          </div>
        </div>
      )}
      {message && <p role="status" className={`text-xs ${message.tone === "ok" ? "text-brand-green" : "text-red-700"}`}>{message.text}</p>}
    </div>
  );
}
