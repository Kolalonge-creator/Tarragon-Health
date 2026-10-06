/**
 * Labels and plain-language hints for the credentialing screens (S15). The states, document kinds and check kinds
 * are the database enums; this file only words them for people. No state logic lives here: which move is allowed
 * is decided by the database (clinician_application_transition_rules), never mirrored in TypeScript.
 */

export type BadgeTone = "red" | "amber" | "blue" | "grey" | "green";

export const APPLICATION_STATE_LABEL: Record<string, string> = {
  started: "Draft",
  documents_submitted: "Submitted",
  checks_in_progress: "Checks in progress",
  training: "Training and test",
  test_passed: "Test passed",
  approved_tier1: "Approved, waiting to go live",
  active: "Active",
  suspended: "Access paused",
  offboarded: "Left the network",
  rejected: "Not approved",
};

export const APPLICATION_STATE_TONE: Record<string, BadgeTone> = {
  started: "grey",
  documents_submitted: "blue",
  checks_in_progress: "blue",
  training: "blue",
  test_passed: "amber",
  approved_tier1: "amber",
  active: "green",
  suspended: "red",
  offboarded: "grey",
  rejected: "red",
};

/** What a person is asked to upload, in the order the form shows it. */
export const DOCUMENT_KINDS: ReadonlyArray<{ kind: string; label: string; hint: string; forContractedOnly?: boolean; optional?: boolean }> = [
  {
    kind: "mdcn_practising_licence",
    label: "Current-year MDCN practising licence",
    hint: "Your annual practising licence for this year, as a PDF or a clear photo. The expiry date must be readable.",
  },
  {
    kind: "mdcn_portal_screenshot",
    label: "Screenshot of your MDCN portal page",
    hint: "A screenshot taken after you sign in to your own MDCN portal account, showing your name and folio number.",
  },
  {
    kind: "graduation_certificate",
    label: "Graduation licence or medical degree certificate",
    hint: "The certificate from your medical school.",
  },
  {
    kind: "nysc_certificate",
    label: "NYSC discharge or exemption certificate",
    hint: "Your NYSC certificate.",
  },
  { kind: "government_id", label: "Government ID", hint: "A valid government photo ID." },
  { kind: "cv", label: "CV", hint: "Your current CV." },
  {
    kind: "indemnity_certificate",
    label: "Professional indemnity certificate",
    hint: "Your certificate showing the insurer, policy number, cover limit and expiry date. Freelance clinicians need their own cover.",
    forContractedOnly: true,
  },
  {
    kind: "mdcn_confirmation",
    label: "Written confirmation from MDCN",
    hint: "If MDCN wrote to confirm your registration, add it here. This is optional.",
    optional: true,
  },
];

export const DOCUMENT_KIND_LABEL: Record<string, string> = Object.fromEntries(DOCUMENT_KINDS.map((d) => [d.kind, d.label]));

export const CHECK_KIND_LABEL: Record<string, string> = {
  licence: "MDCN licence",
  qualifications: "Qualifications and NYSC",
  identity: "Identity",
  practice_years: "Practice after house job",
  referee_1: "Referee 1",
  referee_2: "Referee 2",
};

/** What the reviewer is expected to have done, shown beside each check. */
export const CHECK_KIND_HINT: Record<string, string> = {
  licence:
    "Compare the current-year licence and the portal screenshot with the folio number. Confirm with MDCN where you can. Enter the expiry date printed on the licence.",
  qualifications: "Check the graduation certificate and the NYSC certificate belong to this person.",
  identity: "Check the government ID matches the name on the licence.",
  practice_years: "Confirm the years of practice after house job meet the minimum.",
  referee_1: "Reach the referee through an independently sourced institutional contact, then have them confirm back.",
  referee_2: "Reach the referee through an independently sourced institutional contact, then have them confirm back.",
};

export const MISSING_LABEL: Record<string, string> = {
  mdcn_folio: "MDCN folio number",
  qualification: "Qualification",
  years_since_house_job: "Years of practice after house job",
  languages: "Languages you speak",
  conflicts_declaration: "Conflicts of interest declaration",
  referees: "Two referees",
  referee_details: "Each referee's name, institution and a phone number or email",
  indemnity_details: "Indemnity insurer, policy number and a future expiry date",
};

export function missingLabel(item: string): string {
  if (item.startsWith("document:")) {
    const kind = item.slice("document:".length);
    return DOCUMENT_KIND_LABEL[kind] ?? kind;
  }
  return MISSING_LABEL[item] ?? item;
}

export const COMPETENCY_LABEL: Record<string, string> = {
  adult_general: "Adult general care",
  hypertension: "Hypertension",
  diabetes: "Diabetes",
  result_review: "Result review",
  prescribing: "Prescribing",
  on_call: "On call",
  lead_clinician: "Lead clinician",
};

export const COMPETENCY_CODES = Object.keys(COMPETENCY_LABEL);

export const BLOCKER_LABEL: Record<string, string> = {
  not_yet_activated: "Not switched on yet",
  licence_expired: "Your MDCN licence has expired",
  indemnity_expired: "Your indemnity cover has expired",
  "status:suspended": "Your access is paused",
  "status:offboarded": "You have left the network",
};

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "Not recorded";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Not recorded";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
}
