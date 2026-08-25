import type { Enums } from "@tarragon/shared";

export type PatientDeviceType = Enums<"patient_device_type">;
export type VitalType = Enums<"vital_type">;

/**
 * Which vital_type a device_type measures. patient_device_type and vital_type
 * are separate enums (BLE pairing vs. vitals logging) with no shared naming,
 * so this is the one place that maps between them.
 */
const DEVICE_TYPE_VITAL_TYPE: Record<PatientDeviceType, VitalType> = {
  bp_cuff: "blood_pressure",
  glucometer: "glucose",
  scale: "weight",
  thermometer: "temperature",
  pulse_oximeter: "spo2",
};

const DEVICE_TYPE_LABEL: Record<PatientDeviceType, string> = {
  bp_cuff: "blood pressure monitor",
  glucometer: "glucometer",
  scale: "weight scale",
  thermometer: "thermometer",
  pulse_oximeter: "pulse oximeter",
};

/**
 * Advisory only — this is guidance copy, never a purchase gate. Every device
 * offering stays visible and buyable regardless of what this returns; a null
 * result just means the shop shows no "recommended for you" reason for that
 * item, e.g. a glucometer for a patient only enrolled in hypertension care.
 */
export function deviceRecommendationReason(
  deviceType: PatientDeviceType,
  monitoredVitalTypes: readonly VitalType[],
): string | null {
  const vitalType = DEVICE_TYPE_VITAL_TYPE[deviceType];
  if (!monitoredVitalTypes.includes(vitalType)) return null;
  return `Based on your care plan, we recommend a ${DEVICE_TYPE_LABEL[deviceType]} — your care team tracks this reading.`;
}

/**
 * Annotates every offering with its (possibly null) recommendation reason and
 * sorts recommended-first. Never removes an offering — the whole point is
 * that an unrecommended device stays fully visible and purchasable, just
 * without the "recommended for you" treatment. Stable sort: ties keep their
 * incoming (catalogue display_order) sequence.
 */
export function annotateWithRecommendation<T extends { device_type: PatientDeviceType }>(
  offerings: readonly T[],
  monitoredVitalTypes: readonly VitalType[],
): (T & { recommendationReason: string | null })[] {
  return offerings
    .map((offering) => ({
      ...offering,
      recommendationReason: deviceRecommendationReason(offering.device_type, monitoredVitalTypes),
    }))
    .sort((a, b) => Number(!a.recommendationReason) - Number(!b.recommendationReason));
}
