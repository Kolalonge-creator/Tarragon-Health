import { buildHistory, buildRecordDescription, lagosClock, lagosDateText, readingReference, referencedReadingId, type CorrectionRequest, type HistoryReading, type RecordCorrection } from "./bp-history-model";
import { lagosTimeToUtcMs } from "./lagos-date";

const iso = (date: string, time: string) => new Date(lagosTimeToUtcMs(date, time) as number).toISOString();
const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ID3 = "33333333-3333-4333-8333-333333333333";
const reading = (id: string, date: string, time: string, over: Partial<HistoryReading> = {}): HistoryReading => ({
  id,
  systolic: 130,
  diastolic: 80,
  takenAt: iso(date, time),
  source: "manual",
  syncState: "sent",
  ...over,
});
const request = (id: string, status: CorrectionRequest["status"], at: string, over: Partial<CorrectionRequest> = {}): CorrectionRequest => ({
  id: `req-${id}-${at}`,
  status,
  requestedAt: at,
  recordDescription: `Blood pressure reading 130/80 mmHg ${readingReference(id)}`,
  decisionNote: null,
  resolutionNote: null,
  ...over,
});
const base = { requests: [], corrections: [], canRequest: true };

describe("the reference carried by a request", () => {
  it("round-trips, and is plain words first so the reviewer can read it", () => {
    const text = buildRecordDescription(reading(ID1, "2026-10-04", "14:05", { systolic: 152, diastolic: 96 }));
    expect(text).toBe(`Blood pressure reading 152/96 mmHg, 2026-10-04 14:05 (Lagos) ${readingReference(ID1)}`);
    expect(referencedReadingId(text)).toBe(ID1);
    expect(referencedReadingId("my date of birth")).toBeNull();
    expect(referencedReadingId("[ref:vitals_readings:not-an-id]")).toBeNull();
  });

  it("shows Lagos time of day, not the phone's", () => {
    expect(lagosClock(Date.parse("2026-10-04T13:05:00Z"))).toBe("14:05");
    expect(lagosClock(Date.parse("2026-10-04T23:30:00Z"))).toBe("00:30");
    expect(lagosDateText("2026-10-04T23:30:00Z")).toBe("05/10/2026");
    expect(lagosDateText("nonsense")).toBe("");
  });
});

describe("days and order", () => {
  it("groups by Lagos day, newest day and reading first", () => {
    const days = buildHistory({
      ...base,
      readings: [
        reading(ID1, "2026-10-03", "08:00"),
        reading(ID2, "2026-10-04", "07:00"),
        reading(ID3, "2026-10-04", "19:00"),
      ],
    });
    expect(days.map((d) => d.localDate)).toEqual(["2026-10-04", "2026-10-03"]);
    expect(days[0]?.rows.map((r) => r.reading.id)).toEqual([ID3, ID2]);
    expect(days[0]).toMatchObject({ dayMonth: "04/10", weekday: 0 }); // Sunday
  });

  it("puts a reading logged just after midnight Lagos on the new day", () => {
    const late = reading(ID1, "2026-10-03", "23:30");
    const early = { ...reading(ID2, "2026-10-04", "00:30") };
    expect(buildHistory({ ...base, readings: [late, early] }).map((d) => d.localDate)).toEqual(["2026-10-04", "2026-10-03"]);
  });

  it("drops a reading whose time cannot be read rather than guessing a day", () => {
    expect(buildHistory({ ...base, readings: [{ ...reading(ID1, "2026-10-04", "08:00"), takenAt: "nonsense" }] })).toEqual([]);
  });
});

describe("asking for a correction", () => {
  const row = (over: Partial<Parameters<typeof buildHistory>[0]> = {}, r = reading(ID1, "2026-10-04", "08:00")) =>
    buildHistory({ ...base, readings: [r], ...over })[0]?.rows[0];

  it("is offered for a reading the care team has", () => {
    expect(row()?.canAsk).toBe(true);
  });

  it("is not offered for a reading still on the phone or not accepted: there is nothing on the server to correct", () => {
    expect(row({}, reading(ID1, "2026-10-04", "08:00", { syncState: "on_phone" }))?.canAsk).toBe(false);
    expect(row({}, reading(ID1, "2026-10-04", "08:00", { syncState: "not_accepted", supportCode: "AB12" }))?.canAsk).toBe(false);
  });

  it("is not offered while acting for someone else or when requests could not be loaded", () => {
    expect(row({ canRequest: false })?.canAsk).toBe(false);
  });

  it("allows one open request per reading, including an approved one not yet applied", () => {
    for (const status of ["pending", "under_review", "approved"] as const) {
      expect(row({ requests: [request(ID1, status, "2026-10-04T10:00:00Z")] })).toMatchObject({ canAsk: false, request: { phase: status === "approved" ? "approved" : "open" } });
    }
  });

  it("allows a new request after one was refused or finished", () => {
    expect(row({ requests: [request(ID1, "denied", "2026-10-04T10:00:00Z", { decisionNote: "Matches the device" })] })).toMatchObject({
      canAsk: true,
      request: { phase: "denied", decisionNote: "Matches the device" },
    });
    expect(row({ requests: [request(ID1, "applied", "2026-10-04T10:00:00Z", { resolutionNote: "Corrected" })] })).toMatchObject({ canAsk: true, request: { phase: "applied" } });
  });

  it("follows the latest request, and ignores requests about other readings or none", () => {
    const out = row({
      requests: [
        request(ID1, "denied", "2026-10-01T10:00:00Z"),
        request(ID1, "pending", "2026-10-04T10:00:00Z"),
        request(ID2, "pending", "2026-10-05T10:00:00Z"),
        { ...request(ID1, "pending", "2026-10-06T10:00:00Z"), recordDescription: "my date of birth" },
      ],
    });
    expect(out).toMatchObject({ canAsk: false, request: { phase: "open", requestedAt: "2026-10-04T10:00:00Z" } });
  });
});

describe("corrections the care team made", () => {
  const correction = (over: Partial<RecordCorrection> = {}): RecordCorrection => ({
    entityId: ID1,
    correctedAt: "2026-10-05T09:00:00Z",
    changedColumns: ["systolic"],
    oldValues: { systolic: 150, diastolic: 80 },
    newValues: { systolic: 130, diastolic: 80 },
    ...over,
  });
  const out = (corrections: RecordCorrection[]) => buildHistory({ ...base, readings: [reading(ID1, "2026-10-04", "08:00")], corrections })[0]?.rows[0]?.correction;

  it("shows what changed, before and after", () => {
    expect(out([correction()])).toEqual({ correctedAt: "2026-10-05T09:00:00Z", before: "150/80", after: "130/80" });
  });

  it("says it was corrected without numbers when the change was to something else", () => {
    expect(out([correction({ changedColumns: ["taken_at"] })])).toEqual({ correctedAt: "2026-10-05T09:00:00Z", before: null, after: null });
  });

  it("uses the latest correction and none for another reading", () => {
    expect(out([correction(), correction({ correctedAt: "2026-10-06T09:00:00Z", newValues: { systolic: 128, diastolic: 80 } })])?.after).toBe("128/80");
    expect(out([correction({ entityId: ID2 })])).toBeNull();
  });
});

describe("what is not said", () => {
  it("carries no grade of any reading", () => {
    const row = buildHistory({ ...base, readings: [reading(ID1, "2026-10-04", "08:00", { systolic: 220, diastolic: 130 })] })[0]?.rows[0];
    expect(Object.keys(row ?? {}).sort()).toEqual(["canAsk", "correction", "reading", "request"]);
    expect(JSON.stringify(row)).not.toMatch(/level|target|green|amber|red|status/i);
  });
});

describe("merging server and phone readings", () => {
  const server = (id: string, over: Partial<import("./bp-history-model").ServerBpRow> = {}) => ({
    id,
    systolic: 130,
    diastolic: 80,
    taken_at: iso("2026-10-04", "08:00"),
    source: "manual",
    client_reading_id: null,
    ...over,
  });
  const queued = (clientId: string, state: string, over = {}) => ({
    clientId,
    state,
    systolic: 118,
    diastolic: 76,
    clientRecordedAt: iso("2026-10-04", "09:00"),
    supportCode: "AB12CD",
    ...over,
  });
  const { mergeReadings } = jest.requireActual<typeof import("./bp-history-model")>("./bp-history-model");

  it("marks server rows sent and maps the source", () => {
    const out = mergeReadings([server(ID1), server(ID2, { source: "cgm" }), server(ID3, { source: "fhir_import" })], []);
    expect(out.map((r) => [r.syncState, r.source])).toEqual([["sent", "manual"], ["sent", "device"], ["sent", "other"]]);
  });

  it("shows a waiting row as on the phone and a rejected one as not accepted, with its support code", () => {
    const out = mergeReadings([], [queued("c1", "pending"), queued("c2", "rejected")]);
    expect(out).toMatchObject([{ id: "c1", syncState: "on_phone" }, { id: "c2", syncState: "not_accepted", supportCode: "AB12CD" }]);
    expect(out[0]).not.toHaveProperty("supportCode");
  });

  it("does not show a reading twice while its upload is in flight", () => {
    const out = mergeReadings([server(ID1, { client_reading_id: "c1" })], [queued("c1", "pending")]);
    expect(out.map((r) => r.id)).toEqual([ID1]);
  });

  it("skips server rows with no blood pressure numbers and queued rows in other states", () => {
    expect(mergeReadings([server(ID1, { systolic: null })], [queued("c1", "sending")])).toEqual([]);
  });
});
