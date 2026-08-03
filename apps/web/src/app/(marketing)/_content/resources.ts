/**
 * The /resources content hub, the SEO engine every surveyed digital-health
 * leader runs (Hims category pages, Omada/Virta education hubs), built the
 * Tarragon way: plain-language answers to questions Nigerians actually search,
 * linking into the condition pages that own the depth.
 *
 * HONESTY RULES (brand guide + clinical trust model):
 *   - Byline is the editorial team. NO "reviewed by Dr X" claim exists here
 *     because no per-article clinician review record exists. When a real
 *     review workflow lands, add a nullable reviewedBy field and gate the
 *     badge on it, exactly like the health-education library does.
 *   - Every article carries the education disclaimer; none diagnoses.
 *   - No fear-based urgency, no invented statistics. Clinical thresholds
 *     quoted (140/90, HbA1c 6.5%, etc.) are standard, widely published
 *     guideline figures.
 */

export type ResourceArticle = {
  slug: string;
  title: string;
  description: string;
  category: "Blood pressure" | "Diabetes" | "Weight" | "Screening" | "Cholesterol" | "Nutrition";
  readMinutes: number;
  relatedHref: string;
  relatedLabel: string;
  sections: { heading: string; paragraphs: string[] }[];
  // Null until an admin genuinely records a real clinician's review of THIS
  // article (library-level quality credit, same discipline as
  // health_education_content.reviewed_by_name/reviewed_at, not the
  // per-patient case-review ReviewedByDoctor component). The article page
  // must only render the byline when both are set.
  reviewedByName?: string | null;
  reviewedAt?: string | null;
  // ISO timestamps for JSON-LD + a truthful sitemap lastModified. The static
  // seed library has no real DB row, so these stay undefined for it; the
  // sitemap falls back to a fixed date rather than claiming "changed today".
  publishedAt?: string;
  updatedAt?: string;
};

export const RESOURCE_DISCLAIMER =
  "This article is general health information, not medical advice, a diagnosis, or a treatment plan. Always talk to a doctor about your own situation, and if you feel seriously unwell, go to a hospital now.";

export const RESOURCE_ARTICLES: ResourceArticle[] = [
  {
    slug: "normal-blood-pressure",
    title: "What is a normal blood pressure, and when should you worry?",
    description:
      "What the two numbers mean, what counts as high in adults, and why one raised reading is not a diagnosis.",
    category: "Blood pressure",
    readMinutes: 4,
    relatedHref: "/hypertension",
    relatedLabel: "How Tarragon manages hypertension",
    sections: [
      {
        heading: "The two numbers, in plain language",
        paragraphs: [
          "A blood pressure reading has two numbers, written like 120/80. The first (systolic) is the pressure in your arteries when your heart squeezes; the second (diastolic) is the pressure between beats, when the heart rests. Both matter.",
          "For most adults, a reading under 130/85 at rest is in a healthy range. Readings that stay at 140/90 or higher, measured properly on separate days, are what doctors call hypertension: high blood pressure.",
        ],
      },
      {
        heading: "Why one high reading is not a diagnosis",
        paragraphs: [
          "Blood pressure moves all day. Stress, caffeine, a rushed walk into the pharmacy, even the measurement itself ('white-coat effect') can push a single reading up. That is why no good clinician diagnoses hypertension from one number.",
          "What matters is the pattern: several readings, taken while rested, on different days. A home blood-pressure monitor (used correctly, seated, arm supported) often gives a truer picture than an occasional clinic check.",
        ],
      },
      {
        heading: "Why it matters so much in Nigeria",
        paragraphs: [
          "Hypertension is very common among Nigerian adults and is a leading driver of stroke, heart failure and kidney disease, yet it usually has no symptoms at all. Feeling fine tells you nothing about your blood pressure. The only way to know is to measure.",
        ],
      },
      {
        heading: "What to actually do",
        paragraphs: [
          "If you have never checked, check: at a pharmacy, a lab, or with a home cuff. If your readings sit at 140/90 or above more than once, see a doctor; hypertension is very treatable, and treatment is far cheaper than a stroke.",
          "If you are already diagnosed, the goal is control, not just tablets: take medicines consistently, cut salt, and keep measuring so you and your doctor can see whether the plan is working.",
        ],
      },
    ],
  },
  {
    slug: "hba1c-explained",
    title: "HbA1c: the 3-month sugar test, explained simply",
    description:
      "Why doctors trust HbA1c more than a single fasting sugar, what the percentages mean, and how often to test.",
    category: "Diabetes",
    readMinutes: 4,
    relatedHref: "/diabetes",
    relatedLabel: "How Tarragon manages diabetes",
    sections: [
      {
        heading: "What HbA1c actually measures",
        paragraphs: [
          "Sugar in your blood sticks to haemoglobin, the protein inside red blood cells. Because red cells live about three months, measuring how much sugar is stuck to them (HbA1c) reveals your average blood sugar over the past two to three months, not just this morning.",
          "That is why a single fasting glucose can look fine on a good day while HbA1c tells the fuller story.",
        ],
      },
      {
        heading: "Reading your result",
        paragraphs: [
          "As a widely used guide: below 5.7% is in the normal range; 5.7–6.4% is called prediabetes, a warning zone where change still prevents diabetes; 6.5% or higher on a proper laboratory test supports a diagnosis of diabetes.",
          "If you already live with diabetes, your doctor will set a personal target, often around 7%, balancing control against the risk of sugar going too low. Your target is a conversation, not a universal number.",
        ],
      },
      {
        heading: "How often should you test?",
        paragraphs: [
          "If you have diabetes, HbA1c every three to six months shows whether your plan is working. If you are in the prediabetes zone, a yearly test tracks which direction you are moving. If you have risk factors such as family history, excess weight, or previous high readings, ask about testing rather than waiting for symptoms.",
        ],
      },
      {
        heading: "The point of the number",
        paragraphs: [
          "HbA1c is not a grade on your character; it is feedback. Food, movement, medicines and stress all move it, and it responds within months. People bring it down every day, usually with a mix of small consistent changes and the right prescription, reviewed regularly.",
        ],
      },
    ],
  },
  {
    slug: "lower-blood-pressure-naturally",
    title: "Five changes that genuinely lower blood pressure",
    description:
      "Salt, weight, movement, alcohol and sleep: what the evidence supports, and what it can and can't replace.",
    category: "Blood pressure",
    readMinutes: 5,
    relatedHref: "/hypertension",
    relatedLabel: "Hypertension care at Tarragon",
    sections: [
      {
        heading: "First, an honest frame",
        paragraphs: [
          "Lifestyle change genuinely lowers blood pressure, for many people by enough to matter. But if your readings are high, lifestyle work is usually a partner to medication, not a replacement for it. Never stop a prescribed medicine on your own; blood pressure rebounds quietly.",
        ],
      },
      {
        heading: "1. Cut the salt you can't see",
        paragraphs: [
          "Most excess salt is not from your salt spoon: it hides in seasoning cubes, instant noodles, processed and tinned foods, and suya spice mixes. Halving these often does more than banning table salt. Aim to cook more from fresh ingredients and taste before you season.",
        ],
      },
      {
        heading: "2. Lose weight if you carry extra",
        paragraphs: [
          "Blood pressure tracks body weight closely. Even a 5% weight loss (4 kg for an 80 kg person) measurably lowers readings for most people. Slow and sustained beats dramatic and temporary.",
        ],
      },
      {
        heading: "3. Move most days",
        paragraphs: [
          "About 30 minutes of brisk walking most days lowers blood pressure on its own, independent of weight loss. It does not require a gym; it requires a route and a habit.",
        ],
      },
      {
        heading: "4 & 5. Alcohol and sleep",
        paragraphs: [
          "Regular heavy drinking raises blood pressure directly; cutting down brings it back. And short, broken sleep pushes pressure up over time; snoring badly enough to gasp or choke is worth mentioning to a doctor, as sleep apnoea quietly drives resistant hypertension.",
          "Measure at home while you make these changes. Seeing your own numbers fall is the strongest motivation there is.",
        ],
      },
    ],
  },
  {
    slug: "diabetes-early-signs",
    title: "Early signs of diabetes, and who should get tested",
    description:
      "The symptoms people miss, why many have no symptoms at all, and the risk factors that make testing worth it.",
    category: "Diabetes",
    readMinutes: 4,
    relatedHref: "/diabetes",
    relatedLabel: "Diabetes care at Tarragon",
    sections: [
      {
        heading: "The signs people notice late",
        paragraphs: [
          "Classic warning signs include being unusually thirsty, urinating more than normal (especially at night), losing weight without trying, blurred vision, wounds that heal slowly, and repeated skin or urine infections. Any of these deserves a blood-sugar test, not a wait-and-see.",
        ],
      },
      {
        heading: "The uncomfortable truth: many people feel nothing",
        paragraphs: [
          "Type 2 diabetes builds gradually, and the body adapts. Many people live with raised sugar for years before diagnosis, often until a complication shows up first. Feeling fine is not evidence your sugar is fine.",
        ],
      },
      {
        heading: "Who should test even without symptoms",
        paragraphs: [
          "Testing is worth it if any of these apply: a parent or sibling with diabetes; age above 40; excess weight, especially around the waist; high blood pressure; diabetes in a past pregnancy or a baby over 4 kg; or previous borderline readings. The more that apply, the stronger the case.",
          "The test itself is simple: a fasting glucose or an HbA1c at any decent laboratory. It is one of the cheapest pieces of information about your future you can buy.",
        ],
      },
      {
        heading: "If the result comes back high",
        paragraphs: [
          "A raised result is a starting line, not a sentence. Prediabetes reversed with food, movement and weight change is routine. Diagnosed diabetes managed early and consistently is compatible with a long, normal life. The complications come from years of unmanaged sugar, not from the diagnosis itself.",
        ],
      },
    ],
  },
  {
    slug: "diabetes-just-diagnosed",
    title: "So you've just been diagnosed with diabetes. Now what?",
    description:
      "The first week, the questions worth asking your doctor, and what actually changes versus what doesn't.",
    category: "Diabetes",
    readMinutes: 5,
    relatedHref: "/diabetes",
    relatedLabel: "Diabetes care at Tarragon",
    sections: [
      {
        heading: "Take a breath first",
        paragraphs: [
          "A new diabetes diagnosis can feel like a lot at once. It is not an emergency that demands you overhaul your entire life today. It is a starting line: you now have information that lets you and a doctor act, and that is better than not knowing.",
        ],
      },
      {
        heading: "What actually needs to happen this week",
        paragraphs: [
          "Your doctor will confirm the type (type 1, type 2, or gestational, if you are pregnant), because that changes the plan. Expect baseline tests beyond the sugar result itself: HbA1c, kidney function, cholesterol, and blood pressure, plus a referral for an eye check. If a medicine is prescribed, start it as instructed even before you have mastered the diet side; the two work together, not in sequence.",
        ],
      },
      {
        heading: "Questions worth taking to your first proper review",
        paragraphs: [
          "What is my HbA1c and what target are we aiming for? Do I need medication now, or are we starting with lifestyle change first? What symptoms mean I should call sooner rather than wait for the next appointment? When is my next check, and what will it look at?",
        ],
      },
      {
        heading: "What changes, and what genuinely doesn't",
        paragraphs: [
          "You can still eat foods you love, in sensible portions; still travel; still work as before. What changes is a new habit of checking in on your body on a schedule rather than only when something feels wrong. Most people with type 2 diabetes who follow their plan consistently live long, ordinary lives; the complications people fear come from years of unmanaged sugar, not from the diagnosis itself.",
        ],
      },
    ],
  },
  {
    slug: "diabetes-diet-nigerian-kitchen",
    title: "Diabetes and your plate: what to eat in a Nigerian kitchen",
    description:
      "There is no forbidden food list, only portion, pairing, and a few swaps that make the biggest difference.",
    category: "Diabetes",
    readMinutes: 5,
    relatedHref: "/diabetes",
    relatedLabel: "Diabetes care at Tarragon",
    sections: [
      {
        heading: "No food is banned outright",
        paragraphs: [
          "Eba, pounded yam, rice, and other everyday staples don't have to disappear from your table. What matters most is portion size and what you eat them alongside; a smaller starchy portion next to more protein and vegetables behaves very differently in your body than a large one eaten alone.",
        ],
      },
      {
        heading: "Carbohydrates that behave better",
        paragraphs: [
          "Less-processed, higher-fibre carbohydrates raise sugar more slowly: unripe plantain rather than very ripe, brown rice or a smaller white-rice portion, and beans or other legumes as a base rather than a side. Fibre-rich vegetables (ugu, waterleaf, okra) let you build a fuller plate without much sugar impact.",
        ],
      },
      {
        heading: "The order you eat in matters too",
        paragraphs: [
          "Eating vegetables and protein before the starchy part of a meal genuinely blunts the sugar rise that follows. In practice: a slightly smaller soup/stew starch component, more fish, chicken, or beans, and vegetables eaten first rather than last.",
        ],
      },
      {
        heading: "What's actually worth cutting back",
        paragraphs: [
          "Sugary zobo, soft drinks, and table sugar in tea add sugar with no fibre to slow it down; deep-fried foods and packaged snacks add the kind of fat that works against your numbers over time. Small, consistent swaps you can keep up beat one dramatic overhaul that lasts a fortnight.",
        ],
      },
    ],
  },
  {
    slug: "diabetes-non-medical-treatments-do-they-work",
    title: "Non-medical diabetes treatments: do they really work?",
    description:
      "What the evidence actually shows about herbal remedies, and why the real danger is stopping what works.",
    category: "Diabetes",
    readMinutes: 4,
    relatedHref: "/diabetes",
    relatedLabel: "Diabetes care at Tarragon",
    sections: [
      {
        heading: "Why this question matters here",
        paragraphs: [
          "Herbal remedies (bitter leaf, moringa, aloe vera, cinnamon, and others) are widely marketed in Nigeria as diabetes cures. Some people stop their prescribed medicine to try them instead. That decision, not the herb itself, is usually where the real harm happens.",
        ],
      },
      {
        heading: "What the evidence actually shows",
        paragraphs: [
          "A few of these (cinnamon and bitter melon among them) show a small effect on blood sugar in some studies. Small is the operative word: nowhere close to replacing medication for someone already diagnosed, and outside a laboratory there is no way to know the dose or purity of what you're actually taking.",
        ],
      },
      {
        heading: "The real risk isn't trying them, it's stopping what works",
        paragraphs: [
          "Never replace a prescribed diabetes medicine with a herbal product without your doctor knowing. Tell your care team about anything you're taking alongside your prescription; some herbal products interact with medication in ways that are hard to predict on your own.",
        ],
      },
      {
        heading: "What genuinely does earn its place",
        paragraphs: [
          "Food choices, movement, weight, and sleep are not the exciting answer, but they are the proven one: real, repeated evidence shows they measurably lower blood sugar over time. The honest message is that there is no shortcut supplement, but the boring, unglamorous changes genuinely work.",
        ],
      },
    ],
  },
  {
    slug: "diabetes-and-mental-health",
    title: "Diabetes and mental health: why the emotional side matters too",
    description:
      "Diabetes distress, the two-way link with depression, and why asking for support is good diabetes care.",
    category: "Diabetes",
    readMinutes: 4,
    relatedHref: "/diabetes",
    relatedLabel: "Diabetes care at Tarragon",
    sections: [
      {
        heading: "Diabetes distress is real, and common",
        paragraphs: [
          "Living with a condition that asks for daily attention, checking sugar, timing meals, taking medicine on schedule, is genuinely tiring. Frustration, guilt after a 'bad' reading, and burnout from the routine are common enough to have a name: diabetes distress. It overlaps with depression but isn't quite the same thing.",
        ],
      },
      {
        heading: "The two-way link with depression",
        paragraphs: [
          "People living with diabetes have a higher risk of depression, and depression makes diabetes harder to manage, motivation for daily self-care tends to drop when mood is low. Each can quietly worsen the other, so treating the sugar numbers without noticing the mood behind them can stall progress that looks otherwise unexplained.",
        ],
      },
      {
        heading: "Signs worth mentioning to your care team",
        paragraphs: [
          "Persistent low mood, losing interest in things you used to enjoy, feeling like checking your sugar or taking medicine is pointless, or sleep and appetite changes lasting more than two weeks are all worth raising, even if they feel unrelated to diabetes itself.",
        ],
      },
      {
        heading: "This is not a personal failing",
        paragraphs: [
          "A high HbA1c is not a report card on your character. Good diabetes care treats the numbers and the person behind them together, and asking for support with the emotional weight of a chronic condition is itself part of managing it well, not a separate, lesser concern.",
        ],
      },
    ],
  },
  {
    slug: "diabetes-day-to-day-management",
    title: "Managing your diabetes day to day: monitoring, medicine and routine",
    description:
      "Why consistency beats perfection, what daily readings and HbA1c each tell you, and the follow-up habit that matters most.",
    category: "Diabetes",
    readMinutes: 5,
    relatedHref: "/diabetes",
    relatedLabel: "Diabetes care at Tarragon",
    sections: [
      {
        heading: "Build a routine, not a perfect day",
        paragraphs: [
          "The goal isn't a flawless day; it's a repeatable one. Roughly consistent meal times and a fixed time for medicine turn diabetes care into a habit rather than a decision you have to make from scratch every day, which is where consistency quietly comes from.",
        ],
      },
      {
        heading: "Monitoring: what each check actually tells you",
        paragraphs: [
          "A home glucose check, if your doctor has prescribed one, shows today's number: useful, but a single snapshot. HbA1c, done every three to six months, shows the bigger three-month trend. They answer different questions; neither replaces the other.",
        ],
      },
      {
        heading: "Medicine: consistency beats perfection",
        paragraphs: [
          "Take medicine on schedule even on a day you've eaten well and feel fine. Missed doses are one of the most common, and most preventable, reasons control slips. A phone reminder tied to an existing daily habit works better than relying on memory alone.",
        ],
      },
      {
        heading: "The follow-up habit that changes outcomes",
        paragraphs: [
          "People who do best treat diabetes as an ongoing conversation with their care team rather than a one-time lecture at diagnosis. Regular reviews catch drift before it becomes a complication, and the plan gets adjusted as life changes, a new job, a pregnancy, a change in weight, instead of staying frozen from day one.",
        ],
      },
    ],
  },
  {
    slug: "weight-bmi-waist",
    title: "Is my weight a health problem? BMI, waist size, and what actually helps",
    description:
      "How to read BMI honestly, why waist circumference matters, and what sustainable weight care looks like.",
    category: "Weight",
    readMinutes: 5,
    relatedHref: "/obesity",
    relatedLabel: "The Tarragon weight programme",
    sections: [
      {
        heading: "BMI: useful, imperfect",
        paragraphs: [
          "BMI is your weight in kilograms divided by your height in metres squared. As a broad guide for adults: 18.5–24.9 is the healthy range, 25–29.9 is overweight, and 30 or above is classed as obesity. It is a screening tool, not a verdict: a muscular person can score 'overweight' while carrying little fat.",
        ],
      },
      {
        heading: "Why your waist tells you more",
        paragraphs: [
          "Fat stored around the organs (the belly, not the hips) is what drives diabetes, hypertension and heart disease risk. A waist above roughly 94 cm for men or 80 cm for women signals raised risk even when BMI looks moderate. A tape measure is a better early-warning tool than a mirror.",
        ],
      },
      {
        heading: "What does not work",
        paragraphs: [
          "Crash diets, teas, waist trainers and 'flat tummy' products do not produce lasting fat loss; most produce a rebound. Weight that comes off in weeks tends to come back with interest, because nothing about daily life actually changed.",
        ],
      },
      {
        heading: "What does",
        paragraphs: [
          "The boring, proven combination: modest calorie reduction you can sustain, protein and fibre that keep you full, 30 minutes of movement most days, sleep, and tracking, the step most people skip, so the trend is visible. A 5–10% loss held for a year improves blood pressure, sugar and cholesterol measurably.",
          "If your BMI is 30+ or your weight comes with raised sugar or pressure, this is a medical matter that deserves a doctor's structured support, not a willpower verdict. That is exactly what a managed programme is for.",
        ],
      },
    ],
  },
  {
    slug: "weight-loss-medication-questions-for-your-doctor",
    title: "Weight-loss medication: what to ask your doctor before you start",
    description:
      "What these medicines actually do, who they're usually considered for, and the questions worth taking to that conversation.",
    category: "Weight",
    readMinutes: 5,
    relatedHref: "/obesity",
    relatedLabel: "The Tarragon weight programme",
    sections: [
      {
        heading: "What these medicines actually do",
        paragraphs: [
          "The weight-loss medications getting attention right now work mainly by slowing digestion and quieting appetite signals in the brain, so people eat less without fighting constant hunger. They are prescription medicines, taken under medical supervision, not a supplement you start on your own.",
          "They work best alongside the same lifestyle changes that already help everyone, not instead of them. Food, movement and sleep still matter once you're on one; the medicine makes those changes easier to sustain, not unnecessary.",
        ],
      },
      {
        heading: "Who they're usually considered for",
        paragraphs: [
          "They are typically considered for people with a BMI in the obesity range, or an overweight BMI alongside a related condition like raised blood pressure or blood sugar, after a proper assessment of history and risk. They are not usually a first answer for someone who wants to lose a few kilograms for an event.",
        ],
      },
      {
        heading: "Questions worth taking to that conversation",
        paragraphs: [
          "Am I actually a candidate, based on my BMI and health history, not just what I'd like? What side effects are common, and which ones mean I should call back sooner rather than wait? What happens to my weight if I stop the medicine later? How will this be monitored over time, and what does it cost to continue, not just to start?",
        ],
      },
      {
        heading: "Where Tarragon fits today",
        paragraphs: [
          "Tarragon's weight programme is lifestyle-managed: weight and waist tracking, a personalised plan, monitoring of related conditions like blood pressure and sugar, and regular doctor review. We don't currently prescribe weight-loss medication ourselves, and we'd rather say that plainly than overpromise. Where a doctor review suggests a medical conversation about medication is worth having, that's flagged so you can pursue it, informed rather than guessing.",
        ],
      },
    ],
  },
  {
    slug: "finding-healthy-food-on-any-budget",
    title: "Finding healthy food in any Nigerian market, on any budget",
    description:
      "You don't need imported diet products. Local markets already have what a healthier plate needs, if you know what to look for.",
    category: "Weight",
    readMinutes: 4,
    relatedHref: "/obesity",
    relatedLabel: "The Tarragon weight programme",
    sections: [
      {
        heading: "Healthy doesn't mean imported",
        paragraphs: [
          "Vegetables like ugu, waterleaf and garden egg, beans, fresh fish, and unripe plantain are already close to what any healthy-eating guide recommends. None of it comes in a branded 'diet' package, and none of it needs to.",
        ],
      },
      {
        heading: "Shop the fresh sections, not the packaged aisle",
        paragraphs: [
          "Produce, fish and meat sections tend to be both fresher and, per meal, cheaper than heavily processed or packaged alternatives once you account for how far a home-cooked pot of soup stretches. Buying what's in season usually costs less and tastes better too.",
        ],
      },
      {
        heading: "Protein and fibre stretch further than you'd think",
        paragraphs: [
          "Beans, eggs and fish are usually cheaper sources of protein than red meat, and fibre-rich vegetables bulk out a plate cheaply while keeping you fuller for longer. A bigger vegetable-and-protein base with a smaller starch portion often costs about the same as the reverse.",
        ],
      },
      {
        heading: "Small swaps that don't cost extra",
        paragraphs: [
          "Water or unsweetened zobo instead of a sugary soft drink, a slightly smaller rice or eba portion with beans added in, grilled instead of deep-fried where the price is similar. None of these require a bigger food budget, just a different way of filling the same plate.",
        ],
      },
    ],
  },
  {
    slug: "managing-triggers-that-lead-to-overeating",
    title: "Managing the triggers that lead to overeating",
    description:
      "Stress, boredom, and habit drive most overeating, not hunger. Recognising the trigger is the first real step.",
    category: "Weight",
    readMinutes: 4,
    relatedHref: "/obesity",
    relatedLabel: "The Tarragon weight programme",
    sections: [
      {
        heading: "Most overeating isn't really about hunger",
        paragraphs: [
          "Eating in front of a screen, finishing a plate out of habit rather than appetite, or reaching for food when stressed or bored, all feel like hunger in the moment but usually aren't. Learning to tell the difference between physical hunger and an emotional or habitual trigger is the useful skill, not willpower.",
        ],
      },
      {
        heading: "Common triggers worth noticing",
        paragraphs: [
          "Stress and anxiety, boredom or understimulation, poor sleep (which genuinely raises appetite hormones the next day), social pressure to finish what's served, and simply eating on autopilot while distracted are the ones that come up most often. None of them mean anything is wrong with you; they're just worth noticing.",
        ],
      },
      {
        heading: "What actually helps, in the moment",
        paragraphs: [
          "A short pause before eating, just asking 'am I actually hungry, or is something else going on?', catches a surprising amount. Keeping an easy, ready alternative on hand helps too. Where the trigger is stress, addressing that directly, even a short walk, works better than food ever will at actually resolving it.",
        ],
      },
      {
        heading: "When to loop in your care team",
        paragraphs: [
          "If eating feels genuinely out of your control, or seems tied to low mood that's lasted more than a couple of weeks, that's worth raising with a doctor rather than treating as a personal failing. Addressing it is part of good weight care, not a separate, lesser concern.",
        ],
      },
    ],
  },
  {
    slug: "annual-health-check-guide",
    title: "The annual health check: what it should actually include",
    description:
      "Which tests earn their place in a yearly screen, by age and risk, and why the follow-up matters more than the tests.",
    category: "Screening",
    readMinutes: 5,
    relatedHref: "/prevention",
    relatedLabel: "Preventive care at Tarragon",
    sections: [
      {
        heading: "Why screen at all when you feel fine",
        paragraphs: [
          "The conditions that shorten most adult lives (hypertension, diabetes, kidney disease, some cancers) are silent for years and cheap to manage when caught early. A yearly check exists to catch them in the silent phase, when your options are widest.",
        ],
      },
      {
        heading: "The core, for most adults",
        paragraphs: [
          "Blood pressure. Blood sugar (fasting glucose or HbA1c). A lipid panel (cholesterol). Weight and waist. Urinalysis (an early kidney and diabetes window). These five cover the biggest, most treatable risks and cost little.",
        ],
      },
      {
        heading: "Added by age and history",
        paragraphs: [
          "From the 40s onward: an ECG and a fuller cardiovascular risk review. For women: cervical screening from the mid-20s and breast checks from 40. For men from 45: a prostate conversation with a doctor, informed, not automatic. Family history of any of these moves the start dates earlier.",
        ],
      },
      {
        heading: "The part most checkups get wrong",
        paragraphs: [
          "A stack of results with no follow-up is theatre. The value is in what happens next: someone explains each result, an abnormal finding triggers an actual plan, and next year's numbers get compared to this year's. When you book any screening, the question to ask is not 'which tests?' but 'who follows up?'",
        ],
      },
    ],
  },
  {
    slug: "cholesterol-explained",
    title: "Cholesterol results, decoded: LDL, HDL and the number nobody mentions",
    description:
      "What a lipid panel measures, which number matters most, and when cholesterol needs treating.",
    category: "Cholesterol",
    readMinutes: 4,
    relatedHref: "/chronic-care",
    relatedLabel: "Chronic care at Tarragon",
    sections: [
      {
        heading: "The four numbers on the report",
        paragraphs: [
          "Total cholesterol is everything added together. LDL is the 'delivery' cholesterol that, in excess, builds up in artery walls, and it is the one that treatment usually targets. HDL is the 'cleanup' fraction, where higher is generally better. Triglycerides are circulating fat, sensitive to sugar, alcohol and weight.",
        ],
      },
      {
        heading: "The number nobody mentions: non-HDL",
        paragraphs: [
          "Subtract HDL from total cholesterol and you get non-HDL cholesterol: everything capable of clogging arteries in one figure. Many clinicians now consider it a better single measure than LDL alone, and it needs no extra test: it is arithmetic on results you already have.",
        ],
      },
      {
        heading: "There is no single 'bad' threshold",
        paragraphs: [
          "Whether a cholesterol level needs treatment depends on your whole cardiovascular risk (age, blood pressure, smoking, diabetes, family history), not the number in isolation. The same LDL can be acceptable in one person and urgent in another who has already had a heart problem.",
          "That is why good care assesses total risk and sets a personal target, rather than reacting to a lab report line by line.",
        ],
      },
      {
        heading: "If yours is raised",
        paragraphs: [
          "Diet shifts (less fried and processed food, more fibre), weight loss and movement all help, and for people at meaningful risk, statins are among the best-evidenced, most cost-effective medicines in existence. The right answer is a risk conversation with a doctor, ideally one who will still be watching the trend next year.",
        ],
      },
    ],
  },
  {
    slug: "statins-myths-explained",
    title: "Statins: what they actually do, and the myths that stop people taking them",
    description:
      "Why statins are one of medicine's most proven drugs, and an honest look at the side-effect fears that keep people from starting or staying on them.",
    category: "Cholesterol",
    readMinutes: 4,
    relatedHref: "/chronic-care",
    relatedLabel: "Chronic care at Tarragon",
    sections: [
      {
        heading: "What a statin actually does",
        paragraphs: [
          "A statin lowers LDL cholesterol by slowing how much your liver makes, rather than by removing what's already stuck in your arteries. Taken consistently, it measurably lowers the risk of heart attack and stroke in people whose overall cardiovascular risk is high enough to warrant it, one of the largest, most repeated findings in modern medicine.",
        ],
      },
      {
        heading: "\"But I heard it damages your liver\"",
        paragraphs: [
          "Serious liver injury from statins is rare; most people never need to stop for it, which is why a doctor checks liver function before starting and periodically after, not because harm is expected, but because checking is cheap and reassuring. Weigh that small, monitored risk against an unmonitored heart attack.",
        ],
      },
      {
        heading: "Muscle aches: real, but often over-blamed",
        paragraphs: [
          "Muscle aches are the complaint people raise most, and they are real for some people. But controlled studies that compare a statin against a fake pill find most reported muscle pain happens on the fake pill too, meaning expectation plays a large role. If aches do appear, a doctor can usually solve it by switching statins or adjusting dose rather than stopping treatment altogether.",
        ],
      },
      {
        heading: "The actual risk of not taking it",
        paragraphs: [
          "For someone whose doctor has assessed real cardiovascular risk and recommended a statin, stopping it quietly, without a conversation, removes one of the best-proven protections against a heart attack or stroke you can have. If side effects are genuinely bothering you, that is a reason to call your doctor, not to simply stop; there is almost always another option.",
        ],
      },
    ],
  },
  {
    slug: "home-blood-pressure-monitoring",
    title: "How to measure your blood pressure at home, properly",
    description:
      "The five mistakes that quietly inflate a home reading, and how to build a measurement habit your doctor can actually trust.",
    category: "Blood pressure",
    readMinutes: 4,
    relatedHref: "/hypertension",
    relatedLabel: "Hypertension care at Tarragon",
    sections: [
      {
        heading: "Why a home reading is often more useful than a clinic one",
        paragraphs: [
          "Many people's blood pressure runs higher in a clinic simply from the nerves of being there, a well-known effect called white-coat hypertension. A series of calm, correctly-taken home readings over days or weeks usually paints a truer picture than a single clinic visit, which is why doctors increasingly ask patients to bring in their own log.",
        ],
      },
      {
        heading: "Five mistakes that quietly inflate a reading",
        paragraphs: [
          "Talking or scrolling your phone during the measurement, a full bladder, an unsupported arm (let it rest at heart height on a table, not held up in the air), a cuff over clothing rather than bare skin, and taking it right after coffee, a cigarette, or a rushed walk in the door can each add several points to the number, enough to change what a reading means.",
        ],
      },
      {
        heading: "A simple routine that removes the guesswork",
        paragraphs: [
          "Sit quietly for five minutes first. Feet flat on the floor, back supported, arm resting at heart height. Take two readings, one minute apart, and record both rather than only the lower one. Do this at roughly the same time each day, morning and evening if your doctor has asked for that, for at least a week before any decision is made from the pattern.",
        ],
      },
      {
        heading: "What to do with the numbers",
        paragraphs: [
          "A log of real readings, dated, is far more useful to a doctor than a verbal 'it's usually fine.' If your home average sits at 135/85 or higher, or any single reading is well above 180/120, that is worth a call rather than waiting for your next scheduled appointment.",
        ],
      },
    ],
  },
  {
    slug: "blood-pressure-medication-myths",
    title: "Why you shouldn't stop your blood pressure medicine when you feel fine",
    description:
      "The quiet reason so many people stop treatment early, and why hypertension has no symptom that tells you it's back.",
    category: "Blood pressure",
    readMinutes: 4,
    relatedHref: "/hypertension",
    relatedLabel: "Hypertension care at Tarragon",
    sections: [
      {
        heading: "The trap: feeling fine means nothing",
        paragraphs: [
          "Hypertension is sometimes called a silent condition for a reason: it produces essentially no symptoms until it has already caused damage. A person whose pressure has been brought under control by medication feels exactly the same as a person whose pressure is quietly climbing again. Feeling fine is not feedback; only a reading is.",
        ],
      },
      {
        heading: "Why people stop anyway",
        paragraphs: [
          "The most common reasons are almost never medical: running out and delaying a refill, a busy week that breaks the routine, hearing a rumour that the medicine 'damages the kidneys' or is only meant to be short-term, or simply feeling well enough to assume it's no longer needed. None of these are safe reasons to stop without telling a doctor first.",
        ],
      },
      {
        heading: "What actually happens when you stop",
        paragraphs: [
          "For most blood pressure medicines, pressure rises back toward its untreated level within days to a couple of weeks, quietly, with no warning sign. The risk of stroke and heart attack rises with it. If a medicine genuinely isn't suiting you, side effects, cost, or difficulty remembering doses, that is a real reason to change the plan, but the answer is a different medicine or a different routine, not silence.",
        ],
      },
      {
        heading: "If cost or access is the real reason",
        paragraphs: [
          "Tell your doctor. There is almost always a cheaper, equally effective alternative on the market, and a doctor who knows the real reason can actually solve it, switch drugs, simplify the dosing schedule, connect you with a pharmacy that delivers, rather than a plan quietly falling apart in silence.",
        ],
      },
    ],
  },
  {
    slug: "why-crash-diets-dont-work",
    title: "Why crash diets don't work, and what actually keeps weight off",
    description:
      "The biology behind the rebound, and the unglamorous approach that actually holds weight loss for good.",
    category: "Weight",
    readMinutes: 5,
    relatedHref: "/obesity",
    relatedLabel: "The Tarragon weight programme",
    sections: [
      {
        heading: "The rebound is not a willpower failure",
        paragraphs: [
          "When weight drops very fast, your body reads it as a threat, not a goal. Hunger hormones rise, metabolism slows slightly to conserve energy, and the drive to eat becomes genuinely stronger, not weaker. Most people who lose weight quickly on a crash diet regain it within a year, and this is a predictable biological response, not a personal failing.",
        ],
      },
      {
        heading: "What 'crash' actually means",
        paragraphs: [
          "Very low-calorie plans, skipping meals for days, tea and juice 'cleanses,' and waist trainers all share the same flaw: they are not something a person can live on for more than a few weeks, so whatever weight comes off returns the moment normal eating resumes, often with a little extra alongside it.",
        ],
      },
      {
        heading: "What holds weight off instead",
        paragraphs: [
          "Slower, smaller, sustained changes: a modest and genuinely livable calorie reduction, more protein and fibre so meals stay filling, regular movement, and enough sleep, since poor sleep measurably increases hunger and cravings the next day. A rate of half a kilogram to a kilogram a week is realistic and far more likely to still be true a year from now.",
        ],
      },
      {
        heading: "Track the trend, not the day",
        paragraphs: [
          "Weight moves several kilograms up and down within a single week from water, salt, and hormones alone, so a bad number on a Tuesday means very little. Weighing at a consistent time and watching the weeks-long trend, not any single reading, is what keeps people from abandoning a plan that is actually working.",
        ],
      },
    ],
  },
  {
    slug: "exercise-for-weight-loss-how-much",
    title: "Exercise for weight loss: how much do you actually need?",
    description:
      "Why exercise alone rarely moves the scale much, and what it's actually the best tool in existence for.",
    category: "Weight",
    readMinutes: 4,
    relatedHref: "/obesity",
    relatedLabel: "The Tarragon weight programme",
    sections: [
      {
        heading: "The uncomfortable truth about exercise and the scale",
        paragraphs: [
          "A 30-minute brisk walk burns roughly what a small bottle of soft drink contains in calories. Exercise alone, without any change to eating, moves the scale far less than most people expect, and appetite often quietly rises to compensate. This is not a reason to skip it; it's a reason to be honest about what it's for.",
        ],
      },
      {
        heading: "What exercise is genuinely the best tool for",
        paragraphs: [
          "Keeping weight off once it's lost, protecting muscle while you lose fat (so the weight that comes off is fat, not muscle), and lowering blood pressure, blood sugar and cardiovascular risk largely independent of what happens to your weight at all. People who exercise regularly keep weight off far better than people who rely on diet changes alone.",
        ],
      },
      {
        heading: "How much is actually enough",
        paragraphs: [
          "Roughly 150 minutes a week of brisk walking or similar activity, about 20-25 minutes most days, is the widely-used benchmark for general health. For weight maintenance specifically, some evidence points toward needing closer to 250-300 minutes a week. Either way, consistency across months matters far more than intensity on any single day.",
        ],
      },
      {
        heading: "It doesn't need a gym",
        paragraphs: [
          "Brisk walking, stairs instead of a lift, dancing, carrying shopping, an okada-free commute twice a week, all count. The best form of exercise is the one you'll actually keep doing in six months; a modest routine you sustain beats an ambitious one you abandon after a fortnight.",
        ],
      },
    ],
  },
  {
    slug: "cancer-screening-by-age",
    title: "Cancer screening by age: what to book, and when",
    description:
      "The screenings worth booking at each life stage, matched to age and sex, and why early detection changes everything about treatment.",
    category: "Screening",
    readMinutes: 5,
    relatedHref: "/prevention",
    relatedLabel: "Preventive care at Tarragon",
    sections: [
      {
        heading: "Why the timing matters, not just the test",
        paragraphs: [
          "Cancer screening exists to catch disease before it causes symptoms, when treatment is simplest and most effective. Screening too early wastes money on a low-risk population; screening too late misses the window it exists for. Age and sex-based guidelines aim for the point where the balance tips in your favour.",
        ],
      },
      {
        heading: "For women",
        paragraphs: [
          "Cervical screening from the mid-20s, repeated every few years, catches changes caused by HPV years before they could become cancer, one of the most preventable cancers in existence when screening is kept up. Breast screening becomes relevant from 40, or earlier with a family history; know your own normal well enough to notice a change between screens too.",
        ],
      },
      {
        heading: "For men",
        paragraphs: [
          "Prostate screening (a PSA blood test) becomes a conversation from 45, informed rather than automatic, because the test itself has trade-offs a doctor should walk you through, not a default add-on to every checkup. Family history moves that conversation earlier.",
        ],
      },
      {
        heading: "For everyone from 45",
        paragraphs: [
          "Colorectal screening is worth discussing from 45, or earlier with a family history or persistent symptoms like unexplained bleeding or a change in bowel habit that lasts more than a couple of weeks. None of these tests are pleasant to think about, which is exactly why they're worth booking on a schedule rather than waiting for a reason to feel ready.",
        ],
      },
    ],
  },
  {
    slug: "hiv-hepatitis-screening-why-test",
    title: "HIV and hepatitis screening: why testing beats guessing",
    description:
      "How common undiagnosed infection actually is, why symptoms are a poor guide, and what a positive result actually means today.",
    category: "Screening",
    readMinutes: 4,
    relatedHref: "/prevention",
    relatedLabel: "Preventive care at Tarragon",
    sections: [
      {
        heading: "Why these three deserve their own conversation",
        paragraphs: [
          "HIV, Hepatitis B and Hepatitis C can each be carried for years with no symptoms at all, quietly, while doing real damage in the background. Nigeria carries a significant share of both HIV and chronic Hepatitis B in the region, and a large share of people living with either don't yet know it. Testing, not guessing from how you feel, is the only way to actually know.",
        ],
      },
      {
        heading: "Who should test, honestly",
        paragraphs: [
          "Everyone benefits from knowing their status at least once; it is not a test reserved for people who feel at risk. Pregnancy, a new relationship, a family member's diagnosis, or simply never having been tested are all reasonable, unremarkable reasons to book it. A test result stays private between you and your care team.",
        ],
      },
      {
        heading: "What a positive result actually means today",
        paragraphs: [
          "HIV managed with modern treatment allows a long, normal life, and consistent treatment brings the virus low enough that it cannot be transmitted to a partner. Hepatitis B is managed with monitoring and, when needed, medication that controls it for decades. Neither diagnosis today looks like it did a generation ago; the earlier it's found, the simpler that management is.",
        ],
      },
      {
        heading: "The test itself",
        paragraphs: [
          "A simple blood test at any decent lab, results usually back within days, sometimes the same day for HIV. There is nothing to prepare, and no reason to wait for a symptom that, for these three conditions, may never clearly arrive on its own.",
        ],
      },
    ],
  },
  {
    slug: "adult-vaccines-you-might-be-missing",
    title: "Vaccines aren't just for children: what adults need too",
    description:
      "The boosters and catch-up doses adults quietly miss, and why 'I had that as a child' isn't always the end of the story.",
    category: "Screening",
    readMinutes: 4,
    relatedHref: "/prevention",
    relatedLabel: "Preventive care at Tarragon",
    sections: [
      {
        heading: "Immunity doesn't always last forever",
        paragraphs: [
          "Some childhood vaccines wane over decades and need a booster in adulthood to stay effective; tetanus is the clearest example, needing a top-up roughly every ten years, a detail most adults have never been told. A vaccination record kept from childhood through adulthood, not two separate untracked histories, is what actually lets a doctor spot a gap.",
        ],
      },
      {
        heading: "HPV catch-up, for women who missed it",
        paragraphs: [
          "HPV vaccination is free at government primary health centres for girls aged 9 to 14 in Nigeria, but women who missed that window aren't out of options: catch-up doses are bookable up to age 45 and still meaningfully lower the risk of the cancers HPV causes, including cervical cancer.",
        ],
      },
      {
        heading: "Hepatitis B, if your series was never completed",
        paragraphs: [
          "The Hepatitis B vaccine is a series of doses, not a single shot, and an incomplete series (a common gap when doses were given at different clinics with no shared record) doesn't give full protection. If you're not certain your series was completed, that's worth confirming rather than assuming.",
        ],
      },
      {
        heading: "Before travel, or before a pregnancy",
        paragraphs: [
          "Travel to certain regions can require yellow fever proof or recommend typhoid coverage; planning a pregnancy is a good moment to confirm rubella immunity in particular, since infection during pregnancy carries real risk to the baby. Both are worth a conversation well before the trip or the pregnancy, not the week before.",
        ],
      },
    ],
  },
  {
    slug: "blood-group-genotype-explained",
    title: "Blood group and genotype: what they are, and why every Nigerian should know theirs",
    description:
      "The difference between the two tests, why genotype matters especially before marriage or pregnancy, and how to actually get tested.",
    category: "Screening",
    readMinutes: 4,
    relatedHref: "/prevention",
    relatedLabel: "Preventive care at Tarragon",
    sections: [
      {
        heading: "Two different tests, often confused",
        paragraphs: [
          "Blood group (A, B, AB or O, plus rhesus positive or negative) determines whose blood you can safely receive in a transfusion or emergency. Genotype (AA, AS, SS and rarer combinations) reveals whether you carry the gene for sickle cell disease. They answer completely different questions, and knowing one tells you nothing about the other.",
        ],
      },
      {
        heading: "Why genotype matters so much here",
        paragraphs: [
          "Nigeria carries one of the highest rates of the sickle cell gene in the world; a large share of the population carries AS (the trait, generally healthy) without knowing it. Two AS carriers having a child together have a 1-in-4 chance, each pregnancy, of a child with SS, sickle cell disease. Knowing your genotype before marriage or pregnancy turns that into an informed choice rather than a discovery after the fact.",
        ],
      },
      {
        heading: "Carrying the trait isn't the same as having the disease",
        paragraphs: [
          "AS (sickle cell trait) is not sickle cell disease; most people who carry it live entirely normal lives with no symptoms. It only becomes a serious consideration for the children of two AS (or one AS, one SS) parents. Discovering you're AS is information for family planning, not a diagnosis to be alarmed by.",
        ],
      },
      {
        heading: "How to actually get tested",
        paragraphs: [
          "Both are simple blood tests at any decent laboratory, results typically back within a day, no special preparation needed. If you've never checked either, or you're planning a marriage or pregnancy and don't have a written result you trust, it is one of the cheapest, most consequential pieces of information you can gather about your family's future.",
        ],
      },
    ],
  },
  {
    slug: "prediabetes-the-reversible-warning-stage",
    title: "Prediabetes: the warning stage you can still reverse",
    description:
      "What prediabetes means, why it's not a diagnosis of diabetes, and why this is the moment where change works best.",
    category: "Diabetes",
    readMinutes: 4,
    relatedHref: "/diabetes",
    relatedLabel: "Diabetes care at Tarragon",
    sections: [
      {
        heading: "What prediabetes actually means",
        paragraphs: [
          "Prediabetes means your blood sugar is higher than normal (an HbA1c of 5.7 to 6.4%, or a fasting glucose in a similar borderline range) but not yet high enough to call diabetes. It is your body's early warning, showing up years before diabetes itself typically would.",
        ],
      },
      {
        heading: "Why this stage matters more than most",
        paragraphs: [
          "Left unaddressed, prediabetes commonly progresses to type 2 diabetes over several years. But it is also the stage where change works best: most people who lose a modest amount of weight and move more bring their numbers back into the normal range, something that becomes management rather than reversal once full diabetes is diagnosed.",
        ],
      },
      {
        heading: "What actually reverses it",
        paragraphs: [
          "Losing 5 to 7% of body weight, regular movement, cutting sugary drinks, and eating more fibre are the changes with real evidence behind them. Most people at this stage do not need medication to turn things around, though that is a conversation for your doctor based on your specific numbers.",
        ],
      },
      {
        heading: "Who should get tested",
        paragraphs: [
          "The same risk factors as diabetes apply: family history, extra weight around the waist, age 40 and above, high blood pressure, or a previous borderline reading. A single fasting glucose or HbA1c test tells you where you stand, and a yearly recheck afterward tracks which direction you're moving.",
        ],
      },
    ],
  },
  {
    slug: "diabetes-medications-explained",
    title: "Diabetes medications explained: how the tablets actually work",
    description:
      "The main classes of diabetes tablets, in plain language, and what to actually ask your doctor or pharmacist about yours.",
    category: "Diabetes",
    readMinutes: 5,
    relatedHref: "/diabetes",
    relatedLabel: "Diabetes care at Tarragon",
    sections: [
      {
        heading: "Why there isn't just one diabetes tablet",
        paragraphs: [
          "Different tablets work on different parts of the problem: some help the body respond to its own insulin better, some help the pancreas release more insulin, and some help the kidneys clear excess sugar directly. Your doctor picks based on your numbers, kidney function, other conditions and cost, not a single default answer.",
        ],
      },
      {
        heading: "The tablet most people start on",
        paragraphs: [
          "Metformin is usually prescribed first. It reduces how much sugar the liver releases and helps the body use its own insulin more effectively. Taking it with food reduces stomach upset, and on its own it doesn't cause blood sugar to drop too low.",
        ],
      },
      {
        heading: "If one tablet isn't enough",
        paragraphs: [
          "Other classes commonly get added over time, not necessarily because things are getting worse, but because diabetes control often needs more than one approach, the same way high blood pressure frequently needs more than one medicine. Some newer classes also protect the heart and kidneys as a side benefit, which is why a doctor might recommend one even if your sugar reading alone looks fine.",
        ],
      },
      {
        heading: "What's actually worth asking",
        paragraphs: [
          "What is this tablet doing, and how will we know it's working? What side effects mean I should call rather than wait? Does this interact with anything else I'm taking, including herbal remedies? Bring every medicine you take to that conversation, so nothing hides in the blind spot.",
        ],
      },
    ],
  },
  {
    slug: "starting-insulin-what-to-expect",
    title: "Starting insulin: what it means, and how injections actually work",
    description:
      "Why needing insulin isn't a sign you've failed, and the basics of how the injection itself works.",
    category: "Diabetes",
    readMinutes: 4,
    relatedHref: "/diabetes",
    relatedLabel: "Diabetes care at Tarragon",
    sections: [
      {
        heading: "Needing insulin is not a failure",
        paragraphs: [
          "Type 1 diabetes needs insulin from day one, no tablet involved, because the pancreas makes little or none. Type 2 diabetes sometimes needs insulin added later, not because someone did something wrong, but because the pancreas naturally makes less insulin over time for some people. It's a tool matched to what your body needs now, not a verdict on effort.",
        ],
      },
      {
        heading: "What the injection actually involves",
        paragraphs: [
          "A very fine, short needle goes just under the skin, commonly the abdomen, thigh or upper arm, not into a vein or muscle. Most people describe it as a quick pinch, less uncomfortable than a blood-sugar finger prick. Modern insulin pens make the dose simple to set and see.",
        ],
      },
      {
        heading: "The basics that make it safe",
        paragraphs: [
          "Rotate the injection site within the same general area to avoid lumps forming under the skin. Never share a pen or needle. Store insulin as instructed, most types need a fridge until opened. Know the signs of low blood sugar, shakiness, sweating, confusion, and keep something sugary nearby.",
        ],
      },
      {
        heading: "It gets easier",
        paragraphs: [
          "The first injection is the hardest part for almost everyone. A nurse or doctor walks through it with you before you're ever expected to do it alone, and within a couple of weeks most people describe it as routine, not something they think much about anymore.",
        ],
      },
    ],
  },
  {
    slug: "diabetic-foot-care-daily-habit",
    title: "Diabetic foot care: the 2-minute daily habit that prevents amputation",
    description:
      "Why diabetes makes feet vulnerable, the daily check that catches problems early, and when a small wound becomes urgent.",
    category: "Diabetes",
    readMinutes: 4,
    relatedHref: "/diabetes",
    relatedLabel: "Diabetes care at Tarragon",
    sections: [
      {
        heading: "Why feet specifically",
        paragraphs: [
          "Years of raised blood sugar can quietly reduce feeling in the feet, so you might not notice a cut or a stone in your shoe, and can slow how well small wounds heal. Feet take the most daily wear and get seen the least, which is exactly why diabetes complications often show up there first.",
        ],
      },
      {
        heading: "The 2-minute daily check",
        paragraphs: [
          "Look at the top, sole and between every toe each evening, using a mirror or asking someone if you can't see well. Feel for anything hot, swollen or newly numb. Check inside shoes before putting them on for a stone or rough seam you wouldn't otherwise feel.",
        ],
      },
      {
        heading: "What actually protects your feet",
        paragraphs: [
          "Wash and dry feet properly, especially between the toes. Moisturise the skin, but not between the toes. Trim nails straight across, not curved into the corners. Never walk barefoot, even at home. Choose shoes that fit properly rather than ones that need breaking in.",
        ],
      },
      {
        heading: "When a small wound becomes urgent",
        paragraphs: [
          "Any cut, blister or sore that hasn't visibly started healing within a couple of days, any redness spreading outward, or any wound with a bad smell needs a doctor that same week, not the next routine visit. Caught early, almost every foot problem in diabetes is manageable; caught late, options narrow fast.",
        ],
      },
    ],
  },
  {
    slug: "diabetes-complications-eyes-kidneys-nerves-heart",
    title: "What high sugar does over time: diabetes and your eyes, kidneys, nerves and heart",
    description:
      "The systems years of unmanaged sugar quietly affects, why regular checks matter even with no symptoms, and what genuinely slows this down.",
    category: "Diabetes",
    readMinutes: 5,
    relatedHref: "/diabetes",
    relatedLabel: "Diabetes care at Tarragon",
    sections: [
      {
        heading: "Why complications build silently",
        paragraphs: [
          "Raised blood sugar damages small blood vessels and nerves gradually, over years, usually with no symptoms until the damage is significant. This is exactly why regular screening matters more than how you feel from day to day.",
        ],
      },
      {
        heading: "Eyes, kidneys, and skin",
        paragraphs: [
          "Diabetic retinopathy, damage to the light-sensitive back of the eye, is a leading cause of preventable blindness worldwide, and it is symptomless in its early, most treatable stage. A dilated eye exam, not just a vision check, should happen at least yearly.",
          "The kidneys filter blood through tiny vessels that raised sugar can damage over time. A simple urine test, checking for protein, catches this stage years before any symptom would appear, and it's one of the cheapest, most valuable tests in ongoing diabetes care. Skin can also become drier and slower to heal, a smaller sign of the same underlying vessel changes.",
        ],
      },
      {
        heading: "Nerves and the heart",
        paragraphs: [
          "Nerve damage often starts as tingling or numbness in the feet, part of why foot checks matter so much. Diabetes roughly doubles cardiovascular risk, which is why blood pressure and cholesterol get treated alongside sugar, not as a separate conversation.",
        ],
      },
      {
        heading: "What genuinely slows all of this down",
        paragraphs: [
          "The same three things: sugar in your target range over time, tracked by HbA1c rather than one reading, blood pressure control, and not smoking. None of this is exotic advice; it's the actual evidence for why the boring daily routine matters as much as it does.",
        ],
      },
    ],
  },
  {
    slug: "diabetes-and-sexual-health",
    title: "Diabetes and sexual health: a common complication worth raising with your doctor",
    description:
      "Why diabetes can affect sexual health in both men and women, and why it's a medical conversation, not an embarrassing one.",
    category: "Diabetes",
    readMinutes: 3,
    relatedHref: "/diabetes",
    relatedLabel: "Diabetes care at Tarragon",
    sections: [
      {
        heading: "It's more common than people realise",
        paragraphs: [
          "Years of raised blood sugar can affect the same small blood vessels and nerves involved in sexual function, in both men and women. For men this often shows up as difficulty getting or keeping an erection; for women, as reduced sensation, dryness or lower interest. Neither is a personal failing, and neither is rare among people managing diabetes.",
        ],
      },
      {
        heading: "Why it's worth actually saying out loud",
        paragraphs: [
          "Many people quietly live with this for years rather than mention it, often out of embarrassment. Your care team has heard it many times before, and raising it usually leads somewhere useful, because it's frequently connected to the same sugar, blood pressure and circulation numbers already being tracked.",
        ],
      },
      {
        heading: "What can help",
        paragraphs: [
          "Better overall sugar and blood pressure control often improves things on its own over time. Beyond that, there are safe, well-established treatment options a doctor can discuss once other causes, medication side effects, thyroid, mood, are ruled out. This isn't a dead end; it's a normal part of a diabetes review.",
        ],
      },
    ],
  },
  {
    slug: "diabetes-myths-that-need-to-die",
    title: "Diabetes myths that need to die",
    description: "Common things people believe about diabetes that simply aren't true, and what actually holds up.",
    category: "Diabetes",
    readMinutes: 4,
    relatedHref: "/diabetes",
    relatedLabel: "Diabetes care at Tarragon",
    sections: [
      {
        heading: "\"Only overweight people get diabetes\"",
        paragraphs: [
          "Excess weight raises risk, but plenty of people with type 2 diabetes are of normal weight, and thin people can carry harmful fat around their organs that doesn't show on a scale. Type 1 diabetes has nothing to do with weight at all. Judging risk by appearance misses more than it catches.",
        ],
      },
      {
        heading: "\"Eating too much sugar directly causes it\"",
        paragraphs: [
          "Sugar alone doesn't cause diabetes; the real drivers are genetics, excess weight from any source of extra calories, inactivity and age. Sugary drinks matter because of the calories and rapid glucose spike, not because sugar itself is uniquely toxic.",
        ],
      },
      {
        heading: "\"Once you're on insulin, that's the final, most serious stage\"",
        paragraphs: [
          "Insulin is a tool matched to what your body needs at a given point, not a marker of how serious or advanced a case has become. Many people start insulin, do well on it, and some are even able to come off it later if other changes bring their numbers down.",
        ],
      },
      {
        heading: "\"You can never eat sweet things again\" and \"if I feel fine, my sugar must be fine\"",
        paragraphs: [
          "Nothing is banned outright; portion, pairing and frequency matter far more than any single food. A small piece of cake at a party, eaten occasionally and thoughtfully, is not the same as a daily habit.",
          "And type 2 diabetes is often symptomless for years, which is exactly why regular testing, not how you feel, is what actually tells you where your numbers stand.",
        ],
      },
    ],
  },
  {
    slug: "blood-pressure-medications-explained",
    title: "Blood pressure medications explained: the main types, in plain language",
    description: "Why there are several classes of BP tablets, what each broadly does, and what's worth asking about yours.",
    category: "Blood pressure",
    readMinutes: 5,
    relatedHref: "/hypertension",
    relatedLabel: "Hypertension care at Tarragon",
    sections: [
      {
        heading: "Why one tablet doesn't fit everyone",
        paragraphs: [
          "Blood pressure is controlled by several different systems in the body, how much fluid you're carrying, how tightly blood vessels squeeze, how hard the heart pumps, so different medicine classes work on different parts of the problem. Many people end up on a combination, not because one alone failed, but because two mechanisms working together control pressure better at lower individual doses.",
        ],
      },
      {
        heading: "The commonly used classes",
        paragraphs: [
          "ACE inhibitors and ARBs relax blood vessels and are often a first choice, especially with diabetes or kidney protection in mind. Calcium channel blockers relax the vessel walls directly. Diuretics, water tablets, help the body release excess fluid and salt. Beta blockers slow the heart rate and are used more selectively today, often alongside a specific heart condition.",
        ],
      },
      {
        heading: "Why your doctor picked the one you're on",
        paragraphs: [
          "Age, kidney function, other conditions like diabetes, pregnancy plans, and even evidence about how different groups respond, all factor into the choice. There is genuine science behind why two people with the same blood pressure reading might be started on different tablets.",
        ],
      },
      {
        heading: "What's actually worth asking",
        paragraphs: [
          "What is this tablet doing, and roughly how long before we'd expect to see the effect on my readings? What side effects mean I should call rather than wait? If cost or availability is a problem, say so directly; there is almost always an equally effective alternative.",
        ],
      },
    ],
  },
  {
    slug: "cooking-with-less-salt-nigerian-kitchen",
    title: "Cooking with less salt: herbs, oils and swaps for Nigerian kitchens",
    description: "Where the salt actually hides, which oils behave better, and flavour swaps that don't mean bland food.",
    category: "Blood pressure",
    readMinutes: 4,
    relatedHref: "/hypertension",
    relatedLabel: "Hypertension care at Tarragon",
    sections: [
      {
        heading: "Flavour without the seasoning cube",
        paragraphs: [
          "Ground crayfish in moderation, fresh ginger and garlic, dried pepper, curry and thyme, and aromatics like scent leaf or uziza all add real flavour without adding the sodium a seasoning cube or stock powder does. Building a stew's flavour from these first, then salting at the end and tasting as you go, usually means you need far less salt than cooking on autopilot.",
        ],
      },
      {
        heading: "Reading what you already buy",
        paragraphs: [
          "Many seasoning cubes and instant noodle seasonings carry most of a day's recommended sodium in a single serving. Halving how many cubes a pot uses, or swapping some for the herb combinations above, is one of the highest-impact changes available without changing what you actually cook.",
        ],
      },
      {
        heading: "Oil matters too, just differently",
        paragraphs: [
          "This is more about heart and cholesterol than blood pressure directly, but the two are managed together: groundnut, sunflower or olive oil used in sensible amounts behave better than repeatedly reused frying oil or heavily processed cooking fats, which develop harmful compounds each time they're reheated.",
        ],
      },
      {
        heading: "A realistic way to start",
        paragraphs: [
          "You don't need to overhaul every pot this week. Pick the two or three dishes your household eats most often and rework those first; a change that survives six months beats a perfect week that quietly reverts back.",
        ],
      },
    ],
  },
  {
    slug: "hypertension-complications-heart-brain-kidneys",
    title: "Hypertension complications: what unmanaged blood pressure does to your heart, brain and kidneys",
    description: "Why hypertension is called a silent killer, and the organs most affected by years of raised pressure.",
    category: "Blood pressure",
    readMinutes: 4,
    relatedHref: "/hypertension",
    relatedLabel: "Hypertension care at Tarragon",
    sections: [
      {
        heading: "Why it's called silent",
        paragraphs: [
          "Raised blood pressure itself usually produces no symptoms, but the constant extra force on artery walls does quiet damage over years, in vessels supplying the heart, brain and kidneys among others. The damage, not the number itself, is what eventually causes symptoms, often abruptly.",
        ],
      },
      {
        heading: "The heart and the brain",
        paragraphs: [
          "Years of raised pressure make the heart work harder than it should, which over time can thicken the heart muscle and eventually weaken it, and it accelerates the artery narrowing that leads to heart attacks. Hypertension is also the single biggest controllable risk factor for stroke, both the sudden kind and the slower, cumulative kind linked to memory decline later in life. Controlling blood pressure is one of the most effective stroke-prevention tools that exists.",
        ],
      },
      {
        heading: "The kidneys",
        paragraphs: [
          "The kidneys filter blood through delicate vessels that raised pressure damages over time, and kidney disease and hypertension often worsen each other in a loop: poor kidney function raises blood pressure further, and high blood pressure damages the kidneys further.",
        ],
      },
      {
        heading: "The genuinely reassuring part",
        paragraphs: [
          "Every one of these risks drops substantially once blood pressure is brought under control and kept there. This isn't a one-time fix; it's the reason ongoing monitoring and consistent medicine matter more than any single reading.",
        ],
      },
    ],
  },
  {
    slug: "cholesterol-and-heart-disease-connection",
    title: "Cholesterol and heart disease: how one connects to the other, and what's reversible",
    description: "The plain-language mechanism linking a lab number to an actual heart attack, and what genuinely changes that trajectory.",
    category: "Cholesterol",
    readMinutes: 4,
    relatedHref: "/chronic-care",
    relatedLabel: "Chronic care at Tarragon",
    sections: [
      {
        heading: "From a number to an actual artery",
        paragraphs: [
          "Excess LDL cholesterol doesn't just float harmlessly in your blood. Over years it can work into the walls of arteries and, alongside inflammation, build into fatty deposits called plaque. A narrowed artery restricts blood flow; a plaque that ruptures can trigger a sudden clot, which is often what a heart attack or stroke actually is, happening inside a vessel.",
        ],
      },
      {
        heading: "Why this takes years, not days",
        paragraphs: [
          "This process, atherosclerosis, builds slowly and silently, often over decades, which is exactly why a cholesterol result in your 30s or 40s matters even though nothing feels wrong yet. The earlier it's identified and managed, the more of that decades-long buildup is prevented rather than treated after the fact.",
        ],
      },
      {
        heading: "What's genuinely reversible",
        paragraphs: [
          "Plaque that has already hardened doesn't simply disappear, but lowering LDL meaningfully slows or halts further buildup, and there is real evidence that some soft, early plaque can shrink with sustained treatment. The goal is less about erasing the past and more about changing the next twenty years.",
        ],
      },
      {
        heading: "The point of treating it early",
        paragraphs: [
          "A heart attack or stroke is often the first noticeable symptom of a process that had been building for years. Managing cholesterol well before that point, through diet, movement, not smoking, and a statin when risk is high enough, is what prevention actually means here: an honest description of the biology, not a scare tactic.",
        ],
      },
    ],
  },
  {
    slug: "cooking-oils-trans-fats-cholesterol",
    title: "Cooking oils and trans fats: what actually helps your cholesterol",
    description: "Which oils behave better for your heart, why trans fats are worth avoiding specifically, and practical swaps for Nigerian cooking.",
    category: "Cholesterol",
    readMinutes: 4,
    relatedHref: "/chronic-care",
    relatedLabel: "Chronic care at Tarragon",
    sections: [
      {
        heading: "Not all fat behaves the same way",
        paragraphs: [
          "The type of fat matters more than the total amount for cholesterol specifically. Unsaturated fats, found in groundnut oil, olive oil, fish and avocado, tend to be neutral or even help your numbers. Saturated fat, found in a lot of red meat, butter and palm oil used heavily, raises LDL when eaten often. Trans fat is the one worth actively avoiding.",
        ],
      },
      {
        heading: "Why trans fat specifically earns its bad reputation",
        paragraphs: [
          "It's mostly found in some margarines, shortenings and reused or heavily processed frying oil, and it uniquely both raises the 'bad' LDL cholesterol and lowers the 'good' HDL at the same time, a combination no other fat manages. It shows up most in repeatedly reheated deep-frying oil and some packaged snacks and baked goods.",
        ],
      },
      {
        heading: "The oil swap that actually matters",
        paragraphs: [
          "Using groundnut, sunflower or olive oil in sensible amounts, and not reusing frying oil more than once or twice, does more for your numbers than agonising over an exact brand. Grilling, boiling or air-frying instead of deep-frying, where the taste difference is small, is an easy, low-cost swap.",
        ],
      },
      {
        heading: "A realistic starting point",
        paragraphs: [
          "You don't need to remove all fat; a completely fat-free diet isn't the goal or even healthy. The practical shift is toward fish, beans and vegetable oils more often, and away from reused frying oil and heavily processed snack foods, most days rather than every single day.",
        ],
      },
    ],
  },
  {
    slug: "cancer-warning-signs-worth-not-ignoring",
    title: "Cancer warning signs worth not ignoring",
    description: "The changes in your body that deserve a doctor's visit, explained without the fear, because most turn out to be something else.",
    category: "Screening",
    readMinutes: 4,
    relatedHref: "/prevention",
    relatedLabel: "Preventive care at Tarragon",
    sections: [
      {
        heading: "Most of these signs are not cancer",
        paragraphs: [
          "A lump, a persistent cough, or a mole that's changed is far more often something ordinary than something serious. Knowing these signs isn't about worry; it's about knowing what's worth a check rather than a wait-and-see, so that on the rare occasion it does matter, it's caught early.",
        ],
      },
      {
        heading: "Signs worth a visit, not a panic",
        paragraphs: [
          "A new lump or swelling anywhere on the body. A sore or wound that hasn't started healing after a few weeks. Unexplained weight loss. A cough or hoarseness lasting more than three weeks. A change in bowel or bladder habits that persists. Unusual bleeding, including between periods or after menopause. A mole that's changed size, shape or colour. Persistent difficulty swallowing.",
        ],
      },
      {
        heading: "Why 'it'll probably go away' isn't the right instinct here",
        paragraphs: [
          "Most causes of these symptoms are minor and resolve on their own, which is exactly why people put off checking. The small share that aren't minor are also the ones where catching it early makes the biggest difference to treatment and outcome, so the cost of checking is low and the value of ruling something out is real either way.",
        ],
      },
      {
        heading: "What actually happens when you raise one of these",
        paragraphs: [
          "A doctor examines you, decides what test or referral makes sense, sometimes nothing more than a blood test or a scan, and the great majority of these visits end with reassurance, not a diagnosis. That reassurance is worth having on record either way.",
        ],
      },
    ],
  },
  {
    slug: "what-actually-reduces-cancer-risk",
    title: "What actually reduces cancer risk (and what doesn't)",
    description: "The genuinely evidence-backed changes, and an honest look at the diets and products marketed as cancer cures that aren't.",
    category: "Screening",
    readMinutes: 4,
    relatedHref: "/prevention",
    relatedLabel: "Preventive care at Tarragon",
    sections: [
      {
        heading: "The changes with real evidence behind them",
        paragraphs: [
          "Not smoking, the single biggest controllable factor for several common cancers, limiting alcohol, maintaining a healthy weight, staying physically active, eating more vegetables, fruit and fibre while cutting back on processed and smoked meats, and protecting skin from excessive sun. None of these guarantee anything individually, but together they measurably shift risk, which is the honest way to think about prevention.",
        ],
      },
      {
        heading: "Vaccination as cancer prevention",
        paragraphs: [
          "The HPV vaccine prevents the infection responsible for most cervical cancer and some others, and the Hepatitis B vaccine prevents a major cause of liver cancer. Both are prevention in the most literal sense: stopping the cause before it has a chance to act.",
        ],
      },
      {
        heading: "What doesn't hold up",
        paragraphs: [
          "'Alkaline diets', juice cleanses and specific superfoods marketed as cancer-fighting have no reliable evidence behind the claims made for them. The real risk isn't trying them for general wellbeing; it's delaying or replacing an actual screening or medical assessment because a product promised protection it can't deliver.",
        ],
      },
      {
        heading: "Screening is prevention too, in a different sense",
        paragraphs: [
          "Some screenings, like cervical smears and colorectal tests, don't just detect cancer early, they can catch and allow removal of changes before they ever become cancer at all. Staying up to date with screening is as much a part of risk reduction as diet or exercise, not a separate, later step.",
        ],
      },
    ],
  },
  {
    slug: "abnormal-screening-result-what-happens-next",
    title: "Your screening result came back abnormal. Here's what happens next.",
    description: "What an abnormal result actually means, why it usually isn't cancer, and what Tarragon does the moment a result like this lands.",
    category: "Screening",
    readMinutes: 4,
    relatedHref: "/prevention",
    relatedLabel: "Preventive care at Tarragon",
    sections: [
      {
        heading: "First: an abnormal result is common, and rarely cancer",
        paragraphs: [
          "Screening tests are deliberately sensitive, built to flag anything worth a second look rather than only the small number of results that turn out serious. Most abnormal screening results, on follow-up, turn out to be something minor, an infection, a benign change, a lab variation, not cancer. An abnormal result is a prompt to look closer, not a diagnosis.",
        ],
      },
      {
        heading: "What actually happens at Tarragon the moment it lands",
        paragraphs: [
          "An abnormal result is treated as one of the highest-priority events on the platform. It's routed straight to a doctor for review rather than sitting in a queue with everything else, and where it's genuinely urgent, your care team follows up directly rather than waiting for you to notice and ask.",
        ],
      },
      {
        heading: "What the follow-up usually looks like",
        paragraphs: [
          "A doctor reviews the result against your history, decides whether it needs a repeat test, a referral to a specialist, or simply a routine recheck, and explains the reasoning in plain language, not a lab printout left for you to interpret alone.",
        ],
      },
      {
        heading: "What to actually do while you wait",
        paragraphs: [
          "Keep your contact details current so a call or message reaches you, and if anything is unclear, ask. Waiting for a result is genuinely one of the more anxious parts of care, and the honest answer is that most of the time, the news that follows is reassuring.",
        ],
      },
    ],
  },
  {
    slug: "quitting-smoking-cancer-risk",
    title: "Quitting smoking: the single biggest cancer-risk change you can make",
    description: "Why smoking affects far more than the lungs, what actually happens to your risk after you quit, and where to get real support.",
    category: "Screening",
    readMinutes: 4,
    relatedHref: "/prevention",
    relatedLabel: "Preventive care at Tarragon",
    sections: [
      {
        heading: "More than a lung problem",
        paragraphs: [
          "Smoking is linked to cancers of the mouth, throat, oesophagus, bladder, pancreas and cervix, not only the lungs, because the harmful chemicals travel through the bloodstream to tissues well beyond where the smoke itself goes. It's also a major driver of heart disease, stroke and hypertension, so quitting works on several fronts at once.",
        ],
      },
      {
        heading: "What actually happens after you stop",
        paragraphs: [
          "Within a year, the extra risk to your heart drops substantially. Over the following decade, cancer risk keeps falling the longer you stay smoke-free, though it takes longer to return fully to a never-smoker's baseline. The benefit starts almost immediately and keeps compounding, at any age you quit.",
        ],
      },
      {
        heading: "Why quitting is hard, and that's not a character flaw",
        paragraphs: [
          "Nicotine is genuinely addictive, and most people who successfully quit for good tried more than once first. Cravings are strongest and most frequent in the first couple of weeks and ease meaningfully after that, which is the window worth planning support around rather than trying to manage alone.",
        ],
      },
      {
        heading: "What helps in practice",
        paragraphs: [
          "Setting an actual quit date rather than a vague intention, telling people around you so they can support rather than tempt, removing cigarettes and lighters from the house ahead of time, and having a plan for the specific moments that usually trigger a cigarette. Raise it with your doctor too; there are safe, effective aids that make quitting materially easier.",
        ],
      },
    ],
  },
  {
    slug: "recommended-dietary-allowances-nigeria",
    title: "Recommended Dietary Allowances: what Nigeria's own numbers actually are",
    description:
      "Why the %RDA on a Nigerian food label isn't the same figure used abroad, and NAFDAC's own daily reference numbers for protein, salt, iron, vitamin A and more.",
    category: "Nutrition",
    readMinutes: 6,
    relatedHref: "/prevention",
    relatedLabel: "Preventive care at Tarragon",
    sections: [
      {
        heading: "What \"RDA\" actually means, and why Nigeria has its own numbers",
        paragraphs: [
          "A Recommended Dietary Allowance is not a personal target or a diagnosis; it's a planning number, the amount of a nutrient estimated to meet the needs of almost everyone in a healthy population. It exists to guide food policy and food labels, not to tell any one person exactly what to eat.",
          "The %RDA printed on a packet in Lagos isn't calculated against the same reference numbers as one printed in London, Singapore or the United States. Nigeria has its own legally binding figures, called Nutrient Reference Values, set out in NAFDAC's Food Fortification Regulations. They're adapted from the Codex Alimentarius standard, the joint WHO/FAO food-standards body that most countries build their own national numbers from, which is why they're similar to other countries' figures but rarely identical.",
        ],
      },
      {
        heading: "The big three: energy, protein and salt",
        paragraphs: [
          "Nigerian food labels are built around a reference intake of 2,000 kilocalories a day for an average adult, more for a very active person or someone breastfeeding, less for someone smaller or older. It's a starting point for comparing products, not a number to hit exactly every day.",
          "Protein's reference figure is 50 grams a day, comfortably covered by a normal Nigerian diet that includes beans, fish, eggs, meat or dairy at most meals, even without deliberately tracking it.",
          "Salt is the number worth the most attention. The official ceiling is 2,000 milligrams of sodium a day, roughly a level teaspoon of salt, and that includes what's already in bread, seasoning cubes, and anything packaged or eaten out, not just what's added at the table. Balancing it is potassium, found in beans, plantain and leafy vegetables, which the guidance says most adults should reach at least 3,500 milligrams of a day.",
        ],
      },
      {
        heading: "Vitamins and minerals: the numbers on a Nigerian label",
        paragraphs: [
          "These are the figures NAFDAC requires a manufacturer to test a product against before printing a claim like '30% of your daily vitamin C.' A few worth knowing: vitamin A 800 micrograms, vitamin C 100 milligrams, vitamin D 5 micrograms, calcium 1,000 milligrams, iron 14 milligrams, zinc 11 milligrams, and iodine 150 micrograms. Folate sits at 400 micrograms and vitamin B12 at 2.4 micrograms, both worth knowing if you're pregnant or planning to be.",
          "Three of those are already engineered into the Nigerian food supply. NAFDAC mandates vitamin A and iron fortification of milled wheat and maize flour, vitamin A fortification of vegetable oil, sugar and margarine, and iodine in table salt, precisely so that ordinary cooking with a genuine, properly labelled brand already delivers a meaningful share of the day's number without anyone having to think about it.",
        ],
      },
      {
        heading: "Why iron and folate deserve special attention here",
        paragraphs: [
          "Iron matters more in Nigeria than the 14 milligram reference figure alone suggests. The last Nigeria Demographic and Health Survey found anaemia in well over half of women of reproductive age, and in more than three in five pregnant women, a gap the general adult reference number was never designed to close on its own.",
          "Pregnancy needs more than the general figure, which is why antenatal iron-folate tablets exist as standard care: World Health Organisation guidance calls for 30 to 60 milligrams of iron and 400 micrograms of folic acid daily throughout pregnancy, with the higher end of that iron range specifically recommended wherever anaemia in pregnancy is already common, which, given the numbers above, describes most of Nigeria. It's a supplement layered on top of food, not a replacement for it.",
          "On the food side, iron from meat, liver and fish is absorbed more easily than iron from beans or leafy vegetables like ugu, but pairing a plant source with vitamin C, an orange after a bean meal, for instance, measurably improves how much of it the body actually takes up.",
        ],
      },
      {
        heading: "What this looks like on a Nigerian plate",
        paragraphs: [
          "Nigeria's own food guide, developed with the Federal Ministry of Health and the FAO, sets this out as a pyramid rather than a set of numbers: grains and tubers like rice, garri and yam form the base and belong at every meal; vegetables and fruit sit alongside them, also at every meal; protein foods, fish, eggs, meat and dairy, come in moderate portions rather than as the main event; oils and fats are used sparingly; and sweets and sugary drinks stay occasional, with plenty of water throughout the day.",
          "A fairly ordinary Nigerian day, pap or akara for breakfast, rice and beans or a swallow with vegetable soup for the main meals, meets most of these numbers without any special foods, supplements or counting. The two genuine gaps worth a specific conversation with a doctor rather than guesswork are iron and folate during pregnancy, and vitamin D for anyone who spends most of daylight hours indoors.",
        ],
      },
    ],
  },
];

export function getResourceArticle(slug: string): ResourceArticle | undefined {
  return RESOURCE_ARTICLES.find((a) => a.slug === slug);
}
