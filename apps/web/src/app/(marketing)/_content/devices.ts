import type { FaqItem } from "../_components/marketing-faq-accordion";

/**
 * Static, hand-curated copy for the /devices page — deliberately NOT read
 * from the device_catalog table (see CLAUDE.md: "Marketing pages must not
 * import platform/auth modules; Contact/Join is the only page that writes
 * to Supabase"). The in-app Shop (patient/(sections)/devices) is the
 * DB-driven counterpart; keep this list in sync with it by hand when a
 * curated device changes. Per the Device Pairing & Integration Spec v2 §9.1.
 */
export type MarketingDeviceCategory = "blood_pressure" | "weight" | "blood_glucose";

export type MarketingDeviceCard = {
  category: MarketingDeviceCategory;
  categoryLabel: string;
  deviceName: string;
  vendorName: string;
  whyWeRecommend: string;
  buyHref: string;
  alternative?: { label: string; href: string };
};

export const MARKETING_DEVICES: readonly MarketingDeviceCard[] = [
  {
    category: "blood_pressure",
    categoryLabel: "Blood pressure monitor",
    deviceName: "Omron 10 Series Wireless Upper Arm (BP7450)",
    vendorName: "Omron",
    whyWeRecommend:
      "The most clinically trusted consumer BP brand globally, with confirmed Bluetooth connectivity that syncs straight into your Tarragon record.",
    buyHref:
      "https://www.jumia.com.ng/omron-10-series-wireless-upper-arm-blood-pressure-monitor-bp7450-418251415.html",
  },
  {
    category: "weight",
    categoryLabel: "Weight scale",
    deviceName: "Xiaomi Mi Body Composition Scale 2",
    vendorName: "Xiaomi",
    whyWeRecommend:
      "Bluetooth Low Energy, affordable and widely available in Nigeria, syncing through the Mi Fit app.",
    buyHref: "https://www.mi.com/ng/product/mi-body-composition-scale-2/",
  },
  {
    category: "blood_glucose",
    categoryLabel: "Glucometer",
    deviceName: "Accu-Chek Instant",
    vendorName: "Roche",
    whyWeRecommend:
      "A globally trusted glucose-monitoring brand, Bluetooth-enabled and already stocked locally, so there's no import wait.",
    buyHref: "https://www.jumia.com.ng/blood-glucose-monitors/accu-chek/",
    alternative: {
      label: "Alternative option: HealthPlus Nigeria",
      href: "https://healthplusnigeria.com/products/accuchek-instant-blood-glucose-monitor",
    },
  },
] as const;

export const DEVICES_FAQ: readonly FaqItem[] = [
  {
    question: "Do I have to buy from here?",
    answer:
      "No. Any Bluetooth device with Health Connect or Apple Health support will work — these are simply the ones we've tested and clinically vetted.",
  },
  {
    question: "Does Tarragon make money from this?",
    answer:
      "Yes, a small commission at no extra cost to you. It never affects which devices we recommend, which is based on clinical accuracy and confirmed compatibility only.",
  },
] as const;
