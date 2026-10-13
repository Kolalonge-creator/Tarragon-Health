import { describeEntry, fetchAccessLog, type AccessLogEntry } from "./access-log";

const entry = (over: Partial<AccessLogEntry> = {}): AccessLogEntry => ({
  at: "2026-10-13T10:00:00Z",
  kind: "share_opened",
  actor_label: "Someone with your share link",
  actor_name: null,
  categories: ["vitals", "emergency_info"],
  status: null,
  ends_at: null,
  ...over,
});

describe("describeEntry", () => {
  it("names who, what kind of part of the record, and nothing clinical", () => {
    const d = describeEntry(entry());
    expect(d.title).toBe("A share link was opened");
    expect(d.who).toBe("Someone with your share link");
    expect(d.what).toBe("Part of your record: vitals, emergency info");
  });

  it("shows a person's name with their role, and a readable status", () => {
    const d = describeEntry(entry({ kind: "emergency_access_grant", actor_name: "Ada B", actor_label: "Person you allowed to use emergency access", categories: ["emergency_access"], status: "expired" }));
    expect(d.who).toBe("Ada B (Person you allowed to use emergency access)");
    expect(d.status).toBe("Expired");
  });

  it("falls back to a neutral word for a category it does not know, never a raw key", () => {
    const d = describeEntry(entry({ categories: ["something_new"], status: "mystery" }));
    expect(d.what).toBe("Part of your record: your record");
    expect(d.status).toBeNull();
    expect(d.what).not.toContain("my_health");
  });

  it("has wording for every kind the database can return", () => {
    for (const kind of ["share_opened", "share_pin_wrong", "share_locked", "emergency_card_opened", "emergency_access_grant", "emergency_record_access", "delegated_access", "staff_record_opened"] as const) {
      expect(describeEntry(entry({ kind })).title).not.toContain("my_health.log.kind");
    }
  });
});

describe("fetchAccessLog", () => {
  const client = (reply: unknown) => ({ rpc: jest.fn().mockResolvedValue(reply) }) as never;

  it("returns the entries newest first as given", async () => {
    const r = await fetchAccessLog(client({ data: [entry(), entry({ at: "2026-10-12T10:00:00Z" })], error: null }));
    expect(r.ok && r.entries.length).toBe(2);
  });

  it("an error is a failure, never an empty list that reads as 'no one looked'", async () => {
    expect(await fetchAccessLog(client({ data: null, error: { message: "x" } }))).toEqual({ ok: false });
    expect(await fetchAccessLog(client({ data: { not: "an array" }, error: null }))).toEqual({ ok: false });
  });

  it("drops rows of a kind it does not know", async () => {
    const r = await fetchAccessLog(client({ data: [entry(), { at: "2026-10-12T10:00:00Z", kind: "mystery" }], error: null }));
    expect(r.ok && r.entries.length).toBe(1);
  });

  it("passes the cursor", async () => {
    const c = client({ data: [], error: null });
    await fetchAccessLog(c, "2026-10-13T10:00:00Z");
    expect((c as unknown as { rpc: jest.Mock }).rpc).toHaveBeenCalledWith("my_access_log", { p_before: "2026-10-13T10:00:00Z" });
  });
});
