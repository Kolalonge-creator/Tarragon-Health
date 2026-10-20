import { fileNameFor, playable, type Catalogue, type PlayableResult } from "./manifest";
import type { Manifest, ManifestClip, ManifestGroup } from "./types";

/**
 * S46d: audio hooks for result explanations and the yearly Health Report read-through (group RPT).
 *
 * NO AUDIO IS RECORDED OR GENERATED HERE. Every entry is a DRAFT slot: "not recorded" (no checksum, size or approvals), clinical (so a recording needs the
 * CMO's sign-off as well as brand review), on demand (low data). `withReportClips` is what the production-list import adds to audio/manifest.json when the
 * wording is signed and recordings are commissioned, the same route the therapy session clips (THP) take. Until a recording exists and carries every
 * review, `reportAudioFor` answers "use the text".
 *
 * INV-04: HIV, hepatitis B surface antigen and hepatitis C antibody results (and anything that merely looks like a blood-borne or sexual-health test) are
 * never explained by recorded audio. They have NO slot: `reportAudioClipId` returns null for them, and `reportAudioFor` answers `sensitive_never`, however
 * the manifest is edited. The pattern below mirrors public.report_excluded_code in the database; a test pins the two together.
 */
export const REPORT_GROUP = "RPT";

export const REPORT_GROUP_META: ManifestGroup = {
  title: "Yearly report read-through and result explanations (draft slots)",
  bundle_group: "on_demand",
  reaches_phone: "Download on demand",
  review: "Clinical sign-off required (Chief Medical Officer); no wording is approved and nothing is recorded yet",
};

/** The report sections that can have a read-through clip, in report order. */
export const REPORT_READ_THROUGH_SECTIONS = ["summary", "priorities", "bp", "labs", "retest", "cannot_tell", "emergency"] as const;
export type ReportReadThroughSection = (typeof REPORT_READ_THROUGH_SECTIONS)[number];

/** Result explanations are by outcome, never by analyte, so there is no way to point a clip at a particular virus test. */
export const RESULT_EXPLANATION_OUTCOMES = ["normal", "low", "high"] as const;
export type ResultExplanationOutcome = (typeof RESULT_EXPLANATION_OUTCOMES)[number];

const SECTION_ID: Record<ReportReadThroughSection, string> = {
  summary: "RPT-001",
  priorities: "RPT-002",
  bp: "RPT-003",
  labs: "RPT-004",
  retest: "RPT-005",
  cannot_tell: "RPT-006",
  emergency: "RPT-007",
};
const OUTCOME_ID: Record<ResultExplanationOutcome, string> = { normal: "RPT-101", low: "RPT-102", high: "RPT-103" };

/** Mirror of public.report_excluded_code: the sensitive list plus anything that looks like a blood-borne or sexual-health test. */
export const REPORT_AUDIO_EXCLUDED_PATTERN = /(^|[^a-z])(hiv|hbsag|hbs_ag|hcv|hbv|hep_b|hep_c|hepatitis|syphilis|chlamydia|gonorrh|anti_hbs)/;
const SENSITIVE_CODES: ReadonlySet<string> = new Set([
  "hiv", "hiv_screen", "hiv_ab_ag", "hiv_antibody", "hep_b", "hbsag", "hbs_ag", "hbv_surface_antigen", "hep_c", "hcv_ab", "anti_hcv", "hcv_antibody",
]);

export function isReportAudioExcludedCode(code: string): boolean {
  const c = code.trim().toLowerCase();
  return SENSITIVE_CODES.has(c) || REPORT_AUDIO_EXCLUDED_PATTERN.test(c);
}

export type ReportAudioTarget =
  | { readonly kind: "section"; readonly section: ReportReadThroughSection }
  | { readonly kind: "result"; readonly analyteCode: string; readonly outcome: ResultExplanationOutcome; readonly sensitivePositive?: boolean };

/** The slot id for a target, or null when none may exist (a sensitive or sensitive-looking analyte, a flagged sensitive positive). */
export function reportAudioClipId(target: ReportAudioTarget): string | null {
  if (target.kind === "section") return SECTION_ID[target.section] ?? null;
  if (target.sensitivePositive || isReportAudioExcludedCode(target.analyteCode)) return null;
  return OUTCOME_ID[target.outcome] ?? null;
}

/** One draft, unrecorded, clinical clip per slot. */
export function reportClips(): ManifestClip[] {
  return [...Object.values(SECTION_ID), ...Object.values(OUTCOME_ID)].map((id): ManifestClip => ({
    id,
    group: REPORT_GROUP,
    bundle_group: "on_demand",
    release: 3,
    clinical: true,
    legal: false,
    language_neutral: false,
    files: { en: { file: fileNameFor(id, "en"), sha256: null, bytes: null, duration_ms: null, approvals: [], history: [] } },
    script_hash: null,
  }));
}

/** A manifest with the report slots added (when not already there). The input is not changed. */
export function withReportClips(manifest: Manifest): Manifest {
  const have = new Set(manifest.clips.map((c) => c.id));
  const add = reportClips().filter((c) => !have.has(c.id));
  return { ...manifest, groups: { ...manifest.groups, [REPORT_GROUP]: REPORT_GROUP_META }, clips: [...manifest.clips, ...add] };
}

export type ReportAudioResult = PlayableResult | { readonly ok: false; readonly reason: "sensitive_never" };

/** May this part of a report, or this result's explanation, play as audio? Anything but a signed, recorded, matching clip means use the text. */
export function reportAudioFor(catalogue: Catalogue, target: ReportAudioTarget): ReportAudioResult {
  if (target.kind === "result" && (target.sensitivePositive || isReportAudioExcludedCode(target.analyteCode))) return { ok: false, reason: "sensitive_never" };
  const id = reportAudioClipId(target);
  if (!id) return { ok: false, reason: "no_recording" };
  const clip = catalogue.get(id);
  if (!clip) return { ok: false, reason: "no_recording" };
  return playable(clip, "en");
}
