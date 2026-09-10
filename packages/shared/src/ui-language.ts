/**
 * Interface language for the patient app.
 *
 * WHY THIS EXISTS: the platform is English-only by founder decision
 * (2026-08-03), and that decision holds for clinical content. But "ordinary
 * Nigerian patient" and "reads clinical English comfortably" are not the same
 * population, and every navigation label, action button and setup step in the
 * app assumed they were. Nigerian Pidgin is the widest-reach lingua franca in
 * the country, so it is the single highest-leverage addition here.
 *
 * `pcm` is the ISO 639-3 code for Nigerian Pidgin (Naija). Stored in the
 * long-existing `profiles.language` column, which had no consumer until now.
 *
 * ── THE BOUNDARY, WHICH IS THE IMPORTANT PART ──────────────────────────────
 * This dictionary carries WAYFINDING ONLY: navigation labels, action buttons,
 * tab labels, and the get-started steps. It deliberately does NOT carry:
 *
 *   - clinical guidance or thresholds (the hypo rule, BP bands, red flags)
 *   - emergency copy, or anything on the acknowledge-gated safety path
 *   - medication names, doses or instructions
 *   - consent, privacy or legal text
 *
 * A half-translated safety instruction is worse than an untranslated one: the
 * patient cannot tell which half they are reading. Those surfaces stay in one
 * language until a clinician has signed off a translation, which is a
 * governance step, not a coding one. Adding a clinical string to this file is
 * therefore a clinical decision, not a copy tweak -- see
 * docs/CLINICAL_FEATURE_CHECKLIST.md.
 *
 * ── REVIEW STATUS ──────────────────────────────────────────────────────────
 * These strings have NOT been reviewed by a native Pidgin speaker. They read
 * plausibly, but register and idiom are exactly the things a non-native writer
 * gets subtly wrong, and "subtly wrong" in a health app reads as unserious.
 * Treat this as a working draft to be corrected by a real speaker before it is
 * promoted anywhere public.
 */
export const UI_LANGUAGES = ["en", "pcm"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export const DEFAULT_UI_LANGUAGE: UiLanguage = "en";

export const UI_LANGUAGE_LABEL: Record<UiLanguage, string> = {
  en: "English",
  pcm: "Pidgin",
};

/**
 * Keyed by the exact English source string rather than by an abstract key.
 *
 * That choice is deliberate and is what makes this cheap: nothing in
 * lib/navigation.ts or apps/mobile/src/lib/sections.ts has to change, a new
 * nav item added by someone who has never read this file degrades to English
 * instead of rendering a raw key, and the call site stays readable
 * (`t(item.label, lang)`). The cost is that editing an English label silently
 * drops its translation -- covered by ui-language.test.ts, which asserts every
 * patient-facing nav label still has an entry here.
 */
const PIDGIN: Record<string, string> = {
  // ── Navigation: everyday band ──
  "Overview": "Home",
  "My actions": "Wetin you suppose do",
  "Vitals & symptoms": "Your body readings",
  "Medications": "Your medicine",
  "Labs & results": "Test results",
  "Messages": "Message",
  "Appointments": "Appointment",

  // ── Navigation: Your health ──
  "Your health": "Your health",
  "Health summary": "Your health summary",
  "Prevention": "Checks wey dey prevent sickness",
  "Women's Health": "Woman health",
  "Sexual & reproductive health": "Sexual health",
  "Wellbeing": "How you dey feel",
  "Health Check": "Health check",
  "Find a specialist": "Find specialist",
  "Healthy ageing": "Healthy ageing",
  "Get a device": "Get machine",

  // ── Navigation: Stay well ──
  "Stay well": "Stay well",
  "Lifestyle coaching": "Food & body coaching",
  "Weight management": "Weight matter",
  "Learn": "Learn",
  "Wellness rewards": "Reward",

  // ── Navigation: Support ──
  "Support": "Help",
  "Care & support": "Care & help",
  "Family": "Your family",
  "Your people": "Your people",
  "People you support": "People wey you dey help",
  "Group screening days": "Group screening day",

  // ── Navigation: Your account ──
  "Your account": "Your account",
  "Health Passport": "Health passport",
  "Your finances": "Your money",
  "My services": "Wetin you don pay for",
  "Payments": "Payment",
  "Receipts": "Receipt",
  "Notification settings": "Alert settings",
  "Technical support": "App wahala",
  "Profile": "Your profile",
  "Settings": "Settings",
  "Privacy & data": "Privacy & your data",
  "Devices": "Machine",
  "Emergency card": "Emergency card",

  // ── Phone tab bar (short labels; space is tight) ──
  "Home": "Home",
  "Vitals": "Readings",
  "Meds": "Medicine",
  "People": "People",
  "Screening": "Screening",
  "More": "More",

  // ── Quick actions (label + hint) ──
  "Quick actions": "Quick things",
  "Your numbers": "Your numbers",
  "Everyday": "Everyday",
  "Log a reading": "Enter your reading",
  "BP, sugar, weight": "BP, sugar, weight",
  "Today's doses": "Today medicine",
  "Tick off your medicines": "Mark the ones you don take",
  "Upload a result": "Send your result",
  "A doctor reads it": "Doctor go read am",
  "Message your care team": "Message your care team",
  "In the app, always on record": "For inside app, e dey on record",
  "Food, weight, movement": "Food, weight, movement",
  "Plain-language health reading": "Health talk wey easy to read",
  "Your cycle": "Your period",
  "Log your period, see what's next": "Mark your period, see wetin dey come",

  // ── Get started card ──
  "0 of 3 done": "0 out of 3 done",
  "1 of 3 done": "1 out of 3 done",
  "2 of 3 done": "2 out of 3 done",
  "3 of 3 done": "3 out of 3 done",
  "About two minutes. It builds your personal screening and vaccination calendar: the checks that keep well people well.":
    "Na like two minutes. E go build your own screening and vaccination calendar: the checks wey dey keep well person well.",
  "Blood pressure, blood sugar or weight, from any meter, typed in by hand. This is what the care team looks at.":
    "Blood pressure, blood sugar or weight, from any machine, you fit type am by hand. Na wetin your care team dey look.",
  "Whatever you take now. Once they are on the list, you get dose reminders and refill nudges.":
    "Whatever you dey take now. Once dem dey the list, you go dey get reminder for dose and refill.",
  "All of this is free. You are only ever charged for a doctor's time, and only when you ask for it.":
    "All of this na free. Na only doctor time you dey ever pay for, and na only when you ask for am.",
  "Three things to set up": "Three things wey you go set up",
  "Fill in the health profile": "Fill your health profile",
  "Start the profile": "Start am",
  "Log the first reading": "Enter your first reading",
  "Add the medicines": "Add your medicine",
  "Add your medicines": "Add your medicine",
  "Add a medicine": "Add medicine",
};

/**
 * The Pidgin for `english`, or `english` unchanged when there is no entry.
 *
 * Never throws and never returns a key: a missing translation must degrade to
 * readable English, not to a broken screen.
 */
export function t(english: string, language: UiLanguage): string {
  if (language !== "pcm") return english;
  return PIDGIN[english] ?? english;
}

/** Narrow a raw `profiles.language` value (plain `text` in the generated
 * types, since Supabase codegen does not reflect CHECK constraints). */
export function asUiLanguage(value: string | null | undefined): UiLanguage {
  return value === "pcm" ? "pcm" : DEFAULT_UI_LANGUAGE;
}

/** Exported for the coverage test only. */
export function hasPidgin(english: string): boolean {
  return english in PIDGIN;
}
