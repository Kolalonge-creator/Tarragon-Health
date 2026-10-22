jest.mock("server-only", () => ({}));
import { postCheckinRulesView, readPendingPostCheckinSignoff } from "./pending-post-checkin-signoff";

const rules = {
  offsets: [{ code: "h48", after_minutes: 2880 }, { code: "d7", after_minutes: 10080 }],
  nudge_after_minutes: 1440,
  expire_after_minutes: 2880,
  max_nudges: 1,
  concern_alert_level: "clinician_review",
  questions: [{ text: "How are you?", options: [{ code: "a", label: "Fine", route: "ok" }, { code: "b", label: "Worse", route: "concern_alert" }] }],
};

describe("postCheckinRulesView", () => {
  it("turns minutes into hours for the panel", () => {
    expect(postCheckinRulesView(rules)).toMatchObject({ offsets: [{ code: "h48", afterHours: 48 }, { code: "d7", afterHours: 168 }], nudgeAfterHours: 24, expireAfterHours: 48, maxNudges: 1 });
  });
  it("returns null when something it must show is missing", () => {
    expect(postCheckinRulesView({ ...rules, offsets: undefined })).toBeNull();
    expect(postCheckinRulesView(null)).toBeNull();
  });
});

function client(res: { data: unknown; error: unknown } | "throw") {
  return {
    from: () => ({
      select: () => {
        if (res === "throw") throw new Error("boom");
        return Promise.resolve(res);
      },
    }),
  } as never;
}

describe("readPendingPostCheckinSignoff", () => {
  it("reports the newest unsigned draft newer than the live one", async () => {
    const rows = [{ version: 1, is_active: false, approved_at: null, rules }];
    expect(await readPendingPostCheckinSignoff(client({ data: rows, error: null }))).toMatchObject({ version: 1, failed: false });
  });
  it("reports nothing waiting once signed", async () => {
    const rows = [{ version: 1, is_active: true, approved_at: "2026-10-16", rules }];
    expect(await readPendingPostCheckinSignoff(client({ data: rows, error: null }))).toMatchObject({ version: null, failed: false });
  });
  it("never shows a failed read as an all-clear", async () => {
    expect((await readPendingPostCheckinSignoff(client({ data: null, error: { message: "x" } }))).failed).toBe(true);
    expect((await readPendingPostCheckinSignoff(client("throw"))).failed).toBe(true);
  });
});
