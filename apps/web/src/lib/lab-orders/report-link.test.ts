import {
  groupReportsByOrder,
  linkErrorMessage,
  orderReportState,
  ORDER_REPORT_LABEL,
  type LinkedReport,
} from "./report-link";

const report = (id: string, labOrderId: string, createdAt: string): LinkedReport => ({
  id,
  labOrderId,
  status: "processing",
  createdAt,
});

describe("orderReportState", () => {
  it("is result_back once the request is resulted, with or without a linked report", () => {
    expect(orderReportState("resulted", [])).toBe("result_back");
    expect(orderReportState("resulted", [report("a", "o1", "2026-11-01")])).toBe("result_back");
  });

  it("is report_added when a report is linked to a request that is still open", () => {
    for (const status of ["payment_confirmed", "ordered", "sample_collected", "processing"] as const) {
      expect(orderReportState(status, [report("a", "o1", "2026-11-01")])).toBe("report_added");
    }
  });

  it("is waiting when a report is expected and none is linked", () => {
    expect(orderReportState("ordered", [])).toBe("waiting");
  });

  it("says nothing for a cancelled, unpaid or rejected-sample request", () => {
    expect(orderReportState("cancelled", [report("a", "o1", "2026-11-01")])).toBe("closed");
    expect(orderReportState("pending_payment", [])).toBe("closed");
    expect(orderReportState("sample_rejected", [])).toBe("closed");
  });
});

describe("groupReportsByOrder", () => {
  it("groups by request, newest first", () => {
    const grouped = groupReportsByOrder([
      report("old", "o1", "2026-10-01T10:00:00Z"),
      report("other", "o2", "2026-10-05T10:00:00Z"),
      report("new", "o1", "2026-11-01T10:00:00Z"),
    ]);
    expect(grouped.get("o1")?.map((r) => r.id)).toEqual(["new", "old"]);
    expect(grouped.get("o2")?.map((r) => r.id)).toEqual(["other"]);
    expect(grouped.get("o3")).toBeUndefined();
  });
});

describe("patient copy", () => {
  it("is plain: no em dashes and never 'your doctor'", () => {
    for (const label of Object.values(ORDER_REPORT_LABEL)) {
      expect(label).not.toMatch(/—/);
      expect(label.toLowerCase()).not.toContain("your doctor");
    }
  });
});

describe("linkErrorMessage", () => {
  it("names a cancelled or unpaid request", () => {
    expect(linkErrorMessage({ code: "22023", message: "lab_order_link_order_not_open" })).toMatch(/cancelled or not paid/);
  });
  it("names another patient's request", () => {
    expect(linkErrorMessage({ code: "42501", message: "lab_order_link_not_this_patient" })).toMatch(/someone else/);
  });
  it("refuses a document the caller cannot change", () => {
    expect(linkErrorMessage({ code: "42501", message: "clinical document not found" })).toBe("You cannot change this report.");
  });
  it("falls back to a retry message", () => {
    expect(linkErrorMessage(null)).toBe("Could not save that. Try again.");
  });
});
