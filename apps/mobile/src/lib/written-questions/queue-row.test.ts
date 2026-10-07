import { parseOrQuarantine } from "./queue-row";

const base = { clientId: "c1", userId: "u1", createdAt: 42 };
const good = {
  clientId: "c1",
  userId: "u1",
  category: "symptom",
  question: "My knee is swollen.",
  durationNote: "",
  createdAt: 42,
  consultId: null,
  photos: [{ id: "p1", bytes: 100, uploaded: false, registered: false }],
  photosDropped: 0,
  attempts: 0,
  lastError: null,
  nextAttemptAt: 0,
  state: "queued",
  returnedKey: null,
};

describe("parseOrQuarantine", () => {
  it("returns a good row as its item", () => {
    expect(parseOrQuarantine({ ...base, item: JSON.stringify(good) })).toEqual(good);
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

  it.each([
    ["the photos list is missing", { ...good, photos: undefined }],
    ["a photo is malformed", { ...good, photos: [{ id: "p1" }] }],
    ["the state is not one of the two", { ...good, state: "sending" }],
    ["the category is unknown", { ...good, category: "billing" }],
    ["attempts is not a number", { ...good, attempts: "3" }],
    ["lastError is the wrong type", { ...good, lastError: 5 }],
  ])("quarantines a row that parses but is not an item: %s", (_name, bad) => {
    const out = parseOrQuarantine({ ...base, item: JSON.stringify(bad) });
    expect(out).toMatchObject({ clientId: "c1", state: "returned", lastError: "unreadable", question: "", photos: [] });
  });

  it("keeps a returned item as it is (the patient may still discard or restore it)", () => {
    const returned = { ...good, state: "returned", returnedKey: "wq.members_only", lastError: "refused" };
    expect(parseOrQuarantine({ ...base, item: JSON.stringify(returned) })).toEqual(returned);
  });
});
