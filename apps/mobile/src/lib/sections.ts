import type { Ionicons } from "@expo/vector-icons";

export type SectionId =
  | "overview"
  | "meals"
  | "sleep"
  | "activity"
  | "smoking"
  | "alcohol"
  | "myActions"
  | "vitals"
  | "medications"
  | "labs"
  | "devices"
  | "prevention"
  | "healthSummary"
  | "womensHealth"
  | "sexualHealth"
  | "wellbeing"
  | "healthCheck"
  | "findASpecialist"
  | "healthyAgeing"
  | "lifestyle"
  | "weightManagement"
  | "learn"
  | "wellness"
  | "care"
  | "messages"
  | "aiCoach"
  | "family"
  | "supporting"
  | "appointments"
  | "screeningDays"
  | "passport"
  | "financialProfile"
  | "services"
  | "receipts"
  | "notificationSettings"
  | "technicalSupport"
  | "privacy"
  | "emergency"
  | "settings";

interface SectionDef {
  id: SectionId;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
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
 * Five destinations that exist on web were missing from the app entirely —
 * not merely un-implemented natively, but absent from the drawer with no way
 * to reach them at all: the Learn library, Lifestyle coaching, Wellness
 * rewards, the yearly Health Check, and buying a service. A patient could not
 * open the lifestyle programme they were paying for, or read a single
 * health-education article, from their phone. They are WebView-backed here
 * for now, the same proven pattern Care/Prevention/Your people already use,
 * which is what makes closing the gap a matter of routing rather than of
 * rebuilding five screens natively.
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
    id: "myActions",
    label: "My actions",
    icon: "checkmark-done-outline",
    group: "top",
  },

  {
    id: "vitals",
    label: "Vitals & symptoms",
    icon: "pulse-outline",
    group: "top",
    primary: true,
    shortLabel: "Vitals",
  },
  {
    id: "medications",
    label: "Medications",
    icon: "medkit-outline",
    group: "top",
    primary: true,
    shortLabel: "Meds",
  },
  { id: "labs", label: "Labs & results", icon: "flask-outline", group: "top" },
  { id: "devices", label: "Devices", icon: "bluetooth-outline", group: "Your health" },
  {
    id: "prevention",
    label: "Prevention",
    icon: "shield-checkmark-outline",
    group: "Your health",
  },
  {
    id: "healthSummary",
    label: "Health summary",
    icon: "document-text-outline",
    group: "Your health",
  },
  {
    id: "womensHealth",
    label: "Women's Health",
    icon: "female-outline",
    group: "Your health",
  },
  {
    id: "sexualHealth",
    label: "Sexual & reproductive health",
    icon: "heart-outline",
    group: "Your health",
  },
  {
    id: "wellbeing",
    label: "Wellbeing",
    icon: "happy-outline",
    group: "Your health",
  },
  {
    id: "healthCheck",
    label: "Health Check",
    icon: "clipboard-outline",
    group: "Your health",
  },
  {
    id: "findASpecialist",
    label: "Find a specialist",
    icon: "search-outline",
    group: "Your health",
  },
  {
    id: "healthyAgeing",
    label: "Healthy ageing",
    icon: "accessibility-outline",
    group: "Your health",
  },

  // The four daily trackers, native since the lifestyle-tracker pass. They
  // sit in "Stay well" beside the hub that links them, and are reachable
  // from the drawer directly as well as from Lifestyle coaching -- somebody
  // logging sleep every night should not have to go through a hub to do it.
  { id: "meals", label: "Meals", icon: "restaurant-outline", group: "Stay well" },
  { id: "sleep", label: "Sleep", icon: "moon-outline", group: "Stay well" },
  { id: "activity", label: "Movement", icon: "walk-outline", group: "Stay well" },
  { id: "smoking", label: "Smoking", icon: "flame-outline", group: "Stay well" },
  { id: "alcohol", label: "Alcohol", icon: "wine-outline", group: "Stay well" },
  {
    id: "lifestyle",
    label: "Lifestyle coaching",
    icon: "leaf-outline",
    group: "Stay well",
  },
  {
    id: "weightManagement",
    label: "Weight management",
    icon: "speedometer-outline",
    group: "Stay well",
  },
  {
    id: "learn",
    label: "Learn",
    icon: "school-outline",
    group: "Stay well",
  },
  {
    id: "wellness",
    label: "Wellness rewards",
    icon: "trophy-outline",
    group: "Stay well",
  },

  {
    id: "messages",
    label: "Messages",
    icon: "chatbox-ellipses-outline",
    group: "top",
    primary: true,
    shortLabel: "Messages",
  },
  {
    id: "aiCoach",
    label: "AI Health Coach",
    icon: "sparkles-outline",
    group: "Support",
  },
  {
    id: "appointments",
    label: "Appointments",
    icon: "calendar-outline",
    group: "top",
  },
  // Promoted to just below Appointments (2026-09-11), mirroring web's
  // navigation.ts — this is where the paid-per-service doctor-time revenue
  // lives (video visits, Ask a doctor, second opinions, verified documents,
  // senior case review).
  {
    id: "care",
    label: "Care & support",
    icon: "help-buoy-outline",
    group: "Support",
  },
  // Promoted out of "Your account" (2026-09-11), mirroring web's
  // navigation.ts — the buy page for the same paid-per-service doctor-time
  // revenue belongs next to Care & support, not four rows down an
  // admin-flavoured band.
  {
    id: "services",
    label: "My services",
    icon: "card-outline",
    group: "Support",
  },
  {
    id: "family",
    label: "Your people",
    icon: "people-outline",
    group: "Support",
  },
  { id: "supporting", label: "People you support", icon: "hand-left-outline", group: "Support" },
  {
    id: "screeningDays",
    label: "Group screening days",
    icon: "people-circle-outline",
    group: "Support",
  },

  { id: "passport", label: "Health Passport", icon: "id-card-outline", group: "Your account" },
  {
    id: "financialProfile",
    label: "Your finances",
    icon: "wallet-outline",
    group: "Your account",
  },
  {
    id: "receipts",
    label: "Receipts",
    icon: "receipt-outline",
    group: "Your account",
  },
  {
    id: "notificationSettings",
    label: "Notification settings",
    icon: "notifications-outline",
    group: "Your account",
  },
  {
    id: "technicalSupport",
    label: "Technical support",
    icon: "construct-outline",
    group: "Your account",
  },
  {
    id: "privacy",
    label: "Privacy & data",
    icon: "lock-closed-outline",
    group: "Your account",
  },
  { id: "emergency", label: "Emergency card", icon: "alert-circle-outline", group: "Your account" },
  { id: "settings", label: "Settings", icon: "settings-outline", group: "Your account" },
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
