/**
 * Which clip belongs to which screen. NAV: the 30-second first-use walkthrough of each tab. HLP: the
 * "What is this?" explanation of each screen. The keys are the app's own screen names, stable like i18n keys.
 */
export const NAV_CLIPS = {
  home: "NAV-001",
  my_health: "NAV-002",
  care: "NAV-003",
  wellbeing: "NAV-004",
  family: "NAV-005",
  assistant: "NAV-006",
  profile_menu: "NAV-007",
} as const;
export type NavTab = keyof typeof NAV_CLIPS;

export const HLP_CLIPS = {
  today: "HLP-001",
  quick_log: "HLP-002",
  blood_pressure_log: "HLP-003",
  blood_sugar_log: "HLP-004",
  weight_log: "HLP-005",
  mood_check_in: "HLP-006",
  symptom_log: "HLP-007",
  trends: "HLP-008",
  health_passport: "HLP-009",
  emergency_card: "HLP-010",
  share_records: "HLP-011",
  test_results: "HLP-012",
  screening_calendar: "HLP-013",
  health_report: "HLP-014",
  medicines: "HLP-015",
  adherence: "HLP-016",
  choose_pharmacy: "HLP-017",
  check_symptom: "HLP-018",
  book_consultation: "HLP-019",
  ask_clinician: "HLP-020",
  find_care: "HLP-021",
  book_lab_test: "HLP-022",
  care_packs: "HLP-023",
  checkout: "HLP-024",
  pay_for_loved_one: "HLP-025",
  care_circle: "HLP-026",
  dependants: "HLP-027",
  vaccinations: "HLP-028",
  learning_centre: "HLP-029",
  meditation_sleep: "HLP-030",
  home_workouts: "HLP-031",
  food_log: "HLP-032",
  nutrients: "HLP-033",
  health_points: "HLP-034",
  connected_devices: "HLP-035",
  privacy_settings: "HLP-036",
  discreet_mode: "HLP-037",
  low_data_mode: "HLP-038",
  feature_phone: "HLP-039",
  pregnancy_tracker: "HLP-040",
  therapy_programmes: "HLP-041",
} as const;
export type HelpScreen = keyof typeof HLP_CLIPS;

/**
 * Offer a tab's walkthrough the first time the person opens it. Returns the clip to OFFER, or null once seen.
 * It is an offer ("Listen to a short tour"), never autoplay: a phone can be in a public place (discreet mode, spec D.3)
 * and the walkthrough must be one tap away again from Help.
 */
export function tourOffer(tab: NavTab, seen: ReadonlySet<NavTab>): string | null {
  return seen.has(tab) ? null : NAV_CLIPS[tab];
}
