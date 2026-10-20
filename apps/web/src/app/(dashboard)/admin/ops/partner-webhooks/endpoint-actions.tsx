"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { reenableEndpointAction, rotateSecretAction } from "@/lib/partner-admin/actions";
import type { ActionError } from "@/lib/partner-admin/model";

const locale = DEFAULT_UI_LANGUAGE;
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink";
const ghost = "rounded-lg border border-charcoal-ink/20 px-3 py-1 text-xs font-semibold text-charcoal-ink";
const solid = "rounded-lg bg-brand-green px-3 py-1 text-xs font-semibold text-white disabled:opacity-60";

const ERRORS: Record<ActionError, "partnerops.error.forbidden" | "partnerops.error.grace_open" | "partnerops.error.reason" | "partnerops.error.invalid" | "partnerops.error.generic"> = {
  forbidden: "partnerops.error.forbidden",
  grace_open: "partnerops.error.grace_open",
  reason: "partnerops.error.reason",
  invalid: "partnerops.error.invalid",
  generic: "partnerops.error.generic",
};

/**
 * Rotate and re-enable controls for one endpoint. A rotated signing key is held in this component's memory only: it is not put in
 * the address, a cookie, browser storage or the page's server-rendered output, and it is dropped the moment the admin dismisses it.
 */
export function EndpointActions({ endpointId, isActive, rotationLocked }: { endpointId: string; isActive: boolean; rotationLocked: boolean }) {
  const [mode, setMode] = useState<"idle" | "rotate" | "reenable">("idle");
  const [grace, setGrace] = useState("24");
  const [reason, setReason] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const fail = (e: ActionError) => setMessage({ tone: "error", text: t(ERRORS[e], locale) });

  const rotate = () =>
    start(async () => {
      setMessage(null);
      const r = await rotateSecretAction(endpointId, Number(grace));
      // A generic failure may have happened after the database rotated the key (the answer was lost on the way back): say so.
      if (!r.ok) return r.error === "generic" ? setMessage({ tone: "error", text: t("partnerops.error.rotate_unknown", locale) }) : fail(r.error);
      setSecret(r.secret);
      setMode("idle");
    });

  const reenable = () =>
    start(async () => {
      setMessage(null);
      const r = await reenableEndpointAction(endpointId, reason);
      if (!r.ok) return fail(r.error);
      setReason("");
      setMode("idle");
      setMessage({ tone: "ok", text: t("partnerops.result.reenabled", locale) });
    });

  return (
    <div className="space-y-2">
      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={ghost} onClick={() => setMode("rotate")} disabled={pending || rotationLocked}>
            {t("partnerops.rotate.button", locale)}
          </button>
          {!isActive && (
            <button type="button" className={ghost} onClick={() => setMode("reenable")} disabled={pending}>
              {t("partnerops.reenable.button", locale)}
            </button>
          )}
        </div>
      )}

      {mode === "rotate" && (
        <div className="space-y-2">
          <label className="block text-xs">
            {t("partnerops.rotate.grace", locale)}
            <input type="number" min={1} max={168} value={grace} onChange={(e) => setGrace(e.target.value)} className={field} />
          </label>
          <div className="flex gap-2">
            <button type="button" className={solid} onClick={rotate} disabled={pending}>{t("partnerops.rotate.confirm", locale)}</button>
            <button type="button" className={ghost} onClick={() => setMode("idle")} disabled={pending}>{t("partnerops.cancel", locale)}</button>
          </div>
        </div>
      )}

      {mode === "reenable" && (
        <div className="space-y-2">
          <label className="block text-xs">
            {t("partnerops.reenable.reason", locale)}
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} className={field} />
          </label>
          <div className="flex gap-2">
            <button type="button" className={solid} onClick={reenable} disabled={pending || reason.trim().length < 10}>{t("partnerops.reenable.confirm", locale)}</button>
            <button type="button" className={ghost} onClick={() => setMode("idle")} disabled={pending}>{t("partnerops.cancel", locale)}</button>
          </div>
        </div>
      )}

      {secret && (
        <div role="alert" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs text-charcoal-ink">{t("partnerops.result.rotated", locale)} {t("partnerops.rotate.once", locale)}</p>
          <input readOnly value={secret} onFocus={(e) => e.currentTarget.select()} className={`${field} font-mono text-xs`} aria-label={t("partnerops.endpoints.col.key", locale)} autoComplete="off" />
          <button type="button" className={solid} onClick={() => { setSecret(null); router.refresh(); }}>{t("partnerops.rotate.dismiss", locale)}</button>
        </div>
      )}

      {message && (
        <p role="status" className={`text-xs ${message.tone === "ok" ? "text-brand-green" : "text-red-700"}`}>{message.text}</p>
      )}
    </div>
  );
}
