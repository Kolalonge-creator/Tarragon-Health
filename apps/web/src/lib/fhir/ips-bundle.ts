import type { FhirMapping, IpsMapping, IpsSectionKey } from "./config";
import { buildFhirBundle, type FhirOut } from "./export-bundle";
import type { ExportSnapshot } from "./export-snapshot";

/**
 * Builds an International Patient Summary shaped FHIR R4 document Bundle (spec 2.10; docs/design/IPS.md) from the SAME export snapshot the
 * collection export uses. Pure: no database, no network.
 *
 * What this is and is not:
 *   - It is IPS-SHAPED: a Bundle of type `document` whose first entry is a Composition (LOINC 60591-5) with the IPS sections (problems, allergies,
 *     medicines, immunizations, results, vital signs) and a Patient. It does NOT claim conformance to the IPS implementation guide or to any
 *     Nigeria Core profile: both are still being balloted or drafted, so `meta.profile` is only written when a later configuration version lists
 *     one (the mapping's `profiles`, empty today). Nothing here has been run through the HAPI validator.
 *   - It never widens the snapshot. Access rules (consent, categories, released-only results, no reproductive or mental health sections, no private
 *     notes) were applied by `fhir_export_snapshot` before this function sees anything. Documents are dropped here as well: the IPS has no
 *     documents section and a bare file reference with no file is not a summary.
 *   - A required section with nothing in it is written with `emptyReason` "unavailable" (not recorded here). It is never "nil known": we cannot
 *     say a person has no known allergies, only that none are recorded with us.
 *   - Wearable values keep the estimate tag and note the collection export gives them. Units are the stored units (see units.ts).
 */

export interface IpsSectionSummary {
  key: IpsSectionKey;
  title: string;
  loinc: string;
  required: boolean;
  /** Plain-language lines, one per resource, the same text the document's own narrative carries. */
  lines: string[];
  /** True when the section is in the document but holds no entries (required sections only). */
  empty: boolean;
  /** True when the section was not given to this reader (not the same as nothing recorded). */
  withheld: boolean;
}

export interface IpsResult {
  bundle: FhirOut;
  sections: IpsSectionSummary[];
  skipped: { kind: string; id: string; reason: string }[];
  /** Older readings and results left out to keep the summary short. */
  trimmed: number;
  resourceCount: number;
  documentId: string;
}

const XHTML = "http://www.w3.org/1999/xhtml";

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function div(lines: string[], fallback: string): FhirOut {
  const body = lines.length > 0 ? `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : `<p>${esc(fallback)}</p>`;
  return { status: "generated", div: `<div xmlns="${XHTML}">${body}</div>` };
}

const LAGOS_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" });

/** A calendar day. A date-only value is kept as it is; a timestamp is shown as the Lagos day (Africa/Lagos), not the UTC one. */
function day(value: unknown): string {
  if (typeof value !== "string" || value.length < 10) return "";
  if (value.length === 10) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value.slice(0, 10) : LAGOS_DAY.format(d);
}

function quantityText(q: unknown): string {
  const x = q as { value?: number; unit?: string } | undefined;
  if (!x || x.value == null) return "";
  return x.unit ? `${x.value} ${x.unit}` : String(x.value);
}

function codeText(code: unknown): string {
  const c = code as { text?: string; coding?: { display?: string; code?: string }[] } | undefined;
  const raw = c?.text ?? c?.coding?.[0]?.display ?? c?.coding?.[0]?.code ?? "Item";
  // a lab analyte with no display carries Tarragon's own code (ldl_cholesterol): say it in words
  const words = raw.includes("_") ? raw.replace(/_/g, " ") : raw;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One plain-language line for a resource. Exported so the "what is inside" page shows exactly what the document says. */
export function describeIpsResource(r: FhirOut, dataQualitySystem: string): string {
  switch (r.resourceType) {
    case "Condition": {
      const status = (r.clinicalStatus as { coding?: { code?: string }[] } | undefined)?.coding?.[0]?.code;
      const unconfirmed = (r.verificationStatus as { coding?: { code?: string }[] } | undefined)?.coding?.[0]?.code === "unconfirmed";
      const onset = day(r.onsetDateTime);
      return [codeText(r.code), unconfirmed ? "(not confirmed)" : "", status && status !== "active" ? `(${status})` : "", onset ? `since ${onset}` : ""].filter(Boolean).join(" ");
    }
    case "AllergyIntolerance": {
      const reaction = (r.reaction as { manifestation?: { text?: string }[]; severity?: string }[] | undefined)?.[0];
      const detail = [reaction?.manifestation?.[0]?.text, reaction?.severity].filter(Boolean).join(", ");
      const unverified = (r.verificationStatus as { coding?: { code?: string }[] } | undefined)?.coding?.[0]?.code === "unconfirmed";
      return `${codeText(r.code)}${detail ? `: ${detail}` : ""}${unverified ? " (not verified)" : ""}`;
    }
    case "MedicationStatement": {
      const dose = (r.dosage as { text?: string }[] | undefined)?.[0]?.text;
      const status = r.status === "active" ? "" : ` (${String(r.status)})`;
      return `${codeText(r.medicationCodeableConcept)}${dose ? `, ${dose}` : ""}${status}`;
    }
    case "Immunization": {
      const dose = (r.protocolApplied as { doseNumberPositiveInt?: number }[] | undefined)?.[0]?.doseNumberPositiveInt;
      return [codeText(r.vaccineCode), dose != null ? `dose ${dose}` : "", day(r.occurrenceDateTime)].filter(Boolean).join(", ");
    }
    case "Observation": {
      const when = day(r.effectiveDateTime);
      const tags = ((r.meta as { tag?: { system?: string; code?: string }[] } | undefined)?.tag ?? []);
      const estimate = tags.some((t) => t.system === dataQualitySystem && t.code === "estimate") ? " (estimate from a wearable)" : "";
      const comps = r.component as { valueQuantity?: { value?: number; unit?: string } }[] | undefined;
      let value = "";
      if (comps && comps.length === 2) {
        value = `${comps[0]?.valueQuantity?.value}/${comps[1]?.valueQuantity?.value} ${comps[0]?.valueQuantity?.unit ?? ""}`.trim();
      } else if (r.valueQuantity) {
        value = quantityText(r.valueQuantity);
      } else if (r.valueCodeableConcept) {
        value = codeText(r.valueCodeableConcept);
      }
      // an abnormal flag and the reference range stand in the text too: a printed copy has no structured fields
      const interp = (r.interpretation as { coding?: { code?: string; display?: string }[] }[] | undefined)?.[0]?.coding?.[0];
      const flag = interp?.display && interp.code && !["N", "NEG"].includes(interp.code) ? ` (${interp.display.toLowerCase()})` : "";
      const range = (r.referenceRange as { low?: { value?: number }; high?: { value?: number } }[] | undefined)?.[0];
      const lo = range?.low?.value;
      const hi = range?.high?.value;
      const rangeText = lo != null && hi != null ? ` (reference ${lo} to ${hi})` : lo != null ? ` (reference ${lo} or more)` : hi != null ? ` (reference up to ${hi})` : "";
      return `${codeText(r.code)}: ${value}${flag}${rangeText}${estimate}${when ? `, ${when}` : ""}`;
    }
    default:
      return codeText((r as { code?: unknown }).code);
  }
}

function categoryCode(r: FhirOut): string | undefined {
  return (r.category as { coding?: { code?: string }[] }[] | undefined)?.[0]?.coding?.[0]?.code;
}

function sectionOf(r: FhirOut): IpsSectionKey | null {
  switch (r.resourceType) {
    case "Condition":
      return "problems";
    case "AllergyIntolerance":
      return "allergies";
    case "MedicationStatement":
      return "medications";
    case "Immunization":
      return "immunizations";
    case "Observation":
      return categoryCode(r) === "laboratory" ? "results" : "vital_signs";
    default:
      return null; // Patient is placed separately; DocumentReference has no IPS section
  }
}

/** Which snapshot section feeds each IPS section: a section missing from `sections_included` was not given to this reader. */
const SNAPSHOT_SECTION: Record<IpsSectionKey, string> = {
  problems: "conditions",
  allergies: "allergies",
  medications: "medications",
  immunizations: "immunizations",
  results: "lab_results",
  vital_signs: "vitals",
};

/** Newest `limit` rows per key. Pure; the input order is not assumed. */
function newestPer<T>(rows: T[] | undefined, keyOf: (r: T) => string, whenOf: (r: T) => string, limit: number): { kept: T[] | undefined; trimmed: number } {
  if (!rows) return { kept: rows, trimmed: 0 };
  const groups = new Map<string, T[]>();
  for (const r of rows) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
  const kept: T[] = [];
  for (const list of groups.values()) kept.push(...[...list].sort((a, b) => whenOf(b).localeCompare(whenOf(a))).slice(0, limit));
  return { kept: kept.sort((a, b) => whenOf(b).localeCompare(whenOf(a))), trimmed: rows.length - kept.length };
}

export function buildIpsBundle(
  snapshot: ExportSnapshot,
  mapping: FhirMapping,
  ips: IpsMapping,
  options: { documentId?: string } = {}
): IpsResult {
  // A summary is short: the newest readings of each kind and the newest results of each test. Documents are never part of it.
  const vitals = newestPer(snapshot.vitals, (v) => v.vital_type, (v) => v.taken_at, ips.vitals_per_type);
  const labs = newestPer(snapshot.lab_results, (r) => r.code, (r) => r.taken_at ?? "", ips.results_per_analyte);
  const base = buildFhirBundle({ ...snapshot, documents: undefined, vitals: vitals.kept, lab_results: labs.kept }, mapping);
  const trimmed = vitals.trimmed + labs.trimmed;
  const baseUrl = mapping.base_url.replace(/\/$/, "");
  const documentId = options.documentId ?? globalThis.crypto.randomUUID();
  const authorId = "tarragon-health";
  const qualitySystem = mapping.systems.data_quality;

  const entries = (base.bundle.entry as { fullUrl: string; resource: FhirOut }[]) ?? [];
  const patientEntry = entries.find((e) => e.resource.resourceType === "Patient");
  const bySection = new Map<IpsSectionKey, { fullUrl: string; resource: FhirOut }[]>();
  for (const e of entries) {
    const key = sectionOf(e.resource);
    if (!key) continue;
    const list = bySection.get(key) ?? [];
    list.push(e);
    bySection.set(key, list);
  }

  const summaries: IpsSectionSummary[] = [];
  const compositionSections: FhirOut[] = [];
  const bodyEntries: { fullUrl: string; resource: FhirOut }[] = [];
  const emptyFallback = "Nothing is recorded here. This does not mean there is nothing to record.";
  const withheldFallback = "This part of the record was not shared with whoever made this summary, so it is not shown here. This does not mean there is nothing to record.";
  for (const def of ips.sections) {
    const list = bySection.get(def.key) ?? [];
    // a section the database did not give this reader (a supporter without that category) is withheld, never "nothing recorded"
    const withheld = list.length === 0 && !snapshot.sections_included.includes(SNAPSHOT_SECTION[def.key]);
    if (list.length === 0 && !def.required && !withheld) continue; // an optional section with nothing in it is left out
    const lines = list.map((e) => describeIpsResource(e.resource, qualitySystem));
    const section: FhirOut = {
      title: def.title,
      code: { coding: [{ system: ips.composition_type.system, code: def.loinc, display: def.display }] },
      text: div(lines, withheld ? withheldFallback : emptyFallback),
    };
    if (list.length > 0) {
      section.entry = list.map((e) => ({ reference: `${String(e.resource.resourceType)}/${String(e.resource.id)}` }));
    } else {
      section.emptyReason = { coding: [{ system: ips.empty_reason_system, code: withheld ? ips.withheld_reason_code : ips.empty_reason_code }] };
    }
    compositionSections.push(section);
    bodyEntries.push(...list);
    summaries.push({ key: def.key, title: def.title, loinc: def.loinc, required: def.required, lines, empty: list.length === 0, withheld });
  }

  const leftOut = snapshot.excluded_domains.map((x) => x.replace(/_/g, " "));
  const composition: FhirOut = {
    resourceType: "Composition",
    id: documentId,
    status: ips.composition_status,
    type: { coding: [ips.composition_type] },
    subject: { reference: `Patient/${snapshot.patient.id}` },
    date: snapshot.generated_at,
    author: [{ reference: `Organization/${authorId}` }],
    title: ips.title,
    custodian: { reference: `Organization/${authorId}` },
    text: div(
      [
        "Made by the person from their Tarragon Health record. Not checked or signed by a clinician.",
        "Not included: private notes and documents. There is no separate reproductive health or mental health section, but items inside the other sections are not sorted by what they are for, so read this before you use it.",
        ...(leftOut.length > 0 ? [`Withheld for this reader: ${leftOut.join(", ")}.`] : []),
        "Released laboratory results only. Only the most recent readings and results are included. Readings from a consumer wearable are estimates.",
      ],
      ""
    ),
    section: compositionSections,
  };
  const profile = ips.profiles.Composition;
  if (profile && profile.length > 0) composition.meta = { profile };

  const author: FhirOut = { resourceType: "Organization", id: authorId, name: ips.author_name };

  const entry = (resource: FhirOut): { fullUrl: string; resource: FhirOut } => ({
    fullUrl: `${baseUrl}/${String(resource.resourceType)}/${String(resource.id)}`,
    resource: JSON.parse(JSON.stringify(resource)) as FhirOut,
  });

  const bundle: FhirOut = {
    resourceType: "Bundle",
    type: "document",
    identifier: { system: ips.document_identifier_system, value: documentId },
    timestamp: snapshot.generated_at,
    meta: base.bundle.meta,
    entry: [entry(composition), ...(patientEntry ? [patientEntry] : []), entry(author), ...bodyEntries],
  };
  return { bundle, sections: summaries, skipped: base.skipped, trimmed, resourceCount: bodyEntries.length, documentId };
}
