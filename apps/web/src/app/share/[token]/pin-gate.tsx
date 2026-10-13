"use client";

import { useActionState } from "react";
import { t } from "@tarragon/i18n";
import { unlockShare, type UnlockState } from "./actions";
import { SharedRecordView } from "./shared-record-view";

function Unavailable() {
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-lg font-semibold text-charcoal-ink">This link is not available</h1>
      <p className="mt-2 text-sm text-charcoal-ink/70">{t("share.public.not_available")}</p>
    </main>
  );
}

export function PinGate({ token, needsPin }: { token: string; needsPin: boolean }) {
  const [state, action, pending] = useActionState(unlockShare.bind(null, token, needsPin), {
    status: "pin_required",
    attemptsLeft: null,
  } as UnlockState);

  if (state.status === "ok") return <SharedRecordView record={state.record} />;
  if (state.status === "unavailable") return <Unavailable />;
  const showPin = needsPin || (state.status === "pin_required" && state.needsPin === true);

  return (
    <main className="mx-auto max-w-md p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-tarragon-green">TarragonHealth</p>
      <h1 className="mt-1 text-lg font-semibold text-charcoal-ink">{showPin ? t("share.public.pin_title") : t("share.public.open_title")}</h1>
      <p className="mt-2 text-sm text-charcoal-ink/70">{showPin ? t("share.public.pin_help") : t("share.public.open_help")}</p>
      <form action={action} className="mt-4 space-y-3" autoComplete="off">
        {showPin ? (
          <>
            <label htmlFor="pin" className="block text-sm font-medium text-charcoal-ink">
              {t("share.public.pin_label")}
            </label>
            <input
              id="pin"
              name="pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={12}
              autoComplete="one-time-code"
              required
              className="w-full rounded-lg border border-charcoal-ink/20 px-3 py-2 text-lg tracking-widest"
            />
          </>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-tarragon-green px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? t("share.public.pin_checking") : t("share.public.pin_submit")}
        </button>
      </form>
      {state.status === "try_later" ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {t("share.public.try_later")}
        </p>
      ) : state.message === "format" ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {t("share.public.pin_format")}
        </p>
      ) : state.attemptsLeft !== null ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {t("share.public.pin_wrong", "en", { left: String(state.attemptsLeft) })}
        </p>
      ) : null}
    </main>
  );
}
