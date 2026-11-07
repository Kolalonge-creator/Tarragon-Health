import type { Ionicons } from "@expo/vector-icons";

export type SectionId =
  | "overview"
  | "meals"
  | "sleep"
  | "activity"
  | "exercise"
  | "fasting"
  | "smoking"
  | "alcohol"
  | "myActions"
  | "vitals"
  | "bpHistory"
  | "monthlySummary"
  | "healthReport"
  | "programmes"
  | "medications"
  | "labs"
  | "devices"
  | "prevention"
  | "healthSummary"
  | "timeline"
  | "myHealth"
  | "documents"
  | "dataExchange"
  | "biomarkers"
  | "healthHistory"
  | "symptomJournal"
  | "shareRecords"
  | "myPhones"
  // S50b: the supported eating programme. NOT in the drawer: it is reached only by the link on the Medicines screen, shown only to someone who was offered it.
  | "lowCarb"
  | "womensHealth"
  | "childLog"
  | "sexualHealth"
  | "wellbeing"
  | "healthCheck"
  | "findASpecialist"
  | "directory"
  | "healthyAgeing"
  | "lifestyle"
  | "weightManagement"
  | "learn"
  | "wellness"
  | "care"
  | "messages"
  | "aiCoach"
  | "family"
  | "community"
  | "supporting"
  | "appointments"
  | "screeningDays"
  | "testingDays"
  | "recordsRequests"
  | "passport"
  | "financialProfile"
  | "services"
  | "receipts"
  | "paymentRequests"
  | "notificationSettings"
  | "reminders"
  | "technicalSupport"
  | "privacy"
  | "emergency"
  | "settings";

export interface SectionDef {
  id: SectionId;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Menu group, the same six as the web side menu (patient dashboard 2.0 slice C, apps/web/src/lib/navigation.ts): an unlabelled
   * top group (Home, My actions), then My health, Healthcare, My support, Resources, Account. Regrouped on the phone 2026-11-07
   * (founder, chosen in a prompt; docs/design/PATIENT-DASHBOARD-2.md P7). */
  group: SectionGroup;
  /** Sits behind the group's "More in this group" toggle in the menu, as on the web, so a long group stays scannable. It stays in
   * search, and the toggle opens on its own when the current screen is one of these. */
  more?: boolean;
  /** Promotes this section into the bottom tab bar. Only the first
   * MAX_PRIMARY_SECTIONS are used, ordered by `primaryOrder`. */
  primary?: boolean;
  /** Tab position (lower first), because the tabs come from different menu groups: Home, My Health, Messages, Care plan (PD-01,
   * the same order as the web phone bar in apps/web/src/lib/navigation.ts). Flagged sections without it follow in declaration order. */
  primaryOrder?: number;
  /** Short label for the bottom tab bar, where the full label will not fit. */
  shortLabel?: string;
  /** Bottom bar only: other sections on which this tab shows as active (PD-01: vitals, medicines and results sit inside My Health),
   * the phone twin of the web's `tabAlsoActiveFor`. The menu still highlights those sections' own entries. */
  tabAlsoActiveFor?: readonly SectionId[];
}

export type SectionGroup = (typeof SECTION_GROUP_ORDER)[number];

/** Menu group order, as on the web. "top" is rendered unlabelled, above the rest. */
export const SECTION_GROUP_ORDER = ["top", "My health", "Healthcare", "My support", "Resources", "Account"] as const;

/** Tabs shown before the More button. Four plus More keeps every target
 * comfortably above the 44pt touch minimum on the narrowest phones. */
export const MAX_PRIMARY_SECTIONS = 4;

/**
 * Every section the patient app offers, in menu order: the web side menu's groups and order (apps/web/src/lib/navigation.ts),
 * then the phone's own screens that have no web menu link (on the web they sit inside the "My health record" hub or in search), each
 * behind its group's "More in this group" toggle so nothing becomes unreachable.
 *
 * Five destinations that exist on web were once missing from the app entirely (Learn, Lifestyle coaching, Wellness rewards, the
 * yearly Health Check, and buying a service). They are WebView-backed here, the same proven pattern Care/Prevention/Your people use.
 */
export const SECTIONS: SectionDef[] = [
  // Home: where am I, what needs me today. Unlabelled, never collapsed.
  { id: "overview", label: "Overview", icon: "home-outline", group: "top", primary: true, primaryOrder: 1, shortLabel: "Home" },
  { id: "myActions", label: "My actions", icon: "checkmark-done-outline", group: "top" },

  // My health: my record and the things I log and take, plus the condition and life-stage pages.
  {
    id: "myHealth",
    label: "My Health",
    icon: "id-card-outline",
    group: "My health",
    // The record hub (MyHealthScreen): timeline, results over time, documents, passport, history, plus the everyday record screens.
    primary: true,
    primaryOrder: 2,
    shortLabel: "My Health",
    // PD-01: vitals, medicines and results sit inside My Health on the phone, so the tab stays lit on those screens (web tabAlsoActiveFor;
    // the phone's "Photos of documents" stands in for the web's health records page).
    tabAlsoActiveFor: ["vitals", "medications", "labs", "timeline", "healthSummary", "documents"],
  },
  { id: "vitals", label: "Vitals & symptoms", icon: "pulse-outline", group: "My health" },
  { id: "medications", label: "Medications", icon: "medkit-outline", group: "My health" },
  {
    id: "care",
    label: "Care & support",
    icon: "help-buoy-outline",
    group: "My health",
    // The patient's care plan lives here (CareSupportScreen), as on web (/patient/care), so this is the Care plan tab (PD-01).
    primary: true,
    primaryOrder: 4,
    shortLabel: "Care plan",
  },
  { id: "programmes", label: "Programmes", icon: "people-outline", group: "My health" },
  { id: "healthCheck", label: "Health Check", icon: "clipboard-outline", group: "My health" },
  { id: "prevention", label: "Prevention", icon: "shield-checkmark-outline", group: "My health" },
  { id: "womensHealth", label: "Women's Health", icon: "female-outline", group: "My health", more: true },
  { id: "sexualHealth", label: "Sexual & reproductive health", icon: "heart-outline", group: "My health", more: true },
  { id: "wellbeing", label: "Wellbeing", icon: "happy-outline", group: "My health", more: true },
  { id: "healthyAgeing", label: "Healthy ageing", icon: "accessibility-outline", group: "My health", more: true },
  { id: "lifestyle", label: "Lifestyle coaching", icon: "leaf-outline", group: "My health", more: true },
  { id: "weightManagement", label: "Weight management", icon: "speedometer-outline", group: "My health", more: true },
  // Phone screens with no web menu link (on the web: the My health record hub, or search). Kept in the menu here.
  { id: "healthSummary", label: "Health summary", icon: "document-text-outline", group: "My health", more: true },
  { id: "timeline", label: "Full activity timeline", icon: "time-outline", group: "My health", more: true },
  { id: "biomarkers", label: "Results over time", icon: "stats-chart-outline", group: "My health", more: true },
  { id: "bpHistory", label: "Blood pressure history", icon: "list-outline", group: "My health", more: true },
  { id: "symptomJournal", label: "Symptom journal", icon: "pulse-outline", group: "My health", more: true },
  { id: "healthHistory", label: "Health history", icon: "clipboard-outline", group: "My health", more: true },
  { id: "monthlySummary", label: "Your month", icon: "calendar-outline", group: "My health", more: true },
  { id: "healthReport", label: "Your yearly report", icon: "document-text-outline", group: "My health", more: true },
  { id: "documents", label: "Photos of documents", icon: "camera-outline", group: "My health", more: true },
  { id: "dataExchange", label: "Records from other places", icon: "swap-horizontal-outline", group: "My health", more: true },
  { id: "shareRecords", label: "Share records", icon: "share-outline", group: "My health", more: true },
  { id: "reminders", label: "Reminders", icon: "alarm-outline", group: "My health", more: true },
  { id: "childLog", label: "Baby's daily log", icon: "happy-outline", group: "My health", more: true },
  // The five daily trackers, native since the lifestyle-tracker pass, reachable directly as well as from Lifestyle coaching.
  { id: "meals", label: "Meals", icon: "restaurant-outline", group: "My health", more: true },
  { id: "sleep", label: "Sleep", icon: "moon-outline", group: "My health", more: true },
  { id: "activity", label: "Movement", icon: "walk-outline", group: "My health", more: true },
  { id: "exercise", label: "Exercise programmes", icon: "barbell-outline", group: "My health", more: true },
  { id: "fasting", label: "Fasting and your health", icon: "moon-outline", group: "My health", more: true },
  { id: "smoking", label: "Smoking", icon: "flame-outline", group: "My health", more: true },
  { id: "alcohol", label: "Alcohol", icon: "wine-outline", group: "My health", more: true },

  // Healthcare: tests, results, visits and the services I can book.
  { id: "labs", label: "Labs & results", icon: "flask-outline", group: "Healthcare" },
  { id: "appointments", label: "Appointments", icon: "calendar-outline", group: "Healthcare" },
  { id: "findASpecialist", label: "Find a specialist", icon: "search-outline", group: "Healthcare" },
  { id: "directory", label: "Find care near you", icon: "location-outline", group: "Healthcare" },
  // The one-off service catalogue (video visits, Ask a doctor, second opinions, verified documents).
  { id: "services", label: "My services", icon: "card-outline", group: "Healthcare" },
  { id: "screeningDays", label: "Group screening days", icon: "people-circle-outline", group: "Healthcare" },
  // Testing days are closed to new bookings (T2-02); the screen shows a place someone already holds and where yearly tests happen now.
  { id: "testingDays", label: "Testing days", icon: "calendar-outline", group: "Healthcare" },

  // My support: the people: care team messages, family, community.
  { id: "messages", label: "Messages", icon: "chatbox-ellipses-outline", group: "My support", primary: true, primaryOrder: 3, shortLabel: "Messages" },
  { id: "aiCoach", label: "AI Health Coach", icon: "sparkles-outline", group: "My support" },
  { id: "family", label: "Your people", icon: "people-outline", group: "My support" },
  // Community groups (docs/COMMUNITY_SPEC.md). Shown in the menu only while the go-live guard is on and the person is an adult
  // with their own account (lib/community/entry.ts); the menu filters it out otherwise.
  { id: "community", label: "Community", icon: "chatbubbles-outline", group: "My support" },
  { id: "supporting", label: "People you support", icon: "hand-left-outline", group: "My support" },
  { id: "notificationSettings", label: "Notification settings", icon: "notifications-outline", group: "My support" },

  // Resources: reading, rewards and help.
  { id: "learn", label: "Learn", icon: "school-outline", group: "Resources" },
  { id: "wellness", label: "Wellness rewards", icon: "trophy-outline", group: "Resources" },
  { id: "technicalSupport", label: "Technical support", icon: "construct-outline", group: "Resources" },

  // Account: my details, money, privacy; the Emergency card last, as on the web.
  { id: "settings", label: "Settings", icon: "settings-outline", group: "Account" },
  { id: "financialProfile", label: "Your finances", icon: "wallet-outline", group: "Account" },
  { id: "devices", label: "Devices", icon: "bluetooth-outline", group: "Account" },
  { id: "privacy", label: "Privacy & data", icon: "lock-closed-outline", group: "Account" },
  { id: "passport", label: "Health Passport", icon: "id-card-outline", group: "Account", more: true },
  { id: "recordsRequests", label: "Ask for your records", icon: "document-text-outline", group: "Account", more: true },
  { id: "receipts", label: "Receipts", icon: "receipt-outline", group: "Account", more: true },
  { id: "paymentRequests", label: "Ask someone to pay", icon: "share-social-outline", group: "Account", more: true },
  { id: "myPhones", label: "My phones", icon: "phone-portrait-outline", group: "Account", more: true },
  { id: "emergency", label: "Emergency card", icon: "alert-circle-outline", group: "Account" },
];

/** Whether a bottom tab shows as active on this section: its own section, or one it stands in for (PD-01, web tabIsActive). */
export function tabIsActive(tab: Pick<SectionDef, "id" | "tabAlsoActiveFor">, active: SectionId): boolean {
  return tab.id === active || (tab.tabAlsoActiveFor?.includes(active) ?? false);
}

/** The patient's bottom tabs: Home, My Health, Messages, Care plan (PD-01), then More. */
export const PRIMARY_SECTIONS = SECTIONS.map((s, index) => ({ s, index }))
  .filter(({ s }) => s.primary)
  .sort((a, b) => (a.s.primaryOrder ?? Number.MAX_SAFE_INTEGER) - (b.s.primaryOrder ?? Number.MAX_SAFE_INTEGER) || a.index - b.index)
  .slice(0, MAX_PRIMARY_SECTIONS)
  .map(({ s }) => s);

/**
 * A supporter-only account (profiles.receives_care = false) has no health record here, so its app opens on the people it supports
 * and offers only what such an account is for. Mirrors the web proxy's allow-list for the same accounts (apps/web/src/proxy.ts): the
 * people they support, their own people, messages, paying and receipts, group screening days, and the account's own settings.
 */
export const SUPPORTER_SECTION_IDS: readonly SectionId[] = [
  "supporting",
  "messages",
  "family",
  "screeningDays",
  "receipts",
  "paymentRequests",
  "notificationSettings",
  "technicalSupport",
  "privacy",
  "myPhones",
  "settings",
];

/** The supporter-only bottom tabs: the people they support first, then messages, their own people and receipts. */
export const SUPPORTER_PRIMARY_SECTIONS: SectionDef[] = (["supporting", "messages", "family", "receipts"] as const)
  .map((id) => SECTIONS.find((s) => s.id === id))
  .filter((s): s is SectionDef => s !== undefined)
  .map((s) => (s.id === "supporting" ? { ...s, shortLabel: "People" } : s));

/** Where a supporter-only account may go; anything else (a notification tap, an old link) lands on the people they support. */
export function supporterSection(id: SectionId): SectionId {
  return SUPPORTER_SECTION_IDS.includes(id) ? id : "supporting";
}
