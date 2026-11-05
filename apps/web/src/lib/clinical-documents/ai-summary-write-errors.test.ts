/** @jest-environment node */
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// CDE-10: the AI summary writes on imaging and ECG documents also run the narrative urgent-finding rules (a database trigger).
// supabase-js returns a failure rather than throwing, so a write that only wraps the call in try/catch loses a failed finding without a
// trace. Each write must read the returned error and report it through runBestEffort.
describe("AI summary writes report a returned database error", () => {
  for (const [file, column] of [
    ["../imaging-reports/extraction-actions.ts", "ai_impression_text"],
    ["../ecg-reports/extraction-actions.ts", "ai_rhythm_statement"],
  ] as const) {
    it(file, () => {
      const src = readFileSync(join(__dirname, file), "utf8");
      const at = src.indexOf("runBestEffort(", src.indexOf("CDE-10:"));
      expect(at).toBeGreaterThan(-1);
      const block = src.slice(at, at + 700);
      expect(block).toContain(`${column}:`);
      expect(block).toMatch(/runBestEffort\(/);
      expect(block).toMatch(/const \{ error \} = await service/);
      expect(block).toMatch(/if \(error\) throw/);
    });
  }
});
