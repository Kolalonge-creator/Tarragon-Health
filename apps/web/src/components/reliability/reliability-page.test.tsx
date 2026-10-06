/** @jest-environment node */
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import type { Dashboard } from "@/lib/reliability/model";

let result: { ok: true; data: Dashboard } | { ok: false; denied: boolean } = { ok: false, denied: false };
jest.mock("@/lib/reliability/load", () => ({ loadDashboard: async () => result }));

import { ReliabilityPage } from "./reliability-page";

const ops: Dashboard = {
  viewer: "ops", generated_at: "2026-10-06T10:00:00Z", window_days: 90,
  tasks: { waiting: [{ priority_class: 2, waiting: 3, oldest_wait_minutes: 125, past_due: 1, oldest_past_due_minutes: 30 }], claimed: 2, claimed_past_due: 1 },
  pages: { window_minutes: 5, total: 4, acknowledged: 3, acknowledged_in_window: 2, no_cover: 1, median_ack_seconds: 120, p90_ack_seconds: 400, unacknowledged: [{ sent_at: "2026-10-06T09:40:00Z", seconds_waiting: 1200, level: 1, no_cover: false }] },
  cover: { covered_now: false, primary_on_call: true, backup_on_call: false, gap_days: 7, gaps: [{ from: "2026-10-07T00:00:00Z", to: "2026-10-07T06:00:00Z", kind: "uncovered" }] },
  handbacks: { handed_back_other: 1, handed_back_reasoned: 1, completed_on_time: 6 },
  distribution: { clinicians: 6, min_group: 5, suppressed: false, scores: [95, 90, 80, 75, 60, 50] },
};
const lead: Dashboard = { ...ops, viewer: "lead", on_call: { primary: "Dr Ada", backup: null }, individuals: [{ name: "Dr Ada", tier: "senior_medical_officer", score: 91.4, events: 5, handbacks: 1 }] };
const html = async (viewer: "lead" | "ops", locale: "en" | "pcm" = "en") => renderToStaticMarkup(await ReliabilityPage({ viewer, locale }));

describe("ReliabilityPage", () => {
  it("a failed read shows a load failure and no figures at all", async () => {
    result = { ok: false, denied: false };
    const out = await html("ops");
    expect(out).toContain("could not be loaded");
    expect(out).not.toContain("Tasks waiting");
    expect(out).not.toContain(" 0 ");
  });
  it("ops sees the figures, the gap, the unacknowledged page and the bands, with no names", async () => {
    result = { ok: true, data: ops };
    const out = await html("ops");
    expect(out).toContain("Class 2");
    expect(out).toContain("2 h 5 min");
    expect(out).toContain("1 past their due time");
    expect(out).toContain("2 of 4 acknowledged within 5 minutes");
    expect(out).toContain("Nobody on call");
    expect(out).toContain("Waiting 20 min");
    expect(out).toContain("85 and above");
    expect(out).not.toContain("Each clinician");
    expect(out).not.toContain("Dr Ada");
    expect(out).not.toContain("Fix the rota");
  });
  it("the lead also sees who is on call and each clinician by name, with a note that it is not a ranking", async () => {
    result = { ok: true, data: lead };
    const out = await html("lead");
    expect(out).toContain("Primary: Dr Ada");
    expect(out).toContain("Backup: nobody");
    expect(out).toContain("Each clinician");
    expect(out).toContain("Score 91");
    expect(out).toContain("not by score");
    expect(out).toContain("Fix the rota");
  });
  it("a small group is withheld from ops with the reason", async () => {
    result = { ok: true, data: { ...ops, distribution: { clinicians: 2, min_group: 5, suppressed: true, scores: null } } };
    const out = await html("ops");
    expect(out).toContain("at least 5 clinicians");
    expect(out).not.toContain("85 and above");
  });
  it("renders in Pidgin and holds no em dash", async () => {
    result = { ok: true, data: lead };
    const out = await html("lead", "pcm");
    expect(out).toContain("Tasks wey dey wait");
    expect(out).not.toContain("—");
  });
});
