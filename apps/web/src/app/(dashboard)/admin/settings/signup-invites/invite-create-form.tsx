"use client";

import { useActionState } from "react";
import { t } from "@tarragon/i18n";
import { createInviteAction } from "@/lib/signup-invites/actions";
import { KINDS } from "@/lib/signup-invites/model";

const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";

export function InviteCreateForm() {
  const [state, action, pending] = useActionState(createInviteAction, undefined);
  return (
    <form action={action} className="grid gap-3 rounded-xl border border-charcoal-ink/10 p-3 sm:grid-cols-2">
      <label className="block text-xs text-charcoal-ink">
        {t("signupinv.kind")}
        <select name="kind" required defaultValue="phone" className={field}>
          {KINDS.map((k) => (
            <option key={k} value={k}>{t(`signupinv.kind.${k}`)}</option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-charcoal-ink">
        {t("signupinv.value")}
        <input name="value" maxLength={200} className={field} autoComplete="off" />
      </label>
      <label className="block text-xs text-charcoal-ink sm:col-span-2">
        {t("signupinv.label")}
        <input name="label" required minLength={3} maxLength={200} className={field} />
      </label>
      <label className="block text-xs text-charcoal-ink">
        {t("signupinv.max_uses")}
        <input name="maxUses" type="number" min={1} max={1000} defaultValue={1} className={field} />
      </label>
      <label className="block text-xs text-charcoal-ink">
        {t("signupinv.days")}
        <input name="days" type="number" min={1} max={365} defaultValue={30} className={field} />
      </label>
      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-brand-green px-3 py-1.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">
          {t("signupinv.create")}
        </button>
      </div>
      {state?.error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900 sm:col-span-2">{state.error}</p>}
      {state?.ok && (
        <div role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 sm:col-span-2">
          {state.code ? (
            <>
              <p>{t("signupinv.code_once")}</p>
              <p className="mt-1 select-all font-mono text-lg font-semibold tracking-widest">{state.code}</p>
            </>
          ) : (
            <p>{t("signupinv.notice.created")}</p>
          )}
        </div>
      )}
    </form>
  );
}
