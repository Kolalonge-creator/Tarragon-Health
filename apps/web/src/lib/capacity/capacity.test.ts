import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const redirect = jest.fn<(url: string) => never>((url: string) => {
  throw new Error(`REDIRECT ${url}`);
});
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
const rpc = jest.fn<(fn: string, args: Record<string, unknown>) => Promise<{ data?: unknown; error: { message: string; code?: string } | null }>>();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: (fn: string, args: Record<string, unknown>) => rpc(fn, args) }) }));

import { safeRotaReturnTo } from "@/lib/rota/return-to";
import { DEVICE_GUIDES, GENERAL_DEVICE_STEPS } from "./device-guides";
import { coverOverviewSchema, fireDrillReportSchema, GATE_REASON_LABEL, intakeOverviewSchema, myCoverOffersSchema, opsModeStatusSchema } from "./schemas";
import { decidePause, overrideRestRule, requestPause, respondCoverOffer, setIntakeOverride, startOpsMode } from "./actions";

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const run = async (fn: (f: FormData) => Promise<void>, f: FormData) => { try { await fn(f); return "no redirect"; } catch (e) { return decodeURIComponent((e as Error).message); } };
const ID = "11111111-2222-4333-8444-555555555555";

beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ error: null }); });

describe("the device guides", () => {
  it("cover Tecno, Infinix, Samsung and Xiaomi with real steps", () => {
    expect(DEVICE_GUIDES.map((g) => g.brand)).toEqual(["Tecno", "Infinix", "Samsung", "Xiaomi"]);
    for (const g of DEVICE_GUIDES) expect(g.steps.length).toBeGreaterThanOrEqual(3);
    expect(DEVICE_GUIDES.find((g) => g.brand === "Tecno")?.steps.join(" ")).toMatch(/Auto-start/);
    expect(DEVICE_GUIDES.find((g) => g.brand === "Samsung")?.steps.join(" ")).toMatch(/Unrestricted/);
    expect(DEVICE_GUIDES.find((g) => g.brand === "Xiaomi")?.steps.join(" ")).toMatch(/Autostart/);
  });

  it("never route a page through SMS or WhatsApp and use no em dash", () => {
    const all = [...DEVICE_GUIDES.flatMap((g) => g.steps), ...GENERAL_DEVICE_STEPS].join(" ");
    expect(all).not.toMatch(/sms|whatsapp|text message/i);
    expect(all).not.toContain("—");
  });
});

describe("the return path guard accepts the new pages and nothing else", () => {
  it("honours capacity, rest and cover and device check", () => {
    for (const p of ["/clinician/capacity", "/admin/capacity", "/clinician/rest-and-cover", "/clinician/device-check"]) expect(safeRotaReturnTo(p, "/clinician/on-call")).toBe(p);
    expect(safeRotaReturnTo("https://evil.example/clinician/capacity", "/clinician/on-call")).toBe("/clinician/on-call");
    expect(safeRotaReturnTo("/clinician/capacity/../../x", "/clinician/on-call")).toBe("/clinician/on-call");
  });
});

describe("answers from the database are parsed, not trusted", () => {
  const gate = { open: false, reasons: ["rota_coverage"], lead_capacity: 120, lead_in_use: 3, lead_free: 117, min_lead_headroom: 3, rota_gap_hours: 5.5, rota_horizon_hours: 72, class_breaches: [{ priority_class: 2, oldest_open_minutes: 90, warn_after_minutes: 60 }] };
  const overview = {
    enforced: false, config_version: 1, guard_on: false, gate, surge_active: false, pause_active: false, override: null, modes: [], overrides: [],
    limits: { surge_max_hours: 12, pause_max_hours: 24, override_max_hours: 24, pause_confirm_minutes: 240, reason_min_chars: 20 },
  };

  it("accepts a real overview and refuses a malformed one", () => {
    expect(intakeOverviewSchema.safeParse(overview).success).toBe(true);
    expect(intakeOverviewSchema.safeParse({ ...overview, gate: { ...gate, open: "yes" } }).success).toBe(false);
    expect(intakeOverviewSchema.safeParse({ ...overview, modes: [{ id: ID, mode: "freeze" }] }).success).toBe(false);
  });

  it("labels every reason the database can give", () => {
    for (const r of ["lead_headroom", "rota_coverage", "oldest_task"]) expect(GATE_REASON_LABEL[r]).toBeTruthy();
  });

  it("parses the smaller reads", () => {
    expect(opsModeStatusSchema.parse({ surge: null, pause: "2026-10-15T10:00:00Z" })).toEqual({ surge: null, pause: "2026-10-15T10:00:00Z" });
    expect(myCoverOffersSchema.safeParse({ rest_hours: 11, rest_enforced: false, offers: [{ id: ID, state: "offered", offered_at: "2026-10-15T01:00:00Z", responded_at: null, overnight_pages: 2, next_shift_starts_at: "2026-10-15T20:00:00Z", next_shift_ends_at: "2026-10-16T06:00:00Z" }] }).success).toBe(true);
    expect(myCoverOffersSchema.safeParse([]).success).toBe(false);
    expect(coverOverviewSchema.safeParse({ offers: [], rest_overrides: [], rest_enforced: true, rest_hours: 11 }).success).toBe(true);
  });

  it("parses a drill report with a missed drill (no times) and refuses an unknown group", () => {
    const row = { group: "clinician", key: ID, label: "A", sent: 1, acknowledged: 0, missed: 1, within_target: 0, pct_within_target: 0, p50_seconds: null, p95_seconds: null };
    const report = { days: 90, target_seconds: 300, target_pct: 90, pending: 0, meets_target: false, groups: [row] };
    expect(fireDrillReportSchema.safeParse(report).success).toBe(true);
    expect(fireDrillReportSchema.safeParse({ ...report, groups: [{ ...row, group: "colour" }] }).success).toBe(false);
  });
});

describe("the actions send the right call and show the database's sentence", () => {
  it("starts a surge or a pause with the written reason and hours", async () => {
    expect(await run(startOpsMode, form({ returnTo: "/clinician/capacity", mode: "surge", reason: "Two clinicians away this week", hours: "6" }))).toMatch(/^REDIRECT \/clinician\/capacity\?ok=Surge mode is on/);
    expect(rpc).toHaveBeenCalledWith("cmo_start_ops_mode", { p_mode: "surge", p_reason: "Two clinicians away this week", p_hours: 6 });
  });

  it("refuses a mode that does not exist before any call is made", async () => {
    expect(await run(startOpsMode, form({ mode: "freeze", reason: "x", hours: "6" }))).toMatch(/Check the details/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("an administrator can only request a pause, and the request goes back to the admin page", async () => {
    expect(await run(requestPause, form({ returnTo: "/admin/capacity", reason: "Payment partner outage, hold new sales" }))).toMatch(/^REDIRECT \/admin\/capacity\?ok=Your request was sent/);
    expect(rpc).toHaveBeenCalledWith("request_ops_pause", { p_reason: "Payment partner outage, hold new sales" });
  });

  it("confirming sends the hours, declining sends none", async () => {
    await run(decidePause, form({ id: ID, decision: "confirm", hours: "3" }));
    expect(rpc).toHaveBeenLastCalledWith("cmo_decide_ops_pause", { p_id: ID, p_confirm: true, p_hours: 3, p_note: null });
    await run(decidePause, form({ id: ID, decision: "decline", note: "Not needed" }));
    expect(rpc).toHaveBeenLastCalledWith("cmo_decide_ops_pause", { p_id: ID, p_confirm: false, p_hours: null, p_note: "Not needed" });
  });

  it("shows the database's refusal sentence for a non-CMO", async () => {
    rpc.mockResolvedValue({ error: { message: "only the chief medical officer can do this", code: "42501" } });
    expect(await run(setIntakeOverride, form({ reason: "Pilot launch week with a training clinician", hours: "4" }))).toMatch(/only the chief medical officer can do this/);
  });

  it("converts the rest rule override window from Lagos time and refuses a bad time", async () => {
    await run(overrideRestRule, form({ clinician: ID, reason: "Only qualified clinician for the weekend rota", from: "2026-10-16T08:00", to: "2026-10-16T20:00" }));
    expect(rpc).toHaveBeenCalledWith("cmo_override_rest_rule", { p_clinician: ID, p_from: "2026-10-16T07:00:00.000Z", p_to: "2026-10-16T19:00:00.000Z", p_reason: "Only qualified clinician for the weekend rota" });
    rpc.mockClear();
    expect(await run(overrideRestRule, form({ clinician: ID, reason: "x", from: "soon", to: "later" }))).toMatch(/Check the details/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers a cover offer as fit or as a request for cover", async () => {
    await run(respondCoverOffer, form({ id: ID, answer: "fit" }));
    expect(rpc).toHaveBeenLastCalledWith("respond_cover_offer", { p_offer: ID, p_fit: true, p_note: null });
    await run(respondCoverOffer, form({ id: ID, answer: "cover", note: "Please arrange cover" }));
    expect(rpc).toHaveBeenLastCalledWith("respond_cover_offer", { p_offer: ID, p_fit: false, p_note: "Please arrange cover" });
  });
});
