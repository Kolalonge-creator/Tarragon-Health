/**
 * Per-brand steps to keep Tarragon Health alerts reaching a phone that is locked or in a pocket. These are the steps phone makers publish
 * for their own battery managers; they have not been tested on every handset or Android version, and the menu names change between
 * versions. The test page on the same screen is the real check. English only. No SMS and no WhatsApp: a page reaches you by notification,
 * in the app and by email.
 */
export interface DeviceGuide {
  readonly brand: string;
  readonly alsoSold: string;
  readonly steps: readonly string[];
}

export const DEVICE_GUIDES: readonly DeviceGuide[] = [
  {
    brand: "Tecno",
    alsoSold: "HiOS phones",
    steps: [
      "Open Phone Master (or Settings), then App Management or Battery, then App Power Saving.",
      "Find Tarragon Health and set it to No restrictions (or switch App Power Saving off for it).",
      "Open Auto-start management and allow Tarragon Health to start by itself.",
      "Lock the app in the recent apps list: open recent apps, pull down on the Tarragon Health card or tap the lock icon.",
      "Keep Do Not Disturb off, or let Tarragon Health through it.",
    ],
  },
  {
    brand: "Infinix",
    alsoSold: "XOS phones",
    steps: [
      "Open Settings, then Battery, then App Power Saving (or Phone Master, then Battery).",
      "Set Tarragon Health to No restrictions.",
      "Open Auto-start (or Autostart management) and switch Tarragon Health on.",
      "Lock the app in the recent apps list so the phone does not close it.",
      "Keep Do Not Disturb off, or let Tarragon Health through it.",
    ],
  },
  {
    brand: "Samsung",
    alsoSold: "One UI phones",
    steps: [
      "Open Settings, then Apps, then Tarragon Health, then Battery, and choose Unrestricted.",
      "Open Settings, then Battery, then Background usage limits, and make sure Tarragon Health is not in Sleeping apps or Deep sleeping apps. Add it to Never sleeping apps.",
      "Open Settings, then Notifications, and switch on all notifications for Tarragon Health, with sound.",
      "Keep Do Not Disturb off, or add Tarragon Health to its exceptions.",
    ],
  },
  {
    brand: "Xiaomi",
    alsoSold: "Redmi, POCO, MIUI and HyperOS phones",
    steps: [
      "Open Settings, then Apps, then Manage apps, then Tarragon Health, then Autostart, and switch it on.",
      "In the same place open Battery saver and choose No restrictions.",
      "Open Settings, then Notifications, then Tarragon Health, and allow all notifications, including on the lock screen.",
      "Lock the app in the recent apps list: open recent apps, press and hold the Tarragon Health card, and tap the lock.",
      "Keep Do Not Disturb off, or let Tarragon Health through it.",
    ],
  },
] as const;

export const GENERAL_DEVICE_STEPS: readonly string[] = [
  "Keep mobile data or Wi-Fi on, and a charger or power bank nearby when you are on call.",
  "Make sure the email on your account opens on this phone: every page is also sent by email.",
  "Send yourself a test page below after any phone update, and acknowledge it.",
];
