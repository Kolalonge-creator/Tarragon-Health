"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ANCHOR_IDS, addDays, anchorBaseTime, lagosLocalDate, planDayShift, type AnchorId } from "@tarragon/medicines";
import { anchorTitle, t, type MessageKey } from "@tarragon/i18n";
import { doseAnchorConfig } from "@/lib/medication-schedule/anchor-profile";
import { useAnchors, useCreateDayShift, useEndDayShift, useSaveAnchorTimes } from "@/lib/queries/dose-anchors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/ui/form-error";

/**
 * "My day" (S08z): the time of each part of the day the patient ties a medicine to, and a "my day has shifted" control for a run of
 * dates (a month of fasting, a trip) that returns to the usual day by itself. Nothing is worked out from where the patient is or
 * from a calendar, and none of it is advice about when to take anything. The phone app has the same two things; both read and write
 * the same rows.
 */
export function MyDayCard({ patientId }: { patientId: string }) {
  const config = useMemo(() => doseAnchorConfig(), []);
  const { data: anchors, isLoading } = useAnchors(patientId);
  const save = useSaveAnchorTimes();
  const createShift = useCreateDayShift();
  const endShift = useEndDayShift();
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Partial<Record<AnchorId, string>>>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const today = lagosLocalDate(Date.now());

  const profile = anchors?.profile;
  const loadFailed = anchors !== undefined && !anchors.loaded;

  function submitTimes(event: FormEvent) {
    event.preventDefault();
    if (!profile) return;
    const changed: Partial<Record<AnchorId, string>> = {};
    for (const id of ANCHOR_IDS) {
      const draft = drafts[id];
      const confirmed = (profile.times[id] ?? []).length > 0;
      if (draft !== undefined && /^([01]\d|2[0-3]):[0-5]\d$/.test(draft) && (draft !== anchorBaseTime(profile, id) || !confirmed)) changed[id] = draft;
    }
    if (Object.keys(changed).length === 0) {
      setMessage({ kind: "ok", text: t("doseanchor.myday.saved_now") });
      return;
    }
    save.mutate(
      { patientId, times: changed },
      {
        onSuccess: (from) => {
          setDrafts({});
          setMessage({ kind: "ok", text: t(from > today ? "doseanchor.myday.saved_tomorrow" : "doseanchor.myday.saved_now") });
        },
        onError: (error) => {
          const overlap = (error as { code?: string }).code === "23514";
          setMessage({ kind: "error", text: overlap ? t("doseanchor.window_overlap") : t("doseanchor.myday.error") });
        },
      }
    );
  }

  const upcoming = (anchors?.shiftRows ?? [])
    .filter((s) => s.ends_on >= today && (s.cancelled_from === null || s.cancelled_from > today))
    .sort((a, b) => (a.starts_on < b.starts_on ? -1 : 1));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{t("doseanchor.myday.title")}</CardTitle>
        <Button type="button" variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? t("doseanchor.myday.hide") : t("doseanchor.myday.show")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">…</p> : null}
        {loadFailed ? (
          <p role="alert" className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
            {t("doseanchor.myday.error")}
          </p>
        ) : null}
        {upcoming.map((s) => (
          <div key={s.id} className="space-y-2">
            <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
              {s.starts_on <= today
                ? t("doseanchor.myday.shift_active", undefined, { date: s.ends_on })
                : t("doseanchor.myday.shift_upcoming", undefined, { from: s.starts_on, to: s.ends_on })}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={endShift.isPending}
              onClick={() => {
                if (!window.confirm(t("doseanchor.myday.shift_end_confirm"))) return;
                endShift.mutate(
                  { patientId, shiftId: s.id },
                  {
                    onSuccess: () => setMessage({ kind: "ok", text: t("doseanchor.myday.shift_ended") }),
                    onError: () => setMessage({ kind: "error", text: t("doseanchor.myday.error") }),
                  }
                );
              }}
            >
              {t("doseanchor.myday.shift_end")}
            </Button>
          </div>
        ))}
        {open && profile ? (
          <>
            <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("doseanchor.myday.intro")}</p>
            <form onSubmit={submitTimes} className="space-y-3" aria-label={t("doseanchor.myday.title")}>
              {ANCHOR_IDS.map((id) => {
                const confirmed = (profile.times[id] ?? []).length > 0;
                const base = anchorBaseTime(profile, id);
                return (
                  <div key={id} className="space-y-1">
                    <Label htmlFor={`anchor-${id}`}>{t("doseanchor.myday.time_label", undefined, { name: anchorTitle(id) })}</Label>
                    <Input
                      id={`anchor-${id}`}
                      type="time"
                      value={drafts[id] ?? base}
                      onChange={(event) => setDrafts((prev) => ({ ...prev, [id]: event.target.value }))}
                      aria-describedby={confirmed ? undefined : `anchor-${id}-hint`}
                    />
                    {!confirmed ? (
                      <p id={`anchor-${id}-hint`} className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                        {t("doseanchor.myday.not_set", undefined, { time: base })}
                      </p>
                    ) : null}
                  </div>
                );
              })}
              <Button type="submit" disabled={save.isPending}>
                {t("doseanchor.myday.save")}
              </Button>
            </form>
            <ShiftForm
              patientId={patientId}
              today={today}
              maxDays={config.maxShiftDays}
              choices={config.shiftOffsetChoices}
              pending={createShift.isPending}
              onSubmit={(input, onDone) =>
                createShift.mutate(
                  { patientId, ...input },
                  {
                    onSuccess: () => {
                      onDone();
                      setMessage({ kind: "ok", text: t("doseanchor.myday.shift_saved_now", undefined, { date: input.endsOn }) });
                    },
                    onError: (error) => {
                      const code = (error as { code?: string }).code;
                      setMessage({
                        kind: "error",
                        text: code === "22023" ? t("doseanchor.myday.shift_error_dates", undefined, { days: config.maxShiftDays }) : t("doseanchor.myday.error"),
                      });
                    },
                  }
                )
              }
            />
          </>
        ) : null}
        <FormError id="my-day-error" message={message?.kind === "error" ? message.text : null} />
        {message?.kind === "ok" ? (
          <p role="status" className="text-sm text-charcoal-ink dark:text-night-ink">
            {message.text}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ShiftForm({
  today,
  maxDays,
  choices,
  pending,
  onSubmit,
}: {
  patientId: string;
  today: string;
  maxDays: number;
  choices: readonly number[];
  pending: boolean;
  onSubmit: (input: { startsOn: string; endsOn: string; offsets: Partial<Record<AnchorId, number>> }, onDone: () => void) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 29));
  const [offsets, setOffsets] = useState<Partial<Record<AnchorId, number>>>({});
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {t("doseanchor.myday.shift_title")}
      </Button>
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    // The same planning rule the phone uses. The database applies its own rule on top (a start today moves to tomorrow when today
    // already has answers on the shifted anchors).
    const plan = planDayShift({ startsOn: from, endsOn: to, offsets }, today, false, maxDays);
    if (!plan.ok) {
      setError(
        plan.error === "offsets" ? t("doseanchor.myday.shift_error_none") : t("doseanchor.myday.shift_error_dates", undefined, { days: maxDays })
      );
      return;
    }
    setError(null);
    onSubmit({ startsOn: plan.startsOn, endsOn: plan.endsOn, offsets: plan.offsets }, () => {
      setOpen(false);
      setOffsets({});
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 border-t border-charcoal-ink/10 pt-3 dark:border-night-ink/15" aria-label={t("doseanchor.myday.shift_title")}>
      <h3 className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">{t("doseanchor.myday.shift_title")}</h3>
      <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("doseanchor.myday.shift_help")}</p>
      <div className="space-y-1">
        <Label htmlFor="shift-from">{t("doseanchor.myday.shift_from")}</Label>
        <Input id="shift-from" type="date" value={from} min={today} onChange={(event) => setFrom(event.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="shift-to">{t("doseanchor.myday.shift_to")}</Label>
        <Input id="shift-to" type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
      </div>
      {ANCHOR_IDS.map((id) => (
        <div key={id} className="space-y-1">
          <Label htmlFor={`shift-${id}`}>{t("doseanchor.myday.shift_move", undefined, { name: t(`doseanchor.name.${id}` as MessageKey) })}</Label>
          <Select
            id={`shift-${id}`}
            value={String(offsets[id] ?? 0)}
            onChange={(event) => setOffsets((prev) => ({ ...prev, [id]: Number(event.target.value) }))}
          >
            {choices.map((m) => (
              <option key={m} value={m}>
                {m === 0
                  ? t("doseanchor.myday.shift_no_move")
                  : m > 0
                    ? t("doseanchor.myday.shift_minutes_later", undefined, { minutes: m })
                    : t("doseanchor.myday.shift_minutes_earlier", undefined, { minutes: -m })}
              </option>
            ))}
          </Select>
        </div>
      ))}
      <FormError id="shift-error" message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {t("doseanchor.myday.shift_save")}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
          {t("doseanchor.myday.cancel")}
        </Button>
      </div>
    </form>
  );
}
