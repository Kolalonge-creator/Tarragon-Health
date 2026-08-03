/**
 * The general drug-safety engine — the checks a dispensing pharmacist makes.
 *
 * This platform lets a patient buy medicines from any pharmacy, so no one is
 * standing between the prescription and the patient reading the whole list at
 * once. Three classic catches were therefore going unmade:
 *
 *   1. INTERACTIONS between drugs that are each fine alone.
 *   2. DUPLICATE THERAPY — two drugs of the same class, very often because two
 *      different prescribers each added one and neither saw the other's.
 *   3. RENAL DOSING against the patient's own creatinine-derived eGFR.
 *
 * PURE functions, no I/O, so every rule is unit-testable and this file stays
 * the single source of truth. ADVISORY, NEVER A BLOCK: exactly like
 * `diabetesDrugSafety`, this surfaces to a clinician who decides. Nothing here
 * cancels a prescription, edits a regimen, or reaches a patient unreviewed.
 *
 * SCOPE, STATED HONESTLY: this is a curated, guideline-informed rule set aimed
 * at the drugs this platform's chronic and preventive pathways actually see —
 * cardiometabolic, renal, common Nigerian antimicrobials and antimalarials. It
 * is NOT a complete interaction database and must never be represented as one.
 * A clean result means "none of the rules below fired", never "this combination
 * is safe". That distinction is in the return type, not just this comment.
 *
 * It composes `diabetesDrugSafety` for the glucose-lowering ladder rather than
 * restating it, so the diabetes pathway keeps one owner.
 */

import { diabetesDrugSafety, type DrugSafetyWarning, type DrugSafetySeverity } from "./diabetes-drug-safety";

export type { DrugSafetyWarning, DrugSafetySeverity };

/**
 * Therapeutic classes this engine reasons about. Deliberately coarse — the
 * useful checks (dual blockade, duplicate class, renal clearance) are class
 * level. Individual-drug quirks are handled by explicit drug matches on top.
 */
export type TherapeuticClass =
  | "ace_inhibitor"
  | "arb"
  | "beta_blocker"
  | "ccb_dihydropyridine"
  | "ccb_non_dihydropyridine"
  | "thiazide_diuretic"
  | "loop_diuretic"
  | "potassium_sparing_diuretic"
  | "potassium_supplement"
  | "statin"
  | "fibrate"
  | "nsaid"
  | "anticoagulant"
  | "antiplatelet"
  | "ssri"
  | "tramadol_opioid"
  | "macrolide"
  | "fluoroquinolone"
  | "azole_antifungal"
  | "nitroimidazole"
  | "antimalarial_act"
  | "digoxin"
  | "levothyroxine"
  | "metformin"
  | "sulfonylurea"
  | "sglt2"
  | "dpp4"
  | "insulin"
  | "ppi"
  | "allopurinol"
  | "colchicine"
  | "methotrexate"
  | "gabapentinoid"
  | "nitrofurantoin"
  | "cotrimoxazole"
  | "aminoglycoside"
  | "lithium"
  | "amiodarone"
  | "antipsychotic"
  | "calcium_or_iron_supplement";

export const CLASS_LABEL: Record<TherapeuticClass, string> = {
  ace_inhibitor: "ACE inhibitor",
  arb: "ARB (angiotensin receptor blocker)",
  beta_blocker: "Beta blocker",
  ccb_dihydropyridine: "Calcium channel blocker (dihydropyridine)",
  ccb_non_dihydropyridine: "Calcium channel blocker (rate-limiting)",
  thiazide_diuretic: "Thiazide diuretic",
  loop_diuretic: "Loop diuretic",
  potassium_sparing_diuretic: "Potassium-sparing diuretic",
  potassium_supplement: "Potassium supplement",
  statin: "Statin",
  fibrate: "Fibrate",
  nsaid: "NSAID",
  anticoagulant: "Anticoagulant",
  antiplatelet: "Antiplatelet",
  ssri: "SSRI antidepressant",
  tramadol_opioid: "Tramadol / opioid",
  macrolide: "Macrolide antibiotic",
  fluoroquinolone: "Fluoroquinolone antibiotic",
  azole_antifungal: "Azole antifungal",
  nitroimidazole: "Metronidazole / tinidazole",
  antimalarial_act: "Artemisinin-based antimalarial",
  digoxin: "Digoxin",
  levothyroxine: "Levothyroxine",
  metformin: "Metformin",
  sulfonylurea: "Sulfonylurea",
  sglt2: "SGLT2 inhibitor",
  dpp4: "DPP-4 inhibitor",
  insulin: "Insulin",
  ppi: "Proton pump inhibitor",
  allopurinol: "Allopurinol",
  colchicine: "Colchicine",
  methotrexate: "Methotrexate",
  gabapentinoid: "Gabapentin / pregabalin",
  nitrofurantoin: "Nitrofurantoin",
  cotrimoxazole: "Co-trimoxazole",
  aminoglycoside: "Aminoglycoside antibiotic",
  lithium: "Lithium",
  amiodarone: "Amiodarone",
  antipsychotic: "Antipsychotic",
  calcium_or_iron_supplement: "Calcium / iron supplement",
};

/**
 * Classification patterns. INN stems (-pril, -sartan, -statin, -floxacin) do
 * most of the work and generalise to drugs not named here, with explicit names
 * where a stem is ambiguous or absent.
 *
 * ORDER MATTERS. The first match wins, so any pattern that could be a substring
 * of another must come first — `ccb_non_dihydropyridine` before the -dipine
 * stem, `potassium_sparing_diuretic` before the generic potassium match.
 */
const CLASS_PATTERNS: { cls: TherapeuticClass; pattern: RegExp }[] = [
  { cls: "ccb_non_dihydropyridine", pattern: /\b(verapamil|diltiazem)\b/ },
  { cls: "ccb_dihydropyridine", pattern: /(amlodipine|nifedipine|felodipine|lercanidipine|nimodipine|\w+dipine)\b/ },
  { cls: "ace_inhibitor", pattern: /(lisinopril|ramipril|enalapril|perindopril|captopril|\w+pril)\b/ },
  { cls: "arb", pattern: /(losartan|valsartan|telmisartan|irbesartan|candesartan|olmesartan|\w+sartan)\b/ },
  { cls: "beta_blocker", pattern: /(atenolol|bisoprolol|metoprolol|propranolol|carvedilol|nebivolol|labetalol|\w+olol)\b/ },
  { cls: "potassium_sparing_diuretic", pattern: /\b(spironolactone|eplerenone|amiloride|triamterene)\b/ },
  { cls: "thiazide_diuretic", pattern: /\b(hydrochlorothiazide|hctz|bendroflumethiazide|indapamide|chlortalidone|chlorthalidone|metolazone)\b/ },
  { cls: "loop_diuretic", pattern: /\b(furosemide|frusemide|bumetanide|torasemide|torsemide)\b/ },
  { cls: "potassium_supplement", pattern: /(potassium chloride|\bkcl\b|slow[- ]?k|potassium supplement)/ },
  { cls: "statin", pattern: /(atorvastatin|simvastatin|rosuvastatin|pravastatin|fluvastatin|lovastatin|pitavastatin|\w+statin)\b/ },
  { cls: "fibrate", pattern: /\b(gemfibrozil|fenofibrate|bezafibrate|ciprofibrate)\b/ },
  { cls: "antiplatelet", pattern: /\b(aspirin|acetylsalicylic|asa|clopidogrel|ticagrelor|prasugrel|dipyridamole)\b/ },
  { cls: "nsaid", pattern: /\b(ibuprofen|diclofenac|naproxen|indomethacin|indometacin|piroxicam|meloxicam|celecoxib|etoricoxib|ketoprofen|mefenamic|nimesulide|aceclofenac)\b/ },
  { cls: "anticoagulant", pattern: /\b(warfarin|acenocoumarol|rivaroxaban|apixaban|dabigatran|edoxaban|enoxaparin|heparin)\b/ },
  { cls: "ssri", pattern: /\b(fluoxetine|sertraline|paroxetine|citalopram|escitalopram|fluvoxamine)\b/ },
  { cls: "tramadol_opioid", pattern: /\b(tramadol|codeine|morphine|pethidine|tapentadol|oxycodone)\b/ },
  { cls: "macrolide", pattern: /\b(clarithromycin|erythromycin|azithromycin)\b/ },
  { cls: "fluoroquinolone", pattern: /(ciprofloxacin|levofloxacin|moxifloxacin|ofloxacin|norfloxacin|\w+floxacin)\b/ },
  { cls: "azole_antifungal", pattern: /(fluconazole|itraconazole|ketoconazole|voriconazole|\w+conazole)\b/ },
  { cls: "nitroimidazole", pattern: /\b(metronidazole|tinidazole|secnidazole)\b/ },
  { cls: "antimalarial_act", pattern: /(artemether|lumefantrine|artesunate|amodiaquine|dihydroartemisinin|arteether|coartem)/ },
  { cls: "digoxin", pattern: /\b(digoxin|digitoxin)\b/ },
  { cls: "levothyroxine", pattern: /\b(levothyroxine|thyroxine|eltroxin|l[- ]?thyroxine)\b/ },
  { cls: "metformin", pattern: /\b(metformin|glucophage)\b/ },
  { cls: "sulfonylurea", pattern: /\b(gliclazide|glibenclamide|glimepiride|glipizide|glyburide)\b/ },
  { cls: "sglt2", pattern: /(empagliflozin|dapagliflozin|canagliflozin|ertugliflozin|\w+gliflozin)\b/ },
  { cls: "dpp4", pattern: /(sitagliptin|vildagliptin|linagliptin|saxagliptin|alogliptin|\w+gliptin)\b/ },
  { cls: "insulin", pattern: /\b(insulin|lantus|levemir|humulin|actrapid|mixtard|novomix|tresiba)\b/ },
  { cls: "ppi", pattern: /(omeprazole|esomeprazole|pantoprazole|lansoprazole|rabeprazole|\w+prazole)\b/ },
  { cls: "allopurinol", pattern: /\b(allopurinol|febuxostat)\b/ },
  { cls: "colchicine", pattern: /\b(colchicine)\b/ },
  { cls: "methotrexate", pattern: /\b(methotrexate|mtx)\b/ },
  { cls: "gabapentinoid", pattern: /\b(gabapentin|pregabalin)\b/ },
  { cls: "nitrofurantoin", pattern: /\b(nitrofurantoin|macrodantin|macrobid)\b/ },
  { cls: "cotrimoxazole", pattern: /\b(co[- ]?trimoxazole|cotrimoxazole|trimethoprim|sulfamethoxazole|septrin|bactrim)\b/ },
  { cls: "aminoglycoside", pattern: /\b(gentamicin|amikacin|tobramycin|streptomycin)\b/ },
  { cls: "lithium", pattern: /\b(lithium)\b/ },
  { cls: "amiodarone", pattern: /\b(amiodarone|dronedarone)\b/ },
  { cls: "antipsychotic", pattern: /\b(haloperidol|olanzapine|risperidone|quetiapine|chlorpromazine|aripiprazole)\b/ },
  { cls: "calcium_or_iron_supplement", pattern: /(calcium carbonate|calcium supplement|ferrous (sulphate|sulfate|fumarate|gluconate)|iron supplement|\bferrous\b)/ },
];

function normaliseDrugName(name: string): string {
  return name.toLowerCase().replace(/[.,()/\\]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Classify a free-text drug name into its therapeutic classes.
 *
 * Returns an ARRAY because Nigerian prescriptions very often name a combination
 * product on one line — "Lisinopril/HCTZ", "Artemether-Lumefantrine",
 * "Amlodipine + Valsartan". Treating those as a single unknown drug is exactly
 * how a duplicate ACE inhibitor slips through, so every class present is
 * returned.
 */
export function classifyDrug(drugName: string): TherapeuticClass[] {
  const name = normaliseDrugName(drugName);
  if (!name) return [];

  const found: TherapeuticClass[] = [];
  for (const { cls, pattern } of CLASS_PATTERNS) {
    if (found.includes(cls)) continue;
    if (pattern.test(name)) found.push(cls);
  }
  return found;
}

/** One medication as this engine sees it. Maps directly onto a `medications` row. */
export interface MedicationInput {
  id: string;
  drugName: string;
  dose?: string | null;
  /** `medications.prescriber_name` — the whole point of the duplicate check. */
  prescriberName?: string | null;
  /** `medications.source` — 'clinician' | 'patient' | 'specialist'. */
  source?: string | null;
}

export type FindingKind = "interaction" | "duplicate_therapy" | "renal_dosing" | "drug_specific";

export interface SafetyFinding {
  kind: FindingKind;
  severity: DrugSafetySeverity;
  /** Short headline, e.g. "Dual blockade of the renin-angiotensin system". */
  title: string;
  /** What the risk is and what to do about it. */
  message: string;
  /** The `medications.id`s this finding is about, so the UI can highlight them. */
  medicationIds: string[];
  /** Drug names involved, for a finding rendered outside the list context. */
  drugNames: string[];
}

export interface SafetyContext {
  /** From `egfrFromReading`. Null when no creatinine has ever been captured. */
  egfr?: number | null;
  /** True when the eGFR's source creatinine is over a year old. */
  egfrStale?: boolean;
  pregnant?: boolean;
  acutelyUnwell?: boolean;
  ageYears?: number | null;
}

export interface SafetyReport {
  findings: SafetyFinding[];
  /**
   * Why a renal check could not run. Non-null means every renal rule was
   * SKIPPED — the caller must show this, because an empty findings list would
   * otherwise read as "renal dosing checked and fine".
   */
  renalCheckSkipped: string | null;
  /**
   * Always true. A structural reminder in the return type itself that a clean
   * report means "no rule in this curated set fired", never "safe".
   */
  isAdvisoryOnly: true;
}

// ---------------------------------------------------------------- interactions

interface InteractionRule {
  a: TherapeuticClass;
  b: TherapeuticClass;
  severity: DrugSafetySeverity;
  title: string;
  message: string;
}

/**
 * Class-pair interaction rules. Curated for the drugs this platform's pathways
 * actually see, not a complete database — see the file header.
 */
const INTERACTION_RULES: InteractionRule[] = [
  {
    a: "ace_inhibitor",
    b: "arb",
    severity: "contraindicated",
    title: "Dual blockade of the renin-angiotensin system",
    message:
      "An ACE inhibitor and an ARB together give no added benefit and clearly increase acute kidney injury, hyperkalaemia and hypotension. Stop one of them. This combination very often reaches a patient because two prescribers each added one.",
  },
  {
    a: "ace_inhibitor",
    b: "potassium_sparing_diuretic",
    severity: "caution",
    title: "Hyperkalaemia risk",
    message:
      "Both raise potassium. Check U&E and potassium within 1–2 weeks of starting or increasing either, and repeat after any dose change or intercurrent illness.",
  },
  {
    a: "arb",
    b: "potassium_sparing_diuretic",
    severity: "caution",
    title: "Hyperkalaemia risk",
    message:
      "Both raise potassium. Check U&E and potassium within 1–2 weeks of starting or increasing either, and repeat after any dose change or intercurrent illness.",
  },
  {
    a: "ace_inhibitor",
    b: "potassium_supplement",
    severity: "caution",
    title: "Hyperkalaemia risk",
    message:
      "A potassium supplement alongside an ACE inhibitor is rarely needed and can push potassium to dangerous levels. Confirm the supplement is still indicated and check potassium.",
  },
  {
    a: "arb",
    b: "potassium_supplement",
    severity: "caution",
    title: "Hyperkalaemia risk",
    message:
      "A potassium supplement alongside an ARB is rarely needed and can push potassium to dangerous levels. Confirm the supplement is still indicated and check potassium.",
  },
  {
    a: "ace_inhibitor",
    b: "nsaid",
    severity: "caution",
    title: "Kidney injury risk (NSAID with renin-angiotensin blockade)",
    message:
      "NSAIDs blunt the blood-pressure effect and raise the risk of acute kidney injury. If a diuretic is also on the list this is the classic triple-whammy combination — review the NSAID first, it is usually the one that can go.",
  },
  {
    a: "arb",
    b: "nsaid",
    severity: "caution",
    title: "Kidney injury risk (NSAID with renin-angiotensin blockade)",
    message:
      "NSAIDs blunt the blood-pressure effect and raise the risk of acute kidney injury. If a diuretic is also on the list this is the classic triple-whammy combination — review the NSAID first, it is usually the one that can go.",
  },
  {
    a: "nsaid",
    b: "anticoagulant",
    severity: "contraindicated",
    title: "Serious bleeding risk",
    message:
      "An NSAID with an anticoagulant substantially raises the risk of gastrointestinal and other major bleeding. Avoid the combination; if analgesia is needed use paracetamol, and if an NSAID is unavoidable add gastroprotection and review urgently.",
  },
  {
    a: "nsaid",
    b: "antiplatelet",
    severity: "caution",
    title: "Gastrointestinal bleeding risk",
    message:
      "Adding an NSAID to aspirin or clopidogrel multiplies the risk of gastrointestinal bleeding. Prefer paracetamol; if an NSAID is genuinely needed, co-prescribe a proton pump inhibitor and keep the course short.",
  },
  {
    a: "nsaid",
    b: "loop_diuretic",
    severity: "caution",
    title: "Reduced diuretic effect and kidney injury risk",
    message:
      "NSAIDs oppose the diuretic and can precipitate acute kidney injury, particularly alongside an ACE inhibitor or ARB. Review whether the NSAID is still needed.",
  },
  {
    a: "anticoagulant",
    b: "antiplatelet",
    severity: "caution",
    title: "Combined bleeding risk",
    message:
      "An anticoagulant plus an antiplatelet is sometimes deliberate after a stent or an acute coronary event, but it should be a time-limited, documented decision. Confirm the indication and the intended stop date.",
  },
  {
    a: "anticoagulant",
    b: "azole_antifungal",
    severity: "caution",
    title: "Anticoagulant effect increased",
    message:
      "Azole antifungals inhibit warfarin metabolism and can raise the INR sharply within days. Check the INR early and repeat, or choose a non-interacting antifungal.",
  },
  {
    a: "anticoagulant",
    b: "nitroimidazole",
    severity: "caution",
    title: "Anticoagulant effect increased",
    message:
      "Metronidazole markedly potentiates warfarin. Check the INR within a few days of starting and after finishing the course.",
  },
  {
    a: "anticoagulant",
    b: "macrolide",
    severity: "caution",
    title: "Anticoagulant effect increased",
    message:
      "Macrolides raise the INR on warfarin. Check the INR during the course; azithromycin interacts least of the three.",
  },
  {
    a: "anticoagulant",
    b: "fluoroquinolone",
    severity: "caution",
    title: "Anticoagulant effect increased",
    message: "Fluoroquinolones can raise the INR on warfarin. Check the INR during the course.",
  },
  {
    a: "statin",
    b: "macrolide",
    severity: "contraindicated",
    title: "Muscle toxicity risk (statin with macrolide)",
    message:
      "Clarithromycin and erythromycin sharply raise simvastatin and atorvastatin levels, risking myopathy and rhabdomyolysis. Hold the statin for the antibiotic course, or use azithromycin instead.",
  },
  {
    a: "statin",
    b: "azole_antifungal",
    severity: "caution",
    title: "Muscle toxicity risk (statin with azole antifungal)",
    message:
      "Azole antifungals raise levels of simvastatin and atorvastatin. Hold the statin for short courses, or switch to pravastatin/rosuvastatin which are less affected.",
  },
  {
    a: "statin",
    b: "fibrate",
    severity: "caution",
    title: "Muscle toxicity risk (statin with fibrate)",
    message:
      "Combining a statin with a fibrate raises myopathy risk, most of all with gemfibrozil, which should not be combined with a statin at all. Fenofibrate is the safer partner if combination therapy is genuinely required. Counsel on unexplained muscle pain.",
  },
  {
    a: "beta_blocker",
    b: "ccb_non_dihydropyridine",
    severity: "contraindicated",
    title: "Bradycardia and heart block risk",
    message:
      "A beta blocker with verapamil or diltiazem can cause severe bradycardia, heart block and heart failure. Avoid; use a dihydropyridine such as amlodipine instead if a calcium channel blocker is needed.",
  },
  {
    a: "digoxin",
    b: "amiodarone",
    severity: "caution",
    title: "Digoxin toxicity risk",
    message: "Amiodarone roughly doubles digoxin levels. Halve the digoxin dose and check a level.",
  },
  {
    a: "digoxin",
    b: "loop_diuretic",
    severity: "caution",
    title: "Digoxin toxicity via low potassium",
    message:
      "Diuretic-induced hypokalaemia greatly increases digoxin toxicity. Keep potassium in range and check U&E regularly.",
  },
  {
    a: "digoxin",
    b: "ccb_non_dihydropyridine",
    severity: "caution",
    title: "Digoxin toxicity risk",
    message: "Verapamil and diltiazem raise digoxin levels and add to bradycardia. Reduce the dose and monitor.",
  },
  {
    a: "ssri",
    b: "tramadol_opioid",
    severity: "caution",
    title: "Serotonin syndrome and seizure risk",
    message:
      "Tramadol with an SSRI raises the risk of serotonin syndrome and lowers the seizure threshold. Prefer a different analgesic; if unavoidable, counsel on agitation, tremor, sweating and fever.",
  },
  {
    a: "ssri",
    b: "nsaid",
    severity: "caution",
    title: "Gastrointestinal bleeding risk",
    message:
      "SSRIs impair platelet function; with an NSAID the bleeding risk rises substantially. Consider gastroprotection or a different analgesic.",
  },
  {
    a: "ssri",
    b: "anticoagulant",
    severity: "caution",
    title: "Bleeding risk",
    message: "SSRIs add to bleeding risk on an anticoagulant. Counsel on bleeding and review the need for both.",
  },
  {
    a: "sulfonylurea",
    b: "azole_antifungal",
    severity: "caution",
    title: "Hypoglycaemia risk",
    message: "Fluconazole raises sulfonylurea levels and can cause prolonged hypoglycaemia. Warn the patient and monitor glucose closely.",
  },
  {
    a: "sulfonylurea",
    b: "fluoroquinolone",
    severity: "caution",
    title: "Glucose instability",
    message: "Fluoroquinolones can cause both hypo- and hyperglycaemia on a sulfonylurea. Monitor glucose during the course.",
  },
  {
    a: "sulfonylurea",
    b: "cotrimoxazole",
    severity: "caution",
    title: "Hypoglycaemia risk",
    message: "Co-trimoxazole potentiates sulfonylureas and can cause significant hypoglycaemia. Monitor glucose during the course.",
  },
  {
    a: "methotrexate",
    b: "nsaid",
    severity: "contraindicated",
    title: "Methotrexate toxicity risk",
    message:
      "NSAIDs reduce methotrexate clearance and can precipitate marrow suppression. Avoid, especially with any renal impairment.",
  },
  {
    a: "methotrexate",
    b: "cotrimoxazole",
    severity: "contraindicated",
    title: "Methotrexate toxicity risk",
    message:
      "Both are antifolates. Together they can cause severe marrow suppression. Avoid the combination outright.",
  },
  {
    a: "levothyroxine",
    b: "calcium_or_iron_supplement",
    severity: "caution",
    title: "Reduced levothyroxine absorption",
    message:
      "Calcium and iron bind levothyroxine in the gut and can leave a patient undertreated on an apparently adequate dose. Separate the doses by at least four hours.",
  },
  {
    a: "levothyroxine",
    b: "ppi",
    severity: "info",
    title: "Levothyroxine absorption may fall",
    message: "Reduced stomach acid can lower levothyroxine absorption. If TSH drifts up on a stable dose, consider this.",
  },
  {
    a: "lithium",
    b: "nsaid",
    severity: "contraindicated",
    title: "Lithium toxicity risk",
    message: "NSAIDs reduce lithium clearance and can cause toxicity quickly. Avoid; use paracetamol instead.",
  },
  {
    a: "lithium",
    b: "ace_inhibitor",
    severity: "caution",
    title: "Lithium toxicity risk",
    message: "ACE inhibitors raise lithium levels. Check a lithium level within a week of any change.",
  },
  {
    a: "lithium",
    b: "thiazide_diuretic",
    severity: "caution",
    title: "Lithium toxicity risk",
    message: "Thiazides markedly reduce lithium clearance. Check a lithium level and consider a different antihypertensive.",
  },
  {
    a: "allopurinol",
    b: "colchicine",
    severity: "info",
    title: "Expected combination in gout",
    message:
      "Colchicine cover while starting allopurinol is normal practice. Confirm the colchicine is time-limited rather than an open-ended repeat, and reduce its dose in renal impairment.",
  },
  {
    a: "macrolide",
    b: "fluoroquinolone",
    severity: "caution",
    title: "Additive QT prolongation",
    message:
      "Both prolong the QT interval. Together, and especially with low potassium or magnesium, this raises arrhythmia risk. Avoid combining; correct electrolytes.",
  },
  {
    a: "macrolide",
    b: "antimalarial_act",
    severity: "caution",
    title: "Additive QT prolongation",
    message: "Artemisinin combinations and macrolides both prolong the QT interval. Avoid combining where an alternative exists.",
  },
  {
    a: "fluoroquinolone",
    b: "antimalarial_act",
    severity: "caution",
    title: "Additive QT prolongation",
    message: "Artemisinin combinations and fluoroquinolones both prolong the QT interval. Avoid combining where an alternative exists.",
  },
  {
    a: "antipsychotic",
    b: "macrolide",
    severity: "caution",
    title: "Additive QT prolongation",
    message: "Both prolong the QT interval. Review the need and check potassium and magnesium.",
  },
  {
    a: "antipsychotic",
    b: "fluoroquinolone",
    severity: "caution",
    title: "Additive QT prolongation",
    message: "Both prolong the QT interval. Review the need and check potassium and magnesium.",
  },
  {
    a: "amiodarone",
    b: "fluoroquinolone",
    severity: "caution",
    title: "Additive QT prolongation",
    message: "Amiodarone with a fluoroquinolone meaningfully raises arrhythmia risk. Prefer a different antibiotic.",
  },
  {
    a: "amiodarone",
    b: "statin",
    severity: "caution",
    title: "Muscle toxicity risk",
    message: "Amiodarone raises simvastatin levels; keep simvastatin at or below 20 mg daily, or use an alternative statin.",
  },
];

// ------------------------------------------------------------- renal dosing

interface RenalRule {
  cls: TherapeuticClass;
  /** Fires when eGFR is strictly below this. */
  below: number;
  severity: DrugSafetySeverity;
  message: string;
}

/**
 * Renal rules, evaluated most-severe-first per class so a patient at eGFR 20
 * gets the "avoid" line rather than the milder "reduce dose" one.
 */
const RENAL_RULES: RenalRule[] = [
  { cls: "metformin", below: 30, severity: "contraindicated", message: "Do not use metformin below an eGFR of 30 — lactic-acidosis risk. Stop it if the patient is already taking it." },
  { cls: "metformin", below: 45, severity: "caution", message: "Review and reduce the metformin dose below an eGFR of 45, and monitor renal function closely." },
  { cls: "nsaid", below: 30, severity: "contraindicated", message: "Avoid NSAIDs below an eGFR of 30 — they can precipitate a further, sometimes irreversible, fall in kidney function." },
  { cls: "nsaid", below: 60, severity: "caution", message: "Use NSAIDs only if unavoidable below an eGFR of 60, at the lowest dose for the shortest time, with renal function rechecked." },
  { cls: "potassium_sparing_diuretic", below: 30, severity: "contraindicated", message: "Avoid spironolactone and other potassium-sparing diuretics below an eGFR of 30 — serious hyperkalaemia risk." },
  { cls: "potassium_sparing_diuretic", below: 45, severity: "caution", message: "Below an eGFR of 45, use a potassium-sparing diuretic only with close potassium monitoring." },
  { cls: "nitrofurantoin", below: 45, severity: "contraindicated", message: "Nitrofurantoin does not reach effective urinary concentrations below an eGFR of 45 and toxicity rises. Choose a different agent." },
  { cls: "digoxin", below: 60, severity: "caution", message: "Digoxin is renally cleared — reduce the dose and check a level; toxicity is easy to miss." },
  { cls: "gabapentinoid", below: 60, severity: "caution", message: "Gabapentin and pregabalin need dose reduction as eGFR falls; accumulation causes sedation, confusion and unsteadiness." },
  { cls: "allopurinol", below: 60, severity: "caution", message: "Start allopurinol lower and titrate slowly in renal impairment." },
  { cls: "colchicine", below: 30, severity: "contraindicated", message: "Avoid colchicine below an eGFR of 30 — it accumulates and causes marrow and neuromuscular toxicity." },
  { cls: "colchicine", below: 60, severity: "caution", message: "Reduce the colchicine dose below an eGFR of 60 and keep courses short." },
  { cls: "methotrexate", below: 45, severity: "contraindicated", message: "Avoid methotrexate below an eGFR of 45 — it is renally cleared and marrow toxicity follows quickly." },
  { cls: "methotrexate", below: 60, severity: "caution", message: "Reduce the methotrexate dose and monitor the full blood count closely in renal impairment." },
  { cls: "aminoglycoside", below: 60, severity: "caution", message: "Aminoglycosides are nephrotoxic and ototoxic in renal impairment. Use only if essential, with levels and dose-interval adjustment." },
  { cls: "cotrimoxazole", below: 30, severity: "caution", message: "Reduce the co-trimoxazole dose below an eGFR of 30 and watch potassium — it raises it." },
  { cls: "sulfonylurea", below: 45, severity: "caution", message: "Sulfonylureas accumulate in renal impairment and cause prolonged hypoglycaemia. Prefer gliclazide, use the lowest dose, and avoid glibenclamide entirely." },
  { cls: "dpp4", below: 45, severity: "caution", message: "Most DPP-4 inhibitors need dose reduction in renal impairment — linagliptin is the exception and needs none." },
  { cls: "sglt2", below: 30, severity: "caution", message: "Below an eGFR of 30 an SGLT2 inhibitor gives little glucose lowering, though it may still be continued for kidney or heart protection. Follow the specific product's limits." },
  { cls: "ace_inhibitor", below: 30, severity: "caution", message: "ACE inhibitors are usually still beneficial in advanced kidney disease but need specialist input, close potassium monitoring, and a plan to hold during acute illness." },
  { cls: "arb", below: 30, severity: "caution", message: "ARBs are usually still beneficial in advanced kidney disease but need specialist input, close potassium monitoring, and a plan to hold during acute illness." },
  { cls: "thiazide_diuretic", below: 30, severity: "caution", message: "Thiazides lose effect below an eGFR of 30 — a loop diuretic is usually needed instead." },
  { cls: "statin", below: 30, severity: "info", message: "Cap rosuvastatin at 20 mg daily in severe renal impairment; other statins generally need no adjustment." },
  { cls: "lithium", below: 60, severity: "caution", message: "Lithium is renally cleared and has a narrow margin. Reduce the dose and check levels more often." },
];

/** Drug-specific rules that are not class-wide. Kept explicit rather than forced into a class. */
function drugSpecificFindings(meds: MedicationInput[]): SafetyFinding[] {
  const findings: SafetyFinding[] = [];
  const has = (re: RegExp) => meds.filter((m) => re.test(normaliseDrugName(m.drugName)));

  const simvastatin = has(/\bsimvastatin\b/);
  const amlodipine = has(/\bamlodipine\b/);
  if (simvastatin.length > 0 && amlodipine.length > 0) {
    findings.push({
      kind: "drug_specific",
      severity: "caution",
      title: "Simvastatin dose cap with amlodipine",
      message:
        "Amlodipine raises simvastatin levels. Keep simvastatin at or below 20 mg daily with amlodipine, or switch to atorvastatin or rosuvastatin.",
      medicationIds: [...simvastatin, ...amlodipine].map((m) => m.id),
      drugNames: [...simvastatin, ...amlodipine].map((m) => m.drugName),
    });
  }

  const gemfibrozil = has(/\bgemfibrozil\b/);
  const anyStatin = meds.filter((m) => classifyDrug(m.drugName).includes("statin"));
  if (gemfibrozil.length > 0 && anyStatin.length > 0) {
    findings.push({
      kind: "drug_specific",
      severity: "contraindicated",
      title: "Gemfibrozil with a statin",
      message:
        "Gemfibrozil specifically should not be combined with a statin — the myopathy and rhabdomyolysis risk is far higher than with fenofibrate. Switch the fibrate or stop it.",
      medicationIds: [...gemfibrozil, ...anyStatin].map((m) => m.id),
      drugNames: [...gemfibrozil, ...anyStatin].map((m) => m.drugName),
    });
  }

  const glibenclamide = has(/\b(glibenclamide|glyburide)\b/);
  if (glibenclamide.length > 0) {
    findings.push({
      kind: "drug_specific",
      severity: "caution",
      title: "Glibenclamide carries the highest hypoglycaemia risk",
      message:
        "Glibenclamide has the highest risk of prolonged hypoglycaemia of the sulfonylureas, particularly in older patients and in renal impairment. Gliclazide is the safer choice.",
      medicationIds: glibenclamide.map((m) => m.id),
      drugNames: glibenclamide.map((m) => m.drugName),
    });
  }

  return findings;
}

// ------------------------------------------------------------ the main entry

/**
 * The full safety check for one patient's active medication list.
 *
 * Every finding names the exact `medications.id`s involved so the UI can point
 * at the rows rather than making a clinician re-derive which drugs a warning is
 * about.
 */
export function assessMedicationSafety(
  medications: MedicationInput[],
  ctx: SafetyContext = {},
): SafetyReport {
  const findings: SafetyFinding[] = [];

  // Classify once; every check below reads this.
  const classified = medications.map((m) => ({ med: m, classes: classifyDrug(m.drugName) }));

  // ---- 1. Interactions -----------------------------------------------------
  for (const rule of INTERACTION_RULES) {
    const aMatches = classified.filter((c) => c.classes.includes(rule.a));
    const bMatches = classified.filter((c) => c.classes.includes(rule.b));
    if (aMatches.length === 0 || bMatches.length === 0) continue;

    // A single combination product carrying both classes (e.g. a fixed-dose
    // ACE-inhibitor/thiazide) is a deliberate formulation, not an interaction
    // between two separate prescriptions. Only fire when genuinely distinct
    // medication rows are involved.
    const involved = new Set([...aMatches, ...bMatches].map((c) => c.med.id));
    if (involved.size < 2) continue;

    const drugs = [...aMatches, ...bMatches]
      .filter((c, i, arr) => arr.findIndex((x) => x.med.id === c.med.id) === i)
      .map((c) => c.med);

    findings.push({
      kind: "interaction",
      severity: rule.severity,
      title: rule.title,
      message: rule.message,
      medicationIds: drugs.map((m) => m.id),
      drugNames: drugs.map((m) => m.drugName),
    });
  }

  // ---- 2. Duplicate therapy ------------------------------------------------
  findings.push(...duplicateTherapyFindings(classified));

  // ---- 3. Renal dosing -----------------------------------------------------
  let renalCheckSkipped: string | null = null;
  if (ctx.egfr == null) {
    renalCheckSkipped =
      "No creatinine result is on file, so no renal dosing check could run. Record a kidney function test to switch these checks on.";
  } else {
    const egfr = ctx.egfr;
    for (const { med, classes } of classified) {
      for (const cls of classes) {
        const rule = RENAL_RULES.filter((r) => r.cls === cls && egfr < r.below).sort(
          (x, y) => x.below - y.below,
        )[0];
        if (!rule) continue;
        findings.push({
          kind: "renal_dosing",
          severity: rule.severity,
          title: `${CLASS_LABEL[cls]} at eGFR ${Math.round(egfr)}`,
          message: ctx.egfrStale
            ? `${rule.message} Note this eGFR comes from a creatinine over a year old — recheck before acting on it.`
            : rule.message,
          medicationIds: [med.id],
          drugNames: [med.drugName],
        });
      }
    }
  }

  // ---- 4. Drug-specific ----------------------------------------------------
  findings.push(...drugSpecificFindings(medications));

  // ---- 5. The existing diabetes ladder, composed not duplicated -------------
  for (const med of medications) {
    const ladder = diabetesDrugSafety(med.drugName, {
      egfr: ctx.egfr,
      pregnant: ctx.pregnant,
      acutelyUnwell: ctx.acutelyUnwell,
    });
    for (const warning of ladder) {
      // The renal rules above already cover the eGFR-driven metformin/SGLT2
      // lines; skip the ladder's duplicates so the same advice does not appear
      // twice under two headings.
      if (ctx.egfr != null && /eGFR/i.test(warning.message)) continue;
      findings.push({
        kind: "drug_specific",
        severity: warning.severity,
        title: `${med.drugName}`,
        message: warning.message,
        medicationIds: [med.id],
        drugNames: [med.drugName],
      });
    }
  }

  return {
    findings: dedupeAndRank(findings),
    renalCheckSkipped,
    isAdvisoryOnly: true,
  };
}

/**
 * Duplicate therapy — two active drugs of the same class.
 *
 * The prescriber comparison is the point. Two drugs of one class from the SAME
 * prescriber is usually deliberate (dual antiplatelet after a stent, two
 * insulins). The same thing from DIFFERENT prescribers, or where one arrived
 * via the patient's own record and the other from a clinic, is the classic
 * uncoordinated-care duplication that no one catches when there is no single
 * dispensing pharmacist looking at the whole list.
 */
function duplicateTherapyFindings(
  classified: { med: MedicationInput; classes: TherapeuticClass[] }[],
): SafetyFinding[] {
  const findings: SafetyFinding[] = [];

  /** Classes where more than one agent is routinely, deliberately co-prescribed. */
  const EXPECTED_MULTIPLES: TherapeuticClass[] = ["insulin", "antiplatelet"];

  const byClass = new Map<TherapeuticClass, MedicationInput[]>();
  for (const { med, classes } of classified) {
    for (const cls of classes) {
      const list = byClass.get(cls) ?? [];
      // A combination product can carry a class once only.
      if (!list.some((m) => m.id === med.id)) list.push(med);
      byClass.set(cls, list);
    }
  }

  for (const [cls, meds] of byClass) {
    if (meds.length < 2) continue;

    // Compare case-insensitively but DISPLAY the name as it was recorded —
    // "dr adeyemi" in a warning a clinician reads is sloppy, and this text can
    // reach a printed medication review.
    const prescribers = meds.map((m) => m.prescriberName?.trim() ?? "");
    const distinctPrescribers = new Map<string, string>();
    for (const name of prescribers) {
      if (name.length === 0) continue;
      if (!distinctPrescribers.has(name.toLowerCase())) {
        distinctPrescribers.set(name.toLowerCase(), name);
      }
    }
    const someUnknown = prescribers.some((p) => p.length === 0);
    const differentPrescribers = distinctPrescribers.size > 1;

    // Mixed provenance — one added by a clinician here, one carried in by the
    // patient or a specialist — is the same coordination gap even when the
    // prescriber name is blank on one of them.
    const sources = new Set(meds.map((m) => m.source ?? "unknown"));
    const mixedSources = sources.size > 1;

    if (EXPECTED_MULTIPLES.includes(cls) && !differentPrescribers) continue;

    const severity: DrugSafetySeverity = EXPECTED_MULTIPLES.includes(cls) ? "caution" : "contraindicated";

    let provenance: string;
    if (differentPrescribers) {
      provenance = `These were prescribed by different prescribers (${[...distinctPrescribers.values()].join(", ")}), so it is likely neither saw the other's.`;
    } else if (mixedSources || someUnknown) {
      provenance =
        "These reached the record by different routes, so it is likely no one has seen them side by side.";
    } else {
      provenance = "Confirm this duplication is deliberate.";
    }

    findings.push({
      kind: "duplicate_therapy",
      severity,
      title: `Two ${CLASS_LABEL[cls]} medicines at the same time`,
      message: `${meds.map((m) => m.drugName).join(" and ")} are both ${CLASS_LABEL[cls]} medicines. ${provenance} Taking two of the same class together usually adds side effects without adding benefit.`,
      medicationIds: meds.map((m) => m.id),
      drugNames: meds.map((m) => m.drugName),
    });
  }

  return findings;
}

const SEVERITY_RANK: Record<DrugSafetySeverity, number> = {
  contraindicated: 0,
  caution: 1,
  info: 2,
};

/**
 * Collapse findings that say the same thing about the same drugs (an ACE/ARB
 * pair matches two symmetric rules), then rank most severe first so the thing
 * that could hurt someone is never below an informational note.
 */
function dedupeAndRank(findings: SafetyFinding[]): SafetyFinding[] {
  const seen = new Map<string, SafetyFinding>();
  for (const f of findings) {
    const key = `${f.kind}|${f.title}|${[...f.medicationIds].sort().join(",")}`;
    const existing = seen.get(key);
    if (!existing || SEVERITY_RANK[f.severity] < SEVERITY_RANK[existing.severity]) {
      seen.set(key, f);
    }
  }
  return [...seen.values()].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** Convenience for a badge/count without re-running the whole assessment. */
export function countBySeverity(report: SafetyReport): Record<DrugSafetySeverity, number> {
  return report.findings.reduce(
    (acc, f) => ({ ...acc, [f.severity]: acc[f.severity] + 1 }),
    { contraindicated: 0, caution: 0, info: 0 } as Record<DrugSafetySeverity, number>,
  );
}
