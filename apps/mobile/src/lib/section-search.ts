import { SECTIONS, type SectionId } from "./sections";

/** Words a person would type for a section whose name does not say it. Only sections open to the account are searched (the drawer passes its own list). */
export const SECTION_KEYWORDS: Partial<Record<SectionId, string>> = {
  vitals: "blood pressure bp sugar glucose pulse heart rate oxygen temperature reading log",
  bpHistory: "blood pressure bp readings",
  medications: "tablets pills drugs dose refill reminder medicine",
  labs: "results blood test hba1c cholesterol lipid kidney liver",
  biomarkers: "results trend blood test",
  appointments: "book visit consultation video doctor",
  messages: "chat doctor nurse ask question care team",
  prevention: "screening vaccine vaccination immunisation cancer",
  womensHealth: "period cycle pregnancy fertility menopause contraception",
  wellbeing: "mental anxiety depression stress mood breathing calm",
  devices: "bluetooth apple health fitbit sync wearable cuff glucometer",
  sleep: "rest tired insomnia",
  alcohol: "drink drinking beer wine",
  smoking: "cigarette tobacco quit vape",
  exercise: "walking workout fitness activity",
  activity: "steps walking fitness",
  meals: "food diet eating meal calories nutrition",
  weightManagement: "weight bmi waist kg scale",
  healthCheck: "annual yearly checkup screening",
  family: "caregiver parent child dependant share access",
  emergency: "urgent emergency contact allergies blood group",
  settings: "account name phone email address language",
};

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

function tokenScore(token: string, label: string, other: string): number {
  if (label === token) return 120;
  if (label.startsWith(token)) return 100;
  if (label.split(/[^a-z0-9]+/).some((w) => w.startsWith(token))) return 80;
  if (label.includes(token)) return 60;
  if (other.split(/[^a-z0-9]+/).some((w) => w.startsWith(token))) return 40;
  if (other.includes(token)) return 20;
  return 0;
}

export interface SectionMatch {
  id: SectionId;
  label: string;
  group: string;
}

/**
 * Sections matching what was typed: every word must match something (the label scores highest, then the group and typed-word list).
 * `visible` is the account's own list, so a hidden section is never offered. An empty query matches nothing: the drawer shows its normal menu.
 */
export function searchSections(visible: readonly SectionId[], query: string, labelOf: (label: string) => string, limit = 8): SectionMatch[] {
  const tokens = norm(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const scored: { m: SectionMatch; score: number; index: number }[] = [];
  SECTIONS.forEach((s, index) => {
    if (!visible.includes(s.id) || s.id === "overview") return;
    const label = labelOf(s.label);
    const l = norm(label);
    const other = norm(`${s.group} ${SECTION_KEYWORDS[s.id] ?? ""}`);
    let total = 0;
    for (const token of tokens) {
      const sc = tokenScore(token, l, other);
      if (sc === 0) return;
      total += sc;
    }
    scored.push({ m: { id: s.id, label, group: s.group }, score: total, index });
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).map((x) => x.m);
}
