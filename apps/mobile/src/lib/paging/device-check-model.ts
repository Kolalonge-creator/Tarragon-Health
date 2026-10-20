import type { DeviceGuide } from "@tarragon/shared";

/** Android system settings actions used by the Device check screen (S19e). Pure data so they are tested without a phone. */
export const DO_NOT_DISTURB_ACCESS_ACTION = "android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS";

export function channelSettingsIntent(packageName: string, channelId: string): { action: string; extras: { key: string; value: string }[] } {
  return {
    action: "android.settings.CHANNEL_NOTIFICATION_SETTINGS",
    extras: [
      { key: "android.provider.extra.APP_PACKAGE", value: packageName },
      { key: "android.provider.extra.CHANNEL_ID", value: channelId },
    ],
  };
}

/** The line under a brand's name, e.g. "HiOS phones". */
export function guideSummary(g: DeviceGuide): string {
  return g.alsoSold;
}
