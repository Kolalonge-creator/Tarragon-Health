"use client";

import { useState, useTransition } from "react";
import {
  CONSENT_DATA_TYPES,
  CONSENT_PURPOSES,
  bundleState,
  findCell,
  optionalOnCount,
  type ConsentCell,
  type ConsentDataType,
  type ConsentMatrix,
  type ConsentPurpose,
} from "@tarragon/shared";
import { t, type MessageKey } from "@tarragon/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  applyConsentBundleAction,
  setConsentCellAction,
  withdrawAllOptionalConsentsAction,
  type ConsentMatrixActionState,
} from "./consent-matrix-actions";

export interface ConsentHistoryItem {
  data_type: ConsentDataType;
  purpose: ConsentPurpose;
  action: "granted" | "withdrawn";
  at: string;
}

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });

const key = (k: string) => k as MessageKey;

/**
 * Consent matrix (v5 1.13, 1.15): data type x purpose. Simple view first (bundles), every cell in the advanced view.
 * Two taps to turn anything off: the first arms it, the second does it. A needed-for-care cell has no switch at all, only
 * the badge, and the database would refuse it anyway. The wording is a draft key set (OQ-49, OQ-296) and the panel says so.
 */
export function ConsentMatrixPanel({ matrix, history }: { matrix: ConsentMatrix; history: ConsentHistoryItem[] }) {
  const [advanced, setAdvanced] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<ConsentMatrixActionState>, okText?: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setArmed(null);
      if (result?.error) setMessage({ tone: "error", text: result.error });
      else if (okText) setMessage({ tone: "ok", text: okText });
    });
  }

  const optionalOn = optionalOnCount(matrix);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("consent.matrix.title")}</CardTitle>
        <CardDescription>{t("consent.matrix.intro")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("consent.draft_notice")}</p>

        {!advanced && (
          <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
            {matrix.bundles.map((bundle) => {
              const state = bundleState(matrix, bundle.code);
              const armKey = `bundle:${bundle.code}`;
              return (
                <li key={bundle.code} className="flex items-start justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{t(key(bundle.text_key))}</p>
                    <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t(key(`${bundle.text_key}.body`))}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={state === "on" ? "green" : state === "partial" ? "amber" : "grey"}>{t(key(`consent.bundle.state.${state}`))}</Badge>
                    {state !== "on" && (
                      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => applyConsentBundleAction({ code: bundle.code }))}>
                        {t("consent.matrix.turn_on")}
                      </Button>
                    )}
                    {state !== "off" &&
                      (armed === armKey ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
                            run(async () => {
                              // Switching a bundle off is switching each of its cells off, one decision each in the history.
                              for (const c of bundle.cells) {
                                const result = await setConsentCellAction({ dataType: c.data_type, purpose: c.purpose, granted: false });
                                if (result?.error) return result;
                              }
                              return { ok: true };
                            })
                          }
                        >
                          {t("consent.matrix.turn_off_confirm")}
                        </Button>
                      ) : (
                        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setArmed(armKey)}>
                          {t("consent.matrix.turn_off")}
                        </Button>
                      ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {advanced && (
          <div className="space-y-4">
            {CONSENT_DATA_TYPES.map((dataType) => (
              <fieldset key={dataType} className="space-y-1 rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
                <legend className="px-1 text-sm font-semibold text-charcoal-ink dark:text-night-ink">{t(key(`consent.data.${dataType}`))}</legend>
                <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
                  {CONSENT_PURPOSES.map((purpose) => {
                    const cell = findCell(matrix, dataType, purpose) as ConsentCell | undefined;
                    if (!cell) return null;
                    const armKey = `${dataType}:${purpose}`;
                    return (
                      <li key={armKey} className="flex items-start justify-between gap-3 py-2">
                        <div>
                          <p className="text-sm text-charcoal-ink dark:text-night-ink">{t(key(`consent.purpose.${purpose}`))}</p>
                          <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t(key(cell.text_key))}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {cell.required_for_care ? (
                            <Badge variant="blue">{t("consent.matrix.required")}</Badge>
                          ) : (
                            <>
                              <Badge variant={cell.granted ? "green" : "grey"}>{t(cell.granted ? "consent.matrix.on" : "consent.matrix.off")}</Badge>
                              {cell.granted ? (
                                armed === armKey ? (
                                  <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => setConsentCellAction({ dataType, purpose, granted: false }))}>
                                    {t("consent.matrix.turn_off_confirm")}
                                  </Button>
                                ) : (
                                  <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setArmed(armKey)}>
                                    {t("consent.matrix.turn_off")}
                                  </Button>
                                )
                              ) : (
                                <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => setConsentCellAction({ dataType, purpose, granted: true }))}>
                                  {t("consent.matrix.turn_on")}
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="text-xs font-medium text-charcoal-ink/70 underline underline-offset-2 hover:no-underline dark:text-night-ink/70"
            onClick={() => setAdvanced((v) => !v)}
          >
            {advanced ? t("consent.matrix.simple") : t("consent.matrix.advanced")}
          </button>
          {optionalOn > 0 &&
            (armed === "all" ? (
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => withdrawAllOptionalConsentsAction(), t("consent.matrix.essentials_only_done"))}>
                {t("consent.matrix.essentials_only_confirm")}
              </Button>
            ) : (
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setArmed("all")}>
                {t("consent.matrix.essentials_only")}
              </Button>
            ))}
        </div>
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("consent.matrix.care_unchanged")}</p>

        {message && (
          <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-sm text-red-700" : "text-sm text-charcoal-ink/80 dark:text-night-ink/80"}>
            {message.text}
          </p>
        )}

        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">{t("consent.matrix.history.title")}</summary>
          {history.length === 0 ? (
            <p className="mt-2 text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("consent.matrix.history.empty")}</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {history.map((h, i) => (
                <li key={`${h.at}-${i}`} className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">
                  {when(h.at)} · {t(h.action === "granted" ? "consent.matrix.history.granted" : "consent.matrix.history.withdrawn")} · {t(key(`consent.data.${h.data_type}`))}, {t(key(`consent.purpose.${h.purpose}`))}
                </li>
              ))}
            </ul>
          )}
        </details>
      </CardContent>
    </Card>
  );
}
