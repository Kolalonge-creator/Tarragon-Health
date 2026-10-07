import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "@jest/globals";
import { evaluateBundledRedFlags } from "../safety/bundled-red-flags";
import { runTriage } from "../engine/index";
import { categoryAtLeast, parseTriageProtocolConfig, type SymptomCapture } from "../types/index";
import { PAEDIATRIC_DRAFT_PATHWAYS } from "./paediatric-drafts";
import { SEED_PATHWAYS } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");
const cap = (p: Partial<SymptomCapture> & Pick<SymptomCapture, "presentingComplaintKey">): SymptomCapture => ({ onset: "gradual", severity: 4, associatedSymptoms: [], triggers: [], relevantHistory: [], measurements: {}, ...p });

describe("paediatric draft pathways", () => {
  it("are well formed: parse through the load boundary, no dangling node, every outcome asks a human to look and is never self-care", () => {
    for (const p of PAEDIATRIC_DRAFT_PATHWAYS) {
      expect(parseTriageProtocolConfig({ version: 99, pathways: [p] })).not.toBeNull();
      const keys = new Set(Object.keys(p.nodes));
      expect(keys.has(p.startNodeKey)).toBe(true);
      for (const n of Object.values(p.nodes)) {
        if (n.type === "question") {
          const next = n.kind === "boolean" ? [n.onYes, n.onNo] : n.options.map((o) => o.next);
          for (const k of next) expect(keys.has(k)).toBe(true);
        } else {
          expect(categoryAtLeast(n.category, "routine")).toBe(true);
          expect(n.clinicianReviewRequired).toBe(true);
        }
      }
      expect(categoryAtLeast(p.fallbackOutcome.category, "urgent")).toBe(true);
      for (const r of p.redFlagScreen) expect(r.key.startsWith(`${p.key}.`)).toBe(true);
    }
  });

  it("are UNSIGNED drafts: not in the bundled signed floor, so nothing on a device uses them", () => {
    const signed = new Set(SEED_PATHWAYS.map((p) => p.key));
    for (const p of PAEDIATRIC_DRAFT_PATHWAYS) expect(signed.has(p.key)).toBe(false);
    const floor = evaluateBundledRedFlags(cap({ presentingComplaintKey: "paediatric_fever", associatedSymptoms: ["convulsions"] }));
    expect(floor.fired.some((f) => f.key.startsWith("paediatric_"))).toBe(false);
  });

  it("a danger sign is an emergency in every draft, and a question walk never ends in reassurance", () => {
    for (const p of PAEDIATRIC_DRAFT_PATHWAYS) {
      const danger = runTriage(p, cap({ presentingComplaintKey: p.key, associatedSymptoms: ["unable_to_drink_or_feed"] }), {});
      expect(danger.category).toBe("emergency");
    }
    for (const p of PAEDIATRIC_DRAFT_PATHWAYS) {
      for (const answer of [true, false]) {
        let answers: Record<string, boolean> = {};
        let r = runTriage(p, cap({ presentingComplaintKey: p.key }), answers);
        let guard = 0;
        while (r.nextQuestion && guard++ < 10) {
          answers = { ...answers, [r.nextQuestion.key]: answer };
          r = runTriage(p, cap({ presentingComplaintKey: p.key }), answers);
        }
        expect(categoryAtLeast(r.category, "routine")).toBe(true);
        expect(r.clinicianReviewRequired).toBe(true);
      }
    }
  });

  it("match the copy in the migration byte for byte (a drift fails here)", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s59_paediatric_draft_protocol.sql"));
    if (!file) throw new Error("S59 paediatric draft migration not found");
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const m = /paediatric-draft-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!m?.[1]) throw new Error("paediatric draft JSON not found in the migration");
    expect(JSON.parse(m[1])).toEqual(JSON.parse(JSON.stringify(PAEDIATRIC_DRAFT_PATHWAYS)));
  });
});
