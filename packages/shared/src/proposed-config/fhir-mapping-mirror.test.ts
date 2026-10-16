import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

interface Mapping {
  ig_status: string;
  profiles: Record<string, string[]>;
  systems: Record<string, string>;
  vitals: Record<string, { loinc: string; systolic?: string; diastolic?: string }>;
  lab_analyte_loinc: Record<string, string>;
}

function seededImportCodes(): Record<string, string> {
  const sql = readFileSync(join(MIGRATIONS, "20260922182613_fhir_loinc_vital_type_mappings.sql"), "utf8");
  const out: Record<string, string> = {};
  for (const m of sql.matchAll(/\('([0-9]+-[0-9])', '([a-z_0-9]+)'\)/g)) if (m[1] && m[2]) out[m[1]] = m[2];
  return out;
}

describe("fhir.mapping", () => {
  const entry = getProposedConfig("fhir.mapping");
  const v = entry.value as unknown as Mapping;

  it("is a PROPOSED entry owned by the founder, never confirmed by an agent", () => {
    expect(entry.status).toBe("proposed");
    expect(entry.owner).toBe("Founder");
  });

  it("claims no implementation-guide profile: Nigeria Core and NPHCDA are both under development", () => {
    expect(v.ig_status).toBe("nigeria_core_and_nphcda_under_development");
    expect(v.profiles).toEqual({});
  });

  it("exports every vital under a LOINC code the import also accepts for the same vital, so an export can always be read back", () => {
    const seeded = seededImportCodes();
    for (const [vital, code] of Object.entries(v.vitals)) {
      if (vital === "blood_pressure") {
        expect(code.systolic).toBe("8480-6");
        expect(code.diastolic).toBe("8462-4");
        continue;
      }
      expect(seeded[code.loinc]).toBe(vital);
    }
  });

  it("maps lab analytes only to analytes that exist on a lab panel", () => {
    const sql = readFileSync(join(MIGRATIONS, "20261006173205_s27_lab_results_release_rules.sql"), "utf8");
    const panel = /lab-panels-begin([\s\S]*?)lab-panels-end/.exec(sql)?.[1] ?? "";
    for (const code of Object.keys(v.lab_analyte_loinc)) expect(panel).toContain(`"code": "${code}"`);
  });

  it("keeps every system a URI and every LOINC code in LOINC's shape", () => {
    for (const s of Object.values(v.systems)) expect(s).toMatch(/^https?:\/\//);
    for (const c of [...Object.values(v.lab_analyte_loinc), ...Object.values(v.vitals).map((x) => x.loinc)]) expect(c).toMatch(/^[0-9]{1,7}-[0-9]$/);
  });
});
