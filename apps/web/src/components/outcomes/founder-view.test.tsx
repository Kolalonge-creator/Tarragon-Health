import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { outcomesDashboardCopy } from "@tarragon/i18n";

type Rpc = { data: unknown; error: { code?: string; message: string } | null };
let rpcResult: Rpc = { data: null, error: null };
let role = "admin";
const rpc = jest.fn(async (...args: unknown[]): Promise<Rpc> => {
  void args;
  return rpcResult;
});

jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: (n: string, a?: unknown) => rpc(n, a) }) }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: async () => ({ role }), getCurrentClinicalStaff: async () => null }));
jest.mock("@/lib/clinical/doctor-tier", () => ({ canAssignCases: () => false }));
jest.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
jest.mock("next/cache", () => ({ revalidatePath: () => undefined }));
jest.mock("./outcomes-dashboard-charts", () => ({ EngagementTrendChart: () => null, BeforeAfterChart: () => null }));

import { FounderView } from "./founder-view";
import { readFounderViewAction } from "@/lib/outcomes/dashboard-actions";
import { FOUNDER_IDLE } from "@/lib/outcomes/founder-state";

const SRC = join(__dirname, "..", "..");
const fixture = JSON.parse(readFileSync(join(SRC, "lib", "outcomes", "fixtures", "dashboard-rich.json"), "utf8")) as { report: { panels: { outcomes: unknown; comparison: unknown } } }[];
const view = () => ({
  founder_view: true,
  stored: false,
  as_of: "2026-10-22",
  config_version: 1,
  outcomes: fixture[0]!.report.panels.outcomes,
  comparison: fixture[0]!.report.panels.comparison,
  not_a_causal_claim: true,
  internal_only: true,
});
const form = (reason: string) => {
  const f = new FormData();
  f.set("reason", reason);
  return f;
};

beforeEach(() => {
  rpc.mockClear();
  role = "admin";
});

describe("the founder view page", () => {
  it("always shows the loud warning, word for word, with the form", () => {
    const html = renderToStaticMarkup(<FounderView />);
    expect(html).toContain(outcomesDashboardCopy["outcomes.dash.founder.banner"]);
    expect(outcomesDashboardCopy["outcomes.dash.founder.banner"]).toBe(
      "Founder view. Small groups. Not for sharing, not for the CMO or any partner. Individuals could be identifiable from differences between versions.",
    );
    expect(html).toContain('role="alert"');
    // the differencing risk is stated plainly, inside the same always-visible box
    expect(html).toContain(outcomesDashboardCopy["outcomes.dash.founder.differencing"]);
    expect(outcomesDashboardCopy["outcomes.dash.founder.differencing"]).toMatch(/different days/);
    expect(outcomesDashboardCopy["outcomes.dash.founder.differencing"]).toMatch(/stored monthly report/);
    expect(outcomesDashboardCopy["outcomes.dash.founder.differencing"]).toMatch(/point at individual people/);
    expect(outcomesDashboardCopy["outcomes.dash.founder.differencing"]).not.toMatch(/[–—]/);
    expect(html).toMatch(/<textarea[^>]*name="reason"[^>]*required/);
  });

  it("has no download, no export link and no CSV anywhere on the page", () => {
    const html = renderToStaticMarkup(<FounderView />);
    expect(html).not.toMatch(/href=|\/export|\.csv|<a /i);
  });
});

describe("the founder view action", () => {
  it("refuses everyone but the super admin before it calls the database", async () => {
    role = "clinician";
    const r = await readFounderViewAction(FOUNDER_IDLE, form("checking the pilot after the freeze"));
    expect(r).toEqual({ status: "error", message: "refused" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("needs a real reason before it calls the database", async () => {
    expect(await readFounderViewAction(FOUNDER_IDLE, form("short"))).toEqual({ status: "error", message: "reason" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the reason to the audited function and returns the figures to today, unstored", async () => {
    rpcResult = { data: view(), error: null };
    const r = await readFounderViewAction(FOUNDER_IDLE, form("checking the pilot after the freeze"));
    expect(rpc).toHaveBeenCalledWith("read_outcomes_founder_unfrozen", { p_reason: "checking the pilot after the freeze" });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.view.stored).toBe(false);
      expect(r.view.as_of).toBe("2026-10-22");
    }
  });

  it("turns the database refusals into words", async () => {
    for (const [code, message] of [["55000", "off"], ["42501", "refused"], ["22023", "reason"], ["XX000", "failed"]] as const) {
      rpcResult = { data: null, error: { code, message: "x" } };
      expect(await readFounderViewAction(FOUNDER_IDLE, form("checking the pilot after the freeze"))).toEqual({ status: "error", message });
    }
  });

  it("refuses a reply that is not the shape promised (for example one that claims to be stored)", async () => {
    rpcResult = { data: { ...view(), stored: true }, error: null };
    expect(await readFounderViewAction(FOUNDER_IDLE, form("checking the pilot after the freeze"))).toEqual({ status: "error", message: "failed" });
  });
});

describe("what must not exist", () => {
  it("has no CMO twin and no export route for the founder view", () => {
    const app = join(SRC, "app", "(dashboard)");
    expect(existsSync(join(app, "clinician", "engagement-outcomes", "founder"))).toBe(false);
    expect(existsSync(join(app, "clinician", "engagement-outcomes", "founder", "page.tsx"))).toBe(false);
    const founderDir = join(app, "admin", "outcomes", "engagement", "founder");
    expect(readdirSync(founderDir)).toEqual(["page.tsx"]);
  });

  it("is not reachable from the CSV or the report export", () => {
    for (const f of ["lib/outcomes/dashboard-csv.ts", "lib/outcomes/dashboard-export.ts"]) {
      expect(readFileSync(join(SRC, f), "utf8")).not.toMatch(/read_outcomes_founder|FounderView|parseFounderView/);
    }
  });
});
