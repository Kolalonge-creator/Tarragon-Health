"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  contractionCard,
  contractionTimings,
  evaluateContractions,
  INSTANT_GO_SIGNS,
  type BirthPlanFlags,
  type Contraction,
  type ContractionEvaluation,
  type InstantGoSign,
} from "@tarragon/clinical";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadMaternalConfig } from "@/lib/pregnancy/maternal-config";
import { useSaveContractionSession } from "@/lib/queries/pregnancy-tools";
import { PregnancyActionCard } from "./pregnancy-action-card";

const SIGN_KEY: Record<InstantGoSign, Parameters<typeof t>[0]> = {
  waters_break: "preg.contractions.sign.waters_break",
  vaginal_bleeding: "preg.contractions.sign.vaginal_bleeding",
  reduced_fetal_movement: "preg.contractions.sign.reduced_fetal_movement",
  fit: "preg.contractions.sign.fit",
  severe_headache: "preg.contractions.sign.severe_headache",
};

/**
 * Contraction timer (S67, spec 16.7). Tap when one starts, tap when it stops. The answer is "go now" (a fixed card) or "keep timing": never
 * "wait". 5-1-1 by default, 7-1-1 when the birth plan says a later birth, a previous fast labour or a long journey. A go-now result is
 * saved at once (a sign or before-term result also raises the care-team alert on the server).
 */
export function ContractionTimer({
  patientId,
  organisationId,
  week,
  flags,
  planUnavailable = false,
  now = Date.now,
}: {
  patientId: string;
  organisationId: string;
  week: number | null;
  flags: BirthPlanFlags | null;
  /** The birth plan could not be read, so the standard pattern is in use instead of the plan's earlier one. */
  planUnavailable?: boolean;
  now?: () => number;
}) {
  const { config, version } = useMemo(() => loadMaternalConfig(), []);
  const save = useSaveContractionSession();
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [contractions, setContractions] = useState<Contraction[]>([]);
  const [signs, setSigns] = useState<InstantGoSign[]>([]);
  const [tick, setTick] = useState(() => now());
  const [finished, setFinished] = useState(false);
  // Set only after a save really succeeded; a failed save is retried. One client id per session, so a retry is idempotent on the server.
  const savedRef = useRef(false);
  const inFlightRef = useRef(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const clientIdRef = useRef<string | null>(null);
  // The first "go now" of a session is kept for the rest of it. The rule only counts a run when the NEWEST contraction is long enough, so
  // the moment the next one starts (zero seconds long) the live answer would flip back to "keep timing" and the card would vanish.
  const [latched, setLatched] = useState<ContractionEvaluation | null>(null);

  useEffect(() => {
    if (startedAtMs === null || finished) return;
    const id = setInterval(() => setTick(now()), 1000);
    return () => clearInterval(id);
  }, [startedAtMs, finished, now]);

  const live = evaluateContractions(contractions, { week, signs, flags }, tick, config);
  if (live.state === "go_now" && latched === null) setLatched(live);
  const evaluation = latched ?? live;
  const card = contractionCard(evaluation);
  const rule = evaluation.pattern === "earlier" ? config.contractions.earlier : config.contractions.standard;
  const running = contractions.length > 0 && contractions[contractions.length - 1]!.endMs === null;

  function persist(at: number, known?: ContractionEvaluation) {
    if (savedRef.current || inFlightRef.current || startedAtMs === null) return;
    inFlightRef.current = true;
    setSaveFailed(false);
    clientIdRef.current ??= crypto.randomUUID();
    const final = known ?? latched ?? evaluateContractions(contractions, { week, signs, flags }, at, config);
    save.mutate(
      {
      organisation_id: organisationId,
      patient_id: patientId,
      client_id: clientIdRef.current,
      started_at: new Date(startedAtMs).toISOString(),
      timings: contractionTimings(contractions, startedAtMs, at),
      instant_signs: [...signs],
      pattern: final.pattern,
      result: final.state,
      result_reason: final.state === "go_now" ? final.reason : null,
      week_at_start: week,
      config_version: version,
      source: "patient",
      },
      {
        onSuccess: () => {
          savedRef.current = true;
          inFlightRef.current = false;
          setSaveFailed(false);
        },
        onError: () => {
          inFlightRef.current = false;
          setSaveFailed(true);
        },
      },
    );
  }

  // The first time the answer is "go now", save the session so the care team hears about it.
  useEffect(() => {
    if (live.state === "go_now" && !finished) persist(tick, latched ?? live);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.state]);

  function toggle() {
    const at = now();
    setTick(at);
    if (startedAtMs === null) setStartedAtMs(at);
    if (running) {
      setContractions((cs) => cs.map((c, i) => (i === cs.length - 1 ? { ...c, endMs: at } : c)));
    } else {
      setContractions((cs) => [...cs, { startMs: at, endMs: null }]);
    }
  }

  function toggleSign(sign: InstantGoSign) {
    if (startedAtMs === null) setStartedAtMs(now());
    setSigns((s) => (s.includes(sign) ? s.filter((x) => x !== sign) : [...s, sign]));
  }

  function finish() {
    const at = now();
    setFinished(true);
    persist(at);
  }

  function reset() {
    savedRef.current = false;
    inFlightRef.current = false;
    clientIdRef.current = null;
    setSaveFailed(false);
    setLatched(null);
    setStartedAtMs(null);
    setContractions([]);
    setSigns([]);
    setFinished(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("preg.contractions.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {card === "go_now_sign" && <PregnancyActionCard variant="go_now" />}
        {card === "go_now_pattern" && <PregnancyActionCard variant="go_now" extra={t("preg.ui.contractions.pattern_body")} />}
        {card === "none" && contractions.length > 0 && !finished && <p role="status" className="text-sm">{t("preg.contractions.keep")}</p>}
        {planUnavailable && <p role="status" className="text-sm">{t("preg.ui.contractions.plan_unavailable")}</p>}
        {evaluation.needsGestation && <p className="text-sm">{t("preg.contractions.needs_due_date")}</p>}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("preg.ui.contractions.signs_title")}</legend>
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("preg.ui.contractions.signs_hint")}</p>
          {INSTANT_GO_SIGNS.map((sign) => (
            <label key={sign} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={signs.includes(sign)} onChange={() => toggleSign(sign)} disabled={finished} />
              {t(SIGN_KEY[sign])}
            </label>
          ))}
        </fieldset>

        {!finished && (
          <>
            <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{t("preg.ui.contractions.timing_hint")}</p>
            <Button type="button" size="lg" onClick={toggle}>{running ? t("preg.contractions.stop") : t("preg.contractions.start")}</Button>
          </>
        )}

        {contractions.length > 0 && (
          <div className="space-y-1 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
            <p>{t("preg.ui.contractions.count", "en", { count: contractions.length })}</p>
            {evaluation.gapsMinutes.length > 0 && <p>{t("preg.ui.contractions.gaps", "en", { gaps: evaluation.gapsMinutes.join(", ") })}</p>}
            <p>
              {t(evaluation.pattern === "earlier" ? "preg.ui.contractions.pattern_earlier" : "preg.ui.contractions.pattern_standard", "en", {
                interval: rule.intervalMinutes,
                seconds: rule.durationSeconds,
                sustained: rule.sustainedMinutes,
              })}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {startedAtMs !== null && !finished && <Button type="button" variant="outline" onClick={finish}>{t("preg.ui.contractions.finish")}</Button>}
          {finished && <Button type="button" onClick={reset}>{t("preg.ui.contractions.new")}</Button>}
        </div>
        {save.isSuccess && <p role="status" className="text-sm">{t("preg.ui.contractions.saved")}</p>}
        {saveFailed && (
          <div className="space-y-2">
            <p role="status" className="text-sm">{t("preg.ui.contractions.not_saved")}</p>
            <Button type="button" variant="outline" onClick={() => persist(now())}>{t("preg.ui.kick.retry_save")}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
