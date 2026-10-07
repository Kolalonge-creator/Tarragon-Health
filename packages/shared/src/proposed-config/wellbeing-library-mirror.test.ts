import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seeded(marker: string): unknown {
  for (const f of readdirSync(MIGRATIONS).filter((n) => /_s57_.*\.sql$/.test(n)).sort()) {
    const m = new RegExp(`${marker}-begin[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$`).exec(readFileSync(join(MIGRATIONS, f), "utf8"));
    if (m?.[1]) return JSON.parse(m[1]);
  }
  throw new Error(`${marker} seed not found in any S57 migration`);
}

describe("S57 PROPOSED config mirrors the migration seeds", () => {
  it("media_library.config is identical to media_library_config v1, proposed", () => {
    const e = getProposedConfig("media_library.config");
    expect(seeded("medialib-config-v1")).toEqual(e.value);
    expect(e.status).toBe("proposed");
  });
  it("sleep.apnoea_screen is identical to sleep_apnoea_screen_config v1, proposed and owned by the CMO", () => {
    const e = getProposedConfig("sleep.apnoea_screen");
    expect(seeded("sleepscreen-v1")).toEqual(e.value);
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("CMO");
  });
});
