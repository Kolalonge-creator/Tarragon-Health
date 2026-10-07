import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertNoSmsChannel, SMS_CHANNEL_REMOVED_MESSAGE } from "./sms-policy";

const read = (rel: string) => readFileSync(join(process.cwd(), "src", rel), "utf8");

describe("assertNoSmsChannel (S85-D3)", () => {
  it("refuses an SMS channel in any case and lets email and in-app through", () => {
    expect(() => assertNoSmsChannel(["email", "sms"])).toThrow(SMS_CHANNEL_REMOVED_MESSAGE);
    expect(() => assertNoSmsChannel(["SMS"])).toThrow();
    expect(() => assertNoSmsChannel(["email", "in_app"])).not.toThrow();
    expect(() => assertNoSmsChannel([])).not.toThrow();
  });
});

describe("screens no longer offer SMS (sabotage: re-adding any of these makes the test fail)", () => {
  it("the broadcast composer has no SMS channel option", () => {
    const src = read("app/(dashboard)/admin/settings/broadcasts/broadcast-composer.tsx");
    expect(src).not.toMatch(/value:\s*["']sms["']/);
  });
  it("the broadcast sender and the employer announcement sender refuse SMS", () => {
    expect(read("lib/queries/broadcasts.ts")).toMatch(/assertNoSmsChannel\(input\.channels\)/);
    expect(read("lib/queries/employer-campaigns.ts")).toMatch(/assertNoSmsChannel\(input\.channels\)/);
  });
  it("the employer announcement screen does not list SMS as a choice", () => {
    const src = read("app/(dashboard)/dashboard/corporate/campaigns-announcements-manager.tsx");
    expect(src).toMatch(/Object\.entries\(CHANNEL_CHOICES\)/);
    const choices = /const CHANNEL_CHOICES[^}]*\}/.exec(src)?.[0] ?? "";
    expect(choices).not.toBe("");
    expect(choices).not.toMatch(/sms/i);
  });
  it("the roster manager has no SMS invitation and the hook only takes email", () => {
    expect(read("app/(dashboard)/dashboard/corporate/roster-manager.tsx")).not.toMatch(/channel:\s*["']sms["']|Invite by SMS/);
    expect(read("lib/queries/employer-roster.ts")).not.toMatch(/channel:\s*"email"\s*\|\s*"sms"/);
  });
  it("the dependent claim queues no notification and the patient-link SMS sender is gone", () => {
    expect(read("app/(dashboard)/patient/family/claim-dependent-actions.ts")).not.toMatch(/from\("notifications"\)/);
    expect(() => read("lib/notifications/send-patient-link.ts")).toThrow();
  });
});
