import { buildLabPartnerOverview } from "./overview-summary";

const todayStart = new Date("2026-10-30T23:00:00.000Z"); // midnight Lagos on the 31st
const weekStart = new Date("2026-10-24T12:00:00.000Z");
const reply = (data: unknown) => ({ data, error: null });

const rows = [
  { status: "payment_confirmed", resulted_at: null },
  { status: "sample_collected", resulted_at: null },
  { status: "processing", resulted_at: null },
  { status: "sample_rejected", resulted_at: null },
  { status: "cancelled", resulted_at: null },
  { status: "resulted", resulted_at: "2026-10-31T09:00:00+00:00" },
  { status: "resulted", resulted_at: "2026-10-28T09:00:00+00:00" },
  { status: "resulted", resulted_at: "2026-10-01T09:00:00+00:00" },
];

describe("buildLabPartnerOverview", () => {
  it("counts real orders", () => {
    const o = buildLabPartnerOverview(reply(rows), todayStart, weekStart);
    expect(o.failed).toBe(false);
    expect(o.tiles.routed.value).toBe("8");
    expect(o.tiles.resultedToday.value).toBe("1");
    expect(o.tiles.resultedThisWeek.value).toBe("2");
  });

  it("does not count a rejected sample as awaiting the lab's action", () => {
    const o = buildLabPartnerOverview(reply(rows), todayStart, weekStart);
    expect(o.tiles.awaiting.tile.value).toBe("3");
    expect(o.tiles.awaiting.needsAttention).toBe(true);
    expect(o.tiles.awaiting.delta?.text).toBe("Needs a result uploaded");
  });

  it("says 'All caught up' only for a genuinely empty queue that was read", () => {
    const o = buildLabPartnerOverview(reply([{ status: "resulted", resulted_at: "2026-10-01T00:00:00Z" }]), todayStart, weekStart);
    expect(o.tiles.awaiting.tile.value).toBe("0");
    expect(o.tiles.awaiting.delta?.text).toBe("All caught up");
    expect(o.tiles.awaiting.needsAttention).toBe(false);
  });

  it("reads an empty list as zero, because it was read", () => {
    const o = buildLabPartnerOverview(reply([]), todayStart, weekStart);
    expect(o.failed).toBe(false);
    expect(o.tiles.routed.value).toBe("0");
  });

  it("compares instants, so an offset or Z timestamp at the boundary is judged correctly", () => {
    const o = buildLabPartnerOverview(
      reply([
        { status: "resulted", resulted_at: "2026-10-31T00:00:00+01:00" }, // exactly the Lagos midnight
        { status: "resulted", resulted_at: "2026-10-30T22:59:59Z" }, // one second before
        // The database's own spelling of the same instant as todayStart. As text it sorts before
        // "2026-10-30T23:00:00.000Z", so a text comparison would drop it.
        { status: "resulted", resulted_at: "2026-10-30T23:00:00+00:00" },
      ]),
      todayStart,
      weekStart,
    );
    expect(o.tiles.resultedToday.value).toBe("2");
  });

  it.each([
    ["an error", { data: null, error: { message: "boom" } }],
    ["no data", { data: null, error: null }],
    ["a reply that is not a list", { data: { rows: [] }, error: null }],
  ])("is failed, never zero or 'All caught up', for %s", (_name, r) => {
    const o = buildLabPartnerOverview(r, todayStart, weekStart);
    expect(o.failed).toBe(true);
    for (const t of [o.tiles.routed, o.tiles.awaiting.tile, o.tiles.resultedToday, o.tiles.resultedThisWeek]) {
      expect(t.value).toBeUndefined();
      expect(t.empty).toEqual({ hint: "Could not be loaded" });
    }
    expect(o.tiles.awaiting.delta).toBeUndefined();
    expect(o.tiles.awaiting.needsAttention).toBe(false);
  });
});
