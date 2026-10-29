import { strFromU8, unzipSync } from "fflate";

const rpc = jest.fn();
const profile = jest.fn();
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: () => profile() }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { NextRequest } from "next/server";
import { POST } from "./route";

const row = {
  patient_id: "11111111-1111-4111-8111-111111111111", full_name: "Ada", patient_number: "TH-1", phone_masked: "+234*****123", city: null, state: null,
  age_band: "30-39", sex: "female", account_type: "Self", is_active: true, joined_at: "2026-10-01T08:00:00Z", onboarded_at: null, last_login_at: null,
  login_count: 0, last_active_at: null, activity_status: "never", visits_total: 0, visits_30d: 0, active_days_30d: 0, time_spent_seconds: 0,
  avg_visit_seconds: 0, main_device: null, actions_total: 0, actions_30d: 0, last_action_at: null, top_actions: [], top_sections: [], plan: "free",
  membership_state: null, membership_source: null, membership_started_at: null, membership_ends_at: null, auto_renew: false, purchases_count: 0,
  paid_total_kobo: 0, last_purchase_at: null,
};

function post(fields: Record<string, string>): NextRequest {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new NextRequest("http://localhost/admin/patients/directory/export", { method: "POST", body: form });
}
const GOOD = { reason: "Monthly engagement review", segment: "all", search: "" };
const call = { p_reason: "Monthly engagement review", p_search: null, p_segment: "all", p_sort: "joined", p_dir: "desc" };

beforeEach(() => {
  rpc.mockReset();
  profile.mockReset();
  profile.mockResolvedValue({ id: "a", role: "admin" });
});

describe("directory export route", () => {
  it("refuses a non-admin before calling the database", async () => {
    profile.mockResolvedValue({ id: "c", role: "clinician" });
    expect((await POST(post(GOOD))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses a missing or short reason before calling the database", async () => {
    expect((await POST(post({ ...GOOD, reason: "short" }))).status).toBe(400);
    expect((await POST(post({ segment: "all" }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses an unknown filter or an over-long search before calling the database", async () => {
    expect((await POST(post({ ...GOOD, segment: "everyone" }))).status).toBe(400);
    expect((await POST(post({ ...GOOD, search: "x".repeat(81) }))).status).toBe(400);
    expect((await POST(post({ ...GOOD, sort: "email" }))).status).toBe(400);
    expect((await POST(post({ ...GOOD, dir: "sideways" }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("sends the trimmed reason and filters, and returns a real xlsx with Lagos-time dates", async () => {
    rpc.mockResolvedValue({ data: { rows: [row] }, error: null });
    const res = await POST(post({ reason: "  Monthly engagement review  ", segment: "members", search: " Ada ", sort: "time_spent", dir: "asc" }));
    expect(rpc).toHaveBeenCalledWith("admin_patient_directory_export", { ...call, p_search: "Ada", p_segment: "members", p_sort: "time_spent", p_dir: "asc" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="tarragon-patient-directory-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"] as Uint8Array);
    expect(sheet).toContain("TH-1");
    // 08:00 UTC is 09:00 in Lagos: the stored serial must be 09:00, not 08:00.
    const serial = Number(sheet.match(/r="J2" s="2"><v>([\d.]+)<\/v>/)?.[1]);
    expect(Math.round((serial % 1) * 24)).toBe(9);
  });
  it("defaults to joined, newest first, when no sort is sent", async () => {
    rpc.mockResolvedValue({ data: { rows: [] }, error: null });
    await POST(post(GOOD));
    expect(rpc).toHaveBeenCalledWith("admin_patient_directory_export", call);
  });
  it("gives no file when the database refuses because too many patients match", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "too many", code: "54000" } });
    const res = await POST(post(GOOD));
    expect(res.status).toBe(413);
    expect(res.headers.get("Content-Type")).not.toMatch(/spreadsheet/);
  });
  it("gives no file when the audit could not be recorded", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    const res = await POST(post(GOOD));
    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).not.toMatch(/spreadsheet/);
  });
  it("maps the database's own refusal to 403", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "no", code: "42501" } });
    expect((await POST(post(GOOD))).status).toBe(403);
  });
  it("treats a malformed answer as a failure, not an empty file", async () => {
    rpc.mockResolvedValue({ data: { rows: [{ patient_id: "nope" }] }, error: null });
    expect((await POST(post(GOOD))).status).toBe(502);
  });
});
