import { describeEntry, fetchAccessLog, type AccessLogEntry } from "./access-log";

const entry = (over: Partial<AccessLogEntry> = {}): AccessLogEntry => ({
  at: "2026-10-13T10:00:00Z",
  rid: "l:1",
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

  it("shows a staff opening as name and role, or role alone when there is no name, with no status", () => {
    const named = describeEntry(entry({ kind: "staff_record_opened", actor_label: "Senior Medical Officer", actor_name: "A. Okafor", categories: ["record_opened"] }));
    expect(named.who).toBe("A. Okafor (Senior Medical Officer)");
    expect(named.title).toBe("Your record was opened by a Tarragon staff member");
    expect(named.what).toBe("");
    expect(named.status).toBeNull();
    expect(describeEntry(entry({ kind: "staff_record_opened", actor_label: "Care Coordinator", actor_name: null, categories: ["record_opened"] })).who).toBe("Care Coordinator");
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

  it("keeps a row of a kind it does not know, with a neutral title, so nothing is silently hidden", async () => {
    const r = await fetchAccessLog(client({ data: [entry(), entry({ rid: "x:2", kind: "mystery" })], error: null }));
    expect(r.ok && r.entries.length).toBe(2);
    expect(describeEntry(entry({ kind: "mystery" })).title).toBe("Your record was accessed");
  });

  it("drops a row with no id or time (it cannot be a cursor)", async () => {
    const r = await fetchAccessLog(client({ data: [entry(), { kind: "share_opened" }], error: null }));
    expect(r.ok && r.entries.length).toBe(1);
  });

  it("passes the cursor (time and row id)", async () => {
    const c = client({ data: [], error: null });
    await fetchAccessLog(c, { at: "2026-10-13T10:00:00Z", rid: "l:9" });
    expect((c as unknown as { rpc: jest.Mock }).rpc).toHaveBeenCalledWith("my_access_log", { p_before: "2026-10-13T10:00:00Z", p_before_id: "l:9" });
  });
});
