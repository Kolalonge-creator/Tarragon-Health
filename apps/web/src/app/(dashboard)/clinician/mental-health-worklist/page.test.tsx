/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server";

const redirect = jest.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const profile = jest.fn();
const rpc = jest.fn();
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next/link", () => ({ __esModule: true, default: (p: { href: string; children: unknown }) => require("react").createElement("a", { href: p.href }, p.children) }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: () => profile() }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));
jest.mock("./actions", () => ({ createMentalHealthFollowUpAction: jest.fn() }));

import Page from "./page";

const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  redirect.mockClear();
  rpc.mockReset();
  profile.mockResolvedValue({ role: "clinician" });
});

describe("/clinician/mental-health-worklist", () => {
  it("sends a non-clinician away and never calls the database", async () => {
    profile.mockResolvedValue({ role: "patient" });
    await expect(render()).rejects.toThrow("REDIRECT:/clinician");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("says plainly that nothing is shown until the rules are signed, and that this is not an all-clear", async () => {
    rpc.mockResolvedValue({ data: { status: "not_signed" }, error: null });
    const html = await render();
    expect(html).toContain("Waiting for the rules to be signed");
    expect(html).toContain("not an all-clear");
    expect(html).not.toContain("Nobody on your list");
  });

  it("says it is not switched on while the guard is off", async () => {
    rpc.mockResolvedValue({ data: { status: "off" }, error: null });
    expect(await render()).toContain("Not switched on yet");
  });

  it("gives a care coordinator a calm refusal with no scores", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not authorised" } });
    const html = await render();
    expect(html).toContain("Not available to you");
    expect(html).toContain("does not see scores");
  });

  it("a read failure is an error, never 'nobody on your list'", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    const html = await render();
    expect(html).toContain("could not be read");
    expect(html).not.toContain("Nobody on your list");
  });

  it("lists tied patients with the reason in words and the numbers, and a follow-up control", async () => {
    rpc.mockResolvedValue({
      data: {
        status: "ok", config_version: 1, notes: [],
        rows: [{ patient_id: "11111111-1111-4111-8111-111111111111", full_name: "Ada Obi", patient_number: "TH-100", followed_up_at: null, followed_up_task: null,
          reasons: [{ code: "rising_screen", facts: { instrument: "phq9", from: 8, to: 14, rise: 6, from_at: "2026-08-03T10:00:00Z", to_at: "2026-10-09T10:00:00Z" } }] }],
      },
      error: null,
    });
    const html = await render();
    expect(html).toContain("Ada Obi");
    expect(html).toContain("went from 8 to 14");
    expect(html).toContain("Make a follow-up task");
    expect(html).toContain("written to the audit log");
  });

  it("an empty list still says silence is not safety", async () => {
    rpc.mockResolvedValue({ data: { status: "ok", config_version: 1, notes: [], rows: [] }, error: null });
    const html = await render();
    expect(html).toContain("Nobody on your list");
    expect(html).toContain("does not mean everyone is well");
  });

  it("always states what the list does not detect", async () => {
    for (const data of [{ status: "not_signed" }, { status: "off" }, { status: "ok", rows: [], notes: [] }]) {
      rpc.mockResolvedValue({ data, error: null });
      const html = await render();
      expect(html).toContain("What this list does not detect");
      expect(html).toContain("not a risk predictor");
      expect(html).toContain("Silence is not safety");
    }
  });

  it("marks a patient already followed up but keeps them on the list", async () => {
    rpc.mockResolvedValue({
      data: { status: "ok", config_version: 1, notes: [], rows: [{ patient_id: "p1", full_name: "B C", patient_number: "TH-2", followed_up_at: "2026-10-20T09:00:00Z", followed_up_task: "t1",
        reasons: [{ code: "sleep_trouble", facts: { window_days: 14, entries: 9, trouble_nights: 6 } }] }] },
      error: null,
    });
    const html = await render();
    expect(html).toContain("Follow-up created");
    expect(html).toContain("stays on the list");
  });
});
