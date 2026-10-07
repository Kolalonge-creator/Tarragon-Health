/**
 * The offline emergency content pack (S65, spec 15.13, 15.14, INV-06). Versioned configuration: it is bundled into the app binary so it
 * works with no signal, mirrored in the database table `emergency_pack_config` (a test fails if the two drift), and edited by the CMO by
 * publishing a NEW version, never by changing code.
 *
 * STATUS: DRAFT. `signed` is null. The pack is not shown to patients as signed clinical guidance until the CMO signs it in the hub; an
 * agent never sets `signed` (CLAUDE.md, "never sign clinical protocols as agent"). Until then only `first_line` and the facilities list
 * are used (see `activeEmergencyPack` in @tarragon/clinical).
 *
 * CMO decision Q18 (2026-10-07): there are NO emergency telephone numbers anywhere in this pack, no 112, no 767, no helpline. The state
 * data is FACILITIES ONLY. A facility entry carries a name, an address, coordinates and the date a person last verified it, and nothing
 * else: not even the facility's own phone number. A test scans every string in this file for digit runs that look like a number.
 *
 * Facilities are NOT fabricated. Every state ships as an explicit "none listed" row until a person has verified a real emergency-capable
 * hospital there (the Health Facility Registry import and the phone verification are documented follow-ups in docs/design/S65.md).
 */
export type EmergencyTopicKey =
  | "chest_pain"
  | "stroke"
  | "severe_blood_pressure"
  | "low_blood_sugar"
  | "seizure"
  | "pregnancy_danger"
  | "severe_breathlessness"
  | "malaria_danger"
  | "lassa_warning";

export type EmergencyTopic = {
  readonly key: EmergencyTopicKey;
  readonly title: string;
  /** What to look for. */
  readonly signs: readonly string[];
  /** What to do, in order. The first line of the card (`first_line`) always comes before these. */
  readonly steps: readonly string[];
  /** Things never to do for this problem. */
  readonly never: readonly string[];
  /** Why this topic still needs a named person to read it before signing. */
  readonly cmo_check: string;
}

export type EmergencyFacility = {
  readonly name: string;
  readonly address: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  /** YYYY-MM-DD, the day a person last verified this entry. Always shown next to it. */
  readonly last_verified_on: string;
}

export type EmergencyStateEntry = {
  readonly code: string;
  readonly name: string;
  readonly facilities: readonly EmergencyFacility[];
  /** True when nobody has verified an emergency-capable hospital here yet. The card says so plainly instead of staying silent. */
  readonly none_listed: boolean;
}

export type EmergencyPack = {
  readonly version: number;
  readonly status: "draft" | "signed";
  readonly signed: null | { readonly by: string; readonly on: string; readonly version: number };
  readonly first_line: string;
  readonly topics: readonly EmergencyTopic[];
  readonly states: readonly EmergencyStateEntry[];
}

const none = (code: string, name: string): EmergencyStateEntry => ({ code, name, facilities: [], none_listed: true });

/** The 36 states and the Federal Capital Territory. */
export const NIGERIAN_STATES: readonly { readonly code: string; readonly name: string }[] = [
  { code: "AB", name: "Abia" }, { code: "AD", name: "Adamawa" }, { code: "AK", name: "Akwa Ibom" }, { code: "AN", name: "Anambra" },
  { code: "BA", name: "Bauchi" }, { code: "BY", name: "Bayelsa" }, { code: "BE", name: "Benue" }, { code: "BO", name: "Borno" },
  { code: "CR", name: "Cross River" }, { code: "DE", name: "Delta" }, { code: "EB", name: "Ebonyi" }, { code: "ED", name: "Edo" },
  { code: "EK", name: "Ekiti" }, { code: "EN", name: "Enugu" }, { code: "FC", name: "Federal Capital Territory" }, { code: "GO", name: "Gombe" },
  { code: "IM", name: "Imo" }, { code: "JI", name: "Jigawa" }, { code: "KD", name: "Kaduna" }, { code: "KN", name: "Kano" },
  { code: "KT", name: "Katsina" }, { code: "KE", name: "Kebbi" }, { code: "KO", name: "Kogi" }, { code: "KW", name: "Kwara" },
  { code: "LA", name: "Lagos" }, { code: "NA", name: "Nasarawa" }, { code: "NI", name: "Niger" }, { code: "OG", name: "Ogun" },
  { code: "ON", name: "Ondo" }, { code: "OS", name: "Osun" }, { code: "OY", name: "Oyo" }, { code: "PL", name: "Plateau" },
  { code: "RI", name: "Rivers" }, { code: "SO", name: "Sokoto" }, { code: "TA", name: "Taraba" }, { code: "YO", name: "Yobe" },
  { code: "ZA", name: "Zamfara" },
];

export const EMERGENCY_PACK: EmergencyPack = {
  version: 1,
  status: "draft",
  signed: null,
  first_line: "Go to the nearest hospital now.",
  topics: [
    {
      key: "chest_pain",
      title: "Chest pain or pressure",
      signs: ["Pain, pressure or tightness in the chest", "Pain spreading to the arm, jaw or back", "Cold sweat, feeling faint or being sick"],
      steps: [
        "Sit down and stay as still as you can. Ask someone to take you or to bring help. Do not drive yourself.",
        "If you are awake and alert and you are not allergic to aspirin, chew one aspirin (162 to 324 mg) after you have asked for help, or while you are on the way.",
        "Tell the hospital staff about your chest pain as soon as you arrive.",
      ],
      never: ["Do not take aspirin if you are allergic to it.", "Do not take aspirin if you think this may be a stroke."],
      cmo_check: "Q17 decided the aspirin line (162 to 324 mg, alert, not allergic). Wording and any other medicine exclusion await signature.",
    },
    {
      key: "stroke",
      title: "Possible stroke",
      signs: ["Face drooping on one side", "Weakness or numbness in one arm or leg", "Speech slurred or hard to understand", "Sudden confusion, loss of balance or sight"],
      steps: [
        "Any one of these changes means the hospital is where you need to be now. Ask someone to take you straight away.",
        "Note the time the change started and tell the hospital staff.",
        "Keep the person sitting or lying with the head slightly raised. Give nothing to eat or drink.",
      ],
      never: ["Never give aspirin or any other medicine for a possible stroke."],
      cmo_check: "Q17: never aspirin for stroke. Confirm the rest of the wording.",
    },
    {
      key: "severe_blood_pressure",
      title: "Very high blood pressure with symptoms",
      signs: ["A very high reading together with a bad headache, chest pain, trouble breathing, confusion, weakness or changes in sight"],
      steps: [
        "Sit or lie down. Ask someone to take you to the hospital. Do not drive yourself.",
        "Take your usual medicines as normal. Do not take extra tablets to bring the number down quickly.",
      ],
      never: ["Do not take extra blood pressure tablets to lower the reading fast."],
      cmo_check: "Tiered rule (Q3) is signed separately in the hub; this card wording follows the existing signed EMG codes and is not new thresholds.",
    },
    {
      key: "low_blood_sugar",
      title: "Very low blood sugar",
      signs: ["Shaking, sweating, hunger, confusion or acting strangely", "A reading below your care team's low line"],
      steps: [
        "If the person is awake and can swallow: give 15 g of fast sugar (for example 3 teaspoons of sugar in water, or half a glass of a sugary drink). Check again in 15 minutes and repeat if still low.",
        "If the person is not awake, or cannot swallow safely: give nothing by mouth. Lay them on their side (the recovery position) and take them to the hospital now.",
        "If they do not get better, go to the hospital.",
      ],
      never: ["Never put food or drink in the mouth of someone who is not awake."],
      cmo_check: "15 g and 15 minutes are the Q17/Q5 decided values; sugar equivalents in household measures need a read.",
    },
    {
      key: "seizure",
      title: "Seizure or fit",
      signs: ["Shaking of the whole body, stiffening, or loss of awareness"],
      steps: [
        "Move hard objects away. Cushion the head. Note the time it started.",
        "A seizure that lasts more than 5 minutes, or fits that come one after another, is an emergency: go to the hospital now.",
        "When the shaking stops, lay the person on their side (the recovery position) and stay with them.",
      ],
      never: ["Never put anything in the mouth.", "Never hold the person down."],
      cmo_check: "Over 5 minutes or repeated is the Q17 decision. A first-ever seizure also needs the hospital; confirm wording.",
    },
    {
      key: "pregnancy_danger",
      title: "Pregnancy danger signs",
      signs: [
        "Blood pressure 160/110 or higher",
        "A severe headache that does not go away",
        "Changes in sight, such as blurring or flashing lights",
        "Bleeding from the vagina",
        "A fit",
      ],
      steps: ["Any one of these means the hospital now. Ask someone to take you. Do not wait to see if it settles.", "Lie on your left side while you wait for transport."],
      never: ["Do not wait for a booked visit."],
      cmo_check: "The 160/110 line and the five signs are the Q17 list; any further sign (reduced baby movement, waters breaking) needs the CMO.",
    },
    {
      key: "severe_breathlessness",
      title: "Severe trouble breathing",
      signs: ["Cannot speak a full sentence", "Lips or face turning blue or grey", "Breathing very fast, noisy or with effort"],
      steps: [
        "Sit upright. Loosen tight clothing. Ask someone to take you to the hospital now.",
        "If you have a reliever inhaler that has been prescribed to you, use it as you were taught while you wait for transport.",
      ],
      never: ["Do not lie flat."],
      cmo_check: "Reliever line follows the asthma rule set (Q11, signed separately). Confirm.",
    },
    {
      key: "malaria_danger",
      title: "Fever with malaria danger signs",
      signs: ["Fits", "Cannot drink or keep anything down", "Very drowsy or hard to wake", "Fever with any of these in a child"],
      steps: ["Any of these with a fever means the hospital now. Ask someone to take you.", "Keep the person cool with a light cloth and give small sips if they are awake and can swallow."],
      never: ["Do not wait to see if tablets work when one of these signs is present."],
      cmo_check: "[U] The three signs are from the Q17 list. WHO severe malaria list is longer; the CMO decides what the card carries.",
    },
    {
      key: "lassa_warning",
      title: "Fever with Lassa warning signs",
      signs: [
        "Fever with bleeding from the gums, nose or elsewhere",
        "Fever with severe weakness, repeated vomiting or swelling of the face",
        "Fever after contact with someone known to have Lassa fever",
      ],
      steps: [
        "Go to the hospital now. Tell the staff about your fever and any contact before you go in, so they can protect themselves.",
        "Avoid touching the blood, urine or other body fluids of anyone who is ill.",
      ],
      never: ["Do not share a bed, towels or cups with the person who is ill."],
      cmo_check: "[U] The spec names Lassa warning signs without listing them. These are a draft and need the CMO against the NCDC guidance.",
    },
  ],
  states: NIGERIAN_STATES.map((s) => none(s.code, s.name)),
};

/** Device-side red-rule thresholds for the readings the phone can classify without the server (pulse, SpO2, temperature). Mirrors the
 * SQL functions private.classify_pulse_level, classify_spo2_level and classify_temperature_level; a parity test compares them. */
export const DEVICE_RED_RULES = {
  pulse_bpm: { emergency_at_or_below: 35, emergency_at_or_above: 150, red_at_or_below: 39, red_at_or_above: 121, amber_at_or_below: 49, amber_at_or_above: 101 },
  spo2_pct: { emergency_below: 90, red_at_or_below: 92, amber_at_or_below: 94 },
  temperature_c: { emergency_at_or_above: 40.0, emergency_below: 35.0, red_at_or_above: 39.0, amber_at_or_above: 38.0 },
} as const;
