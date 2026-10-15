/** @jest-environment node */
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import type { Wall } from "@/lib/ops-wall/model";

let result: { ok: true; data: Wall } | { ok: false; denied: boolean } = { ok: false, denied: false };
jest.mock("@/lib/ops-wall/load", () => ({ loadWall: async () => result }));

import { OperationsWall } from "./operations-wall";

const wall: Wall = {
  generated_at: "2026-10-12T10:00:00Z",
  queue: [{ priority_class: 2, waiting: 3, oldest_minutes: 125, past_due: 1 }],
  tasks_claimed: 2,
  pages: { open: 1, unacknowledged: 1, oldest_unacknowledged_seconds: 125, sent_24h: 4 },
  doctors_online: 7,
  on_call_covered: true,
  calls_in_progress: 2,
  calls_waiting: 1,
  tests_this_week: { orders: 10, results_received: 6, results_held: 2 },
  notifications: [{ channel: "push", sent: 90, failed: 10, pending: 3 }],
  payments: { events: 5, processed: 4, unprocessed: 1, errored: 0, taken_minor: 12000000 },
  alerts: {
    open: [{ rule: "unacknowledged_page", title: "A red-event page is unacknowledged past its first step", severity: "sev1", minutes_open: 7, detail: { minutes_waiting: 7 } }],
    rules_on: 11,
    rules_off: [{ rule: "cost_projection", reason: "Placeholder" }],
    rules_failing: 0,
    last_evaluated_at: "2026-10-12T09:59:30Z",
    contacts: 2,
  },
  incidents_open: { sev1: 1, sev2: 0 },
};
const html = async () => renderToStaticMarkup(await OperationsWall());

describe("OperationsWall", () => {
  it("a failed read shows a load failure and no figures", async () => {
    result = { ok: false, denied: false };
    const out = await html();
    expect(out).toContain("could not be loaded");
    expect(out).not.toContain("Open alerts");
  });
  it("a refusal says so", async () => {
    result = { ok: false, denied: true };
    expect(await html()).toContain("do not have access");
  });
  it("shows queue age, pages, doctors, calls, tests, delivery, payments and the open alert", async () => {
    result = { ok: true, data: wall };
    const out = await html();
    expect(out).toContain("Class 2: 3 waiting");
    expect(out).toContain("2 h 5 min");
    expect(out).toContain("1 past due");
    expect(out).toContain("1 open, 1 unacknowledged");
    expect(out).toContain("7 taking queue work");
    expect(out).toContain("2 in progress, 1 waiting");
    expect(out).toContain("10 ordered, 6 results in, 2 held");
    expect(out).toContain("10% failed");
    expect(out).toContain("4 processed, 1 waiting");
    expect(out).toContain("SEV1");
    expect(out).toContain("1 rules are off");
    expect(out).not.toContain("have not run");
  });
  it("says first when the alert checks have stopped, and when nobody is on call or no contact exists", async () => {
    result = { ok: true, data: { ...wall, on_call_covered: false, alerts: { ...wall.alerts, last_evaluated_at: null, contacts: 0 } } };
    const out = await html();
    expect(out).toContain("never run");
    expect(out).toContain("Nobody is on call right now");
    expect(out).toContain("No on-call contact is configured");
  });
});
