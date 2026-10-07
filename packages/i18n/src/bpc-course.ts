/**
 * Blood pressure care course (BPC-01 to BPC-14), Stage 1 content (spec 8.7, Production List section 7.1).
 *
 * SOURCE OF TRUTH for the lesson text. `scripts/learning/generate-bpc-seed.mjs` turns this file into the seed
 * migration and `audio/source/long-form-scripts.json`; a drift test fails if either is stale.
 *
 * STATUS: DRAFT, written by the build session from the production-list briefs and the WHO HEARTS theme. Not
 * reviewed by any clinician. Every lesson is seeded as `draft`, so none is shown to a patient until the CMO moves
 * it through clinical review. This file names no reviewer and records no approval, on purpose.
 *
 * Rules the lint test enforces (see bpc-course.test.ts): about 130 spoken words a minute so a lesson stays under
 * five minutes; short sentences; no dose, no medicine name, no mmHg figure, no claim about a herb; no banned words.
 *
 * English only (founder decision D-14, 2026-10-07): there is no second-language text.
 */
export interface LessonCheck {
  readonly question: string;
  readonly options: readonly [string, string, string];
  readonly answerIndex: 0 | 1 | 2;
}

export interface LessonText {
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly nextAction: string;
  readonly check: LessonCheck;
}

export interface BpcLesson {
  /** Audio Production List id, also the audio manifest clip id. */
  readonly code: string;
  /** Stable content code in `health_education_content`. */
  readonly slug: string;
  /** Planned length in the production list, in minutes. */
  readonly briefMinutes: number;
  readonly en: LessonText;
}

const paras = (...p: string[]): string => p.join("\n\n");

export const BPC_PROGRAMME = {
  code: "bp_care_course",
  title: "Blood pressure care course",
  description: "Fourteen short lessons on living well with blood pressure, with audio and an action to try each day.",
} as const;

export const BPC_LESSONS: readonly BpcLesson[] = [
  {
    code: "BPC-01",
    slug: "bpc_01_what_blood_pressure_is",
    briefMinutes: 3,
    en: {
      title: "What blood pressure is, and why it matters",
      summary: "Two numbers that show how hard your blood pushes on your blood vessels.",
      body: paras(
        "Your heart pumps blood around your body through tubes called blood vessels. Blood pressure is how hard the blood pushes on the walls of those tubes.",
        "A reading has two numbers. The top number is the push each time your heart squeezes. The bottom number is the push between beats, when your heart rests. Both matter.",
        "When the push stays too high for months and years, it slowly harms the walls of your blood vessels. The harm is quiet. You may feel nothing at all. Over time it can strain your heart, your kidneys, your eyes and the blood vessels in your brain.",
        "The good news is that blood pressure can be brought down and kept steady. Taking readings at home, taking your medicines as agreed, eating a little less salt and staying active all help. You do not need to be perfect. Small steady steps count.",
        "This course is short. Each lesson takes a few minutes and ends with one small thing to try. You can listen or read, and you can come back to any lesson at any time.",
        "Your care team is here for you. If anything in this course does not match what they have told you, follow your care team and ask them.",
      ),
      nextAction: "Find out where your blood pressure cuff is kept, or ask your care team how to get a reading near you.",
      check: {
        question: "What does blood pressure measure?",
        options: ["How fast your heart beats", "How hard blood pushes on the walls of your blood vessels", "How much blood is in your body"],
        answerIndex: 1,
      },
    },
  },
  {
    code: "BPC-02",
    slug: "bpc_02_measure_correctly_at_home",
    briefMinutes: 4,
    en: {
      title: "How to measure your blood pressure correctly at home",
      summary: "Rest, sit well, use the right cuff, take two readings and write them down.",
      body: paras(
        "A reading is only useful if it is taken well. The same person can get very different numbers just from how they sit. These steps make your reading fair.",
        "First, rest. Sit quietly for five minutes before you start. Do not talk and do not scroll your phone. Do not take a reading straight after a walk, a meal, a cigarette or a cup of tea or coffee. Go to the toilet first if you need to.",
        "Sit with your back supported and your feet flat on the floor. Do not cross your legs. Rest your arm on a table so the cuff is at the same level as your heart.",
        "Use the right cuff. Put it on bare skin, not over a sleeve. If the cuff is too small, the number reads too high. If it is too big, the number can read too low. If your cuff does not fit your arm well, tell your care team. A borrowed cuff may not fit you.",
        "Take two readings, about one minute apart, with the same arm. Write down both, with the time and the date. If your phone app lets you log them, do that. Do not choose the one you like better. Both are true readings.",
        "Try to measure at the same times each day, the way your care team asked. If you take a reading at a pharmacy or clinic, write down where you took it.",
        "Stay calm if one reading looks odd. One reading is not the whole story. If you feel very unwell, do not keep measuring. Use the emergency guidance in the app.",
      ),
      nextAction: "Take two readings today, one minute apart, after five minutes of sitting quietly. Write down both.",
      check: {
        question: "What should you do before taking a reading?",
        options: ["Walk quickly to warm up", "Sit quietly and rest for five minutes", "Drink a cup of strong tea"],
        answerIndex: 1,
      },
    },
  },
  {
    code: "BPC-03",
    slug: "bpc_03_understanding_numbers_and_target",
    briefMinutes: 3,
    en: {
      title: "Understanding your numbers and your target",
      summary: "Your readings are a pattern over time, and your care team sets your own target.",
      body: paras(
        "Blood pressure readings are grouped as normal, raised and high. Which group a number falls in matters, but the group is not the whole picture.",
        "Your own target is set by your care team. It depends on your age, your health and other conditions you may have. Your target may be different from someone else's, even in your own family. When your care team gives you a target, use that one, not a number you heard from a friend or read online.",
        "One reading is not the whole story. Blood pressure goes up and down through the day. It rises when you hurry, worry, sleep badly or feel pain. It falls when you rest. That is why you take two readings and why you keep a log.",
        "What counts is the pattern. Are most of your readings close to your target over the week? Is the pattern moving the right way over the months? The trend in your log tells your care team much more than any single number.",
        "Do not panic about one high reading, and do not relax about one good reading. If you get a reading that your care plan tells you to act on, do what the plan says. If you are not sure what to do with a number, ask your care team.",
        "The app shows your readings over time so you can see the pattern. You do not need to do the sums yourself.",
      ),
      nextAction: "Open your reading history in the app and look at the last week as a pattern, not as single numbers.",
      check: {
        question: "Whose target should you follow?",
        options: ["The target a friend told you", "The target your care team gave you", "The number you found online"],
        answerIndex: 1,
      },
    },
  },
  {
    code: "BPC-04",
    slug: "bpc_04_feeling_fine_with_high_pressure",
    briefMinutes: 3,
    en: {
      title: "Why you can feel fine with high blood pressure",
      summary: "High blood pressure usually has no feeling, so how you feel is not a good guide.",
      body: paras(
        "Many people with high blood pressure feel completely well. Some people think they would feel it if their pressure were high. Most of the time, they would not.",
        "A headache, a hot head or a dizzy feeling can happen for many reasons, and they do not reliably tell you your pressure. Feeling fine does not mean your pressure is fine. Only a reading can tell you.",
        "This is why blood pressure is so often missed. The harm builds quietly while you carry on with your life. A person can feel well for years and then have a stroke or heart problem with little warning.",
        "It is also why people stop their tablets. They feel well, they think the problem has gone, and they stop. But feeling well is often a sign that the tablets are working. When tablets stop, the pressure usually climbs back, and you may not feel that either.",
        "Please do not stop or change your tablets because you feel fine. If you want to stop, or you are worried about your tablets, talk to your care team first. Tell them the reason. They can often find a better way, such as a different tablet or a different time of day.",
        "Keep taking your readings even when you feel well. A good reading while on your tablets is the result you are looking for. It is not a reason to stop.",
      ),
      nextAction: "If you have ever skipped tablets because you felt fine, tell your care team in a message today. There is no blame.",
      check: {
        question: "You feel well. What is the best next step?",
        options: ["Stop the tablets because the problem is gone", "Keep taking tablets and keep checking readings", "Wait until you feel dizzy to check"],
        answerIndex: 1,
      },
    },
  },
  {
    code: "BPC-05",
    slug: "bpc_05_your_medicines_every_day",
    briefMinutes: 4,
    en: {
      title: "Your medicines: how they work and why every day",
      summary: "Blood pressure tablets work only while you keep taking them.",
      body: paras(
        "Blood pressure tablets do not fix the problem for good. They hold your pressure down while you take them. When you stop, the pressure usually rises again. That is why most people take them every day.",
        "Different tablets work in different ways. Some relax the blood vessels so the blood pushes less. Some help your body pass extra water and salt. Some slow the heart a little. Many people take two or three kinds together, each doing a different job. This is common and it is not a sign that you are very ill.",
        "Take your tablets at the same time every day, the way your care team told you. Link it to something you already do, like brushing your teeth or breakfast. A pill box for the week can help. The app can remind you.",
        "If you miss a tablet, follow the instructions your care team gave you for a missed dose. If you are not sure, ask them. Do not take extra tablets to make up for a missed one unless your care team has told you to.",
        "Never run out. Ask for a refill before your tablets finish. The app can show you when you are running low. If money or distance makes it hard to get your tablets, tell your care team. They would rather know.",
        "Never share tablets and never use someone else's. Tell your care team about every medicine you take, including those from a chemist, from a shop and from traditional healers.",
      ),
      nextAction: "Choose one daily moment to link your tablets to, and set a reminder in the app for it.",
      check: {
        question: "Why do most people take blood pressure tablets every day?",
        options: ["They fix the problem for good after a week", "They hold the pressure down only while you keep taking them", "They are only needed when you feel dizzy"],
        answerIndex: 1,
      },
    },
  },
  {
    code: "BPC-06",
    slug: "bpc_06_side_effects_and_when_to_tell",
    briefMinutes: 3,
    en: {
      title: "Side effects: what is common, and when to tell your care team",
      summary: "Most side effects are mild, but tell your care team before you stop anything.",
      body: paras(
        "Like any medicine, blood pressure tablets can cause side effects. Many people have none. Some have mild ones that fade after a few weeks.",
        "Some common ones are swollen ankles, a dry cough that will not go away, and feeling tired. Some people feel dizzy when they stand up quickly, or need the toilet more often. Not every tablet causes every one of these.",
        "If you feel dizzy when you stand, get up slowly and sit for a moment first. Drink water through the day unless you have been told to limit fluids.",
        "Tell your care team about any side effect that bothers you, even a small one. There is often an easy fix, such as a different tablet or a different time of day. Use the message option in the app.",
        "Please never stop a tablet on your own because of a side effect. Stopping suddenly can let your pressure rise. Speak to your care team first and they will guide you.",
        "Some effects need quick help. Swelling of your face, lips or tongue is one. Trouble breathing, a rash that spreads quickly, or fainting are others. Treat these as an emergency and use the emergency guidance in the app.",
        "Telling your care team about side effects is a normal part of treatment. It helps them choose the right tablets for you.",
      ),
      nextAction: "If a side effect has been bothering you, send your care team a short message today describing it.",
      check: {
        question: "A tablet is making you feel dizzy. What should you do?",
        options: ["Stop the tablet and say nothing", "Tell your care team and keep taking it until they guide you", "Take a double dose to get used to it"],
        answerIndex: 1,
      },
    },
  },
  {
    code: "BPC-07",
    slug: "bpc_07_salt_where_it_hides",
    briefMinutes: 4,
    en: {
      title: "Salt: where it hides in Nigerian food",
      summary: "A lot of salt comes from seasoning, not from the salt shaker.",
      body: paras(
        "Too much salt makes your body hold on to water, and that makes blood pressure rise. Most of the salt we eat does not come from the salt we add at the table. It comes from what is already in the food.",
        "Look at the places salt hides. Stock cubes and seasoning powders are very salty, and many of us use two or three in one pot. Instant noodles come with a salty flavour sachet. Processed and smoked meat, salted fish, sausages and canned food carry a lot. Suya spice and many ready mixes are salty. Bread can add up too, because we eat it often.",
        "You do not have to give up the food you love. Cut down step by step, so your taste has time to adjust.",
        "Try these small changes. Use one stock cube instead of two, then half a cube, then see if you need it at all. Add flavour with fresh pepper, onions, garlic, ginger, tomatoes and herbs such as scent leaf and thyme. Taste your food before you add salt. Cook fresh fish or meat more often than salted. Take the salt shaker off the table.",
        "When you buy packaged food, check the label and choose the one with less salt. Soup and stew can be made rich without much salt.",
        "Your taste changes in a few weeks. Food that tasted bland at first will start to taste right, and very salty food will start to taste too strong.",
        "If you have kidney disease or heart failure, or your care team gave you advice about salt or fluids, follow that advice.",
      ),
      nextAction: "At your next meal, use one fewer stock cube than usual and add fresh pepper or onion for flavour.",
      check: {
        question: "Where does most of the salt in our food come from?",
        options: ["Mostly the salt we add at the table", "Mostly seasoning, cubes and processed food", "Mostly fresh vegetables"],
        answerIndex: 1,
      },
    },
  },
  {
    code: "BPC-08",
    slug: "bpc_08_eating_for_healthy_blood_pressure",
    briefMinutes: 4,
    en: {
      title: "Eating for healthy blood pressure",
      summary: "Swaps that still taste good: more vegetables, fruit and beans, and sensible portions.",
      body: paras(
        "You do not need an expensive diet to help your blood pressure. Everyday Nigerian food can work well when you change the balance on the plate.",
        "Fill about half your plate with vegetables, such as ugu, spinach, okra, garden egg and cabbage. Add fruit through the day, like oranges, pawpaw, banana and watermelon. These give your body more of the things that help it handle salt.",
        "Try swaps that still taste good. Use fresh pepper, onions, tomatoes and herbs instead of extra seasoning cubes. Make soup with more vegetables and a little less meat. Boil or roast plantain and yam instead of frying them. Reach for a piece of fruit instead of a sweet snack.",
        "Choose beans and other pulses more often. Beans, moi moi and akara made with less salt are a good source of protein and fibre. Fish and eggs are good too. Choose fresh over smoked or salted when you can.",
        "Watch the size of the heap of rice, yam, swallow or bread. These foods are fine, but a mountain of any of them is too much. A fist-sized portion of swallow or rice is a good start, with more vegetables beside it.",
        "Use less oil and less sugar. Fry less and boil, grill or steam more. Choose water over sugary drinks.",
        "Make changes one at a time. Pick a single swap this week and keep it. A change you keep is worth more than a perfect plan you drop.",
        "If you have kidney disease, or your care team gave you a special diet, check with them before you change what you eat. Some foods that suit most people need care in kidney disease.",
      ),
      nextAction: "At one meal today, make vegetables fill about half your plate.",
      check: {
        question: "Which plate is the better balance?",
        options: ["A mountain of rice with a little stew", "Half the plate vegetables, with a fist-sized portion of rice or swallow", "Only fruit for every meal"],
        answerIndex: 1,
      },
    },
  },
  {
    code: "BPC-09",
    slug: "bpc_09_moving_more_without_a_gym",
    briefMinutes: 3,
    en: {
      title: "Moving more without a gym",
      summary: "Walking, dancing and housework all count. Start slowly and build up.",
      body: paras(
        "Moving your body helps your heart and your blood vessels, and it can help bring your blood pressure down. You do not need a gym, special clothes or any money.",
        "A good goal for most adults is about thirty minutes of moderate activity on most days. Moderate means your heart beats faster and you breathe harder, but you can still talk. You can split it up. Ten minutes three times a day counts just as well.",
        "Walking is the easiest place to start. Walk to the shop, get off the bus a stop early, or walk around the compound while you talk on the phone. Dancing counts. So does sweeping, fetching water, gardening and washing clothes by hand.",
        "If you have not been active for a while, start slowly. Five or ten minutes is a fine start. Add a few minutes each week. Warm up with a slow walk first and cool down at the end.",
        "Choose cooler times of day, drink water, and wear comfortable shoes.",
        "Stop and rest if you feel dizzy, very breathless or unwell. If you have chest pain or pressure, severe breathlessness or fainting, stop and use the emergency guidance in the app.",
        "If you have a heart condition or any health problem that worries you, ask your care team how much activity is right for you before you start.",
      ),
      nextAction: "Take a ten-minute walk today, at a pace where you can still talk.",
      check: {
        question: "Which of these counts as moving more?",
        options: ["Only paid gym classes", "Walking, dancing and housework", "Only running a long way"],
        answerIndex: 1,
      },
    },
  },
  {
    code: "BPC-10",
    slug: "bpc_10_alcohol_smoking_and_blood_pressure",
    briefMinutes: 3,
    en: {
      title: "Alcohol, smoking and blood pressure",
      summary: "Honest facts, with a first step that is small and doable.",
      body: paras(
        "This lesson is about alcohol and tobacco. It is not about blame. Many people find these hard to change, and wanting help is normal.",
        "Alcohol raises blood pressure, and the effect builds up when you drink often. It can also make some tablets work less well and add extra calories. If you drink, drinking less and less often is better for your pressure. If you do not drink, there is no need to start.",
        "Each cigarette makes your blood pressure and heart rate jump for a short while. Smoking also harms the walls of your blood vessels directly. Together with high blood pressure, smoking raises the chance of a heart attack or stroke far more than either one alone. Smokeless tobacco such as snuff and chewing tobacco also raises blood pressure. Switching to it is not a safe answer.",
        "Quitting is hard and most people need more than one try. Trying again is not failing. It is how most people succeed.",
        "A practical first step is to cut down a little. Skip one drink or one cigarette each day. Notice when you most want one, such as after meals, with friends or when stressed. Plan something else for that moment, like a short walk or a glass of water.",
        "Tell your care team if you drink or use tobacco. They will not judge you. They can give you real support and plan with you.",
      ),
      nextAction: "Choose one small cut for this week, such as one drink or one cigarette less each day, and write it down.",
      check: {
        question: "Is smokeless tobacco, such as snuff, a safe way to avoid the effect on blood pressure?",
        options: ["Yes, it does not affect blood pressure", "No, it also raises blood pressure", "Only a small pinch is safe"],
        answerIndex: 1,
      },
    },
  },
  {
    code: "BPC-11",
    slug: "bpc_11_stress_sleep_and_blood_pressure",
    briefMinutes: 3,
    en: {
      title: "Stress, sleep and blood pressure",
      summary: "Stress and poor sleep push pressure up. Slow breathing and good sleep habits help you come back down.",
      body: paras(
        "When you are stressed, your body releases hormones that make your heart beat faster and your blood vessels tighten. That raises your blood pressure for a while. This is useful in a real emergency. It is not helpful when the stress is traffic, money worries or a long day running on a loop.",
        "Poor sleep does something similar. People who sleep badly night after night often have higher blood pressure. If your partner says you snore loudly or stop breathing for a moment while you sleep, tell your care team. This can be treated.",
        "You cannot remove all stress, and you do not need to. What helps is having a reliable way to come back down. Some people pray or have quiet time. Some walk, talk to a friend or listen to calm music. Slow breathing for a few minutes is something you can do anywhere.",
        "The app has a short guided breathing exercise. It is a calm moment, and many people find it helpful. It does not replace your tablets or your readings. Keep taking your medicines and measuring as agreed with your care team.",
        "For better sleep, try to go to bed and wake at about the same time each day. Keep the room dark and quiet. Put the phone away for the last half hour. Avoid tea, coffee and heavy meals late in the evening.",
        "If stress, low mood or poor sleep is affecting you most days, tell your care team. It is a health matter and they can help.",
      ),
      nextAction: "Try the three-minute breathing exercise in the app once today, sitting down.",
      check: {
        question: "What is true about the breathing exercise?",
        options: ["It replaces your tablets", "It is a calm moment, and you keep taking your medicines", "You should do it while standing in traffic"],
        answerIndex: 1,
      },
    },
  },
  {
    code: "BPC-12",
    slug: "bpc_12_herbal_remedies_and_blood_pressure",
    briefMinutes: 3,
    en: {
      title: "Herbal remedies and blood pressure",
      summary: "Herbal mixtures are not a replacement for your medicines, and your care team needs to know what you take.",
      body: paras(
        "Many families trust herbal remedies, and that trust comes from real experience of care. This lesson is not about blaming anyone. It is about keeping you safe.",
        "Herbal drinks and mixtures are not a replacement for your blood pressure tablets. For most of them, nobody has shown that they control blood pressure safely, or in what amount. Stopping your tablets and relying on a herbal mixture can let your pressure rise without you feeling it.",
        "Some herbal products can also interact with your medicines. A product can make a tablet work too strongly or too weakly, or harm your kidneys or liver. A natural product is not automatically safe. The strength can also differ from one bottle or one seller to the next, and the label may not tell you what is inside.",
        "Please tell your care team about everything you take, including herbal drinks, powders, bitter leaf, garlic or ginger preparations, bottled mixtures and supplements. They will not scold you. They need the full picture so that your treatment is safe.",
        "Some foods and spices are part of a healthy diet. Using garlic or ginger in your cooking is fine. The concern is concentrated mixtures taken as a treatment, or taken in place of tablets.",
        "Before you start any new product, check with your care team first. If you have already stopped your tablets to use a herbal product, please tell your care team so that they can help you restart safely.",
      ),
      nextAction: "Write down everything you take apart from your tablets and share the list with your care team in a message.",
      check: {
        question: "A herbal mixture is making you feel well. What is the safest step?",
        options: ["Stop your tablets and use only the mixture", "Keep your tablets and tell your care team about the mixture", "Take both in bigger amounts"],
        answerIndex: 1,
      },
    },
  },
  {
    code: "BPC-13",
    slug: "bpc_13_warning_signs_that_need_urgent_care",
    briefMinutes: 3,
    en: {
      title: "Warning signs that need urgent care",
      summary: "Some signs mean act now. Call one one two or go to the nearest hospital emergency department.",
      body: paras(
        "Most of the time, blood pressure care is steady and calm. Sometimes a warning sign means you need help right away.",
        "Get emergency help now if you have any of these. A very bad headache that is not like your usual one. Chest pain or a heavy feeling in the chest. Trouble breathing. Weakness or numbness in the face, an arm or a leg. Trouble speaking, or confusion. Sudden problems with your sight.",
        "Call one one two or go to the nearest hospital emergency department. If you can, ask someone to come with you or to drive you. Do not drive yourself if you feel faint, confused or weak.",
        "Do not wait to see if it passes. Do not take another reading to decide. Do not try a home or herbal remedy first. These signs can be a stroke or a heart emergency, and every minute counts.",
        "The app has emergency guidance that works even without data. You can open it at any time from the emergency button. It shows what to do and who to call.",
        "Tell the people at home about these signs ahead of time. If you cannot speak for yourself, they will know what to do.",
        "If you are not sure whether something is an emergency, treat it as one and get help. Your care team would always prefer that you came early.",
      ),
      nextAction: "Find the emergency button in the app today and tell one person at home what these warning signs are.",
      check: {
        question: "You have chest pain and trouble breathing. What should you do?",
        options: ["Take another reading and wait an hour", "Call one one two or go to the nearest hospital emergency department", "Try a herbal drink first"],
        answerIndex: 1,
      },
    },
  },
  {
    code: "BPC-14",
    slug: "bpc_14_staying_in_control_for_life",
    briefMinutes: 3,
    en: {
      title: "Staying in control for life",
      summary: "What the next months and years look like, and the checks that protect your kidneys, heart and eyes.",
      body: paras(
        "Well done for reaching the end of this course. Taking care of your blood pressure is a long road, and you are already on it.",
        "In the first few months, you and your care team find what works for you. That may mean a change of tablets or a change in timing. This is normal. Keep sending your readings so they can see the pattern.",
        "After that, many people settle into a steady routine. Keep taking your readings, take your tablets every day, eat less salt, stay active, and keep up the habits that you built.",
        "Blood pressure can harm the kidneys, the heart and the eyes without any feeling, so keep to your regular checks. Your care team will plan yearly checks for these. Please do not skip them because you feel well.",
        "Expect good days and harder days. A busy week, a funeral, a wedding, a festival or a trip can disturb your routine. When that happens, restart the next day. You have not failed.",
        "Ask for help early. Tell your care team when tablets are running low, when a side effect bothers you or when life gets difficult. Talk to your family so that they can support you.",
        "Keep this course. You can come back to any lesson whenever you want a reminder.",
      ),
      nextAction: "Write down one habit from this course that you will keep, and tell someone at home what it is.",
      check: {
        question: "After a week of travel your routine slipped. What is the best response?",
        options: ["Give up because you have failed", "Restart the next day and tell your care team if you need help", "Stop all readings for a month"],
        answerIndex: 1,
      },
    },
  },
];
