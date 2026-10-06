import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { canExplainLabResult } from "./explain-gate";

const id = "11111111-1111-4111-8111-111111111111";
const client = (rpc: jest.Mock) => ({ rpc }) as unknown as Parameters<typeof canExplainLabResult>[0];

describe("canExplainLabResult fails closed", () => {
  it("is true only when the database says true", async () => {
    expect(await canExplainLabResult(client(jest.fn().mockResolvedValue({ data: true, error: null })), id)).toBe(true);
    expect(await canExplainLabResult(client(jest.fn().mockResolvedValue({ data: false, error: null })), id)).toBe(false);
    expect(await canExplainLabResult(client(jest.fn().mockResolvedValue({ data: null, error: null })), id)).toBe(false);
  });
  it("is false on an error and never calls the database for a malformed id", async () => {
    expect(await canExplainLabResult(client(jest.fn().mockResolvedValue({ data: true, error: { message: "boom" } })), id)).toBe(false);
    const rpc = jest.fn();
    expect(await canExplainLabResult(client(rpc), "not-an-id")).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

/**
 * A standing guard (INV-04): any file that reads structured lab results (lab_result_items, my_lab_results) and also looks like an
 * AI, audio or explanation feature must go through the gate. Today none does, so this passes; it fails the day one is added without it.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name === ".next") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe("no AI or audio code reads structured lab results without the explain gate", () => {
  it("holds across apps/web/src", () => {
    const root = join(__dirname, "..", "..");
    const offenders = walk(root).filter((f) => {
      if (f.includes(`${join("lib", "lab-results")}`) || f.includes(`${join("app", "(dashboard)", "patient", "released-lab-results")}`)) return false;
      const src = readFileSync(f, "utf8");
      const readsResults = /lab_result_items|my_lab_results/.test(src);
      const explains = /ai-coach|runGovernedAi|audio|speech|tts|explain/i.test(src);
      return readsResults && explains && !src.includes("canExplainLabResult");
    });
    expect(offenders).toEqual([]);
  });
});
