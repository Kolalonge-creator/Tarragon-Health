import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

describe("devices.sync_staleness", () => {
  const entry = getProposedConfig<{ staleAfterDays: number }>("devices.sync_staleness");
  it("is proposed, owned by the CMO, unsigned, and a positive whole number of days", () => {
    expect(entry.status).toBe("proposed");
    expect(entry.owner).toBe("CMO");
    expect(entry.version).toBe(1);
    expect(Number.isInteger(entry.value.staleAfterDays)).toBe(true);
    expect(entry.value.staleAfterDays).toBeGreaterThan(0);
  });
  it("is read from config by the callers, never a literal in the UI files", () => {
    for (const rel of [
      "apps/mobile/src/lib/device-row-view.ts",
      "apps/web/src/app/(dashboard)/patient/device-sync-support-card.tsx",
    ]) {
      const src = readFileSync(join(repoRoot, rel), "utf8");
      expect(src).toContain("devices.sync_staleness");
      expect(/staleAfterDays\s*[:=]\s*\d/.test(src)).toBe(false);
    }
  });
});
