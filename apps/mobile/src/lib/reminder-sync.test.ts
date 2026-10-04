import { REMINDER_ID_PREFIX, type PlannedNotification } from "./reminder-plan";
import { applyPlan, cancelAllReminders, type NotificationsPort, type PermissionState } from "./reminder-sync";

const note = (id: string, kind: "bp" | "dose" = "bp", at = 1_000): PlannedNotification => ({
  identifier: `${REMINDER_ID_PREFIX}${kind}:${id}:${at}`,
  kind,
  notifyAtMs: at,
  dueAtMs: at,
});

function fakePort(init: { scheduled?: string[]; permission?: PermissionState; grantOnRequest?: boolean } = {}) {
  const scheduled = new Set(init.scheduled ?? []);
  const calls: string[] = [];
  let permission: PermissionState = init.permission ?? "granted";
  const fail = { schedule: new Set<string>(), cancel: new Set<string>(), list: false };
  const port: NotificationsPort = {
    getPermission: async () => permission,
    requestPermission: async () => {
      calls.push("request");
      permission = init.grantOnRequest ? "granted" : "denied";
      return permission;
    },
    ensureChannel: async () => void calls.push("channel"),
    listScheduledIds: async () => {
      if (fail.list) throw new Error("boom");
      return [...scheduled];
    },
    cancel: async (id) => {
      if (fail.cancel.has(id)) throw new Error("cannot cancel");
      calls.push(`cancel:${id}`);
      scheduled.delete(id);
    },
    schedule: async (n) => {
      if (fail.schedule.has(n.identifier)) throw new Error("cannot schedule");
      calls.push(`schedule:${n.identifier}`);
      scheduled.add(n.identifier);
    },
  };
  return { port, scheduled, calls, fail };
}

describe("applyPlan", () => {
  it("schedules what is missing, keeps what is right, and cancels what is stale, in that safe order", async () => {
    const keep = note("a");
    const add = note("b");
    const stale = note("old");
    const { port, scheduled, calls } = fakePort({ scheduled: [keep.identifier, stale.identifier] });
    const res = await applyPlan(port, [keep, add], { askPermission: false });
    expect(res).toMatchObject({ status: "synced", scheduled: 1, cancelled: 1, kept: 1, failed: 0 });
    expect([...scheduled].sort()).toEqual([keep.identifier, add.identifier].sort());
    // Stale ones go first so the phone's limit is never exceeded in between.
    expect(calls.findIndex((c) => c.startsWith("cancel:"))).toBeLessThan(calls.findIndex((c) => c.startsWith("schedule:")));
  });

  it("is a no-op when the phone already matches the plan, so it is cheap to run on every launch", async () => {
    const a = note("a");
    const { port, calls } = fakePort({ scheduled: [a.identifier] });
    const res = await applyPlan(port, [a], { askPermission: false });
    expect(res).toMatchObject({ scheduled: 0, cancelled: 0, kept: 1 });
    expect(calls.filter((c) => c.startsWith("schedule:") || c.startsWith("cancel:"))).toEqual([]);
  });

  it("never touches a notification this feature does not own", async () => {
    const other = "some-other-feature-123";
    const { port, scheduled } = fakePort({ scheduled: [other] });
    await applyPlan(port, [note("a")], { askPermission: false });
    expect(scheduled.has(other)).toBe(true);
  });

  it("does nothing, and does not prompt, when there is nothing to plan and nothing scheduled", async () => {
    const { port, calls } = fakePort({ permission: "undetermined" });
    const res = await applyPlan(port, [], { askPermission: true });
    expect(res.status).toBe("nothing_to_do");
    expect(calls).toEqual([]);
  });

  it("clears out its own old notifications when the plan is empty", async () => {
    const old = note("gone");
    const { port, scheduled } = fakePort({ scheduled: [old.identifier] });
    const res = await applyPlan(port, [], { askPermission: false });
    expect(res).toMatchObject({ status: "synced", cancelled: 1 });
    expect(scheduled.size).toBe(0);
  });

  describe("permission", () => {
    it("asks only when allowed to, and only when there is something to schedule", async () => {
      const quiet = fakePort({ permission: "undetermined" });
      expect((await applyPlan(quiet.port, [note("a")], { askPermission: false })).status).toBe("no_permission");
      expect(quiet.calls).not.toContain("request");
      const asked = fakePort({ permission: "undetermined", grantOnRequest: true });
      expect((await applyPlan(asked.port, [note("a")], { askPermission: true })).status).toBe("synced");
      expect(asked.calls).toContain("request");
    });

    it("schedules nothing when permission is refused", async () => {
      const { port, scheduled } = fakePort({ permission: "undetermined", grantOnRequest: false });
      const res = await applyPlan(port, [note("a")], { askPermission: true });
      expect(res).toMatchObject({ status: "no_permission", permission: "denied", scheduled: 0 });
      expect(scheduled.size).toBe(0);
    });

    it("does not ask again when it is already granted", async () => {
      const { port, calls } = fakePort({ permission: "granted" });
      await applyPlan(port, [note("a")], { askPermission: true });
      expect(calls).not.toContain("request");
    });
  });

  describe("failures", () => {
    it("keeps going when one schedule fails, reports it, and leaves the rest in place", async () => {
      const a = note("a");
      const b = note("b");
      const { port, scheduled, fail } = fakePort();
      fail.schedule.add(a.identifier);
      const res = await applyPlan(port, [a, b], { askPermission: false });
      expect(res).toMatchObject({ status: "failed", scheduled: 1, failed: 1 });
      expect(scheduled.has(b.identifier)).toBe(true);
    });

    it("retries the failed one on the next run", async () => {
      const a = note("a");
      const { port, scheduled, fail } = fakePort();
      fail.schedule.add(a.identifier);
      await applyPlan(port, [a], { askPermission: false });
      fail.schedule.clear();
      const again = await applyPlan(port, [a], { askPermission: false });
      expect(again).toMatchObject({ status: "synced", scheduled: 1 });
      expect(scheduled.has(a.identifier)).toBe(true);
    });

    it("never throws, even when the phone cannot list its notifications", async () => {
      const { port, fail } = fakePort();
      fail.list = true;
      await expect(applyPlan(port, [note("a")], { askPermission: false })).resolves.toMatchObject({ status: "failed" });
    });

    it("a failed cancel is counted and does not stop scheduling", async () => {
      const stale = note("old");
      const { port, fail } = fakePort({ scheduled: [stale.identifier] });
      fail.cancel.add(stale.identifier);
      const res = await applyPlan(port, [note("a")], { askPermission: false });
      expect(res).toMatchObject({ status: "failed", scheduled: 1, failed: 1 });
    });
  });

  describe("preserve", () => {
    it("leaves a kind alone when its plan could not be worked out, so a failed read never wipes every dose reminder", async () => {
      const dose = note("m1", "dose");
      const bp = note("old", "bp");
      const { port, scheduled } = fakePort({ scheduled: [dose.identifier, bp.identifier] });
      await applyPlan(port, [], { askPermission: false, preserve: ["dose"] });
      expect(scheduled.has(dose.identifier)).toBe(true);
      expect(scheduled.has(bp.identifier)).toBe(false);
    });
  });
});

describe("cancelAllReminders", () => {
  it("cancels only this feature's notifications (for sign-out) and never throws", async () => {
    const mine = note("a");
    const other = "something-else";
    const { port, scheduled, fail } = fakePort({ scheduled: [mine.identifier, other] });
    expect(await cancelAllReminders(port)).toBe(1);
    expect([...scheduled]).toEqual([other]);
    fail.list = true;
    await expect(cancelAllReminders(port)).resolves.toBe(0);
  });
});
