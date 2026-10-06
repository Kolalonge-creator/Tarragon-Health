import { parseOrQuarantine } from "./queue-row";

const base = { clientId: "c1", userId: "u1", createdAt: 42 };

describe("parseOrQuarantine", () => {
  it("returns a good row as its item", () => {
    const item = { clientId: "c1", userId: "u1", question: "hi", state: "queued" };
    expect(parseOrQuarantine({ ...base, item: JSON.stringify(item) })).toMatchObject(item);
  });

  it("turns corrupt JSON into a returned item built from the row columns", () => {
    const out = parseOrQuarantine({ ...base, item: "{not json" });
    expect(out).toMatchObject({
      clientId: "c1",
      userId: "u1",
      createdAt: 42,
      state: "returned",
      returnedKey: "wq.error.generic",
      lastError: "unreadable",
      question: "",
      photos: [],
    });
  });

  it("turns JSON missing clientId into a returned item, trusting the row columns", () => {
    const out = parseOrQuarantine({ ...base, item: JSON.stringify({ userId: "u1", question: "x" }) });
    expect(out.clientId).toBe("c1");
    expect(out.state).toBe("returned");
    expect(out.lastError).toBe("unreadable");
  });

  it("treats JSON that is not an object as unreadable", () => {
    expect(parseOrQuarantine({ ...base, item: "null" }).state).toBe("returned");
    expect(parseOrQuarantine({ ...base, item: "42" }).state).toBe("returned");
  });
});
