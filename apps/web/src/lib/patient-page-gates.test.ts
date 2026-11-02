import { describe, expect, it, jest } from "@jest/globals";
import { getNavSections } from "./navigation";
import { buildPatientSearchIndex } from "./patient-search";
import { navHrefs, readHiddenPatientHrefs, withoutHiddenNav, withoutHiddenSearch } from "./patient-page-gates";

type Reply = { data: unknown; error: { message: string } | null };

/** A tiny stand-in for the Supabase client: guard answers by key, plus what the person holds. */
function client(opts: { guards: Record<string, boolean | "error">; appointments?: number; records?: unknown[]; member?: boolean; orders?: unknown[] }) {
  const rpc = jest.fn(async (fn: string, args?: { p_key?: string }): Promise<Reply> => {
    if (fn === "go_live_guard_is_open") {
      const v = opts.guards[args?.p_key ?? ""];
      return v === "error" || v === undefined ? { data: null, error: { message: "boom" } } : { data: v, error: null };
    }
    if (fn === "my_records_requests") return { data: opts.records ?? [], error: null };
    if (fn === "my_membership") return { data: { is_member: opts.member ?? false, ends_at: null, source: null }, error: null };
    if (fn === "my_orders") return { data: opts.orders ?? [], error: null };
    return { data: null, error: { message: "unexpected" } };
  });
  const from = jest.fn(() => ({
    select: () => ({ eq: async () => ({ count: opts.appointments ?? 0, error: null }) }),
  }));
  return { rpc, from } as never;
}

const CANDIDATES = ["/patient/appointments", "/patient/membership", "/patient/records-requests", "/patient/diary"];

describe("readHiddenPatientHrefs", () => {
  it("hides a page whose guard is closed when the person holds nothing there", async () => {
    const c = client({ guards: { clinical_operations_enabled: false, membership_billing_enabled: false, records_request_letters: false, paper_diary_entry: false } });
    expect([...(await readHiddenPatientHrefs(c, "p1", CANDIDATES))].sort()).toEqual(CANDIDATES.slice().sort());
  });

  it("shows pages whose guards are open", async () => {
    const c = client({ guards: { clinical_operations_enabled: true, membership_billing_enabled: true, records_request_letters: true, paper_diary_entry: true } });
    expect((await readHiddenPatientHrefs(c, "p1", CANDIDATES)).size).toBe(0);
  });

  it("keeps a closed page the person already holds something on", async () => {
    const c = client({
      guards: { clinical_operations_enabled: false, membership_billing_enabled: false, records_request_letters: false, paper_diary_entry: false },
      appointments: 2,
      records: [{ id: "r" }],
      member: true,
    });
    expect([...(await readHiddenPatientHrefs(c, "p1", CANDIDATES))]).toEqual(["/patient/diary"]);
  });

  it("fails closed for hiding when a guard cannot be read (diary), but never hides a holdable page it cannot prove empty", async () => {
    const c = client({ guards: { paper_diary_entry: "error", clinical_operations_enabled: "error" }, appointments: 0 });
    const hidden = await readHiddenPatientHrefs(c, "p1", ["/patient/diary", "/patient/appointments"]);
    expect(hidden.has("/patient/diary")).toBe(true);
    expect(hidden.has("/patient/appointments")).toBe(false); // guard unreadable on a holdable page => stays
  });

  it("reads nothing for a menu that has none of the gated pages", async () => {
    const c = client({ guards: {} });
    expect((await readHiddenPatientHrefs(c, "p1", ["/patient/vitals"])).size).toBe(0);
    expect((c as unknown as { rpc: jest.Mock }).rpc).not.toHaveBeenCalled();
  });

  it("never touches a safety page, whatever the answers", async () => {
    const c = client({ guards: {} });
    const hidden = await readHiddenPatientHrefs(c, "p1", ["/patient/emergency-card", "/patient/messages", "/patient/vitals", ...CANDIDATES]);
    for (const safe of ["/patient/emergency-card", "/patient/messages", "/patient/vitals"]) expect(hidden.has(safe)).toBe(false);
  });
});

describe("withoutHiddenNav and withoutHiddenSearch", () => {
  const sections = getNavSections("patient", true);
  it("takes the page out of the real patient menu and out of search", () => {
    const hidden = new Set(["/patient/appointments", "/patient/membership"]);
    const menu = withoutHiddenNav(sections, hidden);
    const hrefs = navHrefs(menu);
    expect(hrefs).not.toContain("/patient/appointments");
    expect(hrefs).not.toContain("/patient/membership");
    expect(hrefs).toContain("/patient/messages");
    expect(hrefs).toContain("/patient/emergency-card");
    const search = withoutHiddenSearch(buildPatientSearchIndex(sections), hidden).map((e) => e.href);
    expect(search).not.toContain("/patient/appointments");
    expect(search).toContain("/patient/messages");
  });
  it("returns the menu untouched when nothing is hidden", () => {
    expect(withoutHiddenNav(sections, new Set())).toBe(sections);
  });
});
