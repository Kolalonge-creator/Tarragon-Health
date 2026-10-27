import { buildConsentReceipt, parseConsentReceiptData, receiptFileName } from "./consent-receipt";

const matrixEvent = {
  scope: "matrix_event",
  person: "Ada Obi",
  generated_at: "2026-10-20T10:00:00Z",
  change: {
    data_type: "vitals",
    purpose: "research",
    action: "granted",
    source: "patient",
    policy_version: 1,
    text_key: "consent.matrix.vitals.research",
    wording_status: "draft_pending_counsel",
    required_for_care: false,
    wording_current: true,
    at: "2026-10-19T08:30:00Z",
  },
};

const documentEvent = {
  scope: "document_event",
  person: null,
  generated_at: "2026-10-20T10:00:00Z",
  change: {
    consent_type: "data_processing",
    action: "withdrawn",
    version: "v3",
    title: "How we use your data",
    body: "The exact words shown.",
    is_optional: true,
    is_draft: false,
    text_sha256: "abc123",
    channel: "web",
    consented_by_relation: "self",
    at: "2026-10-18T09:00:00Z",
  },
};

const all = {
  scope: "all",
  person: "Ada Obi",
  generated_at: "2026-10-20T10:00:00Z",
  cells: [
    { data_type: "vitals", purpose: "care", required_for_care: true, text_key: "consent.matrix.vitals.care", wording_status: "draft_pending_counsel", policy_version: 1, granted: true, changed_at: null },
    { data_type: "vitals", purpose: "research", required_for_care: false, text_key: "consent.matrix.vitals.research", wording_status: "draft_pending_counsel", policy_version: 1, granted: false, changed_at: "2026-10-19T08:30:00Z" },
    { data_type: "mental_health", purpose: "research", required_for_care: false, text_key: "consent.matrix.mental_health.research", wording_status: "approved", policy_version: 1, granted: false, changed_at: null },
  ],
  documents: [{ consent_type: "terms_of_service", version: "v2", title: "Terms of service", is_optional: false, is_draft: false, at: "2026-09-01T00:00:00Z" }],
};

describe("buildConsentReceipt", () => {
  it("a matrix change says what, for what, the choice, when, the wording version and marks placeholder wording", () => {
    const view = buildConsentReceipt(parseConsentReceiptData(matrixEvent)!);
    const text = JSON.stringify(view);
    expect(view.title).toBe("Consent receipt");
    expect(view.person).toBe("For: Ada Obi");
    expect(view.sections[0]!.lines.map((l) => l.value)).toEqual(
      expect.arrayContaining(["Readings you log", "Research", "You agreed", "1", "Placeholder wording. Our legal adviser has not approved it yet."]),
    );
    expect(view.sections[0]!.quote).toBe("Your readings, with your name removed, can be used for research.");
    expect(view.placeholderNote).toContain("placeholder wording");
    expect(view.howToWithdraw).toContain("Privacy");
    expect(text).not.toContain("—");
  });

  it("when the wording version has moved on it shows neither today's text nor today's status as if it were what the person saw", () => {
    const view = buildConsentReceipt(parseConsentReceiptData({ ...matrixEvent, change: { ...matrixEvent.change, wording_current: false, wording_status: "approved" } })!);
    expect(view.sections[0]!.quote).toBeUndefined();
    const status = view.sections[0]!.lines.find((l) => l.label === "Wording status")!;
    expect(status.value).toContain("updated since this change");
    expect(view.placeholderNote).toBeNull();
  });

  it("a fingerprint is printed in groups so it cannot run off the page", () => {
    const sha = "a".repeat(32) + "b".repeat(32);
    const view = buildConsentReceipt(parseConsentReceiptData({ ...documentEvent, change: { ...documentEvent.change, text_sha256: sha } })!);
    const fp = view.sections[0]!.lines.find((l) => l.label.startsWith("Text fingerprint"))!;
    expect(fp.value.split(" ")).toHaveLength(4);
    expect(fp.value.replace(/ /g, "")).toBe(sha);
  });

  it("a time just after midnight in Lagos prints as 00:05, never 24:05", () => {
    const view = buildConsentReceipt(parseConsentReceiptData({ ...matrixEvent, change: { ...matrixEvent.change, at: "2026-10-20T23:05:00Z" } })!);
    const when = view.sections[0]!.lines.find((l) => l.label === "When")!;
    expect(when.value).toContain("00:05");
    expect(when.value).not.toContain("24:");
  });

  it("approved wording gets no placeholder note", () => {
    const view = buildConsentReceipt(parseConsentReceiptData({ ...matrixEvent, change: { ...matrixEvent.change, wording_status: "approved" } })!);
    expect(view.placeholderNote).toBeNull();
    expect(view.sections[0]!.lines.some((l) => l.value === "Approved wording.")).toBe(true);
  });

  it("a document withdrawal carries the exact words, who, how, the version and the fingerprint", () => {
    const view = buildConsentReceipt(parseConsentReceiptData(documentEvent)!);
    const lines = Object.fromEntries(view.sections[0]!.lines.map((l) => [l.label, l.value]));
    expect(lines["Your choice"]).toBe("You withdrew");
    expect(lines["Wording version"]).toBe("v3");
    expect(lines["Who made the choice"]).toBe("You");
    expect(lines["How it was recorded"]).toBe("on the website");
    expect(lines["Text fingerprint (SHA-256)"]).toBe("abc123");
    expect(view.sections[0]!.quote).toBe("The exact words shown.");
    expect(view.person).toBeNull();
  });

  it("a record from before receipts existed says it was not recorded, and invents no fingerprint", () => {
    const view = buildConsentReceipt(
      parseConsentReceiptData({ ...documentEvent, change: { ...documentEvent.change, consented_by_relation: "legacy", channel: "unknown", text_sha256: null } })!,
    );
    const lines = Object.fromEntries(view.sections[0]!.lines.map((l) => [l.label, l.value]));
    expect(lines["Who made the choice"]).toBe("Not recorded at the time");
    expect(lines["How it was recorded"]).toBe("not recorded at the time");
    expect(lines["Text fingerprint (SHA-256)"]).toBeUndefined();
  });

  it("the whole picture groups by kind of information, shows on and off, marks placeholder sections and lists agreements", () => {
    const view = buildConsentReceipt(parseConsentReceiptData(all)!);
    expect(view.title).toBe("Your current consents");
    expect(view.sections.map((s) => s.heading)).toEqual([
      "Readings you log (placeholder wording)",
      "Mental health",
      "Agreements you accepted",
    ]);
    const vitals = view.sections[0]!.lines;
    expect(vitals[0]).toEqual({ label: "Your care", value: "On, needed for your care, so it stays on" });
    expect(vitals[1]!.value).toBe("Off, changed 19 Oct 2026");
    expect(view.sections[2]!.lines[0]!.value).toMatch(/^version v2, 1 Sep/);
    expect(view.placeholderNote).not.toBeNull();
  });

  it("holds no health value: the page text is built only from labels and consent facts", () => {
    const text = JSON.stringify(buildConsentReceipt(parseConsentReceiptData(all)!));
    expect(text).not.toMatch(/mmHg|mmol|systolic|diagnos/i);
  });

  it("a malformed response is null, never a shorter receipt", () => {
    expect(parseConsentReceiptData(null)).toBeNull();
    expect(parseConsentReceiptData({ scope: "all", person: null, generated_at: "x", cells: [{ data_type: "weight" }], documents: [] })).toBeNull();
    expect(parseConsentReceiptData({ ...matrixEvent, change: { ...matrixEvent.change, action: "maybe" } })).toBeNull();
    expect(parseConsentReceiptData({ scope: "other" })).toBeNull();
  });

  it("the file name says nothing about the person or the choice", () => {
    expect(receiptFileName(new Date("2026-10-20T10:00:00Z"))).toBe("consent-receipt-2026-10-20.pdf");
  });
});
