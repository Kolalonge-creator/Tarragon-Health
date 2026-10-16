/** @jest-environment node */
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import type { GuardStatus } from "@/lib/go-live/model";

const guard = (over: Partial<GuardStatus>): GuardStatus => ({
  key: "payouts_enabled",
  label: "Payouts",
  blocks: "Payout sending",
  condition_text: "x",
  switch_role: "admin",
  enforced_in: [],
  not_enforced_in: "Payout sending is not built yet.",
  is_on: false,
  changed_at: null,
  changed_by_name: null,
  change_note: null,
  conditions: [
    { code: "fee_schedule_approved", label: "A fee schedule is approved", met: false, source: "attestation", detail: null },
    { code: "phone", label: "Read from data", met: true, source: "data", detail: "1 active" },
  ],
  all_met: false,
  recent: [],
  ...over,
});

let guards: GuardStatus[] = [];
let guardsOk = true;
jest.mock("@/lib/go-live/load", () => ({
  loadGuards: async () => (guardsOk ? { ok: true, data: guards } : { ok: false }),
  loadSignoffs: async () => ({ ok: true, data: [] }),
}));
jest.mock("@/lib/go-live/actions", () => ({ attestConditionAction: async () => undefined, signoffConfigAction: async () => undefined, switchGuardAction: async () => undefined }));

import { GoLivePage } from "./go-live-page";

const html = async (viewer: "admin" | "cmo" | "ops", locale: "en" = "en", extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(await GoLivePage({ viewer, locale, ...extra }));

describe("GoLivePage", () => {
  it("says in words when a guard blocks nothing yet, so nobody thinks the feature is protected", async () => {
    guards = [guard({})];
    const out = await html("admin");
    expect(out).toContain("Not enforced anywhere yet, so switching it on or off changes nothing today.");
  });

  it("lists what a wired guard is enforced in", async () => {
    guards = [guard({ key: "clinical_operations_enabled", label: "Clinical operations", enforced_in: ["hold_appointment_slot", "service_get_encounter_room"] })];
    const out = await html("admin");
    expect(out).toContain("hold_appointment_slot, service_get_encounter_room");
    expect(out).not.toContain("changes nothing today");
  });

  it("disables the switch-on button while a condition is unmet and says why", async () => {
    guards = [guard({})];
    const out = await html("admin");
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Switch on<\/button>/);
    expect(out).toContain("Not all conditions are met");
  });

  it("enables it only when every condition is met", async () => {
    guards = [guard({ all_met: true, conditions: [{ code: "a", label: "A", met: true, source: "data", detail: null }] })];
    const out = await html("admin");
    expect(out).not.toMatch(/<button[^>]*disabled=""[^>]*>Switch on<\/button>/);
    expect(out).toContain("Switch on");
  });

  it("shows no switch-on control to the wrong role, but still offers the stop button on a guard that is on", async () => {
    guards = [guard({ switch_role: "cmo" }), guard({ key: "scribe_enabled", label: "AI scribe", is_on: true, all_met: true })];
    const out = await html("admin");
    expect(out).toContain("Only the Chief Medical Officer can switch this on.");
    expect(out).toContain("Switch off");
  });

  it("flags a guard that is on while a condition is no longer met", async () => {
    guards = [guard({ is_on: true, all_met: false })];
    expect(await html("admin")).toContain("a condition is no longer met");
  });

  it("shows the code name of every condition a person records, and of no other", async () => {
    guards = [guard({ all_met: false })];
    const out = await html("admin");
    const codes = [...out.matchAll(/data-testid="attestation-code"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(codes).toEqual(["fee_schedule_approved"]);
  });

  it("offers attestation forms only for conditions a person records", async () => {
    guards = [guard({})];
    const out = await html("admin");
    expect(out.match(/name="code"/g)?.length).toBe(1);
    expect(out).toContain('value="fee_schedule_approved"');
  });

  it("lists every proposed value, with sign-off controls only on the viewer's own", async () => {
    guards = [];
    const admin = await html("admin");
    const cmo = await html("cmo");
    expect(admin).toContain("paging.escalation_minutes");
    expect(admin).toContain("Only the owner confirms this.");
    expect(cmo).toContain("Confirm this value");
    expect(admin).toContain("Confirm this value");
    // a CMO-owned value has no confirm form on the founder's page
    const pagingBlock = admin.slice(admin.indexOf('id="paging.escalation_minutes"'), admin.indexOf('id="paging.escalation_minutes"') + 1500);
    expect(pagingBlock).toContain("Only the owner confirms this.");
  });

  it("shows a calm message when the guards cannot be loaded", async () => {
    guardsOk = false;
    const out = await html("admin", "en");
    expect(out).toContain("This could not be loaded just now");
    guardsOk = true;
  });

  it("shows a notice from a redirect only when it is one of ours", async () => {
    guards = [];
    expect(await html("admin", "en", { notice: "golive.done.switched_on", ok: true })).toContain("Switched on.");
    expect(await html("admin", "en", { notice: "common.continue", ok: true })).not.toContain("Continue");
  });

  it("shows an operations user every guard and no form or button at all", async () => {
    guards = [guard({ is_on: true, all_met: true })];
    const out = await html("ops");
    expect(out).toContain("Payouts");
    expect(out).toContain("A fee schedule is approved");
    expect(out).toContain("This is a read-only view.");
    expect(out).not.toContain("<form");
    expect(out).not.toContain("<button");
    expect(out).not.toContain("Switch off");
    expect(out).not.toContain("Switch on");
  });

  it("does not list the proposed-value sign-offs for an operations user", async () => {
    guards = [guard({})];
    const out = await html("ops");
    expect(out).not.toContain("proposed-values");
  });
});
