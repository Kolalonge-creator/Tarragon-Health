import { describe, expect, it } from "@jest/globals";
import { deriveCaseStatus, ownerDisplayName, UNCLAIMED_OWNER_LABEL } from "./case-status";

describe("deriveCaseStatus", () => {
  it("falls back to the alert's own status when there is no escalation or result document", () => {
    expect(deriveCaseStatus({ alert: { status: "open", acknowledged_by: null } })).toEqual({
      label: "Open — unacknowledged",
      isClosed: false,
      ownerId: null,
    });
    expect(
      deriveCaseStatus({ alert: { status: "acknowledged", acknowledged_by: "doc-1" } })
    ).toEqual({
      label: "Acknowledged — under review",
      isClosed: false,
      ownerId: "doc-1",
    });
    expect(deriveCaseStatus({ alert: { status: "resolved", acknowledged_by: "doc-1" } })).toEqual({
      label: "Resolved",
      isClosed: true,
      ownerId: "doc-1",
    });
  });

  it("an escalation takes precedence over the alert's own status", () => {
    const result = deriveCaseStatus({
      alert: { status: "acknowledged", acknowledged_by: "doc-1" },
      escalation: { status: "under_review", assigned_doctor_id: "doc-2" },
    });
    expect(result).toEqual({
      label: "Escalated — under senior review",
      isClosed: false,
      ownerId: "doc-2",
    });
  });

  it("an escalation resolved or referred is closed, owned by the assigned doctor", () => {
    expect(
      deriveCaseStatus({
        alert: { status: "open", acknowledged_by: null },
        escalation: { status: "resolved", assigned_doctor_id: "doc-2" },
      })
    ).toEqual({ label: "Resolved", isClosed: true, ownerId: "doc-2" });

    expect(
      deriveCaseStatus({
        alert: { status: "open", acknowledged_by: null },
        escalation: { status: "referred", assigned_doctor_id: "doc-2" },
      })
    ).toEqual({ label: "Referred", isClosed: true, ownerId: "doc-2" });
  });

  it("a result document's acknowledgement state takes precedence over the bare alert, when there is no escalation", () => {
    expect(
      deriveCaseStatus({
        alert: { status: "open", acknowledged_by: null },
        resultDocument: { acknowledgement_status: "new" },
      })
    ).toEqual({ label: "Open — unacknowledged", isClosed: false, ownerId: null });

    expect(
      deriveCaseStatus({
        alert: { status: "acknowledged", acknowledged_by: "doc-1" },
        resultDocument: { acknowledgement_status: "opened" },
      })
    ).toEqual({ label: "Opened — under review", isClosed: false, ownerId: "doc-1" });

    expect(
      deriveCaseStatus({
        alert: { status: "acknowledged", acknowledged_by: "doc-1" },
        resultDocument: { acknowledgement_status: "action_required" },
      })
    ).toEqual({ label: "Reviewed — action required", isClosed: false, ownerId: "doc-1" });

    expect(
      deriveCaseStatus({
        alert: { status: "acknowledged", acknowledged_by: "doc-1" },
        resultDocument: { acknowledgement_status: "action_completed" },
      })
    ).toEqual({ label: "Resolved", isClosed: true, ownerId: "doc-1" });
  });

  it("an escalation still wins over a result document when both are present", () => {
    const result = deriveCaseStatus({
      alert: { status: "acknowledged", acknowledged_by: "doc-1" },
      escalation: { status: "open", assigned_doctor_id: null },
      resultDocument: { acknowledgement_status: "action_completed" },
    });
    expect(result.label).toBe("Escalated — awaiting review");
    expect(result.isClosed).toBe(false);
  });
});

describe("ownerDisplayName", () => {
  it("returns the org pool label for an unclaimed case (never blank, never a raw id)", () => {
    expect(ownerDisplayName(null, null)).toBe(UNCLAIMED_OWNER_LABEL);
  });

  it("returns the resolved name for a claimed case", () => {
    expect(ownerDisplayName("doc-1", "Dr. Adaeze Okafor")).toBe("Dr. Adaeze Okafor");
  });

  it("falls back to the org pool label if a claimed owner's name could not be resolved", () => {
    expect(ownerDisplayName("doc-1", null)).toBe(UNCLAIMED_OWNER_LABEL);
  });
});
