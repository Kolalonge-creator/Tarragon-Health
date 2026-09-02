import type { Ionicons } from "@expo/vector-icons";

export type SectionId =
  | "overview"
  | "vitals"
  | "medications"
  | "labs"
  | "devices"
  | "healthDirectory"
  | "stayWellDirectory"
  | "supportDirectory"
  | "accountDirectory"
  | "appointments"
  | "weightManagement"
  | "nutrition"
  | "activity"
  | "privacy"
  | "prevention"
  | "healthCheck"
  | "lifestyle"
  | "learn"
  | "wellness"
  | "care"
  | "messages"
  | "family"
  | "supporting"
  | "passport"
  | "subscription"
  | "emergency"
  | "settings";

interface SectionDef {
  id: SectionId;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Sections without a native screen render this platform path in a WebView.
   * Those loads are signed in via /auth/mobile-bridge (see webview-screen.tsx),
   * so a WebView section is a real working section, not a placeholder — and it
   * tracks every web deploy with no app-store release. */
  webviewPath?: string;
  /** Drawer grouping — mirrors the web sidebar's bands (lib/navigation.ts) so
   * the two surfaces describe the patient's world the same way. */
  group: "top" | "Your health" | "Stay well" | "Support" | "Your account";
  /** Promotes this section into the bottom tab bar. Only the first
   * MAX_PRIMARY_SECTIONS are used, in declaration order. */
  primary?: boolean;
  /** Short label for the bottom tab bar, where the full label will not fit. */
  shortLabel?: string;
}

/** Tabs shown before the More button. Four plus More keeps every target
 * comfortably above the 44pt touch minimum on the narrowest phones. */
export const MAX_PRIMARY_SECTIONS = 4;

/**
 * Every section the patient app offers, in drawer order.
 *
 * The "See everything in ..." row that closes each band is the app's half of
 * the 2026-09-02 discovery pass: on web, a group is a real directory page
 * listing every feature in it with a line about what it is for
 * (apps/web/src/lib/patient/feature-registry.ts), and this is how a phone
 * reaches the same page. It matters more here than on desktop, because this
 * drawer has no room to name eighty features and a patient on a phone has
 * even less patience for hunting.
 *
 * Note the registry itself deliberately still lives in apps/web: its icon
 * names are lucide, not Ionicons, so sharing it would mean abstracting icons
 * across two design systems for no immediate gain. These WebView rows get the
 * whole directory today; a native search screen is the thing that would
 * justify moving it into packages/shared later.
 *
 * Five destinations that exist on web were missing from the app entirely —
 * not merely un-implemented natively, but absent from the drawer with no way
 * to reach them at all: the Learn library, Lifestyle coaching, Wellness
 * rewards, the yearly Health Check, and plan/subscription management. A
 * patient paying for Complete Care could not open the lifestyle programme
 * they were paying for, or read a single health-education article, from their
 * phone. They are WebView-backed here for now, the same proven pattern
 * Care/Prevention/Your people already use, which is what makes closing the
 * gap a matter of routing rather than of rebuilding five screens natively.
 */
export const SECTIONS: SectionDef[] = [
  {
    id: "overview",
    label: "Overview",
    icon: "home-outline",
    group: "top",
    primary: true,
    shortLabel: "Home",
  },

  {
    id: "vitals",
    label: "Vitals & symptoms",
    icon: "pulse-outline",
    group: "Your health",
    primary: true,
    shortLabel: "Vitals",
  },
  {
    id: "medications",
    label: "Medications",
    icon: "medkit-outline",
    group: "Your health",
    primary: true,
    shortLabel: "Meds",
  },
  { id: "labs", label: "Labs & results", icon: "flask-outline", group: "Your health" },
  { id: "devices", label: "Devices", icon: "bluetooth-outline", group: "Your health" },
  {
    id: "prevention",
    label: "Prevention",
    icon: "shield-checkmark-outline",
    group: "Your health",
    webviewPath: "/patient/prevention",
  },
  {
    id: "healthCheck",
    label: "Health Check",
    icon: "clipboard-outline",
    group: "Your health",
    webviewPath: "/patient/health-check",
  },
  {
    id: "healthDirectory",
    label: "See everything in Your health",
    icon: "list-outline",
    group: "Your health",
    webviewPath: "/patient/health",
  },

  {
    id: "lifestyle",
    label: "Lifestyle coaching",
    icon: "leaf-outline",
    group: "Stay well",
    webviewPath: "/patient/lifestyle",
  },
  {
    id: "learn",
    label: "Learn",
    icon: "school-outline",
    group: "Stay well",
    webviewPath: "/patient/learn",
  },
  {
    id: "wellness",
    label: "Wellness rewards",
    icon: "trophy-outline",
    group: "Stay well",
    webviewPath: "/patient/wellness",
  },
  // Three real web destinations the app had no route to at all, found in the
  // 2026-09-02 discovery audit alongside Appointments and Privacy below.
  {
    id: "weightManagement",
    label: "Weight management",
    icon: "barbell-outline",
    group: "Stay well",
    webviewPath: "/patient/weight-management",
  },
  {
    id: "nutrition",
    label: "Food & meals",
    icon: "restaurant-outline",
    group: "Stay well",
    webviewPath: "/patient/nutrition",
  },
  {
    id: "activity",
    label: "Movement",
    icon: "walk-outline",
    group: "Stay well",
    webviewPath: "/patient/activity",
  },
  {
    id: "stayWellDirectory",
    label: "See everything in Stay well",
    icon: "list-outline",
    group: "Stay well",
    webviewPath: "/patient/stay-well",
  },

  {
    id: "messages",
    label: "Messages",
    icon: "chatbox-ellipses-outline",
    group: "Support",
    primary: true,
    shortLabel: "Messages",
  },
  {
    id: "care",
    label: "Care & support",
    icon: "help-buoy-outline",
    group: "Support",
    webviewPath: "/patient/care",
  },
  {
    id: "family",
    label: "Your people",
    icon: "people-outline",
    group: "Support",
    webviewPath: "/patient/family",
  },
  {
    id: "appointments",
    label: "Appointments",
    icon: "calendar-outline",
    group: "Support",
    webviewPath: "/patient/appointments",
  },
  { id: "supporting", label: "People you support", icon: "hand-left-outline", group: "Support" },
  {
    id: "supportDirectory",
    label: "See everything in Support",
    icon: "list-outline",
    group: "Support",
    webviewPath: "/patient/support",
  },

  { id: "passport", label: "Health Passport", icon: "id-card-outline", group: "Your account" },
  {
    id: "subscription",
    label: "Subscription",
    icon: "card-outline",
    group: "Your account",
    webviewPath: "/patient/subscription",
  },
  {
    // Privacy & data rights had NO route in the app at all. Given NDPR, "the
    // screen where you download or delete your data is unreachable on a
    // phone" is not a wayfinding nicety.
    id: "privacy",
    label: "Privacy & data",
    icon: "lock-closed-outline",
    group: "Your account",
    webviewPath: "/patient/privacy",
  },
  { id: "emergency", label: "Emergency card", icon: "alert-circle-outline", group: "Your account" },
  { id: "settings", label: "Settings", icon: "settings-outline", group: "Your account" },
  {
    id: "accountDirectory",
    label: "See everything in Your account",
    icon: "list-outline",
    group: "Your account",
    webviewPath: "/patient/account",
  },
];

/** Drawer band order. "top" is rendered unlabelled, above the rest. */
export const SECTION_GROUP_ORDER = [
  "top",
  "Your health",
  "Stay well",
  "Support",
  "Your account",
] as const;

export const PRIMARY_SECTIONS = SECTIONS.filter((s) => s.primary).slice(0, MAX_PRIMARY_SECTIONS);

/** The path a WebView section should load, or null for a native screen. */
export function sectionWebviewPath(id: SectionId): string | null {
  return SECTIONS.find((s) => s.id === id)?.webviewPath ?? null;
}

export function sectionLabel(id: SectionId): string {
  return SECTIONS.find((s) => s.id === id)?.label ?? id;
}
