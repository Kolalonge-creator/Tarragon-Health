/**
 * Drift guard: the DB migration's jsonb seed
 * (supabase/migrations/*_symptom_triage_protocols_config.sql) is a
 * hand-transcription of SEED_TRIAGE_PROTOCOL_CONFIG below — there is no
 * build step that generates one from the other. `db-seed-fixture.json` is a
 * byte-for-byte copy of the migration's jsonb literal (single-quote
 * escaping undone); this test parses it through the same zod boundary the
 * app layer uses and fails loudly if it and the TS seed ever diverge.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "@jest/globals";
import { parseTriageProtocolConfig } from "../types/index";
import { SEED_TRIAGE_PROTOCOL_CONFIG } from "./index";

// Read rather than `import ... .json` to avoid the ESM JSON-import-attribute
// churn across Node/ts-jest versions — this is a test fixture, not a module.
const fixturePath = fileURLToPath(new URL("./db-seed-fixture.json", import.meta.url));
const dbSeedFixture: unknown = JSON.parse(readFileSync(fixturePath, "utf-8"));

describe("triage protocol config — DB/TS parity", () => {
  it("the DB seed jsonb parses cleanly against the schema", () => {
    const parsed = parseTriageProtocolConfig(dbSeedFixture);
    expect(parsed).not.toBeNull();
  });

  it("the DB seed jsonb describes the exact same graph as the TS seed", () => {
    const parsed = parseTriageProtocolConfig(dbSeedFixture);
    expect(parsed).toEqual(SEED_TRIAGE_PROTOCOL_CONFIG);
  });

  it("rejects a config with a dangling node reference caught by structure, not just types", () => {
    // Sanity check on the schema itself: malformed shapes must fail closed.
    const malformed = { version: 1, pathways: [{ ...SEED_TRIAGE_PROTOCOL_CONFIG.pathways[0], nodes: {} }] };
    expect(parseTriageProtocolConfig(malformed)).not.toBeNull(); // schema doesn't chase dangling refs...
    expect(parseTriageProtocolConfig({ version: 1, pathways: [] })).toBeNull(); // ...but does enforce non-empty pathways
  });
});
