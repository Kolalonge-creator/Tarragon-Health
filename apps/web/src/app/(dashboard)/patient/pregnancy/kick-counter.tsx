"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { evaluateKickSession, kickCounterAvailable, kickResultForStorage, personalNormalMinutes, type KickEvaluation } from "@tarragon/clinical";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadMaternalConfig } from "@/lib/pregnancy/maternal-config";
import { useKickHistory, useSaveKickSession, type KickSessionRow } from "@/lib/queries/pregnancy-tools";
import { PregnancyActionCard } from "./pregnancy-action-card";

interface Session {
  startedAtMs: number;
  movementMs: number[];
  reportedLess: boolean;
}

/**
 * Baby movement counter (S67, spec 16.7). Decided on the screen from the PROPOSED config (same pure code as the phone and the tests), then
 * saved as one row. The only outcomes are keep counting, felt the movements, and the fixed "contact your care team today" card. It never
 * reassures and never advises holding off. If the save fails the card still shows: the advice does not depend on the save.
 */
export function KickCounter({
  patientId,
  organisationId,
  week,
  now = Date.now,
}: {
  patientId: string;
  organisationId: string;
  week: number | null;
  now?: () => number;
}) {
  const { config, version } = useMemo(() => loadMaternalConfig(), []);
  const history = useKickHistory(patientId);
  const save = useSaveKickSession();
  const [session, setSession] = useState<Session | null>(null);
  const [tick, setTick] = useState(() => now());
  const [final, setFinal] = useState<KickEvaluation | null>(null);
  // Set only once a save has succeeded, so a failed save can be tried again. One client id per session keeps a retry idempotent on the server.
  const savedRef = useRef(false);
  const finishedRef = useRef(false);
  const clientIdRef = useRef<string | null>(null);
  const [pendingRow, setPendingRow] = useState<KickSessionRow | null>(null);

  // A stopped session says nothing about her normal, so it takes no slot in the latest-sessions window (same as the phone).
  const normal = useMemo(
    () =>
      personalNormalMinutes(
        [...(history.data ?? [])].reverse().filter((h) => h.result !== "stopped").map((h) => ({ minutesToTarget: h.minutes_to_target })),
        config,
      ),
    [history.data, config],
  );

  useEffect(() => {
    if (!session || final) return;
    const id = setInterval(() => setTick(now()), 1000);
    return () => clearInterval(id);
  }, [session, final, now]);

  const live =
    session && !final
      ? evaluateKickSession({ startedAtMs: session.startedAtMs, movementMs: session.movementMs, reportedLess: session.reportedLess }, tick, normal, config)
      : null;

  function send(row: KickSessionRow) {
    save.mutate(row, {
      onSuccess: () => {
        savedRef.current = true;
        setPendingRow(null);
      },
      onError: () => setPendingRow(row),
    });
  }

  function finish(s: Session, at: number, evaluation: KickEvaluation) {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setFinal(evaluation);
    const result = kickResultForStorage(evaluation);
    clientIdRef.current = crypto.randomUUID();
    send({
      organisation_id: organisationId,
      patient_id: patientId,
      client_id: clientIdRef.current,
      started_at: new Date(s.startedAtMs).toISOString(),
      ended_at: new Date(at).toISOString(),
      movement_offsets_s: s.movementMs.map((m) => Math.max(0, Math.round((m - s.startedAtMs) / 1000))).slice(0, 200),
      reported_less: s.reportedLess,
      result,
      result_reason: result === "contact_today" ? evaluation.reason : null,
      minutes_to_target: evaluation.minutesToTarget === null ? null : Math.round(evaluation.minutesToTarget * 100) / 100,
      week_at_start: week,
      config_version: version,
      source: "patient",
    });
  }

  // A session that reaches a result ends itself.
  useEffect(() => {
    if (session && live && live.state !== "counting") finish(session, tick, live);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.state]);

  if (!kickCounterAvailable(week, config)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("preg.kick.title")}</CardTitle>
          <CardDescription>{t("preg.kick.not_yet")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  function start() {
    savedRef.current = false;
    finishedRef.current = false;
    setPendingRow(null);
    const at = now();
    setFinal(null);
    setTick(at);
    setSession({ startedAtMs: at, movementMs: [], reportedLess: false });
  }

  function tap() {
    if (!session || final) return;
    setSession({ ...session, movementMs: [...session.movementMs, now()] });
  }

  function lessMovement() {
    if (final) return;
    const at = now();
    const base: Session = session ?? { startedAtMs: at, movementMs: [], reportedLess: false };
    const next = { ...base, reportedLess: true };
    setSession(next);
    setTick(at);
    finish(next, at, evaluateKickSession({ startedAtMs: next.startedAtMs, movementMs: next.movementMs, reportedLess: true }, at, normal, config));
  }

  function stop() {
    if (!session || final) return;
    const at = now();
    finish(session, at, evaluateKickSession({ startedAtMs: session.startedAtMs, movementMs: session.movementMs, reportedLess: session.reportedLess }, at, normal, config));
  }

  const shown = final ?? live;
  const target = config.kicks.movementsTarget;
  const windowMinutes = config.kicks.windowMinutes;
  const resultText = (r: string): string =>
    r === "target_reached" ? t("preg.ui.kick.result_target_reached") : r === "contact_today" ? t("preg.ui.kick.result_contact_today") : t("preg.ui.kick.result_stopped");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("preg.kick.title")}</CardTitle>
        <CardDescription>{t("preg.kick.intro")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* The fixed card comes first when the result is "contact today": it does not depend on the save. */}
        {final?.state === "contact_today" && <PregnancyActionCard variant="contact_today" />}
        {final?.state === "target_reached" && <p role="status" className="text-sm">{t("preg.kick.done")}</p>}
        {final && kickResultForStorage(final) === "stopped" && <p role="status" className="text-sm">{t("preg.ui.kick.stopped")}</p>}

        {session && shown && !final && (
          <div className="space-y-2">
            <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{t("preg.ui.kick.how", "en", { window: windowMinutes, target })}</p>
            <p className="text-2xl font-semibold" aria-live="polite">{t("preg.ui.kick.count", "en", { count: shown.count, target })}</p>
            <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("preg.ui.kick.elapsed", "en", { minutes: Math.floor(shown.elapsedMinutes), window: windowMinutes })}</p>
          </div>
        )}

        {final && pendingRow && (
          <div className="space-y-2">
            <p role="status" className="text-sm">{t("preg.ui.kick.not_saved")}</p>
            <Button type="button" variant="outline" onClick={() => send(pendingRow)}>{t("preg.ui.kick.retry_save")}</Button>
          </div>
        )}
        {final && save.isSuccess && <p role="status" className="text-sm">{t("preg.ui.kick.saved")}</p>}

        <div className="flex flex-wrap gap-2">
          {!session || final ? (
            <Button type="button" onClick={start}>{final ? t("preg.ui.kick.new") : t("preg.kick.start")}</Button>
          ) : (
            <>
              <Button type="button" size="lg" onClick={tap}>{t("preg.kick.tap")}</Button>
              <Button type="button" variant="outline" onClick={stop}>{t("preg.ui.kick.stop")}</Button>
            </>
          )}
          {!final && <Button type="button" variant="outline" onClick={lessMovement}>{t("preg.kick.less")}</Button>}
        </div>

        {(history.data?.length ?? 0) > 0 && (
          <div>
            <h3 className="text-sm font-medium">{t("preg.ui.kick.history")}</h3>
            <ul className="mt-1 space-y-1 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
              {history.data!.slice(0, 5).map((h) => (
                <li key={h.started_at}>{new Date(h.started_at).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}: {resultText(h.result)}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
