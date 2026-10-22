import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { outcomesDashboardCopy } from "@tarragon/i18n";

type RpcResult = { data: unknown; error: { message: string } | null };
let rpcResult: RpcResult = { data: [], error: null };
const rpc = jest.fn(async (...args: unknown[]): Promise<RpcResult> => {
  void args;
  return rpcResult;
});

jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: (name: string, args?: unknown) => rpc(name, args) }) }));
// The charts are client components that draw with recharts; the page's own words and figures are what is proven here.
jest.mock("./outcomes-dashboard-charts", () => ({ EngagementTrendChart: () => null, BeforeAfterChart: () => null }));
jest.mock("@/lib/outcomes/dashboard-actions", () => ({ runDashboardAction: async () => undefined }));

import { OutcomesDashboardPage } from "./outcomes-dashboard-page";

const fixture = (name: string): unknown => JSON.parse(readFileSync(join(__dirname, "..", "..", "lib", "outcomes", "fixtures", name), "utf8"));
const render = async (viewer: "admin" | "cmo", outcome?: string) => renderToStaticMarkup(await OutcomesDashboardPage({ viewer, outcome }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

beforeEach(() => {
  rpc.mockClear();
});

describe("the outcomes dashboard page", () => {
  it("reads through the audited function and nothing else", async () => {
    rpcResult = { data: fixture("dashboard-rich.json"), error: null };
    await render("admin");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[0]).toBe("read_outcomes_dashboard");
  });

  it("keeps engagement and clinical outcomes in separate panels and offers no combined score", async () => {
    rpcResult = { data: fixture("dashboard-rich.json"), error: null };
    const s = text(await render("admin"));
    expect(s).toContain(outcomesDashboardCopy["outcomes.dash.engagement.title"]);
    expect(s).toContain(outcomesDashboardCopy["outcomes.dash.outcomes.title"]);
    expect(s).toContain(outcomesDashboardCopy["outcomes.dash.compare.title"]);
    expect(s).not.toMatch(/\b(overall score|health index|composite|combined score|impact score)\b/i);
  });

  it("always says it is internal and that a difference is an association, with a full report, an empty one, and a failed read", async () => {
    for (const data of [fixture("dashboard-rich.json"), [], null] as const) {
      rpcResult = { data, error: data === null ? { message: "denied" } : null };
      const s = text(await render("cmo"));
      expect(s).toContain(outcomesDashboardCopy["outcomes.dash.internal"]);
      expect(s).toContain(outcomesDashboardCopy["outcomes.dash.caveat.selection"]);
      expect(s).toContain(outcomesDashboardCopy["outcomes.dash.caveat.association"]);
    }
  });

  it("says plainly when there is nothing yet, and when the read failed", async () => {
    rpcResult = { data: [], error: null };
    expect(text(await render("admin"))).toContain(outcomesDashboardCopy["outcomes.dash.none"]);
    rpcResult = { data: null, error: { message: "denied" } };
    expect(text(await render("admin"))).toContain(outcomesDashboardCopy["outcomes.dash.load_error"]);
    rpcResult = { data: [{ not: "a report" }], error: null };
    expect(text(await render("admin"))).toContain(outcomesDashboardCopy["outcomes.dash.load_error"]);
  });

  it("shows held-back groups as held back, a calm 'not enough data yet', and never invents a number for them", async () => {
    rpcResult = { data: fixture("dashboard-sparse.json"), error: null };
    const s = text(await render("admin"));
    expect(s).toContain(outcomesDashboardCopy["outcomes.dash.not_enough"]);
    expect(s).toContain(outcomesDashboardCopy["outcomes.dash.withheld_neighbour"]);
    expect(s).toContain(outcomesDashboardCopy["outcomes.dash.compare.did_unavailable"]);
    // the small cohort's counts are not on the page: the fixture's day-90 cohort has 3 unmeasured people and is held back whole
    expect(s).not.toMatch(/under control, counting everyone due \(\d+ of 120\)/);
  });

  it("shows an estimate with its interval and the association-not-proof sentence when there is data", async () => {
    rpcResult = { data: fixture("dashboard-rich.json"), error: null };
    const s = text(await render("admin"));
    expect(s).toContain(outcomesDashboardCopy["outcomes.dash.compare.did_title"]);
    expect(s).toMatch(/interval includes zero|does not include zero/);
    expect(s).toContain("not proof");
    expect(s).toMatch(/Interval \d/);
  });

  it("mounts the same page under /admin and /clinician, each exporting to its own path", async () => {
    rpcResult = { data: fixture("dashboard-rich.json"), error: null };
    expect(await render("admin")).toContain('action="/admin/outcomes/engagement/export"');
    expect(await render("cmo")).toContain('action="/clinician/engagement-outcomes/export"');
  });

  it("makes no causal or marketing claim anywhere on the page", async () => {
    for (const f of ["dashboard-rich.json", "dashboard-sparse.json"]) {
      rpcResult = { data: fixture(f), error: null };
      const s = text(await render("admin"));
      expect(s).not.toMatch(/\b(caused|causes|led to|proves|proven|saved|savings|prevented|improved because|transform\w*|guarantee\w*)\b/i);
      expect(s).not.toMatch(/[–—]/);
      expect(s).not.toMatch(/your doctor/i);
    }
  });

  it("lists nothing about any person", async () => {
    rpcResult = { data: fixture("dashboard-rich.json"), error: null };
    const html = await render("admin");
    expect(html).not.toMatch(/patient_id|subject_key|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("shows the outcome of making a report", async () => {
    rpcResult = { data: fixture("dashboard-rich.json"), error: null };
    expect(text(await render("admin", "run_done"))).toContain(outcomesDashboardCopy["outcomes.dash.run.done"]);
    expect(text(await render("admin", "run_error"))).toContain(outcomesDashboardCopy["outcomes.dash.run.error"]);
  });
});
