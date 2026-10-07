import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATEGORY_PERMISSIONS,
  CONSENT_DATA_TYPES,
  CONSENT_PURPOSES,
  bundleState,
  consentErrorMessage,
  optionalOnCount,
  parseConsentMatrix,
  type ConsentMatrix,
} from "./consent-matrix";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "supabase", "migrations");
const MATRIX_SQL = readFileSync(join(MIGRATIONS, "20261007131712_s42_consent_matrix.sql"), "utf8");
const HANDOVER_SQL = readFileSync(join(MIGRATIONS, "20261007135419_s42_dependants_handover_and_permissions.sql"), "utf8");

describe("the lists mirror the migration (drift fails here)", () => {
  it("data types and purposes match the check constraints", () => {
    const type = /data_type\s+text not null check \(data_type in \(([^)]*)\)\)/.exec(MATRIX_SQL)?.[1] ?? "";
    const purpose = /purpose\s+text not null check \(purpose in \(([^)]*)\)\)/.exec(MATRIX_SQL)?.[1] ?? "";
    const list = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(list(type)).toEqual([...CONSENT_DATA_TYPES]);
    expect(list(purpose)).toEqual([...CONSENT_PURPOSES]);
  });

  it("the category to permission map matches private.category_permissions", () => {
    const fromSql: Record<string, string[]> = {};
    for (const m of HANDOVER_SQL.matchAll(/when '([a-z_]+)'\s+then array\[([^\]]*)\]/g)) {
      fromSql[m[1] as string] = [...(m[2] as string).matchAll(/'([a-z_]+)'/g)].map((x) => x[1] as string);
    }
    for (const [category, perms] of Object.entries(fromSql)) {
      expect([category, CATEGORY_PERMISSIONS[category]]).toEqual([category, perms]);
    }
    // a category with no SQL branch maps to nothing here either
    for (const [category, perms] of Object.entries(CATEGORY_PERMISSIONS)) {
      if (!(category in fromSql)) expect([category, perms]).toEqual([category, []]);
    }
  });

  it("no category maps to an acting permission", () => {
    const acting = new Set(["book_appointments", "manage_pharmacy", "manage_payments", "receive_alerts"]);
    for (const perms of Object.values(CATEGORY_PERMISSIONS)) for (const p of perms) expect(acting.has(p)).toBe(false);
  });
});

const payload = {
  cells: CONSENT_DATA_TYPES.flatMap((data_type) =>
    CONSENT_PURPOSES.map((purpose) => ({
      data_type,
      purpose,
      required_for_care: purpose === "care",
      sensitive: data_type === "reproductive" || data_type === "mental_health",
      text_key: `consent.matrix.${data_type}.${purpose}`,
      wording_status: "draft_pending_counsel",
      granted: purpose === "care",
      changed_at: null,
    })),
  ),
  bundles: [{ code: "help_research", text_key: "consent.bundle.help_research", cells: [{ data_type: "vitals", purpose: "research" }, { data_type: "documents", purpose: "research" }] }],
};

describe("parseConsentMatrix", () => {
  it("reads a good payload", () => {
    const m = parseConsentMatrix(payload) as ConsentMatrix;
    expect(m.cells).toHaveLength(20);
    expect(m.bundles[0]?.cells).toHaveLength(2);
  });
  it("returns null for anything unexpected", () => {
    expect(parseConsentMatrix(null)).toBeNull();
    expect(parseConsentMatrix({ cells: "x", bundles: [] })).toBeNull();
    expect(parseConsentMatrix({ cells: [{ data_type: "weather", purpose: "care", granted: true, required_for_care: true }], bundles: [] })).toBeNull();
  });
  it("counts optional cells that are on and reports bundle state", () => {
    const m = parseConsentMatrix(payload) as ConsentMatrix;
    expect(optionalOnCount(m)).toBe(0);
    expect(bundleState(m, "help_research")).toBe("off");
    const one = { ...m, cells: m.cells.map((c) => (c.data_type === "vitals" && c.purpose === "research" ? { ...c, granted: true } : c)) };
    expect(bundleState(one, "help_research")).toBe("partial");
    expect(optionalOnCount(one)).toBe(1);
    const both = { ...one, cells: one.cells.map((c) => (c.data_type === "documents" && c.purpose === "research" ? { ...c, granted: true } : c)) };
    expect(bundleState(both, "help_research")).toBe("on");
    expect(bundleState(m, "no_such_bundle")).toBe("off");
  });
});

describe("consentErrorMessage", () => {
  it("separates the required refusal from the rest", () => {
    expect(consentErrorMessage("consent_required_for_care")).toBe("required");
    expect(consentErrorMessage("consent_cell_unknown")).toBe("unknown");
    expect(consentErrorMessage("boom")).toBe("generic");
    expect(consentErrorMessage(undefined)).toBe("generic");
  });
});
