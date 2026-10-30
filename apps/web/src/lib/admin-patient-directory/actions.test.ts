const rpc = jest.fn();
const profile = jest.fn();
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: () => profile() }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { loadDirectoryAction } from "./actions";

const summary = { total: 0, active: 0, dormant: 0, never: 0, members: 0, free: 0, inactive: 0, account_active: 0, new_30d: 0, avg_time_spent_seconds: 0, paid_total_kobo: 0 };

beforeEach(() => {
  rpc.mockReset();
  profile.mockReset();
  profile.mockResolvedValue({ id: "a", role: "admin" });
});

describe("loadDirectoryAction", () => {
  it("refuses a non-admin before calling the database", async () => {
    profile.mockResolvedValue({ id: "c", role: "clinician" });
    expect(await loadDirectoryAction({})).toEqual({ ok: false, error: "denied" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses unknown filters without calling the database", async () => {
    expect(await loadDirectoryAction({ segment: "everything" })).toEqual({ ok: false, error: "query" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("sends the trimmed search and the page offset to the function", async () => {
    rpc.mockResolvedValue({ data: { summary, matching: 0, rows: [] }, error: null });
    await loadDirectoryAction({ search: "  Ada ", segment: "members", sort: "time_spent", dir: "asc", page: 2 });
    expect(rpc).toHaveBeenCalledWith("admin_patient_directory", {
      p_search: "Ada", p_segment: "members", p_sort: "time_spent", p_dir: "asc", p_limit: 25, p_offset: 50,
    });
  });
  it("shows a database error as a failure, never as an empty directory", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    expect(await loadDirectoryAction({})).toEqual({ ok: false, error: "failed" });
  });
  it("treats a malformed answer as a failure", async () => {
    rpc.mockResolvedValue({ data: { rows: [{ patient_id: "nope" }] }, error: null });
    expect(await loadDirectoryAction({})).toEqual({ ok: false, error: "failed" });
  });
});
