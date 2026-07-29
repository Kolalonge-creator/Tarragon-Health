export type DeviceKind =
  | "bp"
  | "glucose_fasting"
  | "glucose_random"
  | "hba1c"
  | "weight"
  | "height"
  | "waist"
  | "pulse";

export type DeviceValidation =
  | "validated"
  | "unvalidated_advisory"
  | "wrist_advisory"
  | "unknown";

export interface ValidatedDeviceListEntry {
  make: string;
  model: string;
  deviceKind: DeviceKind;
}

export interface DeviceValidationInput {
  isWrist: boolean;
  make: string;
  model: string;
  deviceKind: DeviceKind;
  approxAgeYears: number | null;
}

/**
 * Spec §5.4 validation rules, in the stated order:
 *   - is_wrist=true -> wrist_advisory, always (checked first, regardless
 *     of anything else -- a wrist device is advisory no matter how new or
 *     how validated the model otherwise is).
 *   - make/model absent from the validated-device list -> unvalidated_advisory.
 *   - approx_age_years > 4 -> unvalidated_advisory.
 *   - otherwise -> validated.
 *
 * The validated-device list is a caller-supplied parameter, not baked in
 * here. Spec §21.4 lists "which published list packages/protocol/devices.ts
 * checks against" as an open decision requiring founder/product input --
 * this function is correct regardless of what that list eventually is; it
 * does not invent one.
 */
export function computeDeviceValidation(
  input: DeviceValidationInput,
  validatedDeviceList: ValidatedDeviceListEntry[],
): DeviceValidation {
  if (input.isWrist) {
    return "wrist_advisory";
  }

  const isOnValidatedList = validatedDeviceList.some(
    (entry) =>
      entry.make === input.make &&
      entry.model === input.model &&
      entry.deviceKind === input.deviceKind,
  );

  if (!isOnValidatedList) {
    return "unvalidated_advisory";
  }

  if (input.approxAgeYears !== null && input.approxAgeYears > 4) {
    return "unvalidated_advisory";
  }

  return "validated";
}

/**
 * Spec §5.4: "BP cuff with no arm_circumference_cm -> block enrolment
 * completion until captured." Pure predicate; the actual blocking is
 * enforced at the DB level (private.enforce_device_capture_before_active_enrolment)
 * since it spans all of a patient's devices, not a single device record.
 */
export function bpDeviceMissingArmCircumference(
  deviceKind: DeviceKind,
  armCircumferenceCm: number | null,
): boolean {
  return deviceKind === "bp" && armCircumferenceCm === null;
}
