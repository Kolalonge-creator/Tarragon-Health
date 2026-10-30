import type { FaqItem } from "../_components/marketing-faq-accordion";

/**
 * Static, hand-curated copy for the /devices page — deliberately NOT read
 * from the device_catalog table (see CLAUDE.md: "Marketing pages must not
 * import platform/auth modules; Contact/Join is the only page that writes
 * to Supabase"). The in-app Shop (patient/(sections)/devices) is the
 * DB-driven counterpart; keep this list in sync with it by hand when a
 * curated device changes. Per the Device Pairing & Integration Spec v2 §9.1.
 *
 * 2026-09-05: the two clinical models named here are the ones with credible,
 * documented STANDARD Bluetooth GATT compliance (A&D UA-651BLE for BP, Roche
 * Accu-Chek Guide/Guide Me for glucose), which is what Tarragon's own pairing
 * path is written against. This page previously named the Omron 10 Series,
 * which pushes a proprietary app/SDK instead — not false, since this page only
 * ever claimed Apple Health / Health Connect sharing, but it pointed patients
 * at hardware the platform can never pair with directly. Nothing here promises
 * direct pairing: that path is built but has never been run against real
 * hardware, so no "supported devices" claim belongs on this page until it has.
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
    deviceName: "A&D Medical UA-651BLE",
    vendorName: "A&D Medical",
    whyWeRecommend:
      "A clinically validated upper-arm cuff that speaks the standard Bluetooth blood pressure profile rather than a brand-specific one, so its readings are not tied to a single company's app. That is the profile Tarragon's own pairing is built against.",
  },
  {
    category: "weight",
    categoryLabel: "Weight scale",
    deviceName: "Xiaomi Mi Body Composition Scale 2",
    vendorName: "Xiaomi",
    whyWeRecommend:
      "A Bluetooth Low Energy scale that is affordable and widely available in Nigeria. Its companion app shares readings with your phone's health platform.",
  },
  {
    category: "blood_glucose",
    categoryLabel: "Glucometer",
    deviceName: "Accu-Chek Guide (or Guide Me)",
    vendorName: "Roche",
    whyWeRecommend:
      "A widely trusted meter that is already stocked locally, so there is no wait for import. It uses the standard Bluetooth glucose profile that Tarragon's pairing is built against.",
  },
] as const;

export const DEVICES_FAQ: readonly FaqItem[] = [
  {
    question: "Do I have to buy one of these?",
    answer:
      "No. Typing in a reading takes seconds and keeps your record just as current. Any device that syncs through Apple Health or Health Connect can also send readings to your record as those connections become available. These models are well regarded and are the ones people most often ask about.",
  },
  {
    question: "Does Tarragon sell these or make money if I buy one?",
    answer:
      "No. Tarragon does not sell or ship any device, and earns no commission on any device. You can buy any brand from a retailer you trust. Whether or not it has Bluetooth, its readings can be kept on your Tarragon record.",
  },
  {
    question: "My device is not syncing automatically. Is something wrong?",
    answer:
      "Automatic sync is being introduced one connection at a time, so a given device may not send readings automatically yet. Nothing is lost in the meantime. You can enter the reading in the app in seconds, and it is added to the same record and receives the same doctor review as a synced reading.",
  },
] as const;
