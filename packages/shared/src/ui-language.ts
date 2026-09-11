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
  "Meals": "Food",
  "Sleep": "Sleep",
  "Movement": "Movement",
  "Smoking": "Smoking",
  "Alcohol": "Alcohol",
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

  // ── Lifestyle trackers (native mobile shell; sleep/alcohol/smoking/
  // movement/meals) ── Deliberately narrow: the question being asked, the
  // save button, the empty state and the shared shell's chrome. Short
  // stat-tile labels ("Your target", "This week", "Quit date", "Daily step
  // goal") and the meal-type chips ("Breakfast"/"Lunch"/"Dinner"/"Snack")
  // are left to degrade to English on purpose -- they read fine as
  // loanwords and a guess at a shorter Pidgin form risks landing worse than
  // the English, see navigation-pidgin-coverage.test.ts's NOT_TRANSLATED
  // set for the same trade-off made on nav labels.
  "Last 30 days": "Last 30 days",
  "Saved.": "E don save.",

  "Log how you slept. Over a few weeks this shows a pattern you and your care team can see.":
    "Track how you sleep. After some weeks, e go show pattern wey you and your care team go fit see.",
  "How long did you sleep?": "How long you sleep?",
  "How was it, 1 to 5?": "How e be, 1 to 5?",
  "How sleepy were you in the day, 1 to 5?": "How sleepy you be for daytime, 1 to 5?",
  "Save tonight's sleep": "Save tonight sleep",
  "Nothing logged yet. Tonight is a good place to start.":
    "Nothing dey log yet. Tonight na good place to start.",

  "Keep a simple count of what you drink. No judgement, just the number.":
    "Just dey count wetin you drink. No judgement, na only the number.",
  "How many drinks today?": "How many drink you take today?",
  "Anything worth noting?": "Anything wey worth noting?",
  "Save today": "Save am",
  "Nothing logged yet.": "Nothing dey log yet.",

  "Check in on how the day went. Cravings count too, even on a day you did not smoke.":
    "Check in for how the day go. Craving dey count too, even for the day wey you no smoke.",
  "How many cigarettes today?": "How many cigarette you smoke today?",
  "How strong were the cravings, 1 to 5?": "How strong the craving be, 1 to 5?",

  "Anything counts: a walk, housework, football. Write what you did and for how long.":
    "Anything dey count: waka, house work, football. Write wetin you do and how long e take.",
  "What did you do?": "Wetin you do?",
  "For how many minutes?": "How many minutes e take?",
  "Save it": "Save am",

  "Write down what you ate. Over time it helps you and your care team see what is working. To add a photo and get a carb estimate, open Meals on the website.":
    "Write down wetin you chop. Over time e go help you and your care team see wetin dey work. To add photo make you get carb estimate, open Meals for the website.",
  "Which meal?": "Which food?",
  "What did you eat?": "Wetin you chop?",
  "Save this meal": "Save this food",
  "Nothing logged yet. Your next meal is a fine place to start.":
    "Nothing dey log yet. Your next food na good place to start.",

  // ── Lifestyle trackers (web; sleep/smoking/alcohol/activity/nutrition) ──
  // The web versions are richer forms than the native shell above (a goal
  // card plus a log card, a step ring, an AI photo estimate, condition
  // guidance), so this covers the same class of copy -- card titles, field
  // labels, buttons, static helper text and empty/loading/success states --
  // and leaves the same two classes untranslated on purpose: enum-driven
  // labels that live in packages outside this file (SMOKING_STATUS_LABELS,
  // SMOKING_TRIGGER_LABELS, ALCOHOL_CONTEXT_LABELS, DAYTIME_SLEEPINESS_LABELS,
  // COMMON_ACTIVITY_NAMES, MEAL_TYPE_LABELS -- translating those means
  // editing shared validation files other things also read, not a copy
  // change here), and any sentence assembled from clinical/guidance content
  // generated elsewhere at runtime (GuidanceBlock's condition-specific
  // messages, the AI carb/calorie estimate breakdown) -- those are not
  // literal strings in this dictionary's keyed-lookup model to begin with.
  "Loading…": "E dey load…",
  "Saving…": "E dey save…",
  "Logged.": "E don log.",
  "History": "Wetin you don log",
  "Close": "Close",
  "Update": "Update",
  "Cancel": "Cancel",
  "Save": "Save am",
  "Set a goal": "Set one goal",
  "Save goal": "Save the goal",

  "Your sleep goal": "Your sleep goal",
  "Target hours": "How many hours you dey target",
  "Log last night": "Log last night sleep",
  "Hours slept": "How many hours you sleep",
  "Quality (1-5)": "How e be, 1 to 5",
  "Bedtime": "Bedtime",
  "Wake time": "Wake time",
  "How likely are you to doze off during the day?": "How e likely say you go sleep for daytime?",
  "Not sure": "Not sure",
  "Daytime sleepiness:": "Daytime sleepiness:",

  "Today's check-in": "Today check-in",
  "Want some support?": "You want small support?",
  "Read up on quitting, or message your care team if you'd like a hand.":
    "Read about how to quit, or message your care team if you want person help you.",
  "Message care team": "Message care team",
  "Your smoking status": "Your smoking status",
  "Status": "Status",
  "Cigarettes per day": "How many cigarette per day",
  "Years smoking": "How many years you don dey smoke",
  "Quit motivation (0-10)": "How much you wan quit, 0 to 10",
  "Target quit date": "Date wey you dey target to quit",
  "Cigarettes today": "Cigarette today",
  "Cravings (0-10)": "Craving, 0 to 10",
  "Any triggers today?": "Anything wey trigger you today?",
  "Save check-in": "Save the check-in",

  "Not sure where you stand?": "You no too sure where you stand?",
  "Retake the AUDIT-C screen, or read up on cutting back.":
    "Do the AUDIT-C screening again, or read about how to cut back.",
  "Weekly goal": "Weekly goal",
  "No goal set yet. Set one whenever you're ready.": "No goal dey set yet. Set one whenever you ready.",
  "Target drinks per week": "How many drink you dey target per week",
  "Log today's drinks": "Log today drinks",
  "Standard drinks": "Standard drinks",
  "Context": "Wetin dey happen",
  "Not specified": "No specify",

  "Today": "Today",
  "Edit steps": "Edit steps",
  "Goal reached, nice work": "You reach your goal, well done",
  "This week's activity guideline": "This week activity guideline",
  "Weekly guideline reached, nice work.": "You reach the weekly guideline, well done.",
  "Log today's steps": "Log today steps",
  "Save steps": "Save the steps",
  "Daily step goal": "Daily step goal",
  "Log a workout": "Log workout",
  "Duration (min)": "How long e take, minutes",
  "Log workout": "Log the workout",

  "Log a meal": "Log a food",
  "Meal": "Food",
  "What did you eat? (optional)": "Wetin you chop? (no be must)",
  "Photo (optional)": "Photo (no be must)",
  "We'll match this against our Nigerian food list to estimate calories, carbs, protein, fat, fibre and sodium. You can describe portions in everyday terms like a plate, cup, spoon, handful, piece or serving.":
    "We go check am against our Nigerian food list make we estimate calories, carbs, protein, fat, fibre and sodium. You fit describe the portion the way you dey talk am everyday -- plate, cup, spoon, handful, piece or serving.",
  "Add a photo and we'll estimate the portions and carbs for you: a coaching guide, not a medical measurement.":
    "Add photo make we estimate the portion and carbs for you: na coaching guide, e no be medical measurement.",
  "Photo estimates aren't switched on yet; your meal still logs with the details you add.":
    "Photo estimate no dey switch on yet; your food still go log with the details wey you add.",
  "Log meal": "Log the food",
  "Logging…": "E dey log…",
  "Logged. We've added an estimate below. Check and confirm it.":
    "E don log. We don add estimate for below. Check am well and confirm am.",
  "Logged. We couldn't estimate this photo automatically. You can add details.":
    "E don log. We no fit estimate this photo automatic. You fit add details.",
  "Recent meals": "The food wey you don log",
  "No meals logged yet.": "No food dey log yet.",
  "Adjust carbs (g, optional)": "Adjust the carbs (g, no be must)",
  "Confirm": "Confirm",
  "Confirmed": "E don confirm",
  "No automatic estimate for this meal.": "No automatic estimate for this food.",
  "Need a cheaper option?": "You need option wey cheaper?",
  "Tell us what you can't afford right now, and we'll suggest a local, budget-friendly swap with a similar role on the plate.":
    "Tell us wetin you no fit afford now, we go suggest one local option wey go cheaper but still fit stand for your plate.",
  "Suggest": "Suggest",
  "Checking…": "E dey check…",
  "We don't have a specific suggestion for that yet. Generally affordable everyday options include beans, eggs, garri and seasonal vegetables.":
    "We no get specific suggestion for that one yet. Generally, food wey dey cheap everyday na beans, eggs, garri and seasonal vegetables.",
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
