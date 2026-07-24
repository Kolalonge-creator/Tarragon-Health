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
  category: "Blood pressure" | "Diabetes" | "Weight" | "Screening" | "Cholesterol";
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
    slug: "weight-bmi-waist",
    title: "Is my weight a health problem? BMI, waist size, and what actually helps",
    description:
      "How to read BMI honestly, why waist circumference matters, and what sustainable weight care looks like.",
    category: "Weight",
    readMinutes: 5,
    relatedHref: "/obesity",
    relatedLabel: "The Tarragon obesity programme",
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
];

export function getResourceArticle(slug: string): ResourceArticle | undefined {
  return RESOURCE_ARTICLES.find((a) => a.slug === slug);
}
