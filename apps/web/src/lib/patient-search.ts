import type { AdminSearchEntry } from "@/lib/admin-search";
import { buildAdminSearchIndex } from "@/lib/admin-search";
import type { NavSection } from "@/lib/navigation";

/**
 * Search for patients: the pages in their menu plus the everyday pages that sit behind a section, each with the words a
 * person would actually type ("tablets", "sugar", "results"). It reuses the admin search engine and index builder, so
 * there is one matcher. Only pages open to every patient are listed; anything hidden or switched off is left out so a
 * search can never lead to a dead end.
 */
export const PATIENT_EXTRA_PAGES: AdminSearchEntry[] = [
  { label: "Blood pressure and vitals", href: "/patient/vitals", group: "Your numbers", hint: "Log and see your readings.", keywords: "bp sugar glucose pulse heart rate oxygen temperature reading log" },
  { label: "Weight", href: "/patient/weight", group: "Your numbers", hint: "Your weight and goal.", keywords: "bmi waist kg scale" },
  { label: "Sleep", href: "/patient/sleep", group: "Your numbers", hint: "Hours slept, night by night.", keywords: "rest tired insomnia" },
  { label: "Alcohol", href: "/patient/alcohol", group: "Your habits", hint: "Drinks this week.", keywords: "drink drinking beer wine" },
  { label: "Smoking", href: "/patient/smoking", group: "Your habits", hint: "Your smoke-free streak.", keywords: "cigarette tobacco quit vape" },
  { label: "Exercise", href: "/patient/exercise", group: "Your habits", hint: "Programmes to build activity safely.", keywords: "walking workout fitness activity" },
  { label: "Nutrition", href: "/patient/nutrition", group: "Your habits", hint: "Meals and food.", keywords: "food diet eating meal calories" },
  { label: "Lab results", href: "/patient/labs", group: "Tests", hint: "Your results and lab requests.", keywords: "blood test results hba1c cholesterol lipid kidney liver" },
  { label: "Health Check", href: "/patient/health-check", group: "Tests", hint: "Your yearly whole-body check, step by step.", keywords: "annual yearly screening checkup" },
  { label: "Health Score", href: "/patient/health-score", group: "Tests", hint: "How your score has moved and what feeds it.", keywords: "score rating progress" },
  { label: "Medications", href: "/patient/medications", group: "Care", hint: "Today's doses and your medicines.", keywords: "tablets pills drugs dose refill reminder medicine" },
  { label: "Messages", href: "/patient/messages", group: "Care", hint: "Write to your care team.", keywords: "chat doctor nurse ask question" },
  { label: "Appointments", href: "/patient/appointments", group: "Care", hint: "Book and see your visits.", keywords: "book visit consultation video clinic" },
  { label: "Emergency card", href: "/patient/emergency-card", group: "Safety", hint: "Your emergency contact and key details.", keywords: "emergency contact allergies blood group urgent" },
  { label: "Prevention", href: "/patient/prevention", group: "Care", hint: "Screenings and vaccines you are due.", keywords: "screening vaccine vaccination immunisation cancer" },
  { label: "Women's health", href: "/patient/womens-health", group: "Care", hint: "Cycle, pregnancy and more.", keywords: "period cycle pregnancy fertility menopause contraception" },
  { label: "Wellbeing", href: "/patient/wellbeing", group: "Care", hint: "Mood, stress and breathing.", keywords: "mental anxiety depression stress mood breathing calm" },
  { label: "Devices", href: "/patient/devices", group: "Settings", hint: "Connect a watch or monitor.", keywords: "bluetooth apple health fitbit sync wearable cuff glucometer" },
  { label: "Your profile", href: "/patient/profile", group: "Settings", hint: "Your details, contacts and preferences.", keywords: "account name phone email address language reminders" },
  { label: "Family and carers", href: "/patient/family", group: "Settings", hint: "People who help look after you.", keywords: "caregiver parent child dependant share access" },
];

/** The curated pages first (they carry the typed words), then any menu page they do not already cover. */
export function buildPatientSearchIndex(sections: NavSection[]): AdminSearchEntry[] {
  const curated = buildAdminSearchIndex([], [], PATIENT_EXTRA_PAGES);
  const have = new Set(curated.map((e) => e.href));
  const fromMenu = buildAdminSearchIndex(sections, [], []).filter((e) => !have.has(e.href));
  return [...curated, ...fromMenu];
}
