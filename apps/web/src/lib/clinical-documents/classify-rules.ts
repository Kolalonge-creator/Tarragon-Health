/**
 * The deterministic first pass of document classification (clinical document engine step 4, design §7): words in the file name and
 * the patient's own note that name one kind of document unambiguously.
 *
 * A rule only ever SUGGESTS. On its own it pre-selects the answer to the patient's "What is this?" question; it is applied without
 * asking only when AI-024 independently suggests the same pipeline (see classify-run.ts). File names are weak evidence ("scan.pdf",
 * "IMG_2041.jpg"), so generic words are deliberately absent, and two rules that point at different kinds cancel each other out.
 */

export interface RuleMatch {
  readonly kindCode: string;
  readonly ruleId: string;
}

interface Rule {
  readonly id: string;
  readonly kindCode: string;
  readonly pattern: RegExp;
}

// Word-bounded, case-insensitive. Separators in file names (_ - .) count as word breaks because they are normalised to spaces first.
const RULES: readonly Rule[] = [
  { id: "ecg", kindCode: "cardiology.ecg", pattern: /\b(ecg|ekg|electrocardiogram|12 lead)\b/ },
  { id: "echo", kindCode: "cardiology.echo", pattern: /\b(echo|echocardiogram|echocardiography)\b/ },
  { id: "holter", kindCode: "cardiology.holter", pattern: /\bholter\b/ },
  { id: "mammogram", kindCode: "imaging.mammography", pattern: /\b(mammogram|mammography|birads|bi rads)\b/ },
  { id: "xray", kindCode: "imaging.xray", pattern: /\b(x ray|xray|cxr|radiograph)\b/ },
  { id: "mri", kindCode: "imaging.mri", pattern: /\bmri\b/ },
  { id: "ct", kindCode: "imaging.ct", pattern: /\b(ct scan|ct abdomen|ct chest|ct head|computed tomography)\b/ },
  { id: "obstetric_scan", kindCode: "imaging.ultrasound.obstetric", pattern: /\b(obstetric scan|obstetric ultrasound|anomaly scan|dating scan)\b/ },
  { id: "pelvic_scan", kindCode: "imaging.ultrasound.pelvic", pattern: /\b(pelvic scan|pelvic ultrasound|transvaginal)\b/ },
  { id: "abdominal_scan", kindCode: "imaging.ultrasound.abdomen", pattern: /\b(abdominal scan|abdominal ultrasound|abdominopelvic)\b/ },
  { id: "breast_scan", kindCode: "imaging.ultrasound.breast", pattern: /\bbreast (scan|ultrasound)\b/ },
  { id: "pap", kindCode: "screening.cervical", pattern: /\b(pap smear|pap test|cervical smear|cervical screening|liquid based cytology)\b/ },
  { id: "hpv", kindCode: "screening.hpv", pattern: /\bhpv\b/ },
  { id: "psa", kindCode: "screening.prostate", pattern: /\bpsa\b/ },
  { id: "histology", kindCode: "lab.histopathology", pattern: /\b(histology|histopathology|biopsy)\b/ },
  { id: "fbc", kindCode: "lab.haematology", pattern: /\b(fbc|cbc|full blood count|complete blood count|haemogram|hemogram)\b/ },
  { id: "chemistry", kindCode: "lab.biochemistry", pattern: /\b(hba1c|lipid profile|lipid panel|lft|liver function|kft|renal function|electrolytes|e u cr|eucr)\b/ },
  { id: "urinalysis", kindCode: "lab.urinalysis", pattern: /\b(urinalysis|urine test|urine analysis)\b/ },
  { id: "thyroid", kindCode: "lab.endocrinology", pattern: /\b(thyroid function|tft)\b/ },
  { id: "discharge", kindCode: "reports.discharge", pattern: /\bdischarge (summary|letter|note)\b/ },
  { id: "endoscopy", kindCode: "reports.endoscopy", pattern: /\b(endoscopy|gastroscopy|ogd)\b/ },
  { id: "colonoscopy", kindCode: "reports.colonoscopy", pattern: /\bcolonoscopy\b/ },
];

export function normaliseForRules(text: string): string {
  return text
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/, " ") // a file extension
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * One kind, or null when nothing matches or the matches disagree. Two rules for kinds in the same branch (for example "fbc" and
 * "hba1c": both lab) resolve to that branch's lab root only when they share a pipeline-level parent; otherwise null.
 */
export function classifyByRules(fileName: string | null, note: string | null): RuleMatch | null {
  const text = normaliseForRules(`${fileName ?? ""} ${note ?? ""}`);
  if (!text) return null;
  const hits = RULES.filter((r) => r.pattern.test(text));
  if (hits.length === 0) return null;
  const kinds = new Set(hits.map((h) => h.kindCode));
  if (kinds.size === 1) return { kindCode: hits[0]!.kindCode, ruleId: hits.map((h) => h.id).join("+") };
  // Several lab sections on one report (a full blood count with an HbA1c) is still a lab report.
  if ([...kinds].every((k) => k.startsWith("lab.") && k !== "lab.histopathology" && k !== "lab.cytology")) {
    return { kindCode: "lab", ruleId: hits.map((h) => h.id).join("+") };
  }
  return null;
}

/** The pipeline-level group a kind belongs to (its root code), for comparing a rule with the model. */
export function kindRoot(code: string): string {
  return code.split(".")[0] ?? code;
}
