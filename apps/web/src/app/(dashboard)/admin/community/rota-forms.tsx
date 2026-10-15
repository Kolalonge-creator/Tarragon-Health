"use client";

import { useId, useState } from "react";
import { ActionForm } from "./action-form";
import { SHIFT_LIMIT, WEEKDAYS, type ShiftRow } from "./ops-schemas";
import { setShiftsAction } from "./ops-actions";
import { btnQuiet, field, help, label } from "./ui";

const hourText = (h: number) => (h === 24 ? "24:00 (midnight)" : `${String(h).padStart(2, "0")}:00`);
const START_HOURS = Array.from({ length: 24 }, (_, i) => i);
const END_HOURS = Array.from({ length: 24 }, (_, i) => i + 1);

/** Replaces all the shifts of one grant. Times are Africa/Lagos. Weekday 0 is Monday. */
export function ShiftsForm({ staffId, who, initial }: { staffId: string; who: string; initial: ShiftRow[] }) {
  const uid = useId();
  const [rows, setRows] = useState<ShiftRow[]>(initial);
  const [nightDay, setNightDay] = useState(0);
  const [nightStart, setNightStart] = useState(22);
  const [nightEnd, setNightEnd] = useState(6);
  const [note, setNote] = useState<string | null>(null);

  const full = rows.length >= SHIFT_LIMIT;

  function update(i: number, patch: Partial<ShiftRow>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function addRow() {
    if (full) return setNote(`A person can have at most ${SHIFT_LIMIT} shifts.`);
    setNote(null);
    setRows((r) => [...r, { weekday: 0, start_hour: 8, end_hour: 16 }]);
  }

  function addOvernight() {
    if (rows.length + 2 > SHIFT_LIMIT) return setNote(`A person can have at most ${SHIFT_LIMIT} shifts.`);
    setNote(`Added ${WEEKDAYS[nightDay]} ${hourText(nightStart)} to midnight, and ${WEEKDAYS[(nightDay + 1) % 7]} midnight to ${hourText(nightEnd)}.`);
    setRows((r) => [
      ...r,
      { weekday: nightDay, start_hour: nightStart, end_hour: 24 },
      { weekday: (nightDay + 1) % 7, start_hour: 0, end_hour: nightEnd },
    ]);
  }

  function everyday() {
    setNote("Filled every day, 24 hours. Save to keep it.");
    setRows(WEEKDAYS.map((_, weekday) => ({ weekday, start_hour: 0, end_hour: 24 })));
  }

  return (
    <ActionForm action={setShiftsAction} submitLabel="Save shifts" pendingLabel="Saving..." confirm={`Replace all of the shifts for ${who}?`}>
      <input type="hidden" name="staff_id" value={staffId} />
      <input type="hidden" name="shifts" value={JSON.stringify(rows)} />

      {rows.length === 0 ? (
        <p className="text-sm text-charcoal-ink">No shifts yet. Saving with no shifts means this person is not on the rota.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-charcoal-ink/15 p-2">
              <div>
                <label htmlFor={`${uid}-d${i}`} className={label}>Day</label>
                <select id={`${uid}-d${i}`} value={row.weekday} onChange={(e) => update(i, { weekday: Number(e.target.value) })} className={field}>
                  {WEEKDAYS.map((d, wd) => <option key={d} value={wd}>{d}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={`${uid}-s${i}`} className={label}>From</label>
                <select id={`${uid}-s${i}`} value={row.start_hour} onChange={(e) => update(i, { start_hour: Number(e.target.value) })} className={field}>
                  {START_HOURS.map((h) => <option key={h} value={h}>{hourText(h)}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={`${uid}-e${i}`} className={label}>Until</label>
                <select id={`${uid}-e${i}`} value={row.end_hour} onChange={(e) => update(i, { end_hour: Number(e.target.value) })} className={field}>
                  {END_HOURS.map((h) => <option key={h} value={h}>{hourText(h)}</option>)}
                </select>
              </div>
              <button type="button" className={btnQuiet} onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))}>
                Remove <span className="sr-only">the {WEEKDAYS[row.weekday]} shift</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnQuiet} onClick={addRow}>Add a shift</button>
        <button type="button" className={btnQuiet} onClick={everyday}>Everyday 24 hours</button>
        {rows.length > 0 && <button type="button" className={btnQuiet} onClick={() => { setRows([]); setNote("All shifts removed. Save to keep it."); }}>Clear all</button>}
      </div>

      <fieldset className="rounded-lg border border-charcoal-ink/15 p-3">
        <legend className="px-1 text-sm font-medium text-charcoal-ink">Add overnight shift</legend>
        <p className={help}>A shift cannot cross midnight, so this adds two rows: the evening of the day you pick, and the morning of the next day.</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={`${uid}-nd`} className={label}>Starts on</label>
            <select id={`${uid}-nd`} value={nightDay} onChange={(e) => setNightDay(Number(e.target.value))} className={field}>
              {WEEKDAYS.map((d, wd) => <option key={d} value={wd}>{d}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-ns`} className={label}>From (evening)</label>
            <select id={`${uid}-ns`} value={nightStart} onChange={(e) => setNightStart(Number(e.target.value))} className={field}>
              {START_HOURS.map((h) => <option key={h} value={h}>{hourText(h)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-ne`} className={label}>Until (next morning)</label>
            <select id={`${uid}-ne`} value={nightEnd} onChange={(e) => setNightEnd(Number(e.target.value))} className={field}>
              {END_HOURS.filter((h) => h < 24).map((h) => <option key={h} value={h}>{hourText(h)}</option>)}
            </select>
          </div>
          <button type="button" className={btnQuiet} onClick={addOvernight}>Add overnight shift</button>
        </div>
      </fieldset>

      <p role="status" aria-live="polite" className="min-h-5 text-sm text-charcoal-ink">{note}</p>
    </ActionForm>
  );
}
