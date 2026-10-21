import { getProposedConfig, PROPOSED_CONFIG } from "@tarragon/shared";
import { z } from "zod";

/**
 * The records request letter (docs/design/RRL.md). The wording is versioned PROPOSED configuration (`records_request.letter`), UNSIGNED PLACEHOLDER
 * text pending counsel, and the reply period is `records_request.response_days`. Nothing in this file contains letter wording: it only fills the
 * configured text with the person's own details. The platform never sends the letter; the person prints it, hands it over or sends it themselves.
 */
export const SCOPE_CODES = ["discharge_summary", "lab_results", "imaging_report", "whole_record"] as const;
export type ScopeCode = (typeof SCOPE_CODES)[number];

const letterSchema = z.object({
  wording_status: z.string(),
  title: z.string(),
  greeting: z.string(),
  intro: z.string(),
  identity_heading: z.string(),
  identity_labels: z.object({ name: z.string(), date_of_birth: z.string(), phone: z.string() }),
  fill_in: z.array(z.string()),
  scope_heading: z.string(),
  scopes: z.object({
    discharge_summary: z.string(),
    lab_results: z.string(),
    imaging_report: z.string(),
    whole_record: z.string(),
  }),
  format: z.string(),
  timing: z.string(),
  closing: z.string(),
  sign_off: z.string(),
  footer: z.string(),
  draft_notice: z.string().optional(),
});

const daysSchema = z.object({ days: z.number().int().min(1).max(180), label: z.string() });

export type LetterConfig = z.infer<typeof letterSchema>;

export interface LoadedLetterConfig {
  letter: LetterConfig;
  /** The key the request row stores, so a printed letter can always be traced to its wording version. */
  letterVersionKey: string;
  wordingSigned: boolean;
  responseDays: number;
}

/**
 * The wording version a request was made with. A row stores `records_request.letter@N`, and re-printing it uses that same version, so the paper in
 * a facility's hands and the app agree even after counsel publishes a newer one. Returns null for a key that names no version.
 */
export function loadLetterConfigForVersion(versionKey: string): LoadedLetterConfig | null {
  const m = /^records_request\.letter@([0-9]+)$/.exec(versionKey);
  if (!m) return null;
  const version = Number(m[1]);
  const entry = PROPOSED_CONFIG.find((e) => e.key === "records_request.letter" && e.version === version);
  if (!entry) return null;
  const d = getProposedConfig("records_request.response_days");
  return {
    letter: letterSchema.parse(entry.value),
    letterVersionKey: versionKey,
    wordingSigned: entry.status === "confirmed",
    responseDays: daysSchema.parse(d.value).days,
  };
}

export function loadLetterConfig(asOf?: string): LoadedLetterConfig {
  const l = getProposedConfig("records_request.letter", asOf);
  const d = getProposedConfig("records_request.response_days", asOf);
  return {
    letter: letterSchema.parse(l.value),
    letterVersionKey: `records_request.letter@${l.version}`,
    // an agent never confirms wording: only a version published as confirmed counts as signed
    wordingSigned: l.status === "confirmed",
    responseDays: daysSchema.parse(d.value).days,
  };
}

export interface LetterInput {
  facilityName: string;
  scopes: readonly ScopeCode[];
  /** ISO date (yyyy-mm-dd) the letter is dated. */
  letterDate: string;
  /** Days after which the person follows up (the configured reminder period). */
  followUpDays: number;
  /** True while the wording is not a confirmed version: the letter then carries the configured draft notice. */
  draft: boolean;
  patient: { fullName: string; dateOfBirth: string | null; phone: string | null };
}

export interface BuiltLetter {
  title: string;
  dateLine: string;
  greeting: string;
  intro: string;
  identityHeading: string;
  identityLines: string[];
  /** Blank lines the person fills in by hand. */
  fillInLines: string[];
  scopeHeading: string;
  scopeLines: string[];
  format: string;
  timing: string;
  closing: string;
  signOff: string;
  signatureLine: string;
  footer: string;
  /** Set only while the wording is unsigned. */
  draftNotice: string | null;
}

const LONG_DATE = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "long", year: "numeric" });

/** `yyyy-mm-dd` (a calendar day, not an instant) as "4 November 2026". */
export function longDate(isoDay: string): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  if (!y || !m || !d) return isoDay;
  return LONG_DATE.format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** Today in Africa/Lagos as yyyy-mm-dd. */
export function lagosToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(isoDay: string, days: number): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  const t = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days, 12));
  return t.toISOString().slice(0, 10);
}

export function buildLetter(config: LetterConfig, input: LetterInput): BuiltLetter {
  const scopeLines = SCOPE_CODES.filter((c) => input.scopes.includes(c)).map((c) => config.scopes[c]);
  const labels = config.identity_labels;
  const identityLines = [`${labels.name}: ${input.patient.fullName}`];
  if (input.patient.dateOfBirth) identityLines.push(`${labels.date_of_birth}: ${longDate(input.patient.dateOfBirth)}`);
  if (input.patient.phone) identityLines.push(`${labels.phone}: ${input.patient.phone}`);
  return {
    title: config.title,
    dateLine: longDate(input.letterDate),
    greeting: config.greeting.replace("{facility}", input.facilityName),
    intro: config.intro,
    identityHeading: config.identity_heading,
    identityLines,
    // what the profile does not hold is left as a blank for the person to write in, never printed as an empty value
    fillInLines: [
      ...config.fill_in,
      ...(input.patient.dateOfBirth ? [] : [`${labels.date_of_birth}:`]),
      ...(input.patient.phone ? [] : [`${labels.phone}:`]),
    ],
    scopeHeading: config.scope_heading,
    scopeLines,
    format: config.format,
    timing: config.timing.replace("{days}", String(input.followUpDays)),
    closing: config.closing,
    signOff: config.sign_off,
    signatureLine: input.patient.fullName,
    footer: config.footer,
    draftNotice: input.draft ? config.draft_notice ?? null : null,
  };
}

/** A request is overdue when it was handed over and its date has passed. Mirrors `my_records_requests().is_overdue`. */
export function isOverdue(row: { state: string; due_at: string | null }, now: Date = new Date()): boolean {
  return row.state === "sent" && row.due_at != null && new Date(row.due_at).getTime() < now.getTime();
}
