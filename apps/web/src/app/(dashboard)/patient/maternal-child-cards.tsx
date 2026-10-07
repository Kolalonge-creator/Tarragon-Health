"use client";

import { useState } from "react";
import { t } from "@tarragon/i18n";
import { availableLifecycleKinds, retentionRules, TRACKER_DELETION_SCOPES, type LifecycleKind, type TrackerDeletionScope } from "@tarragon/shared";
import {
  useBabyChecks, useFeedLog, useLogFeed, useMyLifecycle, useRecordLifecycleEvent, useSaveBabyCheck, useTrackerDeletionActions, useTrackerDeletions,
  type BabyCheckRow, type FeedLogRow,
} from "@/lib/queries/maternal-child";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPatientDate } from "@/lib/format-date";

const KIND_KEY: Record<LifecycleKind, Parameters<typeof t>[0]> = {
  start_trying: "mch.life.act_start_trying",
  stop_trying: "mch.life.act_stop_trying",
  pregnancy_confirmed: "mch.life.act_pregnancy_confirmed",
  delivery_recorded: "mch.life.act_delivery_recorded",
  pregnancy_loss_recorded: "mch.life.act_pregnancy_loss_recorded",
  postnatal_period_ended: "mch.life.act_postnatal_period_ended",
  parenting_ended: "mch.life.act_parenting_ended",
};
const STAGE_KEY = {
  tracking: "mch.life.stage_tracking", trying: "mch.life.stage_trying", pregnant: "mch.life.stage_pregnant", postnatal: "mch.life.stage_postnatal", parenting: "mch.life.stage_parenting",
} as const;
const today = () => new Date().toISOString().slice(0, 10);

/** Where you are now (16.11). Nothing here moves a stage on its own: every button is a person confirming something that happened. */
export function LifecycleCard() {
  const life = useMyLifecycle();
  const record = useRecordLifecycleEvent();
  const [pending, setPending] = useState<LifecycleKind | null>(null);
  const [date, setDate] = useState(today());
  if (!life.data) return null;
  const stage = life.data.stage;
  const kinds = availableLifecycleKinds(stage);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("mch.life.title")}</CardTitle>
        <CardDescription>{t("mch.life.intro")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm font-medium">{t(STAGE_KEY[stage])}</p>
        {life.data.baby_content_hidden && <p className="text-sm">{t("mch.life.loss_note")}</p>}
        {pending === null ? (
          <div className="flex flex-wrap gap-2">
            {kinds.map((k) => (
              <Button key={k} variant="outline" onClick={() => setPending(k)}>{t(KIND_KEY[k])}</Button>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm">{t("mch.life.only_what_happened")}</p>
            <Label htmlFor="life_date">{t("mch.life.confirm_date")}</Label>
            <Input id="life_date" type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
            {record.isError && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{record.error.message === "not_open" ? t("mch.life.not_open") : t("mch.life.unavailable")}</p>}
            <div className="flex gap-2">
              <Button disabled={record.isPending} onClick={() => record.mutate({ kind: pending, occurredOn: date }, { onSuccess: () => setPending(null) })}>{t("mch.life.confirm")}</Button>
              <Button variant="ghost" onClick={() => setPending(null)}>{t("common.cancel")}</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const FEED_TYPES: { value: FeedLogRow["feed_type"]; key: Parameters<typeof t>[0] }[] = [
  { value: "breast_left", key: "mch.feed.type_breast_left" }, { value: "breast_right", key: "mch.feed.type_breast_right" },
  { value: "both_breasts", key: "mch.feed.type_both_breasts" }, { value: "expressed_milk", key: "mch.feed.type_expressed_milk" },
  { value: "formula", key: "mch.feed.type_formula" }, { value: "other", key: "mch.feed.type_other" },
];

/** Breastfeeding feed log (16.9). Support content is a placeholder until the CMO approves text, so only a calm line shows. */
export function FeedLogCard({ patientId, organisationId }: { patientId: string; organisationId: string | null }) {
  const feeds = useFeedLog(patientId);
  const log = useLogFeed(patientId);
  const [feedType, setFeedType] = useState<FeedLogRow["feed_type"]>("breast_left");
  const [minutes, setMinutes] = useState("");
  const [ml, setMl] = useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("mch.feed.title")}</CardTitle>
        <CardDescription>{t("mch.feed.intro")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!organisationId) return;
            log.mutate({ organisationId, feedType, durationMinutes: minutes ? Number(minutes) : null, amountMl: ml ? Number(ml) : null }, { onSuccess: () => { setMinutes(""); setMl(""); } });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="feed_type">{t("mch.feed.type_label")}</Label>
            <select id="feed_type" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={feedType} onChange={(e) => setFeedType(e.target.value as FeedLogRow["feed_type"])}>
              {FEED_TYPES.map((o) => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="feed_min">{t("mch.feed.minutes_label")}</Label><Input id="feed_min" type="number" min="0" max="180" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="feed_ml">{t("mch.feed.ml_label")}</Label><Input id="feed_ml" type="number" min="0" max="500" value={ml} onChange={(e) => setMl(e.target.value)} /></div>
          <div className="sm:col-span-3">
            {log.isError && <p role="alert" className="mb-2 text-sm text-red-600 dark:text-red-300">{log.error.message === "not_open" ? t("mch.feed.not_open") : t("mch.life.unavailable")}</p>}
            <Button type="submit" disabled={log.isPending || !organisationId}>{t("mch.feed.save")}</Button>
          </div>
        </form>
        {feeds.data && feeds.data.length === 0 && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{t("mch.feed.empty")}</p>}
        <ul className="space-y-1 text-sm">
          {(feeds.data ?? []).slice(0, 8).map((f) => (
            <li key={f.id}>{formatPatientDate(f.fed_at, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}: {t(FEED_TYPES.find((o) => o.value === f.feed_type)?.key ?? "mch.feed.type_other")}{f.duration_minutes ? `, ${f.duration_minutes} min` : ""}</li>
          ))}
        </ul>
        <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{t("mch.feed.support_pending")}</p>
      </CardContent>
    </Card>
  );
}

/** Baby week 1 and week 6 checks (16.9). Rows are generated from the delivery; the person only fills them in. */
export function BabyChecksCard({ patientId }: { patientId: string }) {
  const checks = useBabyChecks(patientId);
  const save = useSaveBabyCheck(patientId);
  const [open, setOpen] = useState<string | null>(null);
  const [weight, setWeight] = useState("");
  const [method, setMethod] = useState<NonNullable<BabyCheckRow["feeding_method"]>>("breast_only");
  const [concern, setConcern] = useState(false);
  if (!checks.data || checks.data.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle>{t("mch.baby.title")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {checks.data.map((c) => (
          <div key={c.id} className="space-y-2">
            <p className="text-sm font-medium">
              {t(c.check_window === "week_1" ? "mch.baby.week_1" : "mch.baby.week_6")}{" "}
              <span className="font-normal text-charcoal-ink/60 dark:text-night-ink/60">{c.completed_at ? t("mch.baby.done") : c.scheduled_date ? t("mch.baby.due", "en", { date: formatPatientDate(c.scheduled_date, { month: "short", day: "numeric" }) }) : ""}</span>
            </p>
            {!c.completed_at && open !== c.id && <Button variant="outline" onClick={() => setOpen(c.id)}>{t("mch.baby.save")}</Button>}
            {open === c.id && (
              <div className="space-y-2">
                <Label htmlFor={`bw_${c.id}`}>{t("mch.baby.weight_label")}</Label>
                <Input id={`bw_${c.id}`} type="number" step="0.01" min="0.5" max="25" value={weight} onChange={(e) => setWeight(e.target.value)} />
                <Label htmlFor={`bm_${c.id}`}>{t("mch.baby.feeding_label")}</Label>
                <select id={`bm_${c.id}`} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                  <option value="breast_only">{t("mch.baby.feeding_breast_only")}</option>
                  <option value="breast_and_other">{t("mch.baby.feeding_breast_and_other")}</option>
                  <option value="formula_only">{t("mch.baby.feeding_formula_only")}</option>
                  <option value="other">{t("mch.baby.feeding_other")}</option>
                </select>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={concern} onChange={(e) => setConcern(e.target.checked)} />{t("mch.baby.concerns_label")}</label>
                <Button disabled={save.isPending} onClick={() => save.mutate({ id: c.id, weightKg: weight ? Number(weight) : null, feedingMethod: method, concernsNoted: concern }, { onSuccess: () => setOpen(null) })}>{t("mch.baby.save")}</Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const SCOPE_KEY: Record<TrackerDeletionScope, Parameters<typeof t>[0]> = {
  feed_log: "mch.delete.scope_feed_log", child_growth: "mch.delete.scope_child_growth", baby_checks: "mch.delete.scope_baby_checks", pregnancy_loss: "mch.delete.scope_pregnancy_loss",
};

/** Delete what you entered (decision B3): request, grace window, complete, with a receipt. Sealed rows are kept and the receipt says how many. */
export function TrackerDeletionCard({ patientId }: { patientId: string }) {
  const rows = useTrackerDeletions(patientId);
  const act = useTrackerDeletionActions(patientId);
  const graceDays = retentionRules().graceDays;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("mch.delete.title")}</CardTitle>
        <CardDescription>{t("mch.delete.body", "en", { days: String(graceDays) })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {TRACKER_DELETION_SCOPES.filter((s) => s !== "child_growth").map((scope) => {
          const pending = (rows.data ?? []).find((r) => r.scope === scope && r.status === "pending");
          const due = pending ? new Date(pending.execute_after) <= new Date() : false;
          return (
            <div key={scope} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-40">{t(SCOPE_KEY[scope])}</span>
              {!pending && <Button variant="outline" onClick={() => act.request.mutate({ scope })}>{t("mch.delete.request")}</Button>}
              {pending && !due && <span>{t("mch.delete.pending", "en", { date: formatPatientDate(pending.execute_after, { month: "short", day: "numeric" }) })}</span>}
              {pending && due && <Button onClick={() => act.complete.mutate(pending.id)}>{t("mch.delete.complete")}</Button>}
              {pending && <Button variant="ghost" onClick={() => act.cancel.mutate(pending.id)}>{t("mch.delete.cancel")}</Button>}
            </div>
          );
        })}
        {(rows.data ?? []).filter((r) => r.status === "executed").slice(0, 3).map((r) => (
          <p key={r.id} className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            {t(SCOPE_KEY[r.scope as TrackerDeletionScope])}: {t("mch.delete.receipt", "en", { deleted: String(r.rows_deleted ?? 0), kept: String(r.rows_sealed_kept ?? 0) })}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}
