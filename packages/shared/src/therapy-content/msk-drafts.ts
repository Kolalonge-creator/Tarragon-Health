/**
 * S96 MSK programme content: back, neck, knee and hip pain, eight weekly sessions each.
 *
 * STATUS: DRAFT, ORIGINAL ENGLISH TEXT, NOT REVIEWED. Written by the build for the Chief Medical Officer to read, change or reject. Nothing
 * here is signed or approved: every programme version is seeded with review_state "draft", the guard `therapy_pain_enabled` is OFF, and a
 * real patient is never shown draft text (only a test account can). A physiotherapist can review this later with no rebuild: the content is
 * versioned rows and the approval is one function; this build adds no physiotherapist role.
 *
 * Basis (for the CMO to verify against the source; none of it is represented as approved by NICE or any regulator): NICE NG59 (low back
 * pain and sciatica: stay active, group or self-managed exercise, do not rest in bed, no routine scans), NICE NG226 (osteoarthritis:
 * exercise is a core treatment for knee and hip, with weight advice where it applies), and general neck self-management guidance
 * (gentle movement, posture breaks, shoulder and shoulder-blade strength). Digital MSK programmes show a small effect on pain, so the text
 * promises nothing: it says some people notice a change and some do not.
 *
 * Every dose, hold time, number of repeats and rule of thumb about pain in this file is PROPOSED and must be checked by the CMO.
 *
 * Content rules (checked by msk-content.test.ts): self-help, not treatment; no promise of a result and no trial figure; "your care team"
 * never "your doctor"; never "cure"; no phone number or helpline; no em dash; no mention of artificial intelligence; plain words, short
 * sentences; no fear language; each session's day-set is at most three exercises and always holds one gentle exercise.
 */
import { MSK_DRAWING_ALT } from "./msk-illustrations";

export type MskIntensity = "gentle" | "moderate";

export interface MskExercise {
  readonly key: string;
  readonly name: string;
  readonly intensity: MskIntensity;
  /** Plain steps, one action each. */
  readonly steps: readonly string[];
  /** The written dose for one day. PROPOSED. */
  readonly dose: string;
  readonly easier: string;
  readonly harder: string;
  readonly stopIf: string;
}

const STOP_COMMON = "Stop if you feel sharp pain, new numbness or pins and needles, or dizziness.";

export const MSK_EXERCISES: Readonly<Record<string, MskExercise>> = {
  knee_rock: {
    key: "knee_rock",
    name: "Knee rolls",
    intensity: "gentle",
    steps: [
      "Lie on your back with your knees bent and your feet flat on the floor.",
      "Keep your shoulders on the floor.",
      "Let both knees roll slowly to one side, only as far as is comfortable.",
      "Bring them back to the middle, then roll to the other side.",
    ],
    dose: "8 slow rolls to each side, once a day.",
    easier: "Roll a smaller way, or do 4 to each side.",
    harder: "Do 12 to each side.",
    stopIf: STOP_COMMON,
  },
  pelvic_tilt: {
    key: "pelvic_tilt",
    name: "Pelvic tilt",
    intensity: "gentle",
    steps: [
      "Lie on your back with your knees bent and your feet flat.",
      "Breathe out, and gently press the small of your back towards the floor.",
      "Hold for a count of 3, then let go slowly.",
      "Keep breathing normally the whole time.",
    ],
    dose: "8 tilts, holding each for 3 seconds, once a day.",
    easier: "Hold for 1 or 2 seconds, or do 4 tilts.",
    harder: "Hold for 5 seconds.",
    stopIf: STOP_COMMON,
  },
  cat_camel: {
    key: "cat_camel",
    name: "Back arch and round",
    intensity: "gentle",
    steps: [
      "Get on your hands and knees, with your hands under your shoulders and your knees under your hips.",
      "Slowly round your back up towards the ceiling and let your head hang gently.",
      "Then slowly let your back sag down a little and look forward.",
      "Move only as far as feels comfortable.",
    ],
    dose: "8 slow rounds and sags, once a day.",
    easier: "Make the movement smaller, or do 4.",
    harder: "Do 12.",
    stopIf: STOP_COMMON,
  },
  bridge: {
    key: "bridge",
    name: "Bridge",
    intensity: "gentle",
    steps: [
      "Lie on your back with your knees bent and your feet flat, hip width apart.",
      "Breathe out and squeeze your buttocks.",
      "Lift your hips until your body makes a straight slope from your shoulders to your knees.",
      "Hold for a count of 3, then lower slowly.",
    ],
    dose: "8 bridges, holding each for 3 seconds, once a day.",
    easier: "Lift only a little way, or do 4.",
    harder: "Hold for 5 seconds, or do 12.",
    stopIf: STOP_COMMON,
  },
  bird_dog: {
    key: "bird_dog",
    name: "Arm and leg reach",
    intensity: "moderate",
    steps: [
      "Get on your hands and knees, with your back flat.",
      "Slowly stretch one arm forward and the opposite leg back.",
      "Keep your back still and your hips level. Do not let your back sag.",
      "Hold for a count of 3, come back slowly, then change sides.",
    ],
    dose: "6 reaches on each side, holding each for 3 seconds, once a day.",
    easier: "Lift just an arm, or just a leg, one at a time.",
    harder: "Hold for 5 seconds.",
    stopIf: STOP_COMMON,
  },
  sit_to_stand: {
    key: "sit_to_stand",
    name: "Sit to stand",
    intensity: "moderate",
    steps: [
      "Sit near the front of a firm chair, with your feet flat and hip width apart.",
      "Lean forward a little and stand up. Use your hands on your knees or the chair if you need to.",
      "Stand tall for a moment.",
      "Sit back down slowly and with control.",
    ],
    dose: "8 stands, once or twice a day.",
    easier: "Use a higher seat or push up with your hands, or do 4.",
    harder: "Do not use your hands, or do 12.",
    stopIf: STOP_COMMON,
  },
  walk: {
    key: "walk",
    name: "Easy walk",
    intensity: "gentle",
    steps: [
      "Walk at a pace where you can still talk.",
      "Stand tall and let your arms swing.",
      "Walk on level ground, in comfortable shoes.",
      "Take a short rest if you need one.",
    ],
    dose: "10 minutes, once or twice a day. You can split it into shorter walks.",
    easier: "Walk for 5 minutes, or walk indoors.",
    harder: "Add 5 minutes.",
    stopIf: STOP_COMMON,
  },
  chin_tuck: {
    key: "chin_tuck",
    name: "Chin tuck",
    intensity: "gentle",
    steps: [
      "Sit or stand tall and look straight ahead.",
      "Glide your chin straight back, as if making a double chin. Keep your head level.",
      "Hold for a count of 3.",
      "Relax and let your head come back to the middle.",
    ],
    dose: "8 tucks, holding each for 3 seconds, twice a day.",
    easier: "Do 4, and hold for 1 or 2 seconds.",
    harder: "Hold for 5 seconds.",
    stopIf: STOP_COMMON,
  },
  neck_turn: {
    key: "neck_turn",
    name: "Neck turns",
    intensity: "gentle",
    steps: [
      "Sit or stand tall and look straight ahead.",
      "Slowly turn your head to one side, as far as is comfortable.",
      "Hold for a count of 2, then come back to the middle.",
      "Turn to the other side.",
    ],
    dose: "6 turns to each side, twice a day.",
    easier: "Turn a smaller way, or do 3 to each side.",
    harder: "Do 10 to each side.",
    stopIf: STOP_COMMON,
  },
  neck_side_tilt: {
    key: "neck_side_tilt",
    name: "Gentle side tilt",
    intensity: "gentle",
    steps: [
      "Sit or stand tall with your shoulders relaxed.",
      "Slowly tilt your head so your ear moves towards your shoulder. Do not lift the shoulder.",
      "Hold for a count of 5 when you feel a gentle stretch.",
      "Come back to the middle, then tilt to the other side.",
    ],
    dose: "3 tilts to each side, holding each for 5 seconds, twice a day.",
    easier: "Tilt a smaller way.",
    harder: "Hold for 10 seconds.",
    stopIf: STOP_COMMON,
  },
  shoulder_roll: {
    key: "shoulder_roll",
    name: "Shoulder rolls",
    intensity: "gentle",
    steps: [
      "Sit or stand tall with your arms relaxed.",
      "Lift your shoulders up towards your ears.",
      "Roll them back and down in a slow circle.",
      "Let your arms hang loose at the end.",
    ],
    dose: "10 slow rolls, a few times a day, for example after every hour of sitting.",
    easier: "Do 5.",
    harder: "Do 15.",
    stopIf: STOP_COMMON,
  },
  blade_squeeze: {
    key: "blade_squeeze",
    name: "Shoulder blade squeeze",
    intensity: "gentle",
    steps: [
      "Sit or stand tall with your elbows bent by your sides.",
      "Gently draw your shoulder blades back and together, as if holding a pencil between them.",
      "Hold for a count of 5. Keep your shoulders low, not up by your ears.",
      "Relax slowly.",
    ],
    dose: "8 squeezes, holding each for 5 seconds, twice a day.",
    easier: "Do 4, and hold for 2 or 3 seconds.",
    harder: "Hold for 8 seconds.",
    stopIf: STOP_COMMON,
  },
  neck_press: {
    key: "neck_press",
    name: "Gentle head press",
    intensity: "gentle",
    steps: [
      "Sit tall and place your palm on your forehead.",
      "Gently press your head into your hand. Your head should not move.",
      "Use about a quarter of your strength. Hold for a count of 5 and keep breathing.",
      "Relax. Then try with your hand on the side of your head, one side at a time.",
    ],
    dose: "4 presses in each direction (front, left, right), holding each for 5 seconds, once a day.",
    easier: "Press more softly, or do 2.",
    harder: "Hold for 8 seconds.",
    stopIf: STOP_COMMON,
  },
  heel_slide: {
    key: "heel_slide",
    name: "Heel slides",
    intensity: "gentle",
    steps: [
      "Lie on your back with your legs straight.",
      "Slowly slide the heel of your sore leg towards your buttock, bending the knee.",
      "Go only as far as is comfortable, then slide it straight again.",
      "Keep the movement slow and smooth.",
    ],
    dose: "10 slides, once or twice a day.",
    easier: "Slide a shorter way, or do 5.",
    harder: "Do 15.",
    stopIf: STOP_COMMON,
  },
  quad_set: {
    key: "quad_set",
    name: "Thigh squeeze",
    intensity: "gentle",
    steps: [
      "Lie on your back, or sit with your leg straight on a bed or the floor.",
      "Put a small rolled towel under your knee.",
      "Press the back of your knee down into the towel by tightening the muscle on top of your thigh.",
      "Hold for a count of 5, then relax.",
    ],
    dose: "10 squeezes, holding each for 5 seconds, once or twice a day.",
    easier: "Hold for 2 or 3 seconds, or do 5.",
    harder: "Hold for 8 seconds.",
    stopIf: STOP_COMMON,
  },
  straight_leg_raise: {
    key: "straight_leg_raise",
    name: "Straight leg raise",
    intensity: "gentle",
    steps: [
      "Lie on your back. Bend the knee of your good leg with the foot flat.",
      "Tighten the thigh of your sore leg so the knee is straight.",
      "Lift the straight leg to the height of the other knee.",
      "Hold for a count of 3, then lower slowly.",
    ],
    dose: "8 lifts, once a day.",
    easier: "Lift a smaller way, or do 4.",
    harder: "Hold for 5 seconds, or do 12.",
    stopIf: STOP_COMMON,
  },
  mini_squat: {
    key: "mini_squat",
    name: "Wall mini squat",
    intensity: "moderate",
    steps: [
      "Stand with your back against a wall and your feet a little way in front, hip width apart.",
      "Slowly bend your knees a short way, as if starting to sit. Keep your back on the wall.",
      "Hold for a count of 3, then straighten up slowly.",
      "Keep your knees pointing the same way as your toes.",
    ],
    dose: "8 mini squats, once a day.",
    easier: "Bend a smaller way, or do 4.",
    harder: "Hold for 5 seconds, or do 12.",
    stopIf: STOP_COMMON,
  },
  step_up: {
    key: "step_up",
    name: "Step up",
    intensity: "moderate",
    steps: [
      "Stand in front of a low, sturdy step. Hold a rail or a wall if you need to.",
      "Step up with your sore leg first and stand tall.",
      "Step back down slowly with the other leg.",
      "Take your time and keep your knee in line with your toes.",
    ],
    dose: "8 steps up with each leg, once a day.",
    easier: "Use a lower step, hold on, or do 4.",
    harder: "Use a slightly higher step, or do 12.",
    stopIf: STOP_COMMON,
  },
  calf_raise: {
    key: "calf_raise",
    name: "Heel raises",
    intensity: "moderate",
    steps: [
      "Stand with your hands on a wall or a sturdy chair.",
      "Rise up slowly onto your toes.",
      "Hold for a count of 2, then lower your heels slowly.",
      "Keep your weight even on both feet.",
    ],
    dose: "10 raises, once a day.",
    easier: "Do 5.",
    harder: "Do 15.",
    stopIf: STOP_COMMON,
  },
  clamshell: {
    key: "clamshell",
    name: "Clamshell",
    intensity: "gentle",
    steps: [
      "Lie on your side with your knees bent and your feet together.",
      "Keep your feet touching and lift your top knee, like a clam opening.",
      "Do not roll your hips backwards.",
      "Lower slowly.",
    ],
    dose: "10 lifts on each side, once a day.",
    easier: "Lift a smaller way, or do 5.",
    harder: "Hold for 3 seconds at the top, or do 15.",
    stopIf: STOP_COMMON,
  },
  hip_abduction_standing: {
    key: "hip_abduction_standing",
    name: "Standing leg out to the side",
    intensity: "gentle",
    steps: [
      "Stand tall holding the back of a chair or a wall.",
      "Slowly lift one leg out to the side, keeping your toes pointing forward.",
      "Keep your body upright. Do not lean.",
      "Lower slowly, then repeat. Change legs after a set.",
    ],
    dose: "8 lifts on each leg, once a day.",
    easier: "Lift a smaller way, or do 4.",
    harder: "Do 12.",
    stopIf: STOP_COMMON,
  },
  marching: {
    key: "marching",
    name: "Standing march",
    intensity: "gentle",
    steps: [
      "Stand tall holding the back of a chair or a wall.",
      "Lift one knee up in front, as high as is comfortable.",
      "Lower it slowly and lift the other knee.",
      "Keep your body upright.",
    ],
    dose: "10 lifts on each leg, once a day.",
    easier: "Lift a smaller way, or do 5.",
    harder: "Do 15.",
    stopIf: STOP_COMMON,
  },
};

export type MskContentKind = "education" | "exercise";

export interface MskSessionDraft {
  readonly ordinal: number;
  readonly title: string;
  readonly kind: MskContentKind;
  readonly body: string;
  readonly durationSeconds: number;
  /** The day's set: at most three exercises (the configured daily cap), at least one of them gentle. */
  readonly exercises: readonly string[];
}

export interface MskProgrammeDraft {
  readonly code: "pain_back" | "pain_neck" | "pain_knee" | "pain_hip";
  readonly title: string;
  readonly summary: string;
  readonly sessions: readonly MskSessionDraft[];
}

const HOSPITAL = "If you feel very unwell or in danger, go to the nearest hospital now.";
const FLARE =
  "If your pain gets worse, use the button called My pain got worse. It asks a few safety questions and gives you a lighter plan for a few days.";
const RATE = "After each exercise, tell the app how hard it felt, from very easy to too hard. This helps keep the plan the right size for you.";
const PAIN_RULE =
  "A little discomfort while you exercise is normal. A mild rise in your usual pain that settles within an hour or by the next day is expected. Pain that is sharp, or that stays worse, means you should ease off.";

const FOOT_BACK = `${FLARE} Tell your care team through the app if you notice numbness around your private parts, a change in passing urine or opening your bowels, or weakness in your legs. ${HOSPITAL}`;
const FOOT_NECK = `${FLARE} Tell your care team through the app if you notice weakness or numbness spreading into your arms or hands, or changes in your balance. ${HOSPITAL}`;
const FOOT_KNEE = `${FLARE} Tell your care team through the app if your knee becomes hot and swollen, if you cannot put weight on it, or if your calf becomes painful or swollen. ${HOSPITAL}`;
const FOOT_HIP = `${FLARE} Tell your care team through the app if you cannot put weight on your leg, if you have pain in your groin after a fall, or if your calf becomes painful or swollen. ${HOSPITAL}`;

const s = (
  ordinal: number,
  title: string,
  kind: MskContentKind,
  body: string,
  exercises: readonly string[],
): MskSessionDraft => ({ ordinal, title, kind, body, durationSeconds: 600, exercises });

const BACK: MskProgrammeDraft = {
  code: "pain_back",
  title: "Back pain programme",
  summary: "Eight weeks of gentle, guided movement and plain advice for back pain, with a few short exercises each day. A self-help programme, not treatment.",
  sessions: [
    s(1, "Week 1: keep moving, gently", "education",
      `Welcome. This is a self-help programme. It does not replace your care team. Back pain is very common, and it is rarely a sign of serious damage. Staying active usually helps more than resting in bed. Each day this week, do the short set below and take a walk. ${PAIN_RULE} ${RATE} When you finish this week, the app asks four short questions about your pain and daily life, so we can see how you are getting on. ${FOOT_BACK}`,
      ["walk", "knee_rock", "pelvic_tilt"]),
    s(2, "Week 2: loosening the back", "exercise",
      `This week we add a gentle back arch and round. Move slowly and only as far as is comfortable. Keep walking a little each day. Many people find the back feels looser after a few days. Some do not, and that is useful to know. ${RATE} ${FOOT_BACK}`,
      ["walk", "cat_camel", "pelvic_tilt"]),
    s(3, "Week 3: waking up the muscles", "exercise",
      `Strong hip and back muscles help carry your weight. This week we add the bridge. Squeeze your buttocks as you lift, and breathe normally. Keep your walking going. Try to do your set on at least three or four days. ${FOOT_BACK}`,
      ["walk", "bridge", "cat_camel"]),
    s(4, "Week 4: checking in", "exercise",
      `You are halfway. Sitting and standing up from a chair is something you do all day, so we practise it with care. Keep your back straight and use your legs. When you finish this week, the app asks the four short questions again. If your pain is much worse than at the start, your care team will be told and will look at your plan with you. ${FOOT_BACK}`,
      ["walk", "bridge", "sit_to_stand"]),
    s(5, "Week 5: building strength", "exercise",
      `This week the bridge, the arm and leg reach, and sit to stand make up your set. Keep your back still during the reach. If it feels too hard, use the easier version listed under the exercise. There is no prize for going faster. ${FOOT_BACK}`,
      ["bridge", "bird_dog", "sit_to_stand"]),
    s(6, "Week 6: everyday movements", "exercise",
      `Think about the movements you want to do more easily, such as bending to pick something up or getting out of bed. Bend your hips and knees, keep the load close, and breathe out as you lift. Keep your walk going and add a little time if it feels comfortable. ${FOOT_BACK}`,
      ["walk", "bird_dog", "sit_to_stand"]),
    s(7, "Week 7: staying on track", "exercise",
      `Notice what helps you keep going. A set time, a reminder on your phone, or a walking partner can all help. If you miss a day, start again the next day. There is nothing to catch up. ${FOOT_BACK}`,
      ["walk", "bridge", "bird_dog"]),
    s(8, "Week 8: looking back, and carrying on", "education",
      `You have reached the end of the eight weeks. When you finish, answer the four short questions again and look at how they compare with week 1. Some people notice a change and some do not. Either way, keep moving most days. If your back pain is still getting in the way of your life, or is getting worse, tell your care team. They can talk with you about other support. Thank you for taking part. ${FOOT_BACK}`,
      ["walk", "bird_dog", "sit_to_stand"]),
  ],
};

const NECK: MskProgrammeDraft = {
  code: "pain_neck",
  title: "Neck pain programme",
  summary: "Eight weeks of gentle neck and shoulder movement and plain advice for neck pain, with a few short exercises each day. A self-help programme, not treatment.",
  sessions: [
    s(1, "Week 1: gentle movement", "education",
      `Welcome. This is a self-help programme. It does not replace your care team. Neck pain is common and often settles. Gentle movement and regular breaks from one position usually help more than keeping still. Try to change position at least once an hour. ${PAIN_RULE} ${RATE} When you finish this week, the app asks four short questions about your pain and daily life. ${FOOT_NECK}`,
      ["chin_tuck", "neck_turn", "shoulder_roll"]),
    s(2, "Week 2: easing the stiffness", "exercise",
      `This week we add a gentle side tilt. Move slowly and stop at the first gentle stretch. Never push into pain. Keep up your shoulder rolls whenever you have been sitting for a while. ${RATE} ${FOOT_NECK}`,
      ["chin_tuck", "neck_turn", "neck_side_tilt"]),
    s(3, "Week 3: shoulders and upper back", "exercise",
      `The muscles between your shoulder blades help hold your head and neck in a comfortable place. This week we add the shoulder blade squeeze. Keep your shoulders low and your neck long. ${FOOT_NECK}`,
      ["chin_tuck", "shoulder_roll", "blade_squeeze"]),
    s(4, "Week 4: checking in", "exercise",
      `You are halfway. When you finish this week, the app asks the four short questions again. If your pain is much worse than at the start, your care team will be told and will look at your plan with you. Think about how you sit or sleep, and whether a small change, such as raising your screen, would help. ${FOOT_NECK}`,
      ["neck_turn", "neck_side_tilt", "blade_squeeze"]),
    s(5, "Week 5: building strength", "exercise",
      `This week we add the gentle head press. Your head does not move. You are just waking up the muscles that support it. Use about a quarter of your strength and keep breathing. ${FOOT_NECK}`,
      ["chin_tuck", "blade_squeeze", "neck_press"]),
    s(6, "Week 6: whole-body movement", "exercise",
      `A walk helps your neck too, because it keeps your whole body moving. Walk at an easy pace and let your arms swing. Keep your head level and your shoulders relaxed. ${FOOT_NECK}`,
      ["walk", "blade_squeeze", "neck_press"]),
    s(7, "Week 7: staying on track", "exercise",
      `Notice what helps you keep going. A set time, a reminder on your phone, or doing a set after a meal can all help. If you miss a day, start again the next day. ${FOOT_NECK}`,
      ["walk", "chin_tuck", "blade_squeeze"]),
    s(8, "Week 8: looking back, and carrying on", "education",
      `You have reached the end of the eight weeks. When you finish, answer the four short questions again and look at how they compare with week 1. Some people notice a change and some do not. Keep moving your neck and shoulders through the day. If your neck pain is still getting in the way of your life, or is getting worse, tell your care team. They can talk with you about other support. Thank you for taking part. ${FOOT_NECK}`,
      ["walk", "neck_press", "blade_squeeze"]),
  ],
};

const KNEE: MskProgrammeDraft = {
  code: "pain_knee",
  title: "Knee pain programme",
  summary: "Eight weeks of gentle leg strengthening and plain advice for knee pain, with a few short exercises each day. A self-help programme, not treatment.",
  sessions: [
    s(1, "Week 1: starting gently", "education",
      `Welcome. This is a self-help programme. It does not replace your care team. Knees like to move, and strong thigh muscles take some of the load off the joint. Exercise is one of the most helpful things for sore knees, including knees with arthritis. Start gently. ${PAIN_RULE} ${RATE} When you finish this week, the app asks four short questions about your pain and daily life. ${FOOT_KNEE}`,
      ["walk", "heel_slide", "quad_set"]),
    s(2, "Week 2: waking up the thigh", "exercise",
      `This week we add the straight leg raise. Tighten the thigh first so the knee is straight, then lift. Keep your good knee bent so your back stays comfortable. ${RATE} ${FOOT_KNEE}`,
      ["heel_slide", "quad_set", "straight_leg_raise"]),
    s(3, "Week 3: standing up with control", "exercise",
      `Sit to stand is something you do many times a day. This week we practise it on purpose. Use your hands if you need to and sit down slowly. ${FOOT_KNEE}`,
      ["quad_set", "straight_leg_raise", "sit_to_stand"]),
    s(4, "Week 4: checking in", "exercise",
      `You are halfway. When you finish this week, the app asks the four short questions again. If your pain is much worse than at the start, your care team will be told and will look at your plan with you. If you carry extra weight, even a small loss can ease the load on your knees, and your care team can help if you would like support. ${FOOT_KNEE}`,
      ["walk", "straight_leg_raise", "sit_to_stand"]),
    s(5, "Week 5: building strength", "exercise",
      `This week we add the wall mini squat. Keep your back on the wall and bend only a short way. Keep your knees in line with your toes. Choose the easier version if it feels too much. ${FOOT_KNEE}`,
      ["sit_to_stand", "mini_squat", "quad_set"]),
    s(6, "Week 6: calf and balance", "exercise",
      `Strong calves help your knee too. This week we add heel raises. Hold on to something steady. Keep walking a little more each week if it feels comfortable. ${FOOT_KNEE}`,
      ["walk", "mini_squat", "calf_raise"]),
    s(7, "Week 7: steps and stairs", "exercise",
      `This week we add stepping up onto a low step, which is a lot like climbing stairs. Hold a rail or a wall. Take your time. ${FOOT_KNEE}`,
      ["walk", "step_up", "mini_squat"]),
    s(8, "Week 8: looking back, and carrying on", "education",
      `You have reached the end of the eight weeks. When you finish, answer the four short questions again and look at how they compare with week 1. Some people notice a change and some do not. Keep your legs moving most days, because the benefit lasts only while you keep going. If your knee pain is still getting in the way of your life, or is getting worse, tell your care team. They can talk with you about other support. Thank you for taking part. ${FOOT_KNEE}`,
      ["walk", "step_up", "mini_squat"]),
  ],
};

const HIP: MskProgrammeDraft = {
  code: "pain_hip",
  title: "Hip pain programme",
  summary: "Eight weeks of gentle hip strengthening and plain advice for hip pain, with a few short exercises each day. A self-help programme, not treatment.",
  sessions: [
    s(1, "Week 1: starting gently", "education",
      `Welcome. This is a self-help programme. It does not replace your care team. Hips like to move, and strong hip and thigh muscles help carry your weight. Exercise is one of the most helpful things for a sore hip, including a hip with arthritis. Start gently. ${PAIN_RULE} ${RATE} When you finish this week, the app asks four short questions about your pain and daily life. ${FOOT_HIP}`,
      ["walk", "bridge", "clamshell"]),
    s(2, "Week 2: the buttock muscles", "exercise",
      `This week we add the standing march. Hold on to something steady and keep your body upright. Move slowly. ${RATE} ${FOOT_HIP}`,
      ["clamshell", "bridge", "marching"]),
    s(3, "Week 3: strength at the side of the hip", "exercise",
      `The muscles at the side of your hip keep you steady when you walk. This week we add the standing leg out to the side. Keep your toes pointing forward and do not lean. ${FOOT_HIP}`,
      ["clamshell", "bridge", "hip_abduction_standing"]),
    s(4, "Week 4: checking in", "exercise",
      `You are halfway. When you finish this week, the app asks the four short questions again. If your pain is much worse than at the start, your care team will be told and will look at your plan with you. This week we also practise sit to stand, which you do many times a day. Use your hands if you need to. ${FOOT_HIP}`,
      ["hip_abduction_standing", "sit_to_stand", "marching"]),
    s(5, "Week 5: building strength", "exercise",
      `Your set this week is sit to stand, the standing leg out to the side, and the bridge. Choose the easier version of any exercise that feels too much. There is no prize for going faster. ${FOOT_HIP}`,
      ["sit_to_stand", "hip_abduction_standing", "bridge"]),
    s(6, "Week 6: steps and stairs", "exercise",
      `This week we add stepping up onto a low step, which is a lot like climbing stairs. Hold a rail or a wall and take your time. ${FOOT_HIP}`,
      ["sit_to_stand", "step_up", "hip_abduction_standing"]),
    s(7, "Week 7: staying on track", "exercise",
      `Notice what helps you keep going. A set time or a reminder on your phone can help. If you miss a day, start again the next day. Walk a little more each week if it feels comfortable. ${FOOT_HIP}`,
      ["step_up", "clamshell", "walk"]),
    s(8, "Week 8: looking back, and carrying on", "education",
      `You have reached the end of the eight weeks. When you finish, answer the four short questions again and look at how they compare with week 1. Some people notice a change and some do not. Keep your hips moving most days, because the benefit lasts only while you keep going. If your hip pain is still getting in the way of your life, or is getting worse, tell your care team. They can talk with you about other support. Thank you for taking part. ${FOOT_HIP}`,
      ["sit_to_stand", "step_up", "walk"]),
  ],
};

export const THERAPY_MSK_CONTENT: readonly MskProgrammeDraft[] = [BACK, NECK, KNEE, HIP];

/** What the database stores for one exercise (and what the screens read back). snake_case keys match the JSON. */
export interface MskExerciseRow {
  readonly key: string;
  readonly name: string;
  readonly intensity: MskIntensity;
  readonly steps: readonly string[];
  readonly dose: string;
  readonly easier: string;
  readonly harder: string;
  readonly stop_if: string;
  readonly alt: string;
}

export function mskExerciseRow(key: string): MskExerciseRow {
  const e = MSK_EXERCISES[key];
  if (!e) throw new Error(`unknown MSK exercise ${key}`);
  return {
    key: e.key,
    name: e.name,
    intensity: e.intensity,
    steps: e.steps,
    dose: e.dose,
    easier: e.easier,
    harder: e.harder,
    stop_if: e.stopIf,
    alt: MSK_DRAWING_ALT[e.key] ?? "",
  };
}

/** The JSON the migration seeds, in the order of the markers: one entry per programme. */
export function mskSeedJson(): unknown {
  return THERAPY_MSK_CONTENT.map((p) => ({
    code: p.code,
    title: p.title,
    summary: p.summary,
    sessions: p.sessions.map((x) => ({
      ordinal: x.ordinal,
      title: x.title,
      kind: x.kind,
      body: x.body,
      durationSeconds: x.durationSeconds,
      exercises: x.exercises.map(mskExerciseRow),
    })),
  }));
}
