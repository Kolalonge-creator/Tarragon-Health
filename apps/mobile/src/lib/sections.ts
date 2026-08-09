import type { Ionicons } from "@expo/vector-icons";

export type SectionId =
  | "overview"
  | "vitals"
  | "medications"
  | "labs"
  | "care"
  | "prevention"
  | "family"
  | "passport"
  | "messages"
  | "emergency"
  | "settings";

interface SectionDef {
  id: SectionId;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Sections without a native screen render this platform path in a WebView. */
  webviewPath?: string;
}

/** Drawer order and native-vs-WebView split — mirrors docs/MOBILE_APP_SPEC.md
 * §2's per-screen decision and the Claude Design prototype's drawer. */
export const SECTIONS: SectionDef[] = [
  { id: "overview", label: "Overview", icon: "home-outline" },
  { id: "vitals", label: "Vitals & symptoms", icon: "pulse-outline" },
  { id: "medications", label: "Medications", icon: "medkit-outline" },
  { id: "labs", label: "Labs & results", icon: "flask-outline" },
  { id: "care", label: "Care & support", icon: "help-buoy-outline", webviewPath: "/patient/care" },
  {
    id: "prevention",
    label: "Prevention",
    icon: "shield-checkmark-outline",
    webviewPath: "/patient/prevention",
  },
  { id: "family", label: "Your people", icon: "people-outline", webviewPath: "/patient/family" },
  { id: "passport", label: "Health Passport", icon: "id-card-outline" },
  { id: "messages", label: "Messages", icon: "chatbox-ellipses-outline" },
  { id: "emergency", label: "Emergency card", icon: "alert-circle-outline" },
  { id: "settings", label: "Settings", icon: "settings-outline" },
];

export function sectionLabel(id: SectionId): string {
  return SECTIONS.find((s) => s.id === id)?.label ?? id;
}
