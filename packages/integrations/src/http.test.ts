import { describe, expect, it } from "@jest/globals";
import { httpJson, type FetchLike } from "../../../supabase/functions/_shared/integrations/index.ts";

describe("httpJson", () => {
  const seen: Record<string, string>[] = [];
  const f: FetchLike = async (_u, init) => (seen.push(init.headers), { status: 200, ok: true, text: async () => "{}" });
  const deps = { fetch: f, timeoutMs: 1000 };

  it("sends a JSON content type only when there is a body", async () => {
    await httpJson(deps, { url: "https://x.example/a", method: "GET", headers: {} });
    await httpJson(deps, { url: "https://x.example/a", method: "POST", headers: {} });
    await httpJson(deps, { url: "https://x.example/a", method: "POST", headers: {}, body: { a: 1 } });
    expect(seen.map((h) => h["Content-Type"])).toEqual([undefined, undefined, "application/json"]);
  });

  it("lets a caller's own header win", async () => {
    seen.length = 0;
    await httpJson(deps, { url: "https://x.example/a", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "a=1" });
    expect(seen[0]!["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });
});
