import type { Database } from "@tarragon/shared";

type VitalType = Database["public"]["Enums"]["vital_type"];
type CarePlanCondition = Database["public"]["Enums"]["care_plan_condition"];

/**
 * The vital types a clinician can put on a monitoring schedule. A narrower
 * set than the full vital_type enum — ketones/waist_circumference are
 * logged as needed, not on a recurring monitoring cadence.
 */
export const MONITORABLE_VITAL_TYPES = [
  "blood_pressure",
  "glucose",
  "weight",
  "pulse",
  "temperature",
  "spo2",
] as const satisfies readonly VitalType[];

export type MonitorableVitalType = (typeof MONITORABLE_VITAL_TYPES)[number];

export const MONITORABLE_VITAL_TYPE_LABEL: Record<MonitorableVitalType, string> = {
  blood_pressure: "Blood pressure",
  glucose: "Glucose",
  weight: "Weight",
  pulse: "Pulse",
  temperature: "Temperature",
  spo2: "SpO2",
};

export type MonitoringScheduleItemTemplate = {
  vitalType: MonitorableVitalType;
  timesPerDay: number;
  frequencyDays: number;
  escalationMissedThreshold: number;
  acceptableRange: Record<string, number>;
  /** Whether a rising value is the direction of concern (BP/glucose/weight
   * in heart failure) vs falling (SpO2). Drives trend-interpretation copy
   * only — never the actual red-flag classification, which stays in the
   * dedicated per-vital classifiers. */
  higherIsConcern: boolean;
};

export type MonitoringProgrammeTemplate = {
  key: string;
  label: string;
  condition: CarePlanCondition | null;
  purpose: string;
  /** null = ongoing, no fixed end date. */
  durationDays: number | null;
  trackSymptoms: boolean;
  scheduleItems: MonitoringScheduleItemTemplate[];
};

/**
 * The three example programmes from the home-monitoring spec (§51.3):
 * Hypertension (BP twice daily, 7-day period, review after completion —
 * this is exactly the existing HBPM protocol, TH-CP-HTN-001 §5.3, now given
 * a real episode/schedule so it shows up on the adherence and clinician
 * views rather than only as a rolling 7-day average), Diabetes (glucose per
 * care plan + weight, ongoing), and a cardiovascular/heart-failure-style
 * programme (weight + BP daily, ongoing). A clinician can also start a
 * blank/custom episode — that path skips this list entirely.
 */
export const MONITORING_PROGRAMME_TEMPLATES: MonitoringProgrammeTemplate[] = [
  {
    key: "hypertension_hbpm",
    label: "Hypertension — 7-day home BP monitoring",
    condition: "hypertension",
    purpose: "Hypertension review",
    durationDays: 7,
    trackSymptoms: false,
    scheduleItems: [
      {
        vitalType: "blood_pressure",
        timesPerDay: 2,
        frequencyDays: 1,
        escalationMissedThreshold: 3,
        acceptableRange: { systolic_max: 135, diastolic_max: 85 },
        higherIsConcern: true,
      },
    ],
  },
  {
    key: "diabetes_glucose",
    label: "Diabetes — glucose & weight monitoring",
    condition: "diabetes",
    purpose: "Diabetes glucose monitoring",
    durationDays: null,
    trackSymptoms: true,
    scheduleItems: [
      {
        vitalType: "glucose",
        timesPerDay: 2,
        frequencyDays: 1,
        escalationMissedThreshold: 4,
        acceptableRange: { min_mmol_l: 4, max_mmol_l: 10 },
        higherIsConcern: true,
      },
      {
        vitalType: "weight",
        timesPerDay: 1,
        frequencyDays: 7,
        escalationMissedThreshold: 2,
        acceptableRange: {},
        higherIsConcern: true,
      },
    ],
  },
  {
    key: "cardiovascular_hf",
    label: "Heart failure — weight & BP monitoring",
    condition: "cardiovascular",
    purpose: "Heart failure monitoring",
    durationDays: null,
    trackSymptoms: true,
    scheduleItems: [
      {
        vitalType: "weight",
        timesPerDay: 1,
        frequencyDays: 1,
        escalationMissedThreshold: 2,
        acceptableRange: {},
        higherIsConcern: true,
      },
      {
        vitalType: "blood_pressure",
        timesPerDay: 1,
        frequencyDays: 1,
        escalationMissedThreshold: 3,
        acceptableRange: { systolic_max: 140, diastolic_max: 90 },
        higherIsConcern: true,
      },
    ],
  },
];

export function findMonitoringProgrammeTemplate(
  key: string
): MonitoringProgrammeTemplate | undefined {
  return MONITORING_PROGRAMME_TEMPLATES.find((template) => template.key === key);
}

export function higherIsConcernForVitalType(vitalType: MonitorableVitalType): boolean {
  return vitalType !== "spo2";
}
