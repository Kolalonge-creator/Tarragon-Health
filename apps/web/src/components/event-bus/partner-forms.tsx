"use client";

import { useActionState, useRef, useState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import {
  reenablePartnerEndpointAction,
  removeMappingAction,
  rotatePartnerSecretAction,
  saveMappingAction,
} from "@/lib/event-bus/partners-actions";
import { IDLE, type PartnerActionState } from "@/lib/event-bus/partners-model";

const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink";
const primary = "rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
const secondary = "rounded-lg border border-charcoal-ink/20 px-3 py-2 text-sm font-semibold text-charcoal-ink disabled:opacity-50";

const lagos = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function Result({ state, locale }: { state: PartnerActionState; locale: Locale }) {
  if (state.status === "idle" || !state.message) return null;
  const ok = state.status === "ok";
  return (
    <p role={ok ? "status" : "alert"} className={`mt-3 rounded-lg border px-3 py-2 text-sm ${ok ? "border-brand-green/40 bg-brand-green/5" : "border-red-300 bg-red-50"}`}>
      {t(state.message, locale)}
    </p>
  );
}

/**
 * Rotate form plus the copy-once panel. The secret lives only in this component's action state in the browser. Pressing the dismiss
 * button, or leaving the page, loses it; nothing writes it to storage, the address or a toast.
 */
export function RotateKeyForm({ endpointId, inGrace, locale }: { endpointId: string; inGrace: boolean; locale: Locale }) {
  const [state, action, pending] = useActionState(rotatePartnerSecretAction, IDLE);
  const [hidden, setHidden] = useState<string | null>(null);
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
  const secretRef = useRef<HTMLInputElement>(null);
  const secret = state.status === "ok" && state.secret && state.secret !== hidden ? state.secret : null;

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(secret ?? "");
      setCopy("done");
    } catch {
      secretRef.current?.select();
      setCopy("failed");
    }
  }

  return (
    <div>
      <h4 className="text-sm font-semibold text-charcoal-ink">{t("busops.partners.rotate.title", locale)}</h4>
      <p className="mt-1 text-sm text-charcoal-ink/70">{t("busops.partners.rotate.help", locale)}</p>
      {inGrace && !secret ? <p className="mt-2 text-sm text-charcoal-ink">{t("busops.partners.rotate.in_grace", locale)}</p> : null}
      <form action={action} className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end">
        <input type="hidden" name="endpoint_id" value={endpointId} />
        <label className="text-sm">
          {t("busops.partners.rotate.grace", locale)}
          <input name="grace_hours" type="number" min={1} max={168} defaultValue={24} required className={field} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input name="confirm" type="checkbox" required />
          {t("busops.partners.rotate.confirm", locale)}
        </label>
        <button type="submit" disabled={pending || inGrace} className={secondary}>
          {t("busops.partners.rotate.button", locale)}
        </button>
      </form>
      {state.status === "error" ? <Result state={state} locale={locale} /> : null}
      {secret ? (
        <div role="alert" className="mt-4 rounded-lg border border-amber-400 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-charcoal-ink">{t("busops.partners.rotate.done", locale)}</p>
          <input ref={secretRef} readOnly value={secret} aria-label={t("busops.partners.rotate.done", locale)} onFocus={(e) => e.currentTarget.select()} className={`${field} font-mono text-xs`} autoComplete="off" spellCheck={false} />
          <p className="mt-2 text-sm text-charcoal-ink">{t("busops.partners.rotate.once", locale)}</p>
          {state.graceEndsAt ? <p className="mt-1 text-sm text-charcoal-ink">{t("busops.partners.rotate.grace_ends", locale, { when: lagos(state.graceEndsAt) })}</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={copySecret} className={secondary}>{t("busops.partners.rotate.copy", locale)}</button>
            <button type="button" onClick={() => setHidden(secret)} className={primary}>{t("busops.partners.rotate.dismiss", locale)}</button>
            <span role="status" className="text-sm">
              {copy === "done" ? t("busops.partners.rotate.copied", locale) : copy === "failed" ? t("busops.partners.rotate.copy_failed", locale) : ""}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ReenableForm({ endpointId, locale }: { endpointId: string; locale: Locale }) {
  const [state, action, pending] = useActionState(reenablePartnerEndpointAction, IDLE);
  return (
    <div>
      <h4 className="text-sm font-semibold text-charcoal-ink">{t("busops.partners.enable.title", locale)}</h4>
      <p className="mt-1 text-sm text-charcoal-ink/70">{t("busops.partners.enable.help", locale)}</p>
      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="endpoint_id" value={endpointId} />
        <label className="block text-sm">
          {t("busops.partners.enable.reason", locale)}
          <textarea name="reason" required minLength={10} maxLength={300} rows={2} className={field} />
        </label>
        <button type="submit" disabled={pending} className={primary}>{t("busops.partners.enable.button", locale)}</button>
      </form>
      <Result state={state} locale={locale} />
    </div>
  );
}

export function MappingForm({
  eventOptions,
  partnerOptions,
  locale,
}: {
  eventOptions: { value: string; label: string }[];
  partnerOptions: string[];
  locale: Locale;
}) {
  const [state, action, pending] = useActionState(saveMappingAction, IDLE);
  return (
    <form action={action} className="space-y-3">
      <h3 className="text-sm font-semibold text-charcoal-ink">{t("busops.partners.mappings.form.title", locale)}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          {t("busops.partners.mappings.form.event", locale)}
          <select name="bus_event_type" required defaultValue="" className={field}>
            <option value="" disabled />
            {eventOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t("busops.partners.mappings.form.partner", locale)}
          <select name="integration_event_type" required defaultValue="" className={field}>
            <option value="" disabled />
            {partnerOptions.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-sm">
        {t("busops.partners.mappings.form.keys", locale)}
        <input name="id_keys" maxLength={600} className={field} placeholder="lab_result_id" autoComplete="off" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="confirm" type="checkbox" required />
        {t("busops.partners.mappings.form.confirm", locale)}
      </label>
      <button type="submit" disabled={pending} className={primary}>{t("busops.partners.mappings.form.save", locale)}</button>
      <Result state={state} locale={locale} />
    </form>
  );
}

export function RemoveMappingForm({ eventType, locale }: { eventType: string; locale: Locale }) {
  const [state, action, pending] = useActionState(removeMappingAction, IDLE);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="bus_event_type" value={eventType} />
      <label className="flex items-center gap-2 text-xs">
        <input name="confirm" type="checkbox" required />
        {t("busops.partners.mappings.remove_confirm", locale)}
      </label>
      <button type="submit" disabled={pending} className={secondary}>{t("busops.partners.mappings.remove", locale)}</button>
      <Result state={state} locale={locale} />
    </form>
  );
}
