/**
 * S96 (Module 14, MSK pain programmes: back, neck, knee, hip): the PROPOSED entry screen and settings, written once here and mirrored by
 * the S96 migration seeds (a test fails on drift). DRAFT, UNSIGNED: nobody has confirmed any of it. The Chief Medical Officer confirms or
 * replaces the lists by saving a higher version (`save_therapy_exclusion_list` then `confirm_therapy_exclusion_list`).
 *
 * Basis, to be verified against the source by the CMO (nothing here is represented as regulator- or guideline-approved):
 *  - NICE NG59 (low back pain and sciatica in over 16s): red flags that need an assessment before self-management.
 *  - NICE NG226 (osteoarthritis in over 16s): knee and hip exercise as a core treatment; joint red flags.
 *  - General neck, knee and hip self-management guidance. No licensed instrument is used: the PEG (3 items) is free to use; the
 *    function goal is a plain 0 to 10 item written for this programme.
 *
 * Routes: `crisis` means "go to the nearest hospital now" (the engine's urgent route; for these MSK items it carries `nonPaging`: the programme stops
 * and a normal same-day clinician task is raised, and the on-call clinician is NOT paged, founder decision 2026-10-27); `same_day_clinician` a
 * task due the same day; `medical_review_first` a task due within two days before the programme starts; `education_only` no task.
 * Every item is a yes or no and FAILS CLOSED in the engine: an unanswered item stops the programme.
 * `unverified` marks a local addition the CMO has not confirmed. It still stops the programme.
 */
import type { TherapyExclusionRule } from "./therapy-config-data";

export const MSK_PROGRAMME_CODES = ["pain_back", "pain_neck", "pain_knee", "pain_hip"] as const;
export type MskProgrammeCode = (typeof MSK_PROGRAMME_CODES)[number];

const yn = (
  code: string,
  question: string,
  route: TherapyExclusionRule["route"],
  unverified = false,
): TherapyExclusionRule => {
  const base: TherapyExclusionRule = unverified ? { code, question, kind: "yes_no", route, unverified } : { code, question, kind: "yes_no", route };
  // Founder decision 2026-10-27: possible heart or stroke warning signs stop the programme and show hospital-now guidance, but never page the on-call clinician.
  return route === "crisis" ? { ...base, nonPaging: true } : base;
};

/** Items every MSK programme asks. Order matters (the screen shows them in this order). */
const COMMON_FIRST: readonly TherapyExclusionRule[] = [
  yn("recent_trauma", "Did this pain start after a fall, accident, blow or injury?", "same_day_clinician"),
  yn("fever", "Do you have a fever, or have you felt feverish or unwell with this pain?", "same_day_clinician"),
  yn("progressive_deficit", "Is any weakness, numbness or pins and needles getting worse over days or weeks?", "same_day_clinician"),
];

const COMMON_LAST: readonly TherapyExclusionRule[] = [
  yn("unexplained_weight_loss", "Have you lost weight without trying in the last few months?", "same_day_clinician"),
  yn("cancer_history", "Have you ever been told you have or had cancer?", "same_day_clinician"),
  yn("night_pain", "Does the pain wake you at night, or is it worst when you lie still and rest?", "same_day_clinician"),
  yn(
    "low_defences",
    "Do you inject drugs, take medicines that lower your body's defences (such as chemotherapy or long-term steroid tablets), or have an illness that weakens your defences?",
    "same_day_clinician",
    true,
  ),
  yn("steroids_or_thin_bones", "Do you take steroid tablets most days, or have you been told your bones are thin (osteoporosis)?", "medical_review_first", true),
  yn("known_tb", "Have you been told you have TB (tuberculosis)?", "same_day_clinician", true),
  yn("sickle_cell_bone_pain", "Do you have sickle cell disease, and is this a bone pain?", "same_day_clinician", true),
  yn("known_hiv", "Do you live with HIV?", "same_day_clinician", true),
];

const LEG_CLOT: readonly TherapyExclusionRule[] = [
  yn("calf_pain_or_swelling", "Do you have pain, swelling, warmth or redness in your calf?", "same_day_clinician"),
  yn("breathless_with_leg_pain", "Are you short of breath, or coughing up blood, along with leg pain or swelling?", "crisis"),
];

export const MSK_EXCLUSION_LISTS: Readonly<Record<MskProgrammeCode, readonly TherapyExclusionRule[]>> = {
  pain_back: [
    yn("saddle_numbness", "Do you have numbness or odd feelings around your genitals, buttocks or inner thighs (the saddle area)?", "same_day_clinician"),
    yn("bladder_or_bowel_change", "Have you noticed a new change in passing urine or opening your bowels, such as leaking, or not being able to go?", "same_day_clinician"),
    yn("weakness_both_legs", "Do you have weakness in one or both legs, such as a foot that drags or a leg that gives way?", "same_day_clinician"),
    yn("chest_pain_now", "Do you have chest pain, chest tightness or shortness of breath now, or along with this pain?", "crisis"),
    ...COMMON_FIRST,
    yn("pain_first_time_over_50", "Are you over 50, and is this the first time you have had pain like this?", "medical_review_first", true),
    yn("pregnant_or_recent_birth", "Are you pregnant, or did you give birth in the last six weeks?", "medical_review_first", true),
    ...COMMON_LAST,
  ],
  pain_neck: [
    yn("chest_or_arm_pain_now", "Do you have chest pain or tightness, or pain spreading down the left arm or into the jaw, now or along with this pain?", "crisis"),
    yn("sudden_severe_headache", "Did a sudden, severe headache start with this neck pain, the worst you have ever had?", "crisis"),
    yn("speech_swallow_vision_face", "Do you have trouble speaking or swallowing, double vision, or one side of your face drooping?", "crisis"),
    yn("arm_or_hand_weakness_or_numbness", "Do you have weakness or numbness in your arm or hand that is spreading, or in both arms?", "same_day_clinician"),
    yn("hands_clumsy", "Are your hands clumsy, or do you drop things more than usual?", "same_day_clinician"),
    yn("balance_or_walking_change", "Has your balance or the way you walk changed, or do your legs feel stiff or weak?", "same_day_clinician"),
    yn("bladder_or_bowel_change", "Have you noticed a new change in passing urine or opening your bowels?", "same_day_clinician"),
    ...COMMON_FIRST,
    yn("pain_first_time_over_50", "Are you over 50, and is this the first time you have had pain like this?", "medical_review_first", true),
    ...COMMON_LAST,
  ],
  pain_knee: [
    yn("hot_swollen_joint_unwell", "Is your knee hot, red and swollen, and do you feel feverish or unwell?", "same_day_clinician"),
    yn("cannot_weight_bear", "Is it too painful to put weight on your leg, or can you not stand on it at all?", "same_day_clinician"),
    yn("knee_locks_or_gives_way", "Does your knee lock so it will not bend or straighten, or give way suddenly?", "medical_review_first"),
    ...LEG_CLOT,
    ...COMMON_FIRST,
    ...COMMON_LAST,
  ],
  pain_hip: [
    yn("cannot_weight_bear", "Is it too painful to put weight on your leg, or can you not stand on it at all?", "same_day_clinician"),
    yn("groin_pain_after_fall", "Do you have groin or hip pain after a fall, even a small one?", "same_day_clinician"),
    yn("hip_pain_new_with_steroids_or_alcohol", "Did the hip pain start suddenly, and do you take steroid tablets or drink a lot of alcohol?", "same_day_clinician", true),
    ...LEG_CLOT,
    ...COMMON_FIRST,
    ...COMMON_LAST,
  ],
};

/** The PEG (free) plus one function goal, asked at the checkpoint sessions. Worse is a higher number for every one of them. */
export const MSK_INSTRUMENTS = ["peg_pain", "peg_enjoyment", "peg_activity", "function_goal"] as const;

/**
 * Settings the engine and the screens read. Every number is PROPOSED: the build chose it so the programme can run, and the CMO confirms
 * or replaces it. Nothing clinical is decided by a model.
 */
export interface MskSettings {
  /** The most exercises shown for one day, however many a week lists. */
  readonly daily_exercise_cap: number;
  /** A week can be finished only after this many different days with a full set recorded. */
  readonly min_days_to_complete: number;
  /** After "my pain got worse" and a clear re-check: days of the lighter plan. */
  readonly step_down_days: number;
  /** In step-down the day's set is cut to this many exercises (gentle ones only). */
  readonly step_down_max_exercises: number;
  /** Difficulty after each exercise: 1 very easy to 5 too hard. */
  readonly difficulty_min: number;
  readonly difficulty_max: number;
  /** This many "too hard" ratings in a row on one exercise: the screen offers the easier version. */
  readonly too_hard_rating: number;
  readonly too_hard_in_a_row: number;
  /** Pain, 0 to 10, that is reported as "now" in the flare-up flow and is kept with the event. */
  readonly flare_pain_scale_max: number;
}

export const MSK_SETTINGS: MskSettings = {
  daily_exercise_cap: 3,
  min_days_to_complete: 3,
  step_down_days: 3,
  step_down_max_exercises: 2,
  difficulty_min: 1,
  difficulty_max: 5,
  too_hard_rating: 5,
  too_hard_in_a_row: 2,
  flare_pain_scale_max: 10,
};
