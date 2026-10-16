/**
 * S63 Wave A programme content: panic breathing, pelvic floor, gut-directed relaxation for IBS.
 *
 * STATUS: DRAFT, ORIGINAL ENGLISH TEXT, NOT REVIEWED. Written by the build for the Chief Medical Officer to read, change or reject.
 * Nothing here is signed, approved or live: every programme version is seeded with review_state "draft", every guard is OFF, and a real
 * patient is never shown draft text (only a test account can). No audio exists; each session names the manifest clip id its recording
 * will use (THP group, see packages/audio/src/therapy.ts).
 *
 * Content rules (checked by therapy-content.test.ts): self-help, not therapy; no promise of a result and no outcome figure from any trial
 * in another format; "your care team" never "your doctor"; never "cure"; no phone number or helpline anywhere; no em dash; no mention of
 * artificial intelligence. The panic programme is audio-paced breathing only: no carbon dioxide sensing, no breath holding, no
 * hardware. First-time panic and any chest symptom are sent to a clinician by the entry screen before any session opens.
 *
 * Where a number appears (8 squeezes, 3 times a day, 3 months) it is the value in therapy.programme_config.pelvic_floor, and a test
 * fails if the two drift.
 */

export type TherapyContentKind = "education" | "paced_breathing" | "guided_audio" | "exercise";

export interface TherapySessionDraft {
  readonly ordinal: number;
  readonly title: string;
  readonly kind: TherapyContentKind;
  /** The session text. It is also the script the audio will be recorded from. */
  readonly body: string;
  /** Planned length of the recording in seconds. The real length replaces it when a recording exists. */
  readonly durationSeconds: number;
}

export interface TherapyProgrammeDraft {
  readonly code: "panic_breathing" | "pelvic_floor" | "ibs_hypnotherapy";
  readonly wave: "A";
  readonly title: string;
  readonly summary: string;
  /** Short code used in manifest clip ids: THP-<clip>NN. */
  readonly clip: "PAN" | "PEL" | "IBS";
  readonly sessions: readonly TherapySessionDraft[];
}

const SAFETY_STOP =
  "If you feel dizzy, faint or unwell at any point, stop, sit down and breathe normally. If something feels wrong or you are worried, contact your care team through the app. If you feel in danger, go to the nearest hospital now.";

const PANIC: TherapyProgrammeDraft = {
  code: "panic_breathing",
  wave: "A",
  clip: "PAN",
  title: "Slow breathing for panic",
  summary: "Six weekly sessions of guided slow breathing you can follow by sound or on screen. A self-help programme, not treatment.",
  sessions: [
    {
      ordinal: 1,
      title: "What panic is, and your first slow breaths",
      kind: "education",
      durationSeconds: 600,
      body:
        "Welcome. This is a self-help programme. It is not treatment, and it does not replace your care team. Panic is a rush of fear that comes with strong body feelings, such as a pounding heart, shaky hands or fast breathing. It feels frightening, and it passes. Fast, shallow breathing can make those body feelings stronger. Slow, even breathing gives your body a calmer signal. " +
        "Today we only practise. Sit comfortably with your feet on the floor. Let your shoulders drop. Breathe in gently through your nose as the guide moves up, and breathe out slowly as it moves down. Let the out-breath be a little longer than the in-breath. Never force a breath and never hold it. " +
        "Practise twice a day this week, when you feel calm. " + SAFETY_STOP,
    },
    {
      ordinal: 2,
      title: "Practising when you feel calm",
      kind: "paced_breathing",
      durationSeconds: 600,
      body:
        "Welcome back. Slow breathing is a skill, and skills grow with practice on ordinary days, not only on hard ones. Sit comfortably. Follow the pacer: in gently as it rises, out slowly as it falls. Keep your breath small and quiet, as if you were breathing in the smell of food and breathing out onto a cool window. " +
        "If your mind wanders, that is normal. Notice it and come back to the pacer. Practise twice a day. You do not need to wait for panic to practise. " + SAFETY_STOP,
    },
    {
      ordinal: 3,
      title: "A longer out-breath, eyes open",
      kind: "paced_breathing",
      durationSeconds: 600,
      body:
        "This week we practise with your eyes open, so you can use the skill anywhere. Sit or stand. Rest your gaze on one still point. Follow the pacer. Breathe in gently, and let the out-breath be slow and soft. " +
        "Try it at a bus stop, in a queue or before a meeting. Each time, notice how your body feels before and after. You are not trying to feel perfect. You are practising settling. " + SAFETY_STOP,
    },
    {
      ordinal: 4,
      title: "Using it early, when a wave begins",
      kind: "paced_breathing",
      durationSeconds: 600,
      body:
        "Now we use the skill when you notice the first signs of a wave. Early signs may be a tight chest feeling you know well, a quick heartbeat or a rush of worry. Say to yourself: this is a wave, and it will pass. Then start your slow breathing, in gently and out slowly. " +
        "Keep going for a few minutes, even if the feelings are still there. Slow breathing may not stop a wave at once. It gives you something steady to do while it passes. If a chest feeling is new, different from your usual pattern, or severe, do not use this programme. Get help straight away. " + SAFETY_STOP,
    },
    {
      ordinal: 5,
      title: "Staying with the wave",
      kind: "paced_breathing",
      durationSeconds: 600,
      body:
        "Waves of panic rise, peak and fall. Trying to fight a wave often makes it feel bigger. This week, when a wave comes, breathe slowly and let it rise and fall without arguing with it. Follow the pacer, and notice where in your body you feel the wave. " +
        "Afterwards, write down one line in your diary: where you were, and what helped. Your diary stays on this phone unless you choose to share it. " + SAFETY_STOP,
    },
    {
      ordinal: 6,
      title: "Looking back, and what comes next",
      kind: "education",
      durationSeconds: 480,
      body:
        "You have practised slow breathing for six weeks. Look at your diary and at your scores. Some people notice a change and some do not. Either is useful to know. " +
        "Keep practising a little each day if it helps you. If panic is still getting in the way of your life, or is getting worse, tell your care team. They can talk with you about other support. Thank you for taking part. " + SAFETY_STOP,
    },
  ],
};

const PELVIC: TherapyProgrammeDraft = {
  code: "pelvic_floor",
  wave: "A",
  clip: "PEL",
  title: "Pelvic floor exercises",
  summary: "Twelve weekly sessions of audio-guided pelvic floor exercises for bladder leaks. A self-help programme, not treatment.",
  sessions: [
    {
      ordinal: 1,
      title: "Finding your pelvic floor",
      kind: "education",
      durationSeconds: 480,
      body:
        "Welcome. This is a self-help programme. It does not replace your care team. Your pelvic floor is a sling of muscles that supports your bladder. When it is weak, you can leak when you cough, sneeze, laugh or lift. These muscles can be trained, like any other muscle. " +
        "Sit comfortably. Imagine you are trying to stop yourself passing wind, and at the same time stop the flow of urine. Squeeze and lift gently inside, then let go. Do not hold your breath. Do not squeeze your buttocks or thighs. Do not practise while passing urine. Try three gentle squeezes now. " +
        "If you cannot feel the muscles, or you feel pain, tell your care team.",
    },
    {
      ordinal: 2,
      title: "Slow squeezes and rest",
      kind: "exercise",
      durationSeconds: 480,
      body:
        "Today we practise slow squeezes. Squeeze and lift, hold for a count of three, then let go fully for a count of three. Let go completely each time, because the rest is part of the exercise. Breathe normally throughout. " +
        "Do a short set now with the guide. Over the week, aim for a set of squeezes morning, afternoon and evening.",
    },
    {
      ordinal: 3,
      title: "Building up to a full set",
      kind: "exercise",
      durationSeconds: 540,
      body:
        "Your target is a set of at least 8 squeezes, three times a day, for at least 3 months. We build up to it. Today, do as many slow squeezes as you can with good form, up to 8, and rest between each. If your muscles tire, stop the set and try again later. " +
        "Tired muscles are normal at first. Sharp pain is not. If you feel pain, stop and tell your care team. Fix your sets to things you already do, such as after brushing your teeth, at lunch and before bed.",
    },
    {
      ordinal: 4,
      title: "Squeeze before you cough or sneeze",
      kind: "exercise",
      durationSeconds: 540,
      body:
        "Now we link your exercises to daily life. Just before you cough, sneeze, laugh or lift something, squeeze and lift your pelvic floor, and hold until after. This is a skill. It takes practice, so begin with a small cough on purpose. " +
        "Keep up your three sets of 8 squeezes each day.",
    },
    {
      ordinal: 5,
      title: "Longer holds",
      kind: "exercise",
      durationSeconds: 540,
      body:
        "Keep up your sets of 8 squeezes, three times a day. This week, slowly lengthen each hold. If you can, hold for a count of five, then rest for a count of five. Do not strain. Breathe throughout. " +
        "Some people skip a day. That is fine. Start again the next day.",
    },
    {
      ordinal: 6,
      title: "Quick squeezes",
      kind: "exercise",
      durationSeconds: 540,
      body:
        "Alongside your slow squeezes, add a few quick ones. Squeeze and lift fast, let go fully, and repeat up to 8 times. Quick squeezes practise reacting in time when you cough or move. Keep to three sets a day. " +
        "Stop and tell your care team if you notice pain, blood in your urine, or trouble passing urine.",
    },
    {
      ordinal: 7,
      title: "Squeezing while you are standing",
      kind: "exercise",
      durationSeconds: 540,
      body:
        "So far you have practised sitting. Now practise standing, because that is when leaks often happen. Stand with your feet apart. Squeeze and lift for a slow count, then rest. Keep to your three sets of 8 a day, and try one of them standing.",
    },
    {
      ordinal: 8,
      title: "Checking in on your progress",
      kind: "education",
      durationSeconds: 420,
      body:
        "You are about halfway. Think back over the last two weeks. How many leaks did you have each week? Add your count when the app asks. Some people see a change by now and some need longer. The usual advice is to keep going for at least 3 months before judging. " +
        "If leaks are getting worse, tell your care team.",
    },
    {
      ordinal: 9,
      title: "Squeezing during activity",
      kind: "exercise",
      durationSeconds: 540,
      body:
        "Practise squeezing while you walk, climb stairs or carry something light. Squeeze and lift, then relax as you finish the movement. Keep up your three sets a day. Notice which moments are hardest, and squeeze just before them.",
    },
    {
      ordinal: 10,
      title: "Keeping the habit",
      kind: "education",
      durationSeconds: 420,
      body:
        "A habit sticks when it is tied to your day. Choose three moments you will not forget. Set a quiet reminder if it helps. Keep your three sets of 8 squeezes. Drink normally and avoid cutting back on water to avoid leaks, because that can irritate your bladder.",
    },
    {
      ordinal: 11,
      title: "Longer and stronger",
      kind: "exercise",
      durationSeconds: 540,
      body:
        "Combine what you have learned. Do slow holds, quick squeezes and a squeeze before a cough. Keep your three sets a day. Stay with good form: breathe, do not squeeze your buttocks, and let go fully.",
    },
    {
      ordinal: 12,
      title: "Looking back, and keeping going",
      kind: "education",
      durationSeconds: 420,
      body:
        "You have reached the end of the twelve sessions. Look at your leak counts. Muscles stay strong only with regular use, so keep your three sets a day if you can. " +
        "If leaks have not eased, or have got worse, tell your care team. They can talk with you about other support. Thank you for taking part.",
    },
  ],
};

const IBS: TherapyProgrammeDraft = {
  code: "ibs_hypnotherapy",
  wave: "A",
  clip: "IBS",
  title: "Gut calm audio",
  summary: "Six weeks of a 15 minute guided relaxation recording for tummy symptoms. A self-help programme, not treatment.",
  sessions: [
    {
      ordinal: 1,
      title: "Week 1: settling the body",
      kind: "guided_audio",
      durationSeconds: 900,
      body:
        "Find a quiet place where you will not be disturbed, and lie down or sit back. This is a self-help recording. It does not replace your care team. Close your eyes if you wish. " +
        "Let your breathing slow. Notice your feet, and let them be heavy. Let that heaviness move up through your legs, your hips and your back. Let your shoulders drop and your jaw soften. " +
        "Now bring your attention to your tummy. Rest a warm hand there if you like. With each slow out-breath, let your tummy soften. Imagine a gentle warmth spreading through it, like sun on your skin. There is nothing to do and nowhere to be. " +
        "When you are ready, take a deeper breath, stretch, and open your eyes. Listen to this recording once a day this week.",
    },
    {
      ordinal: 2,
      title: "Week 2: a calm, steady rhythm",
      kind: "guided_audio",
      durationSeconds: 900,
      body:
        "Settle into your usual quiet place. Let your breath slow, and let your body grow heavy. Move your attention through your body from your feet up to your head, letting each part relax. " +
        "Now picture a slow, steady river that flows at an easy pace. Imagine your gut moving in the same even rhythm, without hurry and without effort. Each out-breath lets the river flow a little more smoothly. " +
        "Stay with that picture for a few minutes. When you are ready, open your eyes. Keep listening once a day.",
    },
    {
      ordinal: 3,
      title: "Week 3: a safe and quiet place inside",
      kind: "guided_audio",
      durationSeconds: 900,
      body:
        "Begin as before: slow breath, heavy body, soft shoulders. Picture a place where you feel safe and calm. It might be a garden, a shady tree or a quiet room. Notice what you can see, hear and feel there. " +
        "Bring that calm into your tummy. With each out-breath, let that calm settle there. If a tummy sensation comes, notice it kindly, without trying to push it away, and let your breath stay slow. " +
        "When you are ready, return to the room, take a deeper breath and open your eyes.",
    },
    {
      ordinal: 4,
      title: "Week 4: noticing without worry",
      kind: "guided_audio",
      durationSeconds: 900,
      body:
        "Settle in with a slow breath and relax your body from your feet upwards. This week, as you rest, notice any sensations in your tummy as simply sensations, like weather passing. They come and they go. " +
        "Breathe slowly, and picture a soft, warm light resting over your tummy, steady and calm. Let each out-breath soften the area a little more. " +
        "When you finish, notice how you feel. Keep your daily listening going.",
    },
    {
      ordinal: 5,
      title: "Week 5: bringing calm into your day",
      kind: "guided_audio",
      durationSeconds: 900,
      body:
        "Settle in as before, and relax your body. Picture an ordinary part of your day, such as a meal or a journey, going smoothly. Imagine yourself calm and comfortable in your body as it happens. " +
        "Then take a slow breath in, and as you breathe out, let your tummy soften. You can use that same soft out-breath in your day, at any time. " +
        "When you are ready, open your eyes. Keep listening once a day.",
    },
    {
      ordinal: 6,
      title: "Week 6: looking back, and carrying on",
      kind: "guided_audio",
      durationSeconds: 900,
      body:
        "Settle into your quiet place. Let your breath slow and your body relax, in your own time. " +
        "Think back over the six weeks. Notice what has helped you settle. Keep the slow out-breath, the warm hand and the quiet place as tools you can use whenever you like. " +
        "When you are ready, open your eyes. Check your symptom score when the app asks. If your tummy symptoms are not easing or are getting worse, or if anything new worries you, tell your care team. Thank you for taking part.",
    },
  ],
};

export const THERAPY_WAVE_A_CONTENT: readonly TherapyProgrammeDraft[] = [PANIC, PELVIC, IBS];

/** The manifest clip id a session's recording will use, for example THP-PAN03. */
export function therapyClipId(clip: TherapyProgrammeDraft["clip"], ordinal: number): string {
  return `THP-${clip}${String(ordinal).padStart(2, "0")}`;
}
