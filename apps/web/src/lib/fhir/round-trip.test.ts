import { describe, expect, it } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadFhirMapping } from "./config";
import { buildFhirBundle, type FhirOut } from "./export-bundle";
import { fixtureSnapshot } from "./test-fixtures";
import { parseFhirResourceEntry } from "@/lib/integrations/fhir/parse-resource";
import { fhirBundleSchema, type FhirResource } from "@/lib/integrations/fhir/bundle-schema";

/**
 * The acceptance test for spec 2.10: "FHIR round trip preserves observation values and units". A bundle our own export writes is read back by
 * our own import parser and the numbers and units must come out the same. The LOINC lookup the parser uses is a database table; the stub here
 * is built from that table's own seed migration, so the test cannot pass against a mapping the database does not have.
 */

function seededLoincMappings(): Record<string, string> {
  let dir = process.cwd();
  while (!existsSync(join(dir, "supabase", "migrations")) && dirname(dir) !== dir) dir = dirname(dir);
  const sql = readFileSync(join(dir, "supabase", "migrations", "20260922182613_fhir_loinc_vital_type_mappings.sql"), "utf8");
  const out: Record<string, string> = {};
  for (const m of sql.matchAll(/\('([0-9]+-[0-9])', '([a-z_0-9]+)'\)/g)) {
    if (m[1] && m[2]) out[m[1]] = m[2];
  }
  return out;
}

function stubSupabase(mappings: Record<string, string>): Parameters<typeof parseFhirResourceEntry>[1] {
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

const { mapping } = loadFhirMapping();
const supabase = stubSupabase(seededLoincMappings());

function resourceOf(bundle: FhirOut, id: string): FhirResource {
  const parsed = fhirBundleSchema.parse(bundle);
  const found = parsed.entry.find((e) => e.resource?.id === id)?.resource;
  if (!found) throw new Error(`resource ${id} not in the bundle`);
  return found;
}

describe("FHIR round trip: export then import keeps values and units", () => {
  const { bundle } = buildFhirBundle(fixtureSnapshot(), mapping);

  it("is a Bundle our own import schema accepts", () => {
    expect(() => fhirBundleSchema.parse(bundle)).not.toThrow();
  });

  const cases: { id: string; vital: string; field: string; value: number }[] = [
    { id: "aaaaaaaa-0000-4000-8000-000000000002", vital: "glucose", field: "glucose_mmol_l", value: 5.4 },
    { id: "aaaaaaaa-0000-4000-8000-000000000003", vital: "weight", field: "weight_kg", value: 72.5 },
    { id: "aaaaaaaa-0000-4000-8000-000000000004", vital: "temperature", field: "temperature_c", value: 37.2 },
    { id: "aaaaaaaa-0000-4000-8000-000000000005", vital: "spo2", field: "spo2_pct", value: 97 },
    { id: "aaaaaaaa-0000-4000-8000-000000000006", vital: "pulse", field: "pulse_bpm", value: 68 },
    { id: "aaaaaaaa-0000-4000-8000-000000000007", vital: "waist_circumference", field: "waist_cm", value: 88 },
  ];
  for (const c of cases) {
    it(`reads a ${c.vital} back as exactly ${c.value}, with no conversion warning`, async () => {
      const r = await parseFhirResourceEntry(resourceOf(bundle, c.id), supabase);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.proposal.normalizedPayload).toMatchObject({ vital_type: c.vital, [c.field]: c.value });
      expect(r.proposal.parseWarnings.filter((w) => w.includes("converted"))).toEqual([]);
    });
  }

  it("reads blood pressure back as 128 over 82", async () => {
    const r = await parseFhirResourceEntry(resourceOf(bundle, "aaaaaaaa-0000-4000-8000-000000000001"), supabase);
    expect(r.ok && r.proposal.normalizedPayload).toMatchObject({ vital_type: "blood_pressure", systolic: 128, diastolic: 82 });
  });

  it("reads a medicine and a vaccination dose back", async () => {
    const med = await parseFhirResourceEntry(resourceOf(bundle, "cccccccc-0000-4000-8000-000000000001"), supabase);
    expect(med.ok && med.proposal.normalizedPayload).toMatchObject({ drug_name: "Amlodipine", dose: "5 mg, once daily", is_active: true });
    // Immunization looks the vaccine up by name in the catalogue; a stub with the exact name proves the fields round-trip.
    const catalog: Record<string, unknown> = { maybeSingle: () => Promise.resolve({ data: { id: "catalog-1" }, error: null }) };
    for (const m of ["from", "select", "eq", "ilike", "order", "limit"]) catalog[m] = () => catalog;
    const imm = await parseFhirResourceEntry(resourceOf(bundle, "ffffffff-0000-4000-8000-000000000001"), catalog as unknown as Parameters<typeof parseFhirResourceEntry>[1]);
    expect(imm.ok && imm.proposal.normalizedPayload).toMatchObject({ dose_number: 2, date_administered: "2026-07-01", provider: "Lagos clinic" });
  });

  it("every LOINC code the export writes for a vital is one the import accepts for the same vital", () => {
    const seeded = seededLoincMappings();
    for (const [vital, code] of Object.entries(mapping.vitals)) {
      if (vital === "blood_pressure") continue; // a panel, recognised by its structure
      expect(seeded[code.loinc]).toBe(vital);
    }
  });

  describe("the old import filed a number without looking at its unit; now the unit decides", () => {
    const glucoseIn = (value: number, unit?: string, code?: string): FhirResource => ({
      resourceType: "Observation",
      id: "x1",
      code: { coding: [{ system: "http://loinc.org", code: "15074-8" }] },
      effectiveDateTime: "2026-10-01T08:00:00Z",
      valueQuantity: { value, unit, code },
    });

    it("converts mg/dL to mmol/L and shows the clinician that it did", async () => {
      const r = await parseFhirResourceEntry(glucoseIn(126, "mg/dL", "mg/dL"), supabase);
      expect(r.ok && r.proposal.normalizedPayload.glucose_mmol_l).toBe(6.99);
      expect(r.ok && r.proposal.parseWarnings.some((w) => w.includes("converted from 126 mg/dL"))).toBe(true);
    });

    it("skips a glucose with no unit, with a reason, rather than guessing", async () => {
      const r = await parseFhirResourceEntry(glucoseIn(126), supabase);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.skip.reason).toMatch(/not a unit this platform can convert|No unit/);
    });

    it("skips a blood pressure whose unit is not mmHg", async () => {
      const bp: FhirResource = {
        resourceType: "Observation",
        id: "x2",
        code: { coding: [{ system: "http://loinc.org", code: "85354-9" }] },
        effectiveDateTime: "2026-10-01T08:00:00Z",
        component: [
          { code: { coding: [{ code: "8480-6" }] }, valueQuantity: { value: 16, unit: "kPa" } },
          { code: { coding: [{ code: "8462-4" }] }, valueQuantity: { value: 10, unit: "kPa" } },
        ],
      };
      const r = await parseFhirResourceEntry(bp, supabase);
      expect(r.ok).toBe(false);
    });
  });
});
