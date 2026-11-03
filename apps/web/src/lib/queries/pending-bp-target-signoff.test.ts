import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

jest.mock("server-only", () => ({}));

import { bpTargetView, readPendingBpTargetSignoff } from "./pending-bp-target-signoff";

const v1 = {
  targets: { home: { systolic: 135, diastolic: 85 }, clinic: { systolic: 140, diastolic: 90 } },
  grade: { minReadingsPerPerson: 3, restMinutes: 5, minGapMinutes: 1, repeatWindowMinutes: 10 },
  contextToTarget: { diary: "home", clinic: "clinic", pharmacy: "clinic", home_self: "home", home_assisted: "home" },
};

const client = (result: { data: unknown; error: unknown }) =>
  ({ rpc: jest.fn(async () => result) }) as unknown as SupabaseClient<Database>;

describe("bpTargetView", () => {
  it("reads the targets, the readings needed and every context", () => {
    const view = bpTargetView(v1);
    expect(view?.home).toEqual({ systolic: 135, diastolic: 85 });
    expect(view?.clinic).toEqual({ systolic: 140, diastolic: 90 });
    expect(view?.minReadingsPerPerson).toBe(3);
    expect(view?.contexts).toContainEqual({ context: "pharmacy", target: "clinic" });
  });
  it("refuses to show a version with a missing value or an unknown target, so Sign is never offered on it", () => {
    expect(bpTargetView({ ...v1, targets: { home: { systolic: 135 }, clinic: v1.targets.clinic } })).toBeNull();
    expect(bpTargetView({ ...v1, contextToTarget: { diary: "ward" } })).toBeNull();
    expect(bpTargetView(null)).toBeNull();
  });
});

describe("readPendingBpTargetSignoff", () => {
  it("returns the pending version with its view", async () => {
    const res = await readPendingBpTargetSignoff(client({ data: { live: null, pending: { version: 1, config: v1 } }, error: null }));
    expect(res).toMatchObject({ version: 1, liveVersion: null, failed: false });
    expect(res.view?.home.systolic).toBe(135);
  });
  it("returns nothing pending once signed", async () => {
    const res = await readPendingBpTargetSignoff(client({ data: { live: { version: 1, config: v1 }, pending: null, current_default: v1.targets.home }, error: null }));
    expect(res).toEqual({ version: null, view: null, liveVersion: 1, currentDefault: { systolic: 135, diastolic: 85 }, failed: false });
  });
  it("reads the current default from the database, so the sign-off text never hard-codes it", async () => {
    const res = await readPendingBpTargetSignoff(
      client({ data: { live: null, pending: { version: 1, config: v1 }, current_default: { systolic: 140, diastolic: 90 } }, error: null })
    );
    expect(res.currentDefault).toEqual({ systolic: 140, diastolic: 90 });
  });
  it("reports a failed read instead of an all-clear", async () => {
    const res = await readPendingBpTargetSignoff(client({ data: null, error: { code: "42501", message: "not authorised" } }));
    expect(res.failed).toBe(true);
  });
});
