import type { FaqItem } from "../_components/marketing-faq-accordion";

/**
 * Static, hand-curated copy for the /devices page — deliberately NOT read
 * from the device_catalog table (see CLAUDE.md: "Marketing pages must not
 * import platform/auth modules; Contact/Join is the only page that writes
 * to Supabase"). The in-app Shop (patient/(sections)/devices) is the
 * DB-driven counterpart; keep this list in sync with it by hand when a
 * curated device changes. Per the Device Pairing & Integration Spec v2 §9.1.
 *
 * 2026-08-26: no purchase link — Jumia/Konga have no workable affiliate
 * programme for these categories, and a direct-manufacturer/international
 * link exposes a Nigerian patient to import duty at checkout. This is a
 * plain clinical recommendation; the patient buys from any retailer they
 * already trust.
 */
export type MarketingDeviceCategory = "blood_pressure" | "weight" | "blood_glucose";

export type MarketingDeviceCard = {
  category: MarketingDeviceCategory;
  categoryLabel: string;
  deviceName: string;
  vendorName: string;
  whyWeRecommend: string;
};

export const MARKETING_DEVICES: readonly MarketingDeviceCard[] = [
  {
    category: "blood_pressure",
    categoryLabel: "Blood pressure monitor",
    deviceName: "Omron 10 Series Wireless Upper Arm (BP7450)",
    vendorName: "Omron",
    whyWeRecommend:
      "One of the most widely trusted consumer BP brands. Its own app shares readings with Apple Health and Health Connect, which Tarragon reads as device sync rolls out.",
  },
  {
    category: "weight",
    categoryLabel: "Weight scale",
    deviceName: "Xiaomi Mi Body Composition Scale 2",
    vendorName: "Xiaomi",
    whyWeRecommend:
      "Bluetooth Low Energy, affordable and widely available in Nigeria. Its companion app shares readings with your phone's health platform.",
  },
  {
    category: "blood_glucose",
    categoryLabel: "Glucometer",
    deviceName: "Accu-Chek Instant",
    vendorName: "Roche",
    whyWeRecommend:
      "A globally trusted glucose-monitoring brand, Bluetooth-enabled and already stocked locally, so there's no import wait.",
  },
] as const;

export const DEVICES_FAQ: readonly FaqItem[] = [
  {
    question: "Do I have to buy one of these?",
    answer:
      "No. Typing a reading into the app takes seconds and is a first-class way to keep your record current, forever. Any device whose app shares with Apple Health or Health Connect can also flow in as those connections roll out; these are simply well-regarded models people ask us about.",
  },
  {
    question: "Does Tarragon sell these or make money if I buy one?",
    answer:
      "No. Tarragon doesn't sell, ship, or earn a commission on any device, so buy any brand from whichever retailer you trust. Bluetooth or not, its readings can live on your Tarragon record.",
  },
  {
    question: "My device isn't syncing automatically. Is something wrong?",
    answer:
      "Automatic sync is rolling out connection by connection, so a given device may not flow in automatically yet. Nothing is lost in the meantime: log the reading in the app in seconds and it lands on the same record, with the same doctor review, as a synced one.",
  },
] as const;
