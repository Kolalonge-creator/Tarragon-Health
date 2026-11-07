"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSlaSettings, useSlaSettingsAction, type SlaPolicy } from "@/lib/queries/support-desk";
import { PRIORITY_LABEL, formatMinutes, type Priority } from "@/lib/support-desk/model";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const PRIORITIES: Priority[] = ["urgent", "high", "normal", "low"];
const field = "rounded-md border border-charcoal-ink/15 bg-white px-2 py-1.5 text-sm dark:border-night-ink/20 dark:bg-transparent";

function describeTarget(minutes: number | null, clock: string) {
  if (minutes === null) return "Assessed individually";
  return clock === "business" ? `${formatMinutes(minutes)} of staffed time` : formatMinutes(minutes);
}

function PolicyEditor({ p, onDone }: { p: SlaPolicy; onDone: () => void }) {
  const act = useSlaSettingsAction();
  const [clock, setClock] = useState(p.clock);
  const [first, setFirst] = useState(String(p.first_response_minutes));
  const [resolution, setResolution] = useState(p.resolution_minutes === null ? "" : String(p.resolution_minutes));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="mt-2 flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const f = Number(first);
        const r = resolution.trim() === "" ? null : Number(resolution);
        if (!Number.isInteger(f) || f <= 0 || (r !== null && (!Number.isInteger(r) || r <= 0))) {
          setError("Targets are whole minutes above zero.");
          return;
        }
        try {
          await act.mutateAsync({ kind: "policy", priority: p.priority, clock, firstResponseMinutes: f, resolutionMinutes: r, changeNote: note });
          onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not save.");
        }
      }}
    >
      <label className="flex flex-col text-xs text-charcoal-ink/60">
        Clock
        <select className={field} value={clock} onChange={(e) => setClock(e.target.value)}>
          <option value="business">Staffed hours</option>
          <option value="calendar">Around the clock</option>
        </select>
      </label>
      <label className="flex flex-col text-xs text-charcoal-ink/60">
        First reply (minutes)
        <input className={`${field} w-28`} inputMode="numeric" value={first} onChange={(e) => setFirst(e.target.value)} />
      </label>
      <label className="flex flex-col text-xs text-charcoal-ink/60">
        Resolve (minutes, blank = individually)
        <input className={`${field} w-28`} inputMode="numeric" value={resolution} onChange={(e) => setResolution(e.target.value)} />
      </label>
      <label className="flex min-w-[16rem] flex-1 flex-col text-xs text-charcoal-ink/60">
        Why it is changing
        <input required minLength={10} className={field} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <Button type="submit" size="sm" disabled={act.isPending || note.trim().length < 10}>
        Save new version
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
      {error && <p role="alert" className="basis-full text-sm text-red-700">{error}</p>}
    </form>
  );
}

/** SUP-3 targets, staffed hours and public holidays. Anyone on the desk can read them; a support lead changes them. */
export function SlaSettings({ me, isLead }: { me: string; isLead: boolean }) {
  const q = useSlaSettings();
  const act = useSlaSettingsAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayName, setHolidayName] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (q.isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (q.isError || !q.data) return <p role="alert" className="text-sm text-red-700">Settings could not be loaded.</p>;
  const { policies, hours, holidays } = q.data;
  const active = (pr: string) => policies.find((p) => p.priority === pr && p.is_active);
  const history = policies.filter((p) => !p.is_active);
  const run = (input: Parameters<typeof act.mutateAsync>[0]) =>
    act.mutateAsync(input).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not save."));

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <Card>
        <CardHeader>
          <CardTitle>Service targets</CardTitle>
          <CardDescription>
            Internal targets, not a promise to customers. A change is saved as a new version with a reason; earlier versions stay below. Clinical items follow the clinical escalation targets instead.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {PRIORITIES.map((pr) => {
            const p = active(pr);
            if (!p) return <p key={pr} className="text-sm text-red-700">No active target for {PRIORITY_LABEL[pr]}.</p>;
            return (
              <div key={pr} className="rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{PRIORITY_LABEL[pr]}</p>
                  <Badge variant="grey">Version {p.version}</Badge>
                </div>
                <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
                  First reply: {describeTarget(p.first_response_minutes, p.clock)}. Resolve: {describeTarget(p.resolution_minutes, p.clock)}.
                </p>
                <p className="text-xs text-charcoal-ink/55 dark:text-night-ink/55">{p.change_note}</p>
                {isLead && editing !== p.id && (
                  <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => setEditing(p.id)}>
                    Change
                  </Button>
                )}
                {editing === p.id && <PolicyEditor p={p} onDone={() => setEditing(null)} />}
              </div>
            );
          })}
          {history.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-charcoal-ink/70">Earlier versions ({history.length})</summary>
              <ul className="mt-2 space-y-1">
                {history.map((h) => (
                  <li key={h.id}>
                    {PRIORITY_LABEL[h.priority as Priority]} v{h.version}: first reply {describeTarget(h.first_response_minutes, h.clock)}, resolve{" "}
                    {describeTarget(h.resolution_minutes, h.clock)}. {h.change_note}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Staffed hours</CardTitle>
          <CardDescription>Lagos time. The business-hours clock only runs while the desk is staffed.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {DAYS.map((d, idx) => {
              const wd = idx + 1;
              const h = hours.find((x) => x.weekday === wd);
              return (
                <li key={d} className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="w-24 font-medium">{d}</span>
                  {isLead ? (
                    <HoursRow
                      opens={h?.opens.slice(0, 5) ?? null}
                      closes={h?.closes.slice(0, 5) ?? null}
                      onSave={(opens, closes) => run({ kind: "hours", weekday: wd, opens, closes, updatedBy: me })}
                    />
                  ) : (
                    <span>{h ? `${h.opens.slice(0, 5)} to ${h.closes.slice(0, 5)}` : "Closed"}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Public holidays</CardTitle>
          <CardDescription>
            The desk is closed on these days. Eid al-Fitr, Eid al-Adha and Mawlid are declared close to the date: add each one when the Federal Government announces it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-1 text-sm">
            {holidays.map((h) => (
              <li key={h.holiday_date} className="flex items-center gap-3">
                <span className="w-28 tabular-nums">{h.holiday_date}</span>
                <span className="flex-1">{h.name}</span>
                {isLead && (
                  <button type="button" className="text-sm text-charcoal-ink/60 underline-offset-2 hover:underline" onClick={() => run({ kind: "remove_holiday", date: h.holiday_date })}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          {isLead && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                await run({ kind: "add_holiday", date: holidayDate, name: holidayName, createdBy: me });
                setHolidayDate("");
                setHolidayName("");
              }}
            >
              <label className="flex flex-col text-xs text-charcoal-ink/60">
                Date
                <input type="date" required className={field} value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} />
              </label>
              <label className="flex flex-col text-xs text-charcoal-ink/60">
                Name
                <input required minLength={3} className={field} value={holidayName} onChange={(e) => setHolidayName(e.target.value)} />
              </label>
              <Button type="submit" size="sm" variant="outline" disabled={act.isPending}>
                Add holiday
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function HoursRow({ opens, closes, onSave }: { opens: string | null; closes: string | null; onSave: (o: string | null, c: string | null) => void }) {
  const [o, setO] = useState(opens ?? "");
  const [c, setC] = useState(closes ?? "");
  const dirty = o !== (opens ?? "") || c !== (closes ?? "");
  return (
    <span className="flex flex-wrap items-center gap-2">
      <input type="time" aria-label="Opens" className={field} value={o} onChange={(e) => setO(e.target.value)} />
      <span>to</span>
      <input type="time" aria-label="Closes" className={field} value={c} onChange={(e) => setC(e.target.value)} />
      {dirty && (
        <Button type="button" size="sm" variant="outline" disabled={(o === "") !== (c === "") || (o !== "" && c <= o)} onClick={() => onSave(o || null, c || null)}>
          Save
        </Button>
      )}
      {!o && !c && <span className="text-charcoal-ink/55">Closed</span>}
    </span>
  );
}
