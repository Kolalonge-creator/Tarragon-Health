import type { AppIconName } from "@/lib/icons";

/**
 * The patient feature registry — one declarative record of every capability
 * the patient app offers, independent of which page happens to render it.
 *
 * Why this exists
 * ---------------
 * Before this file, a feature was discoverable only by being hardcoded into
 * one page. Nothing could list, search, or recommend features, because
 * features were not addressable objects — they were JSX inside a route. The
 * consequence was measured in the 2026-09-02 discovery audit: ~230 rendered
 * patient surfaces behind a flat 21-item sidebar, with real, live, working
 * features sitting four levels deep and cross-linked from nowhere. Cycle
 * tracking (`cycle-tracking` below) was the worst case: sidebar -> Prevention
 * -> the fourth tab -> the third card -> and only for a patient whose profile
 * says female. It works perfectly. Nobody could find it.
 *
 * This registry is deliberately NOT a router, a permission system, or a
 * second source of truth for what a patient may do. Every `href` points at a
 * page that already exists and already carries its own entitlement gate and
 * RLS; listing a feature here never grants access to it, and a gated page
 * still greets its visitor with the same friendly UpgradePrompt it always
 * did. `relevance` below decides whether we *mention* a feature unprompted,
 * never whether the patient may open it — which is why search deliberately
 * ignores relevance (see `searchFeatures`).
 *
 * It powers four surfaces, all of which stay in sync for free:
 *   1. Search              (components/patient/feature-search.tsx)
 *   2. The group directory pages   (/patient/health, /stay-well, ...)
 *   3. "You might not know this is here" (patient/feature-discovery-card.tsx)
 *   4. The sidebar's group structure   (lib/navigation.ts)
 *
 * Adding a feature means adding a row here. It must NOT mean adding a
 * sidebar link — that is the growth this whole design exists to stop.
 */

/** The four bands the patient's world is described in. Kept identical to the
 * web sidebar's and the mobile drawer's groups (apps/mobile/src/lib/sections.ts)
 * so the two surfaces never drift into describing the same app differently. */
export const FEATURE_GROUPS = [
  "Your health",
  "Stay well",
  "Support",
  "Your account",
] as const;

export type FeatureGroup = (typeof FEATURE_GROUPS)[number];

/** The directory page each group lives on, and how it introduces itself. */
export const GROUP_META: Record<
  FeatureGroup,
  { href: string; icon: AppIconName; description: string }
> = {
  "Your health": {
    href: "/patient/health",
    icon: "bp",
    description:
      "The record you log into and read back: your readings, medicines, results, and the checks that catch things early.",
  },
  "Stay well": {
    href: "/patient/stay-well",
    icon: "lifestyle",
    description:
      "Food, movement, weight, reading, and rewards. The things that keep a well person well.",
  },
  Support: {
    href: "/patient/support",
    icon: "clinicianFollowUp",
    description: "The people: your care team, your appointments, and your family.",
  },
  "Your account": {
    href: "/patient/account",
    icon: "settings",
    description: "Your details, your plan, your data, and your emergency card.",
  },
};

/**
 * What we know about the patient, for deciding what to mention unprompted.
 * Resolved once per request by lib/patient/feature-signals.ts.
 */
export interface PatientSignals {
  /** profiles.sex — null when not recorded, which never excludes a feature. */
  sex: "male" | "female" | null;
  ageYears: number | null;
  /** care_plans.condition for the patient's active plans. */
  conditions: readonly string[];
  /** Entitlement codes the patient's plan/add-ons actually grant. */
  features: readonly string[];
}

export interface FeatureRelevance {
  /** Only mention this to a patient recorded as this sex. A patient with no
   * recorded sex is NEVER excluded — an unset field is a gap in our record,
   * not a statement about them, the same null-gating principle the
   * ReviewedByDoctor and doctor_tier rules follow. */
  sex?: "male" | "female";
  minAge?: number;
  maxAge?: number;
  /** Any-of. An active care plan for any listed condition makes this relevant. */
  conditions?: readonly string[];
  /** Entitlement code (has_feature_access). Absent means never suggest it to
   * somebody whose plan does not include it — the directory still lists it,
   * so nothing becomes invisible; we simply do not go out of our way to
   * recommend something they would hit an upgrade wall on. */
  feature?: string;
}

export interface PatientFeature {
  /** Stable slug. Also the key written to patient_feature_views, so renaming
   * one loses that patient's "already seen" history — don't. */
  id: string;
  label: string;
  /** One line of plain patient language: what this is FOR. Shown in the
   * directories, in search results, and in the discovery card. No jargon, no
   * fear-based urgency, no em dashes (house style). */
  blurb: string;
  /** Route, optionally with an in-page anchor. Every anchor here must be a
   * real `id` on the page: search lands the reader ON the card, not on a
   * page they then have to scan. */
  href: string;
  icon: AppIconName;
  group: FeatureGroup;
  /** Words a patient might actually type that aren't already in the label or
   * blurb. This is where "period" finds cycle tracking and "counterfeit"
   * finds Check my pack. */
  keywords?: readonly string[];
  relevance?: FeatureRelevance;
  /** Kept out of "you might not know this is here". For things that are
   * either always visible anyway, or that it would be tasteless to nudge
   * somebody toward unprompted (the emergency card is not a discovery). */
  neverSuggest?: boolean;
}

export const PATIENT_FEATURES: readonly PatientFeature[] = [
  // ---------------------------------------------------------------- Your health
  {
    id: "vitals-log",
    label: "Log a reading",
    blurb: "Blood pressure, blood sugar, weight, temperature or oxygen, in a few seconds.",
    href: "/patient/vitals#log-reading",
    icon: "bp",
    group: "Your health",
    keywords: ["bp", "blood pressure", "sugar", "glucose", "weight", "temperature", "spo2", "oxygen", "pulse", "reading"],
    neverSuggest: true,
  },
  {
    id: "vitals-trends",
    label: "Your reading trends",
    blurb: "How your numbers have moved over weeks and months, as a chart.",
    href: "/patient/vitals#trends",
    icon: "analytics",
    group: "Your health",
    keywords: ["chart", "graph", "trend", "history"],
  },
  {
    id: "vitals-history",
    label: "Every reading you've logged",
    blurb: "The full list, newest first, with what each one meant at the time.",
    href: "/patient/vitals#history",
    icon: "review",
    group: "Your health",
    keywords: ["log", "past", "previous", "history"],
  },
  {
    id: "bp-summary",
    label: "Home blood pressure summary",
    blurb: "Your seven-day home readings averaged the way a doctor reads them.",
    href: "/patient/vitals#bp-summary",
    icon: "bp",
    group: "Your health",
    keywords: ["hbpm", "average", "hypertension", "bp"],
    relevance: { conditions: ["hypertension"] },
  },
  {
    id: "glucose-insights",
    label: "Blood sugar insights",
    blurb: "Your glucose patterns by time of day, and what they suggest.",
    href: "/patient/vitals#glucose",
    icon: "diabetes",
    group: "Your health",
    keywords: ["sugar", "glucose", "diabetes", "hba1c"],
    relevance: { conditions: ["diabetes"] },
  },
  {
    id: "symptoms",
    label: "Log a symptom",
    blurb: "Tell us how you're feeling. Anything worrying is checked straight away.",
    href: "/patient/vitals#symptoms",
    icon: "mood",
    group: "Your health",
    keywords: ["pain", "headache", "dizzy", "symptom", "unwell", "sick"],
    neverSuggest: true,
  },
  {
    id: "diabetes-log",
    label: "Diabetes daily log",
    blurb: "Sugar readings, insulin, hypos and feet, in one daily place.",
    href: "/patient/vitals#diabetes-log",
    icon: "diabetes",
    group: "Your health",
    keywords: ["insulin", "hypo", "diabetes"],
    relevance: { conditions: ["diabetes"] },
  },
  {
    id: "complications",
    label: "Your diabetes checks",
    blurb: "Eyes, kidneys, feet and heart: which checks are current and which are due.",
    href: "/patient/vitals#complications",
    icon: "preventive",
    group: "Your health",
    keywords: ["eye", "retinopathy", "kidney", "nephropathy", "complication"],
    relevance: { conditions: ["diabetes"] },
  },
  {
    id: "foot-risk",
    label: "Foot risk check",
    blurb: "Where your feet stand, and how often they should be looked at.",
    href: "/patient/vitals#foot-risk",
    icon: "preventive",
    group: "Your health",
    keywords: ["feet", "foot", "ulcer", "neuropathy"],
    relevance: { conditions: ["diabetes"] },
  },
  {
    id: "wearables",
    label: "Connect a watch or tracker",
    blurb: "Let your Fitbit, Oura, WHOOP, Garmin or phone send readings in for you.",
    href: "/patient/vitals#wearables",
    icon: "devices",
    group: "Your health",
    keywords: ["fitbit", "oura", "whoop", "garmin", "dexcom", "apple health", "watch", "wearable", "sync"],
  },
  {
    id: "medications-list",
    label: "Your medicines",
    blurb: "Everything you're on, what each one is for, and when to take it.",
    href: "/patient/medications#my-medications",
    icon: "medication",
    group: "Your health",
    keywords: ["drugs", "tablets", "prescription", "medicine"],
    neverSuggest: true,
  },
  {
    id: "medication-add",
    label: "Add a medicine",
    blurb: "Anything you're taking that we don't know about yet, including from elsewhere.",
    href: "/patient/medications#add-medication",
    icon: "medication",
    group: "Your health",
    keywords: ["new medicine", "add drug", "prescription"],
  },
  {
    id: "todays-doses",
    label: "Today's doses",
    blurb: "Tick off each dose as you take it, so nothing gets doubled or missed.",
    href: "/patient/medications#todays-doses",
    icon: "medication",
    group: "Your health",
    keywords: ["dose", "adherence", "taken", "reminder"],
    neverSuggest: true,
  },
  {
    id: "adherence",
    label: "Dose check-ins",
    blurb: "If you've been missing doses, tell us why. There's usually something we can fix.",
    href: "/patient/medications#adherence",
    icon: "review",
    group: "Your health",
    keywords: ["missed", "skipped", "adherence", "side effect"],
  },
  {
    id: "check-my-pack",
    label: "Check my pack",
    blurb: "Not sure a pack is genuine? Check it before you take it.",
    href: "/patient/medications#check-my-pack",
    icon: "medication",
    group: "Your health",
    keywords: ["fake", "counterfeit", "genuine", "nafdac", "verify", "pack"],
  },
  {
    id: "lab-monitoring",
    label: "Medicine safety bloods",
    blurb: "The blood tests some medicines need on a schedule, and when yours are due.",
    href: "/patient/medications#lab-monitoring",
    icon: "labs",
    group: "Your health",
    keywords: ["monitoring", "kidney", "liver", "potassium", "safety"],
  },
  {
    id: "lab-results",
    label: "Your lab results",
    blurb: "Every result on file, with what it means in plain language.",
    href: "/patient/labs#results",
    icon: "labs",
    group: "Your health",
    keywords: ["blood test", "result", "lab"],
    neverSuggest: true,
  },
  {
    id: "result-documents",
    label: "Upload a result",
    blurb: "Took a test anywhere? Send us the sheet and a doctor reads it.",
    href: "/patient/labs#documents",
    icon: "upload",
    group: "Your health",
    keywords: ["upload", "photo", "pdf", "scan", "document"],
  },
  {
    id: "result-trends",
    label: "How your results are moving",
    blurb: "The thing one lab visit cannot tell you: what has changed across several.",
    href: "/patient/labs#trends",
    icon: "analytics",
    group: "Your health",
    keywords: ["trend", "compare", "over time"],
  },
  {
    id: "lab-orders",
    label: "Lab test requests",
    blurb: "Requests your care team has written for you, ready to take to any lab.",
    href: "/patient/labs#orders",
    icon: "labs",
    group: "Your health",
    keywords: ["order", "request", "form"],
  },
  {
    id: "lab-catalogue",
    label: "What tests usually cost",
    blurb: "Typical Nigerian prices, so you know what to expect before you go.",
    href: "/patient/labs#catalogue",
    icon: "labs",
    group: "Your health",
    keywords: ["price", "cost", "how much", "catalogue"],
  },
  {
    id: "booking-requests",
    label: "Your booking requests",
    blurb: "Where each test or visit you asked for has got to.",
    href: "/patient/labs#booking-requests",
    icon: "booking",
    group: "Your health",
    keywords: ["booking", "status", "request"],
  },
  {
    id: "health-check",
    label: "Your yearly Health Check",
    blurb: "A guided whole-body check-in, reviewed by a doctor at the end.",
    href: "/patient/health-check",
    icon: "review",
    group: "Your health",
    keywords: ["annual", "yearly", "check up", "checkup", "mot"],
  },
  {
    id: "mental-health",
    label: "Mood and wellbeing check",
    blurb: "A short, private check on how you've been feeling lately.",
    href: "/patient/health-check#wellbeing",
    icon: "mood",
    group: "Your health",
    keywords: ["depression", "anxiety", "stress", "phq", "gad", "mental health", "sad", "mood"],
  },
  {
    id: "annual-check-booking",
    label: "Book an Annual Health Check",
    blurb: "The one-off whole-body workup, available on any plan including Free.",
    href: "/patient/prevention#health-check",
    icon: "booking",
    group: "Your health",
    keywords: ["book", "annual", "package", "screening"],
  },
  {
    id: "screening-calendar",
    label: "Your screening calendar",
    blurb: "The checks that catch things early, timed to your age, sex and history.",
    href: "/patient/prevention#screenings",
    icon: "preventive",
    group: "Your health",
    keywords: ["screening", "due", "cervical", "breast", "prostate", "cancer"],
  },
  {
    id: "vaccinations",
    label: "Vaccinations",
    blurb: "What you and your children have had, and what's coming due.",
    href: "/patient/prevention#vaccinations",
    icon: "vaccination",
    group: "Your health",
    keywords: ["vaccine", "immunisation", "jab", "hpv", "hepatitis", "tetanus", "yellow fever"],
  },
  {
    id: "risk-assessment",
    label: "Your health risk profile",
    blurb: "Two minutes that build your whole personal screening and vaccination plan.",
    href: "/patient/prevention#risk-assessment",
    icon: "preventive",
    group: "Your health",
    keywords: ["risk", "profile", "questionnaire", "family history"],
  },
  {
    id: "findrisc",
    label: "Your diabetes risk score",
    blurb: "Eight questions that estimate your chance of developing diabetes.",
    href: "/patient/prevention#findrisc",
    icon: "diabetes",
    group: "Your health",
    keywords: ["findrisc", "diabetes risk", "prediabetes", "score"],
    relevance: { minAge: 30 },
  },
  {
    id: "programme-recommendations",
    label: "Programmes suggested for you",
    blurb: "Care programmes your own answers and readings point towards.",
    href: "/patient/prevention#risk-assessment",
    icon: "carePlan",
    group: "Your health",
    keywords: ["recommended", "programme", "suggestion"],
  },
  {
    id: "preventive-programmes",
    label: "Preventive programmes",
    blurb: "Women's health, men's health, heart and metabolic programmes you can join.",
    href: "/patient/prevention#programmes",
    icon: "preventive",
    group: "Your health",
    keywords: ["programme", "women's health", "men's health", "join"],
  },
  {
    id: "prevention-campaigns",
    label: "Health campaigns",
    blurb: "Short group pushes on one thing at a time, with others doing it too.",
    href: "/patient/prevention#campaigns",
    icon: "broadcast",
    group: "Your health",
    keywords: ["campaign", "drive", "awareness"],
  },
  {
    id: "cycle-tracking",
    label: "Cycle and reproductive health",
    blurb:
      "Track your period, and get gentle reminders that fit where you are: trying to conceive, pregnant, postpartum or approaching menopause.",
    href: "/patient/prevention#cycle",
    icon: "family",
    group: "Your health",
    keywords: [
      "period",
      "periods",
      "menstrual",
      "menstruation",
      "cycle",
      "ovulation",
      "fertility",
      "trying to conceive",
      "ttc",
      "postpartum",
      "menopause",
      "perimenopause",
      "reproductive",
    ],
    relevance: { sex: "female" },
  },
  {
    id: "devices-shop",
    label: "Getting a device",
    blurb: "Which blood pressure monitors and glucometers work well, and where to buy one.",
    href: "/patient/devices",
    icon: "devices",
    group: "Your health",
    keywords: ["monitor", "cuff", "glucometer", "buy", "device", "machine"],
  },

  // ---------------------------------------------------------------- Stay well
  {
    id: "lifestyle",
    label: "Lifestyle coaching",
    blurb: "Food, weight, movement, sleep and stress, with your care team alongside.",
    href: "/patient/lifestyle",
    icon: "lifestyle",
    group: "Stay well",
    keywords: ["coach", "coaching", "habit", "goal", "sleep", "stress"],
    relevance: { feature: "lifestyle_coaching" },
  },
  {
    id: "nutrition",
    label: "Food and meals",
    blurb: "Log what you eat, including Nigerian dishes, and watch your salt.",
    href: "/patient/nutrition",
    icon: "nutrition",
    group: "Stay well",
    keywords: ["diet", "meal", "food", "eat", "salt", "sodium", "calories", "swallow", "jollof"],
  },
  {
    id: "activity",
    label: "Movement and steps",
    blurb: "What you've been doing, and how close you are to a week that helps.",
    href: "/patient/activity",
    icon: "steps",
    group: "Stay well",
    keywords: ["exercise", "walk", "steps", "workout", "gym", "activity"],
  },
  {
    id: "weight-management",
    label: "Weight management",
    blurb: "A structured programme when weight is the thing you want to work on.",
    href: "/patient/weight-management",
    icon: "weight",
    group: "Stay well",
    keywords: ["obesity", "bmi", "lose weight", "slim"],
  },
  {
    id: "weight-log",
    label: "Log your weight",
    blurb: "One number, tracked over time, feeding everything else.",
    href: "/patient/weight",
    icon: "weightTrend",
    group: "Stay well",
    keywords: ["weigh", "kg", "scale", "bmi"],
  },
  {
    id: "learn",
    label: "Learn",
    blurb: "Short, plain-language reading on your own conditions, checked by a doctor.",
    href: "/patient/learn",
    icon: "learn",
    group: "Stay well",
    keywords: ["article", "read", "education", "explain", "understand", "library"],
  },
  {
    id: "wellness",
    label: "Wellness rewards",
    blurb: "Points and badges for the healthy things you already do.",
    href: "/patient/wellness",
    icon: "wellness",
    group: "Stay well",
    keywords: ["points", "badge", "reward", "streak"],
  },
  {
    id: "wellness-challenges",
    label: "Challenges",
    blurb: "A goal with a deadline, and other people going for it at the same time.",
    href: "/patient/wellness#challenges",
    icon: "challenge",
    group: "Stay well",
    keywords: ["challenge", "compete", "goal"],
  },
  {
    id: "wellness-classes",
    label: "Wellness classes",
    blurb: "Live sessions you can join, on movement, food and managing stress.",
    href: "/patient/wellness#classes",
    icon: "wellnessClass",
    group: "Stay well",
    keywords: ["class", "session", "webinar", "live"],
  },

  // ---------------------------------------------------------------- Support
  {
    id: "messages",
    label: "Message your care team",
    blurb: "A real conversation with the doctors looking after you, always on record.",
    href: "/patient/messages",
    icon: "messages",
    group: "Support",
    keywords: ["chat", "message", "talk", "contact", "ask", "whatsapp"],
    neverSuggest: true,
  },
  {
    id: "care-plan",
    label: "Your care plan",
    blurb: "What your doctor has set as your targets, and how you're tracking against them.",
    href: "/patient/care#care-plan",
    icon: "carePlan",
    group: "Support",
    keywords: ["plan", "target", "goal"],
    relevance: { feature: "clinician_review" },
  },
  {
    id: "escalations",
    label: "Things flagged for a doctor",
    blurb: "Anything of yours that went to a doctor, and what they said about it.",
    href: "/patient/care#escalations",
    icon: "escalation",
    group: "Support",
    keywords: ["flag", "alert", "urgent", "escalation", "review"],
  },
  {
    id: "ask-a-doctor",
    label: "Ask a doctor",
    blurb: "Send a written question and get a doctor's answer in the app.",
    href: "/patient/care#ask-a-doctor",
    icon: "clinicianFollowUp",
    group: "Support",
    keywords: ["question", "advice", "consult", "ask"],
    relevance: { feature: "async_doctor_visit" },
  },
  {
    id: "video-visit",
    label: "Book a video visit",
    blurb: "See a doctor face to face without leaving the house.",
    href: "/patient/care#video-visit",
    icon: "booking",
    group: "Support",
    keywords: ["video", "call", "zoom", "consultation", "appointment"],
  },
  {
    id: "ai-coach",
    label: "AI health coach",
    blurb: "Instant answers on your own record, with a doctor behind anything serious.",
    href: "/patient/care#ai-coach",
    icon: "aiCoach",
    group: "Support",
    keywords: ["ai", "coach", "assistant", "chatbot"],
    relevance: { feature: "ai_coach" },
  },
  {
    id: "referrals",
    label: "Your referrals",
    blurb: "Specialists you've been referred to, and where each referral has got to.",
    href: "/patient/care#referrals",
    icon: "referral",
    group: "Support",
    keywords: ["specialist", "refer", "consultant", "hospital"],
  },
  {
    id: "hospital-admissions",
    label: "Hospital admissions",
    blurb: "If you've been admitted anywhere, tell us so your care team can follow up.",
    href: "/patient/care#hospital-admissions",
    icon: "hmo",
    group: "Support",
    keywords: ["admitted", "hospital", "discharge", "ward"],
  },
  {
    id: "pregnancy",
    label: "Pregnancy",
    blurb: "Tell your care team you're pregnant so your medicines and checks are made safe.",
    href: "/patient/care#pregnancy",
    icon: "family",
    group: "Support",
    keywords: ["pregnant", "pregnancy", "antenatal", "baby", "expecting"],
    relevance: { sex: "female" },
  },
  {
    id: "care-circle",
    label: "Your care circle",
    blurb: "Everyone involved in looking after you, in one place.",
    href: "/patient/care#care-circle",
    icon: "team",
    group: "Support",
    keywords: ["team", "circle", "who"],
  },
  {
    id: "vouchers",
    label: "Care Vouchers",
    blurb: "Care someone has paid for on your behalf, and what's left on it.",
    href: "/patient/care#vouchers",
    icon: "payables",
    group: "Support",
    keywords: ["voucher", "sponsor", "gift", "credit", "balance"],
  },
  {
    id: "appointments",
    label: "Appointments",
    blurb: "What's booked, and how to book something new.",
    href: "/patient/appointments",
    icon: "booking",
    group: "Support",
    keywords: ["book", "appointment", "diary", "schedule", "visit"],
  },
  {
    id: "family",
    label: "Your people",
    blurb: "Children and adults whose care you help manage.",
    href: "/patient/family",
    icon: "family",
    group: "Support",
    keywords: ["family", "child", "children", "dependant", "parent", "spouse"],
  },
  {
    id: "next-of-kin",
    label: "Next of kin",
    blurb: "Who we contact about you if it ever matters.",
    href: "/patient/family#next-of-kin",
    icon: "members",
    group: "Support",
    keywords: ["kin", "next of kin", "relative", "contact"],
  },
  {
    id: "care-visibility",
    label: "Who can see your care",
    blurb: "Exactly who has access to what, and how to change it.",
    href: "/patient/family#care-visibility",
    icon: "privacy",
    group: "Support",
    keywords: ["visibility", "access", "share", "permission", "who can see"],
  },
  {
    id: "caregiver-access",
    label: "Let someone manage your care",
    blurb: "Give a trusted person the ability to act on your behalf here.",
    href: "/patient/family/caregiver",
    icon: "parentCare",
    group: "Support",
    keywords: ["caregiver", "manage", "proxy", "on my behalf", "power"],
  },
  {
    id: "supporting",
    label: "People you support",
    blurb: "Care you're paying for on somebody else's behalf.",
    href: "/patient/supporting",
    icon: "parentCare",
    group: "Support",
    keywords: ["sponsor", "paying for", "support", "diaspora", "parent"],
  },
  {
    id: "testimonial",
    label: "Share your story",
    blurb: "If this has helped, telling other Nigerians why makes a real difference.",
    href: "/patient/care#testimonial",
    icon: "messages",
    group: "Support",
    keywords: ["testimonial", "review", "feedback", "story"],
  },

  // ------------------------------------------------------------ Your account
  {
    id: "health-passport",
    label: "Health Passport",
    blurb: "Your record as one doctor-reviewed document you can hand to anyone.",
    href: "/patient/health-passport",
    icon: "passport",
    group: "Your account",
    keywords: ["passport", "summary", "pdf", "record", "travel", "print"],
  },
  {
    id: "subscription",
    label: "Plan and payments",
    blurb: "What you're on, what it covers, and what you've paid.",
    href: "/patient/subscription",
    icon: "billing",
    group: "Your account",
    keywords: ["plan", "pay", "billing", "subscription", "price", "upgrade", "receipt"],
  },
  {
    id: "profile",
    label: "Your details",
    blurb: "Name, photo, where you live, and how we should reach you.",
    href: "/patient/profile",
    icon: "settings",
    group: "Your account",
    keywords: ["profile", "details", "address", "phone", "name", "settings"],
  },
  {
    id: "emergency-contact",
    label: "Emergency contact",
    blurb: "The person we call if a reading of yours ever looks dangerous.",
    href: "/patient/profile#emergency-contact",
    icon: "warning",
    group: "Your account",
    keywords: ["emergency", "contact", "next of kin", "call"],
  },
  {
    id: "identity-verification",
    label: "Verify your identity",
    blurb: "Confirms it's really you, which some results and documents need.",
    href: "/patient/profile#identity",
    icon: "security",
    group: "Your account",
    keywords: ["verify", "identity", "nin", "bvn", "id"],
  },
  {
    id: "condition-language",
    label: "How we talk about your condition",
    blurb: "Choose the words you'd rather we used about your own health.",
    href: "/patient/profile#condition-language",
    icon: "messages",
    group: "Your account",
    keywords: ["language", "wording", "obesity", "preference", "how you talk"],
  },
  {
    id: "communication-prefs",
    label: "Reminders and notifications",
    blurb: "What we send you, and on which channel.",
    href: "/patient/profile#communication-preferences",
    icon: "bell",
    group: "Your account",
    keywords: ["reminder", "notification", "sms", "whatsapp", "email", "alert", "unsubscribe", "stop"],
  },
  {
    id: "communication-history",
    label: "What we've sent you",
    blurb: "Every message we've sent, so nothing about your care is invisible.",
    href: "/patient/profile#communication-history",
    icon: "inbox",
    group: "Your account",
    keywords: ["sent", "history", "sms", "log"],
  },
  {
    id: "password",
    label: "Change your password",
    blurb: "Keep your account yours.",
    href: "/patient/profile#password",
    icon: "security",
    group: "Your account",
    keywords: ["password", "login", "security", "2fa", "mfa"],
  },
  {
    id: "privacy",
    label: "Privacy and your data",
    blurb: "What we hold about you, who has seen it, and what you can do about it.",
    href: "/patient/privacy",
    icon: "privacy",
    group: "Your account",
    keywords: ["privacy", "data", "ndpr", "consent", "gdpr"],
  },
  {
    id: "data-rights",
    label: "Download or delete your data",
    blurb: "Take a full copy with you, or ask us to erase it.",
    href: "/patient/privacy#data-rights",
    icon: "privacy",
    group: "Your account",
    keywords: ["export", "download", "delete", "erase", "close account", "ndpr", "gdpr", "copy"],
  },
  {
    id: "consents",
    label: "Your consents",
    blurb: "What you've agreed to, and how to withdraw any of it.",
    href: "/patient/privacy#consents",
    icon: "approvals",
    group: "Your account",
    keywords: ["consent", "agree", "withdraw", "permission"],
  },
  {
    id: "emergency-card",
    label: "Emergency card",
    blurb: "The one page a stranger needs if they find you unwell. Works offline.",
    href: "/patient/emergency-card",
    icon: "warning",
    group: "Your account",
    keywords: ["emergency", "card", "blood group", "allergy", "offline", "accident", "ice"],
    neverSuggest: true,
  },
];

/** Feature by id, or undefined. */
export function getFeature(id: string): PatientFeature | undefined {
  return PATIENT_FEATURES.find((f) => f.id === id);
}

/** Everything in one group, in declaration order (which is the reading order
 * the directory pages present). */
export function featuresInGroup(group: FeatureGroup): PatientFeature[] {
  return PATIENT_FEATURES.filter((f) => f.group === group);
}

/**
 * Whether we would mention this feature to this patient unprompted.
 *
 * Every unset signal is permissive: a patient whose sex, age or conditions we
 * do not hold is never excluded by that field, because an empty column is a
 * gap in our record rather than a fact about them. Only a signal we actually
 * have can rule a feature out.
 */
export function isFeatureRelevant(feature: PatientFeature, signals: PatientSignals): boolean {
  const r = feature.relevance;
  if (!r) return true;

  if (r.sex && signals.sex && signals.sex !== r.sex) return false;
  if (r.minAge !== undefined && signals.ageYears !== null && signals.ageYears < r.minAge) {
    return false;
  }
  if (r.maxAge !== undefined && signals.ageYears !== null && signals.ageYears > r.maxAge) {
    return false;
  }
  if (r.conditions && !r.conditions.some((c) => signals.conditions.includes(c))) return false;
  if (r.feature && !signals.features.includes(r.feature)) return false;

  return true;
}

/**
 * Free-text search across the registry.
 *
 * Deliberately relevance-blind: somebody who types "period" gets cycle
 * tracking whether or not our record says female, and somebody who types
 * "ask a doctor" is shown it even on a plan that does not include it (they
 * land on the page's own upgrade prompt, which explains it far better than a
 * silent absence would). Hiding a real, existing feature from somebody who
 * typed its name is exactly the failure this whole registry exists to end.
 *
 * Ranking, best first: label prefix, then label substring, then an exact
 * keyword hit, then a keyword prefix, then the blurb.
 */
export function searchFeatures(query: string, limit = 8): PatientFeature[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const scored: { feature: PatientFeature; score: number }[] = [];

  for (const feature of PATIENT_FEATURES) {
    const label = feature.label.toLowerCase();
    let score = 0;

    if (label.startsWith(q)) score = 100;
    else if (label.includes(q)) score = 80;
    else if (feature.keywords?.some((k) => k === q)) score = 70;
    else if (feature.keywords?.some((k) => k.startsWith(q))) score = 60;
    else if (feature.keywords?.some((k) => k.includes(q))) score = 45;
    else if (feature.blurb.toLowerCase().includes(q)) score = 30;
    else if (feature.group.toLowerCase().includes(q)) score = 20;

    if (score > 0) scored.push({ feature, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.feature.label.localeCompare(b.feature.label))
    .slice(0, limit)
    .map((s) => s.feature);
}

/**
 * How specifically a feature matches THIS patient, rather than matching
 * everybody. One point per relevance constraint we can positively confirm
 * against a signal we actually hold.
 *
 * A feature with no constraints scores zero: it is fine for anybody, which is
 * exactly why it is a weak thing to bring up unprompted.
 */
function relevanceSpecificity(feature: PatientFeature, signals: PatientSignals): number {
  const r = feature.relevance;
  if (!r) return 0;
  let score = 0;
  if (r.sex && signals.sex === r.sex) score += 2;
  if (r.conditions && r.conditions.some((c) => signals.conditions.includes(c))) score += 2;
  if (r.feature && signals.features.includes(r.feature)) score += 1;
  if ((r.minAge !== undefined || r.maxAge !== undefined) && signals.ageYears !== null) score += 1;
  return score;
}

/**
 * Candidates for the "you might not know this is here" card: relevant to this
 * patient, safe to suggest, and never opened or dismissed by them.
 *
 * Ranked most-specific first. Registry order alone was tried and was wrong in
 * an obvious way the moment it was on screen: it led with "Your reading
 * trends" and "Every reading you've logged" for everybody, because those
 * happen to be declared early and fit anyone. Nobody needs telling that a
 * health app has a chart. What earns the two slots on Overview is the thing
 * that is specifically for THIS patient — the cycle card for a woman, the
 * foot-risk check for somebody with diabetes — with the generic entries
 * surfacing only once there is nothing more particular left to say.
 *
 * `seenIds` comes from patient_feature_views.
 */
export function suggestableFeatures(
  signals: PatientSignals,
  seenIds: readonly string[],
): PatientFeature[] {
  const eligible = PATIENT_FEATURES.filter(
    (f) => !f.neverSuggest && !seenIds.includes(f.id) && isFeatureRelevant(f, signals),
  );
  const order = new Map(PATIENT_FEATURES.map((f, i) => [f.id, i]));
  return eligible.sort(
    (a, b) =>
      relevanceSpecificity(b, signals) - relevanceSpecificity(a, signals) ||
      (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
  );
}
