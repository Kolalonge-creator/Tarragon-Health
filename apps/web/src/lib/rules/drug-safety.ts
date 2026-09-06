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
  | "penicillin"
  | "cephalosporin"
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
  penicillin: "Penicillin",
  cephalosporin: "Cephalosporin",
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
  { cls: "statin", pattern: /(atorvastatin|simvastatin|rosuvastatin|pravastatin|fluvastatin|lovastatin|pitavastatin|\w+statin|statins?)\b/ },
  { cls: "fibrate", pattern: /\b(gemfibrozil|fenofibrate|bezafibrate|ciprofibrate)\b/ },
  { cls: "antiplatelet", pattern: /\b(aspirin|acetylsalicylic|asa|clopidogrel|ticagrelor|prasugrel|dipyridamole)\b/ },
  { cls: "nsaid", pattern: /\b(ibuprofen|diclofenac|naproxen|indomethacin|indometacin|piroxicam|meloxicam|celecoxib|etoricoxib|ketoprofen|mefenamic|nimesulide|aceclofenac|nsaids?)\b/ },
  { cls: "anticoagulant", pattern: /\b(warfarin|acenocoumarol|rivaroxaban|apixaban|dabigatran|edoxaban|enoxaparin|heparin)\b/ },
  { cls: "ssri", pattern: /\b(fluoxetine|sertraline|paroxetine|citalopram|escitalopram|fluvoxamine)\b/ },
  { cls: "tramadol_opioid", pattern: /\b(tramadol|codeine|morphine|pethidine|tapentadol|oxycodone|opioids?|co-?codamol)\b/ },
  { cls: "macrolide", pattern: /\b(clarithromycin|erythromycin|azithromycin)\b/ },
  { cls: "fluoroquinolone", pattern: /(ciprofloxacin|levofloxacin|moxifloxacin|ofloxacin|norfloxacin|\w+floxacin)\b/ },
  {
    cls: "penicillin",
    pattern:
      /\b(penicillin|amoxicillin|ampicillin|flucloxacillin|cloxacillin|dicloxacillin|piperacillin|augmentin|co-?amoxiclav|benzylpenicillin|phenoxymethylpenicillin)\b/,
  },
  {
    cls: "cephalosporin",
    pattern:
      /\b(cephalosporin|cefuroxime|ceftriaxone|cefixime|cefpodoxime|cefotaxime|ceftazidime|cefaclor|cefadroxil|cefalexin|cephalexin|cefdinir|cefepime)\b/,
  },
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
  {
    cls: "cotrimoxazole",
    pattern: /\b(co[- ]?trimoxazole|cotrimoxazole|trimethoprim|sulfamethoxazole|septrin|bactrim|sulfa|sulfonamide|sulphonamide)\b/,
  },
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

export type FindingKind = "interaction" | "duplicate_therapy" | "renal_dosing" | "drug_specific" | "allergy";

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

/** One recorded allergy as this engine sees it. Maps directly onto a `patient_allergies` row. */
export interface AllergyInput {
  id: string;
  /** Free text — a drug name, a class name ("penicillin"), or a brand name. */
  allergen: string;
  reaction?: string | null;
  severity?: "mild" | "moderate" | "severe" | null;
  source?: "patient" | "clinician" | "fhir_import" | null;
}

export interface SafetyContext {
  /** From `egfrFromReading`. Null when no creatinine has ever been captured. */
  egfr?: number | null;
  /** True when the eGFR's source creatinine is over a year old. */
  egfrStale?: boolean;
  /**
   * From `reproductive_health_profiles.life_stage = 'pregnant'` — a
   * self-report, never a clinical confirmation (same status the profile
   * itself is documented as: "never a diagnosis"). Undefined means "not
   * checked" (the caller never loaded the profile) — distinct from `false`,
   * which means "checked, and the patient has not reported being pregnant".
   * See `SafetyReport.pregnancyCheckNote`.
   */
  pregnant?: boolean;
  acutelyUnwell?: boolean;
  ageYears?: number | null;
  /**
   * The patient's recorded allergies. Undefined means "not checked" (the
   * caller never loaded them) — distinct from an empty array, which means
   * "checked, and none are on file". See `SafetyReport.allergyCheckNote`.
   */
  allergies?: AllergyInput[];
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
   * Non-null explains why the allergy findings above should not be read as
   * reassurance: either allergy data was never loaded (`ctx.allergies` was
   * undefined), or it was loaded and genuinely empty — "no known allergies"
   * meaning nobody has recorded one, not that the patient has none.
   */
  allergyCheckNote: string | null;
  /**
   * Non-null explains why a pregnancy-related finding (or its absence) should
   * be read with a caveat: either pregnancy status was never loaded
   * (`ctx.pregnant` was undefined), or it was loaded and IS a self-report —
   * pregnancy-related findings below are only ever as reliable as that
   * self-report, never a clinician confirmation. Null when the patient has
   * not reported being pregnant, which needs no caveat.
   */
  pregnancyCheckNote: string | null;
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
      "NSAIDs blunt the blood-pressure effect and raise the risk of acute kidney injury. If a diuretic is also on the list this is the classic triple-whammy combination; review the NSAID first, it is usually the one that can go.",
  },
  {
    a: "arb",
    b: "nsaid",
    severity: "caution",
    title: "Kidney injury risk (NSAID with renin-angiotensin blockade)",
    message:
      "NSAIDs blunt the blood-pressure effect and raise the risk of acute kidney injury. If a diuretic is also on the list this is the classic triple-whammy combination; review the NSAID first, it is usually the one that can go.",
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
  { cls: "metformin", below: 30, severity: "contraindicated", message: "Do not use metformin below an eGFR of 30: lactic-acidosis risk. Stop it if the patient is already taking it." },
  { cls: "metformin", below: 45, severity: "caution", message: "Review and reduce the metformin dose below an eGFR of 45, and monitor renal function closely." },
  { cls: "nsaid", below: 30, severity: "contraindicated", message: "Avoid NSAIDs below an eGFR of 30; they can precipitate a further, sometimes irreversible, fall in kidney function." },
  { cls: "nsaid", below: 60, severity: "caution", message: "Use NSAIDs only if unavoidable below an eGFR of 60, at the lowest dose for the shortest time, with renal function rechecked." },
  { cls: "potassium_sparing_diuretic", below: 30, severity: "contraindicated", message: "Avoid spironolactone and other potassium-sparing diuretics below an eGFR of 30: serious hyperkalaemia risk." },
  { cls: "potassium_sparing_diuretic", below: 45, severity: "caution", message: "Below an eGFR of 45, use a potassium-sparing diuretic only with close potassium monitoring." },
  { cls: "nitrofurantoin", below: 45, severity: "contraindicated", message: "Nitrofurantoin does not reach effective urinary concentrations below an eGFR of 45 and toxicity rises. Choose a different agent." },
  { cls: "digoxin", below: 60, severity: "caution", message: "Digoxin is renally cleared: reduce the dose and check a level; toxicity is easy to miss." },
  { cls: "gabapentinoid", below: 60, severity: "caution", message: "Gabapentin and pregabalin need dose reduction as eGFR falls; accumulation causes sedation, confusion and unsteadiness." },
  { cls: "allopurinol", below: 60, severity: "caution", message: "Start allopurinol lower and titrate slowly in renal impairment." },
  { cls: "colchicine", below: 30, severity: "contraindicated", message: "Avoid colchicine below an eGFR of 30; it accumulates and causes marrow and neuromuscular toxicity." },
  { cls: "colchicine", below: 60, severity: "caution", message: "Reduce the colchicine dose below an eGFR of 60 and keep courses short." },
  { cls: "methotrexate", below: 45, severity: "contraindicated", message: "Avoid methotrexate below an eGFR of 45; it is renally cleared and marrow toxicity follows quickly." },
  { cls: "methotrexate", below: 60, severity: "caution", message: "Reduce the methotrexate dose and monitor the full blood count closely in renal impairment." },
  { cls: "aminoglycoside", below: 60, severity: "caution", message: "Aminoglycosides are nephrotoxic and ototoxic in renal impairment. Use only if essential, with levels and dose-interval adjustment." },
  { cls: "cotrimoxazole", below: 30, severity: "caution", message: "Reduce the co-trimoxazole dose below an eGFR of 30 and watch potassium; it raises it." },
  { cls: "sulfonylurea", below: 45, severity: "caution", message: "Sulfonylureas accumulate in renal impairment and cause prolonged hypoglycaemia. Prefer gliclazide, use the lowest dose, and avoid glibenclamide entirely." },
  { cls: "dpp4", below: 45, severity: "caution", message: "Most DPP-4 inhibitors need dose reduction in renal impairment; linagliptin is the exception and needs none." },
  { cls: "sglt2", below: 30, severity: "caution", message: "Below an eGFR of 30 an SGLT2 inhibitor gives little glucose lowering, though it may still be continued for kidney or heart protection. Follow the specific product's limits." },
  { cls: "ace_inhibitor", below: 30, severity: "caution", message: "ACE inhibitors are usually still beneficial in advanced kidney disease but need specialist input, close potassium monitoring, and a plan to hold during acute illness." },
  { cls: "arb", below: 30, severity: "caution", message: "ARBs are usually still beneficial in advanced kidney disease but need specialist input, close potassium monitoring, and a plan to hold during acute illness." },
  { cls: "thiazide_diuretic", below: 30, severity: "caution", message: "Thiazides lose effect below an eGFR of 30; a loop diuretic is usually needed instead." },
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
        "Gemfibrozil specifically should not be combined with a statin: the myopathy and rhabdomyolysis risk is far higher than with fenofibrate. Switch the fibrate or stop it.",
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

// -------------------------------------------------------------- allergy check

/**
 * Classes whose members are grouped together for INTERACTION purposes but are
 * chemically or mechanistically too diverse to assume cross-reactivity for an
 * ALLERGY. A same-class allergy match against one of these is downgraded from
 * "contraindicated" to "caution" rather than treated as a confirmed hit —
 * e.g. aspirin and clopidogrel share the "antiplatelet" class for interaction
 * purposes but are chemically unrelated, so an aspirin allergy says nothing
 * about clopidogrel.
 */
const COARSE_ALLERGY_CLASSES = new Set<TherapeuticClass>(["tramadol_opioid", "antipsychotic", "antiplatelet"]);

/** Reactions consistent with a severe/IgE-type hypersensitivity rather than a benign side effect. */
const SEVERE_REACTION_RE = /anaphyla|angioedema|stevens|toxic epidermal|\bten\b|laryngeal|throat|difficulty breathing|hives|urticaria/i;
/** The ACE-inhibitor class-effect dry cough — not an allergic reaction, and not predictive of an ARB reaction. */
const COUGH_ONLY_RE = /^\s*(a\s+)?(dry\s+)?cough\s*$/i;
const ASPIRIN_RE = /\b(aspirin|acetylsalicylic|asa)\b/;

/** Alphanumeric-only, for literal name-substring comparison (stricter than `normaliseDrugName`). */
function bareAlnum(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
const MIN_NAME_MATCH_LEN = 5;

function buildAllergyMessage(allergy: AllergyInput, lead: string): string {
  const parts = [lead];
  if (allergy.reaction) parts.push(`Recorded reaction: ${allergy.reaction}.`);
  if (allergy.severity) parts.push(`Recorded severity: ${allergy.severity}.`);
  if (allergy.source === "patient") {
    parts.push("Self-reported by the patient, not clinician-confirmed; verify if uncertain, but do not disregard.");
  }
  return parts.join(" ");
}

function exactMatchFinding(allergy: AllergyInput, med: MedicationInput): SafetyFinding {
  return {
    kind: "allergy",
    severity: "contraindicated",
    title: `Recorded allergy: ${allergy.allergen}`,
    message: buildAllergyMessage(
      allergy,
      `${med.drugName} matches the patient's recorded allergy to ${allergy.allergen} by name. Do not dispense without confirming this is safe.`,
    ),
    medicationIds: [med.id],
    drugNames: [med.drugName, allergy.allergen],
  };
}

function classMatchFinding(allergy: AllergyInput, med: MedicationInput, cls: TherapeuticClass): SafetyFinding {
  const coarse = COARSE_ALLERGY_CLASSES.has(cls);
  return {
    kind: "allergy",
    severity: coarse ? "caution" : "contraindicated",
    title: `Recorded allergy: ${allergy.allergen}`,
    message: buildAllergyMessage(
      allergy,
      coarse
        ? `${med.drugName} is in the same broad ${CLASS_LABEL[cls]} group as the recorded allergy to ${allergy.allergen}. That group bundles chemically different agents, so a reaction is not certain; confirm which specific drug the allergy refers to before dispensing.`
        : `${med.drugName} is a ${CLASS_LABEL[cls]}, the same class as the patient's recorded allergy to ${allergy.allergen}. Do not dispense without confirming this is safe.`,
    ),
    medicationIds: [med.id],
    drugNames: [med.drugName, allergy.allergen],
  };
}

const BETA_LACTAM_CROSS_REACTIVITY: { from: TherapeuticClass; to: TherapeuticClass }[] = [
  { from: "penicillin", to: "cephalosporin" },
  { from: "cephalosporin", to: "penicillin" },
];

/** Penicillin ↔ cephalosporin: real but low cross-reactivity, driven by side-chain similarity, not the shared beta-lactam ring. */
function penicillinCephalosporinCrossReactivity(
  allergy: AllergyInput,
  allergenClasses: TherapeuticClass[],
  classifiedMeds: { med: MedicationInput; classes: TherapeuticClass[] }[],
  flaggedMedIds: Set<string>,
): SafetyFinding[] {
  const findings: SafetyFinding[] = [];
  const reaction = allergy.reaction ?? "";
  const severe = allergy.severity === "severe" || SEVERE_REACTION_RE.test(reaction);

  for (const { from, to } of BETA_LACTAM_CROSS_REACTIVITY) {
    if (!allergenClasses.includes(from)) continue;
    for (const { med, classes } of classifiedMeds) {
      if (flaggedMedIds.has(med.id) || !classes.includes(to)) continue;
      findings.push({
        kind: "allergy",
        severity: severe ? "contraindicated" : "caution",
        title: `Possible cross-reactivity between ${CLASS_LABEL[from].toLowerCase()} and ${CLASS_LABEL[to].toLowerCase()} allergy`,
        message: severe
          ? `The recorded ${CLASS_LABEL[from].toLowerCase()} allergy to ${allergy.allergen} was severe${reaction ? ` (${reaction})` : ""}. Avoid ${med.drugName} unless allergy testing has cleared it. Cross-reactivity between penicillins and cephalosporins is low overall (well under 5%), but a prior severe reaction is exactly when it matters most.`
          : `Cross-reactivity between penicillins and cephalosporins is now understood to be much lower than once taught (well under 5%, and dependent on side-chain similarity, not the shared beta-lactam ring). ${med.drugName} is usually fine after a mild reaction to ${allergy.allergen}, but confirm the original reaction was not severe before dispensing, and prefer a structurally dissimilar cephalosporin where there is a choice.`,
        medicationIds: [med.id],
        drugNames: [med.drugName, allergy.allergen],
      });
    }
  }
  return findings;
}

/**
 * ACE inhibitor ↔ ARB. Deliberately reaction-aware: a dry cough is the
 * well-known ACE-inhibitor class effect and switching to an ARB is the
 * standard next step, NOT a cross-reactivity risk — flagging it as a caution
 * would actively discourage the guideline-recommended move. Angioedema is the
 * genuine (small but real) cross-reactivity concern.
 */
function aceArbCrossReactivity(
  allergy: AllergyInput,
  allergenClasses: TherapeuticClass[],
  classifiedMeds: { med: MedicationInput; classes: TherapeuticClass[] }[],
  flaggedMedIds: Set<string>,
): SafetyFinding[] {
  const isAceAllergy = allergenClasses.includes("ace_inhibitor");
  const isArbAllergy = allergenClasses.includes("arb");
  if (!isAceAllergy && !isArbAllergy) return [];

  const targetClass: TherapeuticClass = isAceAllergy ? "arb" : "ace_inhibitor";
  const reaction = (allergy.reaction ?? "").trim();
  const coughOnly = COUGH_ONLY_RE.test(reaction);
  const severeSigns = SEVERE_REACTION_RE.test(reaction);

  const findings: SafetyFinding[] = [];
  for (const { med, classes } of classifiedMeds) {
    if (flaggedMedIds.has(med.id) || !classes.includes(targetClass)) continue;

    if (coughOnly) {
      findings.push({
        kind: "allergy",
        severity: "info",
        title: `${med.drugName} is the usual alternative for an ACE-inhibitor cough`,
        message: `The recorded reaction to ${allergy.allergen} is a dry cough, the well-known ACE-inhibitor class effect. It does not predict a reaction to ${med.drugName}; switching to an ARB is the standard next step, not a cross-reactivity concern.`,
        medicationIds: [med.id],
        drugNames: [med.drugName, allergy.allergen],
      });
      continue;
    }

    findings.push({
      kind: "allergy",
      severity: severeSigns ? "caution" : "info",
      title: severeSigns
        ? "Possible cross-reactivity with an ACE inhibitor/ARB angioedema reaction"
        : `Confirm the nature of the ${allergy.allergen} reaction before prescribing ${med.drugName}`,
      message: severeSigns
        ? `${allergy.allergen} caused ${reaction || "a reaction"}, consistent with angioedema. A small but real proportion of patients with ACE-inhibitor angioedema also react to an ARB. Use with caution and monitor closely in the first weeks; avoid entirely if the original reaction involved the airway or was anaphylactic.`
        : `${allergy.allergen} is recorded as an allergy but the reaction is not described. If it was a dry cough, an ARB is the usual safe alternative; if it was swelling or angioedema, an ARB carries a small risk of recurrence and should be used with caution. Confirm which before prescribing ${med.drugName}.`,
      medicationIds: [med.id],
      drugNames: [med.drugName, allergy.allergen],
    });
  }
  return findings;
}

/** Aspirin ↔ other NSAIDs: a shared COX-1 mechanism, not limited to one drug (classic AERD). */
function aspirinNsaidCrossReactivity(
  allergy: AllergyInput,
  allergenClasses: TherapeuticClass[],
  classifiedMeds: { med: MedicationInput; classes: TherapeuticClass[] }[],
  flaggedMedIds: Set<string>,
): SafetyFinding[] {
  const allergenIsAspirin = ASPIRIN_RE.test(allergy.allergen.toLowerCase());
  const allergenIsOtherNsaid = allergenClasses.includes("nsaid");
  if (!allergenIsAspirin && !allergenIsOtherNsaid) return [];

  const findings: SafetyFinding[] = [];
  for (const { med, classes } of classifiedMeds) {
    if (flaggedMedIds.has(med.id)) continue;
    const medIsAspirin = ASPIRIN_RE.test(med.drugName.toLowerCase());
    const medIsOtherNsaid = classes.includes("nsaid");

    const crosses = (allergenIsAspirin && medIsOtherNsaid) || (allergenIsOtherNsaid && !allergenIsAspirin && medIsAspirin);
    if (!crosses) continue;

    findings.push({
      kind: "allergy",
      severity: "caution",
      title: "Possible cross-reactivity across NSAIDs and aspirin",
      message: `Aspirin and other NSAIDs share the same COX-1 mechanism, so a genuine hypersensitivity reaction to one (as recorded for ${allergy.allergen}) often extends to the whole group, including ${med.drugName}. This is a pharmacological effect, not limited to a single drug. Paracetamol is usually the safer analgesic choice; if aspirin is specifically needed for cardiovascular protection, that decision needs specialist input rather than a routine substitution.`,
      medicationIds: [med.id],
      drugNames: [med.drugName, allergy.allergen],
    });
  }
  return findings;
}

const NON_ANTIBIOTIC_SULFONAMIDE_CLASSES: TherapeuticClass[] = ["thiazide_diuretic", "loop_diuretic", "sulfonylurea"];

/**
 * Corrective note, not a warning: the "sulfa allergy" rule historically used
 * to avoid diuretics/sulfonylureas/celecoxib after an antibiotic sulfonamide
 * reaction is not supported by current evidence — the sulfonamide moiety
 * differs structurally. Surfaced as `info` precisely so it is not mistaken
 * for a reason to withhold an otherwise-indicated medicine.
 */
function sulfonamideCrossReactivityNote(
  allergy: AllergyInput,
  allergenClasses: TherapeuticClass[],
  classifiedMeds: { med: MedicationInput; classes: TherapeuticClass[] }[],
  flaggedMedIds: Set<string>,
): SafetyFinding[] {
  if (!allergenClasses.includes("cotrimoxazole")) return [];

  const findings: SafetyFinding[] = [];
  for (const { med, classes } of classifiedMeds) {
    if (flaggedMedIds.has(med.id)) continue;
    const isCelecoxib = /\bcelecoxib\b/.test(med.drugName.toLowerCase());
    const isNonAntibioticSulfonamide = classes.some((c) => NON_ANTIBIOTIC_SULFONAMIDE_CLASSES.includes(c));
    if (!isCelecoxib && !isNonAntibioticSulfonamide) continue;

    findings.push({
      kind: "allergy",
      severity: "info",
      title: "Sulfonamide antibiotic allergy does not extend to this medicine",
      message: `${allergy.allergen} is a sulfonamide antibiotic. ${med.drugName} also contains a sulfonamide group, but current evidence does not support real cross-reactivity between antibiotic and non-antibiotic sulfonamides; the "sulfa allergy" rule once used to avoid diuretics, sulfonylureas or celecoxib is not well supported. It is reasonable to continue ${med.drugName}; this note exists so it is not withheld on the old rule.`,
      medicationIds: [med.id],
      drugNames: [med.drugName, allergy.allergen],
    });
  }
  return findings;
}

/**
 * Cross-checks a patient's active medications against their recorded
 * allergies. Three tiers, most specific first:
 *
 *   1. LITERAL NAME MATCH — the allergen and a drug name overlap as text.
 *      Catches brand/local names outside the therapeutic-class taxonomy.
 *   2. SAME-CLASS MATCH — the allergen classifies into the same
 *      `TherapeuticClass` as a medication. Downgraded to a caution for
 *      classes known to bundle chemically dissimilar agents (see
 *      `COARSE_ALLERGY_CLASSES`) rather than treated as a confirmed hit.
 *   3. CROSS-FAMILY — known, evidence-scoped cross-reactivity between
 *      related-but-distinct classes (penicillin/cephalosporin, ACE/ARB,
 *      aspirin/NSAID), plus a corrective note for the sulfa-allergy myth.
 *      Only runs for a (allergy, medication) pair not already caught above.
 *
 * Like the rest of this file: a curated, evidence-scoped rule set, not a
 * complete interaction database. A clean result means "no rule fired".
 */
export function assessAllergyFindings(medications: MedicationInput[], allergies: AllergyInput[]): SafetyFinding[] {
  if (medications.length === 0 || allergies.length === 0) return [];

  const classifiedMeds = medications.map((m) => ({ med: m, classes: classifyDrug(m.drugName) }));
  const findings: SafetyFinding[] = [];

  for (const allergy of allergies) {
    if (!allergy.allergen.trim()) continue;
    const allergenClasses = classifyDrug(allergy.allergen);
    const allergenBare = bareAlnum(allergy.allergen);
    const flaggedMedIds = new Set<string>();

    for (const { med, classes } of classifiedMeds) {
      const medBare = bareAlnum(med.drugName);
      const nameMatch =
        allergenBare.length >= MIN_NAME_MATCH_LEN &&
        medBare.length >= MIN_NAME_MATCH_LEN &&
        (medBare.includes(allergenBare) || allergenBare.includes(medBare));

      if (nameMatch) {
        findings.push(exactMatchFinding(allergy, med));
        flaggedMedIds.add(med.id);
        continue;
      }

      const sharedClasses = classes.filter((c) => allergenClasses.includes(c));
      if (sharedClasses.length > 0) {
        for (const cls of sharedClasses) findings.push(classMatchFinding(allergy, med, cls));
        flaggedMedIds.add(med.id);
      }
    }

    findings.push(...penicillinCephalosporinCrossReactivity(allergy, allergenClasses, classifiedMeds, flaggedMedIds));
    findings.push(...aceArbCrossReactivity(allergy, allergenClasses, classifiedMeds, flaggedMedIds));
    findings.push(...aspirinNsaidCrossReactivity(allergy, allergenClasses, classifiedMeds, flaggedMedIds));
    findings.push(...sulfonamideCrossReactivityNote(allergy, allergenClasses, classifiedMeds, flaggedMedIds));
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
            ? `${rule.message} Note this eGFR comes from a creatinine over a year old; recheck before acting on it.`
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

  // ---- 6. Allergy cross-check -----------------------------------------------
  let allergyCheckNote: string | null;
  if (ctx.allergies === undefined) {
    allergyCheckNote =
      "Allergy data was not checked for this report. Load the patient's recorded allergies to switch these checks on.";
  } else if (ctx.allergies.length === 0) {
    allergyCheckNote =
      "No allergies are recorded for this patient. That means none has been recorded, not that the patient is confirmed allergy-free.";
  } else {
    allergyCheckNote = null;
    findings.push(...assessAllergyFindings(medications, ctx.allergies));
  }

  // ---- 7. Pregnancy caveat ---------------------------------------------------
  let pregnancyCheckNote: string | null;
  if (ctx.pregnant === undefined) {
    pregnancyCheckNote =
      "Pregnancy status was not checked for this report. Load the patient's reproductive health profile to switch on pregnancy-related medication warnings.";
  } else if (ctx.pregnant) {
    pregnancyCheckNote =
      "Pregnancy is self-reported by the patient, not clinician-confirmed. Any pregnancy-related warning below reflects that self-report; verify before acting on it, but do not disregard it.";
  } else {
    pregnancyCheckNote = null;
  }

  return {
    findings: dedupeAndRank(findings),
    renalCheckSkipped,
    allergyCheckNote,
    pregnancyCheckNote,
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
