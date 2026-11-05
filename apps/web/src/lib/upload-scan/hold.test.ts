import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { heldPaths, isPathHeld } from "./hold";

const client = (impl: () => Promise<unknown>) => ({ rpc: jest.fn(impl) }) as unknown as SupabaseClient<Database> & { rpc: jest.Mock };

const ORIGINAL = process.env.SCANNER_SERVICE_URL;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.SCANNER_SERVICE_URL;
  else process.env.SCANNER_SERVICE_URL = ORIGINAL;
});

describe("heldPaths", () => {
  it("asks the database once, de-duplicated, and returns the held paths", async () => {
    const c = client(async () => ({ data: ["p/2.pdf"], error: null }));
    const held = await heldPaths(c, ["p/1.pdf", "p/2.pdf", "p/2.pdf", null, ""]);
    expect([...held]).toEqual(["p/2.pdf"]);
    expect(c.rpc).toHaveBeenCalledWith("upload_scan_held_paths", { p_paths: ["p/1.pdf", "p/2.pdf"] });
  });

  it("makes no call for an empty list", async () => {
    const c = client(async () => ({ data: [], error: null }));
    expect((await heldPaths(c, [])).size).toBe(0);
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the scanner is configured and the check errors", async () => {
    process.env.SCANNER_SERVICE_URL = "https://scanner.test";
    const c = client(async () => ({ data: null, error: { message: "boom" } }));
    expect([...(await heldPaths(c, ["a", "b"]))].sort()).toEqual(["a", "b"]);
  });

  it("fails open when the scanner is not configured (nothing can be held)", async () => {
    delete process.env.SCANNER_SERVICE_URL;
    const c = client(async () => {
      throw new Error("no rpc");
    });
    expect(await isPathHeld(c, "a")).toBe(false);
  });
});
