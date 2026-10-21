import { describe, expect, it } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadFhirMapping, loadIpsMapping } from "./config";
import type { FhirOut } from "./export-bundle";
import { buildIpsBundle } from "./ips-bundle";
import { fixtureSnapshot } from "./test-fixtures";
import { fhirBundleSchema } from "@/lib/integrations/fhir/bundle-schema";
import { parseFhirResourceEntry } from "@/lib/integrations/fhir/parse-resource";

const { mapping } = loadFhirMapping();
const { ips, version } = loadIpsMapping();
const DOC_ID = "12345678-1234-4234-8234-123456789012";

type Entry = { fullUrl: string; resource: FhirOut };
const entriesOf = (b: FhirOut): Entry[] => b.entry as Entry[];
const resourcesOf = (b: FhirOut, type: string): FhirOut[] => entriesOf(b).map((e) => e.resource).filter((r) => r.resourceType === type);

function allReferences(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => allReferences(n, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "reference" && typeof v === "string") out.push(v);
      else allReferences(v, out);
    }
  }
  return out;
}

describe("buildIpsBundle: structure", () => {
  const out = buildIpsBundle(fixtureSnapshot(), mapping, ips, { documentId: DOC_ID });
  const bundle = out.bundle;

  it("is a Bundle of type document whose first entry is the Composition, with an identifier and a timestamp", () => {
    expect(bundle.resourceType).toBe("Bundle");
    expect(bundle.type).toBe("document");
    expect(bundle.identifier).toEqual({ system: ips.document_identifier_system, value: DOC_ID });
    expect(bundle.timestamp).toBe("2026-10-07T09:00:00+00:00");
    expect(entriesOf(bundle)[0]?.resource.resourceType).toBe("Composition");
  });

  it("types the Composition as a patient summary (LOINC 60591-5) and makes it preliminary, not clinician-signed", () => {
    const c = entriesOf(bundle)[0]?.resource as FhirOut;
    expect(c.type).toEqual({ coding: [{ system: "http://loinc.org", code: "60591-5", display: "Patient summary Document" }] });
    expect(c.status).toBe("preliminary");
    expect(c.title).toBe("International Patient Summary");
    expect(c.subject).toEqual({ reference: "Patient/11111111-1111-4111-8111-111111111111" });
    expect(resourcesOf(bundle, "Patient")).toHaveLength(1);
  });

  it("carries the six IPS sections in the configured order, each with its LOINC code, a title and a narrative", () => {
    const c = entriesOf(bundle)[0]?.resource as FhirOut;
    const sections = c.section as { title: string; code: { coding: { code: string }[] }; text: { div: string }; entry?: { reference: string }[] }[];
    expect(sections.map((s) => s.code.coding[0]?.code)).toEqual(["11450-4", "48765-2", "10160-0", "11369-6", "30954-2", "8716-3"]);
    expect(sections.map((s) => s.title)).toEqual(["Problems", "Allergies and intolerances", "Medicines", "Immunizations", "Results", "Vital signs"]);
    for (const s of sections) {
      expect(s.text.div.startsWith('<div xmlns="http://www.w3.org/1999/xhtml">')).toBe(true);
      expect(s.entry?.length).toBeGreaterThan(0);
    }
  });

  it("puts each resource in the right section", () => {
    const c = entriesOf(bundle)[0]?.resource as FhirOut;
    const sections = c.section as { code: { coding: { code: string }[] }; entry: { reference: string }[] }[];
    const typesIn = (loinc: string): string[] => [...new Set(sections.find((s) => s.code.coding[0]?.code === loinc)?.entry.map((e) => e.reference.split("/")[0] as string))];
    expect(typesIn("11450-4")).toEqual(["Condition"]);
    expect(typesIn("48765-2")).toEqual(["AllergyIntolerance"]);
    expect(typesIn("10160-0")).toEqual(["MedicationStatement"]);
    expect(typesIn("11369-6")).toEqual(["Immunization"]);
    expect(typesIn("30954-2")).toEqual(["Observation"]);
    expect(typesIn("8716-3")).toEqual(["Observation"]);
    // laboratory observations are results, vital-sign observations are vital signs
    const resultRefs = sections.find((s) => s.code.coding[0]?.code === "30954-2")?.entry ?? [];
    expect(resultRefs.map((e) => e.reference).sort()).toEqual(["Observation/bbbbbbbb-0000-4000-8000-000000000001", "Observation/bbbbbbbb-0000-4000-8000-000000000002", "Observation/bbbbbbbb-0000-4000-8000-000000000003"]);
  });

  it("resolves every reference inside the document to an entry of the bundle", () => {
    const fullUrls = new Set(entriesOf(bundle).map((e) => e.fullUrl));
    const base = mapping.base_url.replace(/\/$/, "");
    const refs = allReferences(bundle.entry);
    expect(refs.length).toBeGreaterThan(10);
    for (const ref of refs) expect(fullUrls.has(`${base}/${ref}`)).toBe(true);
  });

  it("has unique fullUrls and every resource appears once", () => {
    const urls = entriesOf(bundle).map((e) => e.fullUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("claims no profile and no conformance: no meta.profile anywhere, and the configuration says so", () => {
    expect(ips.ig_status).toBe("ips_shaped_no_conformance_claimed");
    expect(ips.profiles).toEqual({});
    expect(JSON.stringify(bundle)).not.toContain('"profile"');
    expect(version).toBe(1);
  });

  it("is deterministic for the same snapshot and document id", () => {
    expect(JSON.stringify(buildIpsBundle(fixtureSnapshot(), mapping, ips, { documentId: DOC_ID }).bundle)).toBe(JSON.stringify(bundle));
  });

  it("describes each section in plain language, the same lines the preview page shows", () => {
    const lines = Object.fromEntries(out.sections.map((s) => [s.key, s.lines]));
    expect(lines.medications).toEqual(["Amlodipine, 5 mg, once daily", "Ibuprofen (stopped)"]);
    expect(lines.problems?.[1]).toBe("Possible anaemia (not confirmed)");
    expect(lines.results).toEqual(["Creatinine: 0.9 mg/dL (reference 0.6 to 1.3), 2026-09-20", "Ldl cholesterol: 130 mg/dL (high) (reference up to 100), 2026-09-20", "Hbsag: Negative, 2026-09-20"]);
    expect(lines.allergies).toEqual(["Penicillin: Rash, moderate (not verified)"]);
    expect(lines.vital_signs).toContain("Blood pressure: 128/82 mmHg, 2026-10-01");
    expect(lines.vital_signs?.some((l) => l.includes("(estimate from a wearable)"))).toBe(true);
  });
});

describe("buildIpsBundle: what must never be in it", () => {
  it("drops documents even when the snapshot holds them (the IPS has no documents section)", () => {
    const out = buildIpsBundle(fixtureSnapshot(), mapping, ips);
    expect(resourcesOf(out.bundle, "DocumentReference")).toHaveLength(0);
    expect(JSON.stringify(out.bundle)).not.toContain("discharge_summary");
  });

  it("holds only the resource types of the IPS sections, the Patient and the author", () => {
    const types = new Set(entriesOf(buildIpsBundle(fixtureSnapshot(), mapping, ips).bundle).map((e) => e.resource.resourceType));
    expect([...types].sort()).toEqual(["AllergyIntolerance", "Composition", "Condition", "Immunization", "MedicationStatement", "Observation", "Organization", "Patient"]);
  });

  it("names the excluded domains in the bundle tags and the Composition narrative, and never writes their content", () => {
    const out = buildIpsBundle(fixtureSnapshot(), mapping, ips);
    const json = JSON.stringify(out.bundle);
    expect(json).toContain("excludes-reproductive-health");
    expect(json).toContain("excludes-mental-health");
    expect(json).toContain("Not included: private notes and documents. There is no separate reproductive health or mental health section");
    expect(json).toContain("Withheld for this reader: reproductive health, mental health.");
    // no clinical content from those domains can be produced: nothing in the mapper has a place to put it
    for (const word of ["menstrual", "pregnan", "contracept", "fertil", "depress", "anxiety", "phq", "gad-7", "self-harm"]) {
      expect(json.toLowerCase()).not.toContain(word);
    }
  });

  it("tells the truth when the database withheld nothing (the live self export): items inside general sections are not sorted by purpose, and the text says so", () => {
    const live = buildIpsBundle(fixtureSnapshot({ excluded_domains: [] }), mapping, ips);
    const composition = entriesOf(live.bundle)[0]?.resource as FhirOut;
    const narrative = (composition.text as { div: string }).div;
    expect(narrative).toContain("items inside the other sections are not sorted by what they are for");
    expect(narrative).not.toContain("Withheld for this reader");
    expect(JSON.stringify(live.bundle)).toContain("items-inside-general-sections-are-not-classified-by-purpose");
  });

  it("keeps only what the snapshot holds: a section the database refused is not invented", () => {
    const refused = fixtureSnapshot({ medications: undefined, sections_refused: ["medications"], sections_included: ["vitals"] });
    const out = buildIpsBundle(refused, mapping, ips);
    expect(resourcesOf(out.bundle, "MedicationStatement")).toHaveLength(0);
    expect(JSON.stringify(out.bundle)).toContain("section-not-permitted-medications");
  });

  it("writes a refused section as 'withheld', never as 'nothing recorded' or 'unavailable' (a supporter without the allergy category must not read as 'no allergies')", () => {
    const supporter = fixtureSnapshot({
      requester_kind: "supporter",
      sections_included: ["vitals"],
      sections_refused: ["allergies", "conditions", "medications", "immunizations", "lab_results"],
      allergies: undefined,
      conditions: undefined,
      medications: undefined,
      immunizations: undefined,
      lab_results: undefined,
      documents: undefined,
    });
    const out = buildIpsBundle(supporter, mapping, ips);
    const c = entriesOf(out.bundle)[0]?.resource as FhirOut;
    const sections = c.section as { title: string; emptyReason?: { coding: { code: string }[] }; text: { div: string } }[];
    const byTitle = Object.fromEntries(sections.map((s) => [s.title, s]));
    for (const title of ["Problems", "Allergies and intolerances", "Medicines", "Immunizations", "Results"]) {
      expect(byTitle[title]?.emptyReason?.coding[0]?.code).toBe("withheld");
      expect(byTitle[title]?.text.div).toContain("was not shared with whoever made this summary");
      expect(byTitle[title]?.text.div).not.toContain("Nothing is recorded here");
    }
    expect(byTitle["Vital signs"]?.emptyReason).toBeUndefined();
    expect(out.sections.find((x) => x.key === "allergies")?.withheld).toBe(true);
  });

  it("marks an unverified allergy and an abnormal result in the narrative, not only in the structured fields", () => {
    const out = buildIpsBundle(fixtureSnapshot(), mapping, ips);
    const lines = Object.fromEntries(out.sections.map((s) => [s.key, s.lines]));
    expect(lines.allergies).toEqual(["Penicillin: Rash, moderate (not verified)"]);
    expect(lines.results?.[0]).toBe("Creatinine: 0.9 mg/dL (reference 0.6 to 1.3), 2026-09-20");
    expect(lines.results?.[1]).toBe("Ldl cholesterol: 130 mg/dL (high) (reference up to 100), 2026-09-20");
  });

  it("shows a timestamp as the Lagos day: a reading at 00:30 Lagos on 2 October is 2 October, not the UTC 1 October", () => {
    const late = fixtureSnapshot({ vitals: [{ id: "aaaaaaaa-0000-4000-8000-0000000000a1", vital_type: "weight", taken_at: "2026-10-01T23:30:00+00:00", source: "manual", weight_kg: 70 }] });
    expect(buildIpsBundle(late, mapping, ips).sections.find((s) => s.key === "vital_signs")?.lines[0]).toBe("Body weight: 70 kg, 2026-10-02");
  });

  it("keeps a measured reading ahead of wearable estimates, so a day of watch syncs cannot push out the last cuff reading", () => {
    const watch = Array.from({ length: 8 }, (_, i) => ({
      id: `aaaaaaaa-0000-4000-8000-0000000002${String(i).padStart(2, "0")}`,
      vital_type: "pulse",
      taken_at: `2026-10-02T0${i}:00:00+00:00`,
      source: "wearable",
      pulse_bpm: 60 + i,
    }));
    const cuff = { id: "aaaaaaaa-0000-4000-8000-000000000299", vital_type: "pulse", taken_at: "2026-09-01T08:00:00+00:00", source: "manual", pulse_bpm: 66 };
    const out = buildIpsBundle(fixtureSnapshot({ vitals: [...watch, cuff] }), mapping, ips);
    const lines = out.sections.find((s) => s.key === "vital_signs")?.lines ?? [];
    expect(lines).toHaveLength(ips.vitals_per_type);
    expect(lines.filter((l) => !l.includes("(estimate from a wearable)"))).toHaveLength(1);
  });

  it("writes into the document how many readings were left out and which mapping version made it", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: `aaaaaaaa-0000-4000-8000-0000000003${String(i).padStart(2, "0")}`,
      vital_type: "weight",
      taken_at: `2026-09-0${i + 1}T08:00:00+00:00`,
      source: "manual",
      weight_kg: 70 + i,
    }));
    const out = buildIpsBundle(fixtureSnapshot({ vitals: many }), mapping, ips, { mappingVersion: 1, mappingStatus: "proposed" });
    const json = JSON.stringify(out.bundle);
    expect(json).toContain(`${9 - ips.vitals_per_type} older readings and results are left out of this summary.`);
    expect(json).toContain("ips-mapping-v1-proposed");
  });

  it("keeps the summary short: the newest few readings of each kind and results of each test, and says how many were left out", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `aaaaaaaa-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`,
      vital_type: "weight",
      taken_at: `2026-09-${String(i + 1).padStart(2, "0")}T08:00:00+00:00`,
      source: "manual",
      weight_kg: 70 + i,
    }));
    const out = buildIpsBundle(fixtureSnapshot({ vitals: many }), mapping, ips);
    const weights = out.sections.find((s) => s.key === "vital_signs")?.lines ?? [];
    expect(weights).toHaveLength(ips.vitals_per_type);
    expect(weights[0]).toContain("81 kg"); // the newest first
    expect(out.trimmed).toBe(12 - ips.vitals_per_type);
  });

  it("labels wearable readings as estimates and keeps the unit with every value", () => {
    const out = buildIpsBundle(fixtureSnapshot(), mapping, ips);
    const weight = resourcesOf(out.bundle, "Observation").find((o) => o.id === "aaaaaaaa-0000-4000-8000-000000000003") as FhirOut;
    expect(JSON.stringify(weight.meta)).toContain('"code":"estimate"');
    const lines = out.sections.find((s) => s.key === "vital_signs")?.lines ?? [];
    expect(lines.filter((l) => l.includes("(estimate from a wearable)"))).toHaveLength(2); // the weight and the wearable pulse, nothing else
    expect(weight.valueQuantity).toMatchObject({ value: 72.5, unit: "kg", code: "kg", system: "http://unitsofmeasure.org" });
  });
});

describe("buildIpsBundle: empty sections are honest", () => {
  const empty = fixtureSnapshot({ conditions: [], allergies: [], medications: [], immunizations: [], lab_results: [], vitals: [], documents: [] });
  const out = buildIpsBundle(empty, mapping, ips, { documentId: DOC_ID });
  const c = entriesOf(out.bundle)[0]?.resource as FhirOut;
  const sections = c.section as { title: string; emptyReason?: { coding: { system: string; code: string }[] }; entry?: unknown[]; text: { div: string } }[];

  it("keeps the three required sections and leaves the optional empty ones out", () => {
    expect(sections.map((s) => s.title)).toEqual(["Problems", "Allergies and intolerances", "Medicines"]);
  });

  it("marks a required empty section 'unavailable' with no entries, and never 'nil known'", () => {
    for (const s of sections) {
      expect(s.entry).toBeUndefined();
      expect(s.emptyReason?.coding[0]?.code).toBe("unavailable");
      expect(s.text.div).toContain("does not mean there is nothing to record");
    }
    expect(JSON.stringify(out.bundle)).not.toContain("nilknown");
    expect(JSON.stringify(out.bundle).toLowerCase()).not.toContain("no known allergies");
  });

  it("still carries the Patient and resolves every reference", () => {
    const fullUrls = new Set(entriesOf(out.bundle).map((e) => e.fullUrl));
    for (const ref of allReferences(out.bundle.entry)) expect(fullUrls.has(`${mapping.base_url}/${ref}`)).toBe(true);
    expect(resourcesOf(out.bundle, "Patient")).toHaveLength(1);
  });

  it("escapes text in the narrative so a medicine name cannot inject markup", () => {
    const hostile = buildIpsBundle(
      fixtureSnapshot({ medications: [{ id: "cccccccc-0000-4000-8000-000000000009", drug_name: "<script>x</script> & co", dose: null, frequency: null, route: null, is_active: true, source: "patient", stopped_at: null, created_at: "2026-08-01T00:00:00+00:00" }] }),
      mapping,
      ips
    );
    const composition = entriesOf(hostile.bundle)[0]?.resource as FhirOut;
    const divs = JSON.stringify((composition.section as { text: { div: string } }[]).map((s) => s.text.div));
    expect(divs).not.toContain("<script>");
    expect(divs).toContain("&lt;script&gt;x&lt;/script&gt; &amp; co");
  });
});

describe("buildIpsBundle: round trip through our own import keeps values and units", () => {
  function seededLoincMappings(): Record<string, string> {
    let dir = process.cwd();
    while (!existsSync(join(dir, "supabase", "migrations")) && dirname(dir) !== dir) dir = dirname(dir);
    const sql = readFileSync(join(dir, "supabase", "migrations", "20260922182613_fhir_loinc_vital_type_mappings.sql"), "utf8");
    const out: Record<string, string> = {};
    for (const m of sql.matchAll(/\('([0-9]+-[0-9])', '([a-z_0-9]+)'\)/g)) if (m[1] && m[2]) out[m[1]] = m[2];
    return out;
  }
  const mappings = seededLoincMappings();
  function stub(): Parameters<typeof parseFhirResourceEntry>[1] {
    let code: string | null = null;
    const b: Record<string, unknown> = {
      maybeSingle: () => Promise.resolve({ data: code && mappings[code] ? { vital_type: mappings[code] } : null, error: null }),
    };
    b.from = () => b;
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      if (col === "loinc_code") code = String(val);
      return b;
    };
    return b as unknown as Parameters<typeof parseFhirResourceEntry>[1];
  }

  const { bundle } = buildIpsBundle(fixtureSnapshot(), mapping, ips, { documentId: DOC_ID });
  const parsed = fhirBundleSchema.parse(bundle);
  const find = (id: string) => {
    const r = parsed.entry.find((e) => e.resource?.id === id)?.resource;
    if (!r) throw new Error(`no ${id}`);
    return r;
  };

  it("is a Bundle our own import schema accepts", () => {
    expect(parsed.entry.length).toBeGreaterThan(10);
  });

  const cases = [
    { id: "aaaaaaaa-0000-4000-8000-000000000002", field: "glucose_mmol_l", value: 5.4 },
    { id: "aaaaaaaa-0000-4000-8000-000000000003", field: "weight_kg", value: 72.5 },
    { id: "aaaaaaaa-0000-4000-8000-000000000004", field: "temperature_c", value: 37.2 },
    { id: "aaaaaaaa-0000-4000-8000-000000000005", field: "spo2_pct", value: 97 },
  ];
  for (const c of cases) {
    it(`reads ${c.field} back as exactly ${c.value} with no conversion`, async () => {
      const r = await parseFhirResourceEntry(find(c.id), stub());
      expect(r.ok && r.proposal.normalizedPayload).toMatchObject({ [c.field]: c.value });
      expect(r.ok && r.proposal.parseWarnings.filter((w) => w.includes("converted"))).toEqual([]);
    });
  }

  it("reads blood pressure back as 128 over 82", async () => {
    const r = await parseFhirResourceEntry(find("aaaaaaaa-0000-4000-8000-000000000001"), stub());
    expect(r.ok && r.proposal.normalizedPayload).toMatchObject({ systolic: 128, diastolic: 82 });
  });

  it("does not turn the Composition or the author into a record: the importer skips them with a reason", async () => {
    for (const type of ["Composition", "Organization"]) {
      const r = await parseFhirResourceEntry(parsed.entry.find((e) => e.resource?.resourceType === type)?.resource as never, stub());
      expect(r.ok).toBe(false);
    }
  });
});
