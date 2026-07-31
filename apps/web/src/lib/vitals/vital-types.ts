/**
 * Shared vital-type catalogue for both the client-side VitalsForm and the
 * server-rendered /patient/quick-log/[type] page. Deliberately its own
 * plain module (no "use client") — importing a named constant from a
 * "use client" file into a server component turns every export of that
 * module into an opaque client reference under the RSC bundler, not just
 * the component, which breaks `.map()` on a plain array at build time.
 */
export const VITAL_TYPES = [
  { value: "blood_pressure", label: "Blood pressure" },
  { value: "glucose", label: "Glucose" },
  { value: "ketones", label: "Ketones" },
  { value: "weight", label: "Weight" },
  { value: "waist_circumference", label: "Waist circumference" },
  { value: "pulse", label: "Pulse" },
  { value: "temperature", label: "Temperature" },
  { value: "spo2", label: "SpO2" },
] as const;

export type VitalType = (typeof VITAL_TYPES)[number]["value"];
