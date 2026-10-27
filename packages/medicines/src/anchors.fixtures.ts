import type { AnchorId, AnchorTimeVersion, DayShift } from "./anchors";

/**
 * Shared cases for anchored dose times (S08z). The package tests resolve each one in TypeScript; the database proof
 * (`packages/db/tests/s08z_dose_anchors.sql`) carries the same cases through `private.medication_slots_on`. A Jest
 * test in this package fails if the proof stops listing the same case names, so the two cannot drift apart silently.
 *
 * The default times are TEST values only. The proposed defaults live in the versioned configuration
 * (`medicines.dose_anchors`), and the package never reads them.
 */
export const TEST_ANCHOR_DEFAULTS: Record<AnchorId, string> = {
  waking: "06:30",
  morning_prayer: "05:45",
  breakfast: "07:30",
  midday_prayer: "13:15",
  lunch: "13:00",
  afternoon_prayer: "16:30",
  evening_prayer: "19:15",
  dinner: "19:30",
  night_prayer: "20:45",
  bedtime: "22:30",
};

/**
 * Test slot keys, one per anchor. A stored schedule names a SLOT, never the anchor (religious belief, see anchors.ts), so the cases below
 * are written in anchor terms for readability and `toSlotSpec` turns them into what is stored. The database proof uses the same keys.
 */
export const TEST_SLOT_OF: Record<AnchorId, string> = {
  waking: "s00000000a1",
  morning_prayer: "s00000000a2",
  breakfast: "s00000000a3",
  midday_prayer: "s00000000a4",
  lunch: "s00000000a5",
  afternoon_prayer: "s00000000a6",
  evening_prayer: "s00000000a7",
  dinner: "s00000000a8",
  night_prayer: "s00000000a9",
  bedtime: "s00000000b0",
};
export const TEST_SLOTS: Record<string, AnchorId> = Object.fromEntries(
  (Object.entries(TEST_SLOT_OF) as [AnchorId, string][]).map(([anchor, slot]) => [slot, anchor])
);

/** The stored form of a case's schedule: each `{anchor, offsetMinutes}` becomes `{slot, offsetMinutes}`. */
export function toSlotSpec(spec: Record<string, unknown>): Record<string, unknown> {
  const anchored = spec.anchored as { anchor: AnchorId; offsetMinutes: number }[] | undefined;
  if (!anchored) return spec;
  return { ...spec, anchored: anchored.map((a) => ({ slot: TEST_SLOT_OF[a.anchor], offsetMinutes: a.offsetMinutes })) };
}

export interface AnchorCase {
  name: string;
  spec: Record<string, unknown>;
  /** The patient's own anchor times, in force from the start (a time chosen long ago). */
  patientTimes?: Partial<Record<AnchorId, string>>;
  /** Anchor times with their own start dates, for a change made part way through. */
  patientVersions?: Partial<Record<AnchorId, AnchorTimeVersion[]>>;
  shifts?: DayShift[];
  /** What each date should resolve to (HH:MM, ascending). */
  expect: Record<string, string[]>;
}

const daily = (extra: Record<string, unknown>): Record<string, unknown> => ({ kind: "daily", times: [], ...extra });

export const ANCHOR_CASES: AnchorCase[] = [
  {
    name: "with breakfast, the patient never set it: the proposed default",
    spec: daily({ anchored: [{ anchor: "breakfast", offsetMinutes: 0 }] }),
    expect: { "2026-10-05": ["07:30"] },
  },
  {
    name: "with breakfast at the time the patient chose",
    spec: daily({ anchored: [{ anchor: "breakfast", offsetMinutes: 0 }] }),
    patientTimes: { breakfast: "08:15" },
    expect: { "2026-10-05": ["08:15"] },
  },
  {
    name: "thirty minutes after the morning prayer, and thirty before dinner",
    spec: daily({
      anchored: [
        { anchor: "morning_prayer", offsetMinutes: 30 },
        { anchor: "dinner", offsetMinutes: -30 },
      ],
    }),
    patientTimes: { morning_prayer: "05:20" },
    expect: { "2026-10-05": ["05:50", "19:00"] },
  },
  {
    name: "a fixed clock time beside an anchored one, and a duplicate time is one dose",
    spec: daily({ times: ["07:30", "21:00"], anchored: [{ anchor: "breakfast", offsetMinutes: 0 }] }),
    expect: { "2026-10-05": ["07:30", "21:00"] },
  },
  {
    name: "a day shift moves the anchor on its dates only, then returns to normal",
    spec: daily({ anchored: [{ anchor: "dinner", offsetMinutes: 0 }] }),
    shifts: [{ startsOn: "2026-10-05", endsOn: "2026-10-07", offsets: { dinner: 90 } }],
    expect: {
      "2026-10-04": ["19:30"],
      "2026-10-05": ["21:00"],
      "2026-10-07": ["21:00"],
      "2026-10-08": ["19:30"],
    },
  },
  {
    name: "a shift moves only the anchors it names",
    spec: daily({
      anchored: [
        { anchor: "breakfast", offsetMinutes: 0 },
        { anchor: "dinner", offsetMinutes: 0 },
      ],
    }),
    shifts: [{ startsOn: "2026-10-05", endsOn: "2026-10-06", offsets: { breakfast: -120 } }],
    expect: { "2026-10-05": ["05:30", "19:30"] },
  },
  {
    name: "when two shifts cover a date the one listed last (the newest) applies",
    spec: daily({ anchored: [{ anchor: "dinner", offsetMinutes: 0 }] }),
    shifts: [
      { startsOn: "2026-10-05", endsOn: "2026-10-09", offsets: { dinner: 60 } },
      { startsOn: "2026-10-06", endsOn: "2026-10-07", offsets: { dinner: -30 } },
    ],
    expect: { "2026-10-05": ["20:30"], "2026-10-06": ["19:00"], "2026-10-08": ["20:30"] },
  },
  {
    name: "an hour after a 23:30 bedtime is 00:30 on the NEXT date, not 23:59 on the same one",
    spec: daily({ anchored: [{ anchor: "bedtime", offsetMinutes: 60 }] }),
    patientTimes: { bedtime: "23:30" },
    expect: { "2026-10-05": ["00:30"], "2026-10-06": ["00:30"] },
  },
  {
    name: "half an hour before a 00:10 waking is 23:40 on the PREVIOUS date",
    spec: daily({ anchored: [{ anchor: "waking", offsetMinutes: -30 }] }),
    patientTimes: { waking: "00:10" },
    expect: { "2026-10-05": ["23:40"] },
  },
  {
    name: "a shift can carry an anchor across midnight, and the day the dose belongs to decides the shift",
    spec: daily({ anchored: [{ anchor: "bedtime", offsetMinutes: 0 }] }),
    patientTimes: { bedtime: "23:30" },
    shifts: [{ startsOn: "2026-10-05", endsOn: "2026-10-05", offsets: { bedtime: 45 } }],
    // Day 5 bedtime resolves to 00:15 on the 6th, so the 5th has none; days 4 and 6 stay at 23:30 on their own dates.
    expect: { "2026-10-04": ["23:30"], "2026-10-05": [], "2026-10-06": ["00:15", "23:30"] },
  },
  {
    name: "every third day: only the occurrence days, and one that crosses midnight lands on the next date",
    spec: { kind: "every_n_days", intervalDays: 3, anchorDate: "2026-10-01", times: [], anchored: [{ anchor: "bedtime", offsetMinutes: 90 }] },
    patientTimes: { bedtime: "23:00" },
    expect: { "2026-10-01": [], "2026-10-02": ["00:30"], "2026-10-03": [], "2026-10-04": [], "2026-10-05": ["00:30"] },
  },
  {
    name: "certain weekdays: an anchored dose on a Monday that crosses midnight lands on Tuesday",
    spec: { kind: "weekdays", days: [1], times: [], anchored: [{ anchor: "night_prayer", offsetMinutes: 180 }] },
    patientTimes: { night_prayer: "22:00" },
    // 2026-10-05 is a Monday.
    expect: { "2026-10-05": [], "2026-10-06": ["01:00"], "2026-10-07": [] },
  },
  {
    name: "the end date is the last schedule day: its dose that crosses midnight still lands, the next one does not",
    spec: daily({ endDate: "2026-10-05", anchored: [{ anchor: "bedtime", offsetMinutes: 60 }] }),
    patientTimes: { bedtime: "23:30" },
    expect: { "2026-10-05": ["00:30"], "2026-10-06": ["00:30"], "2026-10-07": [] },
  },
  {
    name: "the start date: nothing resolves from a schedule day before it",
    spec: daily({ startDate: "2026-10-05", anchored: [{ anchor: "bedtime", offsetMinutes: 60 }] }),
    patientTimes: { bedtime: "23:30" },
    expect: { "2026-10-05": [], "2026-10-06": ["00:30"] },
  },
  {
    name: "a changed anchor time applies from its own date: earlier days keep the old time",
    spec: daily({ anchored: [{ anchor: "breakfast", offsetMinutes: 0 }] }),
    patientVersions: {
      breakfast: [
        { effectiveFrom: "2026-09-01", time: "07:00" },
        { effectiveFrom: "2026-10-06", time: "08:30" },
      ],
    },
    expect: { "2026-09-15": ["07:00"], "2026-10-05": ["07:00"], "2026-10-06": ["08:30"], "2026-10-20": ["08:30"] },
  },
  {
    name: "before the patient's first chosen time takes effect the proposed default applies",
    spec: daily({ anchored: [{ anchor: "lunch", offsetMinutes: 0 }] }),
    patientVersions: { lunch: [{ effectiveFrom: "2026-10-06", time: "12:00" }] },
    expect: { "2026-10-05": ["13:00"], "2026-10-06": ["12:00"] },
  },
  {
    name: "ending a shift early leaves the days already lived as they were",
    spec: daily({ anchored: [{ anchor: "dinner", offsetMinutes: 0 }] }),
    shifts: [{ startsOn: "2026-10-05", endsOn: "2026-10-10", cancelledFrom: "2026-10-07", offsets: { dinner: 60 } }],
    expect: { "2026-10-05": ["20:30"], "2026-10-06": ["20:30"], "2026-10-07": ["19:30"], "2026-10-09": ["19:30"] },
  },
];
