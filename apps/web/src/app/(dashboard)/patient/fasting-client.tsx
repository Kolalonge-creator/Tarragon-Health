"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { t } from "@tarragon/i18n";
import { fastingMessageKey, mayStartFast, type Fast } from "@tarragon/clinical/fasting-safety";
import { createClient } from "@/lib/supabase/client";
import { fetchFastingDetails } from "@/lib/fasting/details";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const FASTS: readonly Fast[] = ["ramadan", "lent"];
const KEY = "fasting-gate";

/**
 * Fasting and your health (S50b, 6.13). A safety answer for Ramadan and Lent, never a fasting feature: no timer, no schedule, and no sentence that
 * tells anyone to fast or to stop fasting. The answer is the database's (public.my_fasting_gate); any doubt shows the same "talk to your care team"
 * line. The only timing shown is the plan a clinician wrote and signed, in their words, with their name.
 */
export function FastingClient() {
  const [fast, setFast] = useState<Fast>("ramadan");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [failed, setFailed] = useState(false);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: [KEY, fast],
    queryFn: () => fetchFastingDetails(fast, null, null),
    staleTime: 30 * 1000,
  });
  const start = useMutation({
    mutationFn: async () => {
      const { error } = await createClient().rpc("start_fasting_plan", { p_fast: fast, p_starts_on: starts, p_ends_on: ends });
      if (error) throw new Error("not started");
    },
    onSuccess: () => {
      setFailed(false);
      return qc.invalidateQueries({ queryKey: [KEY] });
    },
    onError: () => setFailed(true),
  });
  const [endFailed, setEndFailed] = useState(false);
  const end = useMutation({
    mutationFn: async (reason: "finished" | "stopped_by_person") => {
      const { error } = await createClient().rpc("end_fasting_plan", { p_reason: reason });
      if (error) throw new Error("not ended");
    },
    onSuccess: () => {
      setEndFailed(false);
      return qc.invalidateQueries({ queryKey: [KEY] });
    },
    // A failure must be visible: a plan that looks ended but is not would stay on the care team's list and block a new one.
    onError: () => setEndFailed(true),
  });

  const d = q.data;
  const answer = d?.answer ?? { state: "unavailable" as const };
  const label = t(answer.state === "unavailable" ? "fasting.label.unavailable" : answer.decision === "may_fast_with_guidance" ? "fasting.label.may" : answer.decision === "needs_clinician_plan" ? "fasting.label.needs_plan" : "fasting.label.paused");
  const variant = answer.state === "ok" && answer.decision === "may_fast_with_guidance" ? "green" : "amber";

  return (
    <div className="space-y-6">
      <p className="text-sm text-charcoal-ink dark:text-night-ink">{t("fasting.intro")}</p>

      <div role="group" aria-label={t("fasting.fast_label")} className="flex flex-wrap gap-2">
        {FASTS.map((f) => (
          <Button key={f} type="button" variant={f === fast ? "default" : "outline"} className="min-h-11" aria-pressed={f === fast} onClick={() => setFast(f)}>
            {t(`fasting.fast.${f}`)}
          </Button>
        ))}
      </div>

      <Card role="status" aria-live="polite">
        <CardContent className="flex items-start gap-3 pt-6">
          {q.isLoading ? (
            <p className="text-sm">{t("fasting.loading")}</p>
          ) : (
            <>
              <Badge variant={variant}>{label}</Badge>
              <p className="text-sm text-charcoal-ink dark:text-night-ink">{t(fastingMessageKey(answer))}</p>
            </>
          )}
        </CardContent>
      </Card>

      {d && d.answer.state === "ok" ? (
        <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
          {d.calendar.status === "expected" ? t("fasting.calendar.expected", "en", { start: d.calendar.start, end: d.calendar.end }) : t("fasting.calendar.unknown")}
        </p>
      ) : null}

      {d && d.timingPlans.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("fasting.timing_plan.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {d.timingPlans.map((p) => (
              <div key={`${p.signedAt}-${p.validTo}`} className="space-y-1">
                <p className="whitespace-pre-line">{p.summary}</p>
                <p className="text-charcoal-ink/70">
                  {t("fasting.timing_plan.signed_by", "en", { name: p.signedByName ?? "your care team", date: p.signedAt.slice(0, 10), from: p.validFrom, to: p.validTo })}
                </p>
              </div>
            ))}
            <p className="text-charcoal-ink/70">{t("fasting.timing_plan.note")}</p>
          </CardContent>
        </Card>
      ) : null}

      {d?.plan ? (
        <Card>
          <CardContent className="space-y-3 pt-6 text-sm">
            <p>{t("fasting.plan.active", "en", { fast: t(`fasting.fast.${d.plan.fast}`), start: d.plan.startsOn, end: d.plan.endsOn })}</p>
            {d.planPaused ? <p role="alert">{t("fasting.plan.paused")}</p> : null}
            {endFailed ? <p role="alert" className="text-red-700">{t("fasting.plan.end_failed")}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="min-h-11" disabled={end.isPending} onClick={() => end.mutate("finished")}>
                {t("fasting.plan.finished")}
              </Button>
              <Button type="button" variant="outline" className="min-h-11" disabled={end.isPending} onClick={() => end.mutate("stopped_by_person")}>
                {t("fasting.plan.stopped")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : mayStartFast(answer) ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("fasting.start.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                start.mutate();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="fast-start">{t("fasting.start.starts")}</Label>
                  <Input id="fast-start" type="date" required value={starts} onChange={(e) => setStarts(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fast-end">{t("fasting.start.ends")}</Label>
                  <Input id="fast-end" type="date" required min={starts || undefined} value={ends} onChange={(e) => setEnds(e.target.value)} />
                </div>
              </div>
              {failed ? <p role="alert" className="text-sm text-red-700">{t("fasting.start.failed")}</p> : null}
              {start.isSuccess && !failed ? <p role="status" className="text-sm text-green-800">{t("fasting.start.done")}</p> : null}
              <Button type="submit" className="min-h-11" disabled={start.isPending || !starts || !ends}>
                {t("fasting.start.button")}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-2 text-sm">
        <Link href="/patient/messages" className="inline-flex min-h-11 items-center text-brand-green underline hover:no-underline dark:text-brand-green-bright">
          {t("fasting.message_team")}
        </Link>
        <p>{t("fasting.emergency")}</p>
        <p className="text-charcoal-ink/70">{t("fasting.disclaimer")}</p>
      </div>
    </div>
  );
}
