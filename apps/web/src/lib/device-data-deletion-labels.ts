import type { Enums } from "@tarragon/shared";
import type { BadgeProps } from "@/components/ui/badge";

/**
 * 55.19 device/wearable data governance — plain-language labels shared
 * between the patient request form (device-data-deletion-card.tsx) and the
 * staff processing queue (clinician/data-deletion-requests). Kept in one
 * place so the two sides describe the same scope the same way.
 */

export type DataDeletionScope = Enums<"data_deletion_scope">;
export type DataDeletionStatus = Enums<"data_deletion_status">;

export const DATA_DELETION_SCOPE_ORDER: DataDeletionScope[] = [
  "wearable_readings",
  "device_connections",
  "all_device_data",
];

export const DATA_DELETION_SCOPE_LABEL: Record<DataDeletionScope, string> = {
  wearable_readings: "Delete my passive activity data",
  device_connections: "Disconnect and delete my wearable data",
  all_device_data: "Delete all my device data and unpair everything",
};

export const DATA_DELETION_SCOPE_DESCRIPTION: Record<DataDeletionScope, string> = {
  wearable_readings:
    "Removes step counts, sleep, heart-rate variability, and other passive activity readings synced from your wearables. Your wearable connections stay linked and keep syncing new data going forward.",
  device_connections:
    "Removes the same passive activity data, and disconnects every wearable account you've linked (Oura, WHOOP, Garmin, Fitbit, Dexcom, etc.) so none of them sync any more.",
  all_device_data:
    "Removes all of your passive activity data, disconnects every wearable account, and unpairs every Bluetooth device (BP cuff, glucometer, scale, thermometer, pulse oximeter) from your account.",
};

/** This never touches vitals_readings — the patient's actual clinical
 * record — under any scope. Worth saying plainly in the UI so a patient
 * doesn't worry a deletion request could erase readings their care team
 * relies on. See execute_wearable_data_deletion()'s own comment. */
export const DATA_DELETION_SAFETY_NOTE =
  "This never deletes your logged vitals, symptoms, or medical record — only passive device/wearable data.";

export const DATA_DELETION_STATUS_LABEL: Record<DataDeletionStatus, string> = {
  requested: "Requested",
  in_progress: "In progress",
  completed: "Completed",
  rejected: "Rejected",
};

export const DATA_DELETION_STATUS_BADGE_VARIANT: Record<
  DataDeletionStatus,
  NonNullable<BadgeProps["variant"]>
> = {
  requested: "amber",
  in_progress: "blue",
  completed: "green",
  rejected: "red",
};
