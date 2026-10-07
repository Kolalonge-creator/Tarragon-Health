import { readFileSync } from "node:fs";
import { join } from "node:path";

const EDGE = join(__dirname, "..", "..", "..", "..", "..", "supabase", "functions", "_shared", "scribe", "facts.ts");
const WEB = join(__dirname, "facts.ts");

describe("the facts stage has one definition", () => {
  it("apps/web/src/lib/scribe/facts.ts is byte-identical to the edge function's copy", () => {
    expect(readFileSync(WEB, "utf8")).toBe(readFileSync(EDGE, "utf8"));
  });
});
