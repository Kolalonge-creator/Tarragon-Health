/**
 * S70 (18.2): the recommended-devices list, as the screens see it.
 *
 * The listing rule (CMO pack C5, OQ-313) is enforced in the database (`device_catalog_listing_criteria`): a model is active only
 * when it is validated (ValidateBP or a published standard) AND NAFDAC-registered or sold by an authorised local distributor
 * whose name is recorded. `isListable` repeats the same rule so a screen never shows a row that somehow slipped past, and so the
 * rule has a unit test. Tarragon sells nothing: there is no price, link or checkout here, and manual entry is always the first
 * thing a screen offers (`MANUAL_ENTRY_FIRST`).
 */
export type DeviceNafdacStatus = "unverified" | "registered" | "authorised_distributor";
export type DeviceBluetoothVia = "none" | "direct" | "health_connect" | "apple_health" | "vendor_app";
export type DeviceValidationStandard = "validatebp" | "iso_81060_2" | "aami_esh_iso_universal" | "iso_15197" | "other_published";

export interface RecommendedDeviceRow {
  active: boolean;
  clinically_reviewed: boolean;
  validation_standard: string | null;
  validation_reference: string | null;
  nafdac_status: string;
  nafdac_registration_number: string | null;
  distributor_name: string | null;
  bluetooth_via: string;
}

export function isListable(row: RecommendedDeviceRow): boolean {
  if (!row.active || !row.clinically_reviewed) return false;
  if (!row.validation_standard || !row.validation_reference) return false;
  if (row.nafdac_status !== "registered" && row.nafdac_status !== "authorised_distributor") return false;
  if (row.nafdac_status === "registered" && !row.nafdac_registration_number) return false;
  return Boolean(row.distributor_name && row.distributor_name.trim().length > 0);
}

export const VALIDATION_STANDARD_LABEL: Record<DeviceValidationStandard, string> = {
  validatebp: "On the ValidateBP list",
  iso_81060_2: "Validated to ISO 81060-2",
  aami_esh_iso_universal: "Validated to the AAMI, ESH and ISO universal standard",
  iso_15197: "Meets ISO 15197 (manufacturer statement)",
  other_published: "Published validation study",
};

export const CONNECTION_LABEL: Record<DeviceBluetoothVia, string> = {
  none: "Type the reading in, or take a photo of the screen",
  direct: "Connects by Bluetooth in the Tarragon app",
  health_connect: "Syncs through Health Connect on Android",
  apple_health: "Syncs through Apple Health on iPhone",
  vendor_app: "Syncs through the maker's own app, then into Health Connect or Apple Health",
};

export function connectionLabel(via: string): string {
  return CONNECTION_LABEL[via as DeviceBluetoothVia] ?? CONNECTION_LABEL.none;
}

export function validationLabel(standard: string | null): string | null {
  return standard ? (VALIDATION_STANDARD_LABEL[standard as DeviceValidationStandard] ?? null) : null;
}

/** The screens render this ahead of any device card: a device is never required (Module 18 safety rule). */
export const MANUAL_ENTRY_FIRST = "You do not need a device. Type any reading in, or take a photo of your device's screen. Your care team sees it either way.";
