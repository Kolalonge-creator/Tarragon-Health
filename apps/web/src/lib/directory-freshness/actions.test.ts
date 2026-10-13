const rpc = jest.fn();
const redirect = jest.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { recordDirectoryVerificationAction } from "./actions";

const ID = "11111111-1111-4111-8111-111111111111";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const goes = async (p: Promise<void>) => p.then(() => "no redirect", (e: Error) => e.message);
const good = { listing_table: "lab_providers", listing_id: ID, note: "phoned the lab and checked the hours" };

beforeEach(() => {
  rpc.mockReset();
  redirect.mockClear();
});

describe("recordDirectoryVerificationAction", () => {
  it("passes the form to the database function and says recorded", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    expect(await goes(recordDirectoryVerificationAction(fd(good)))).toBe("REDIRECT:/admin/ops/directory-freshness?n=recorded");
    expect(rpc).toHaveBeenCalledWith("record_directory_verification", { p_listing_table: "lab_providers", p_listing_id: ID, p_note: good.note });
  });
  it("never calls the database with a short note", async () => {
    expect(await goes(recordDirectoryVerificationAction(fd({ ...good, note: "short" })))).toBe("REDIRECT:/admin/ops/directory-freshness?n=note_short");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("never calls the database for a table that is not a listing table", async () => {
    expect(await goes(recordDirectoryVerificationAction(fd({ ...good, listing_table: "profiles" })))).toBe("REDIRECT:/admin/ops/directory-freshness?n=record_failed");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a refusal from the database is a denied notice, not a success", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "x", code: "42501" } });
    expect(await goes(recordDirectoryVerificationAction(fd(good)))).toBe("REDIRECT:/admin/ops/directory-freshness?n=record_denied");
  });
  it("any other failure is a failure notice", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "x", code: "XX000" } });
    expect(await goes(recordDirectoryVerificationAction(fd(good)))).toBe("REDIRECT:/admin/ops/directory-freshness?n=record_failed");
  });
});
