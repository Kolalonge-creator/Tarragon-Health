import { renderToStaticMarkup } from "react-dom/server";
import { OutsideRecordStatus, outsideRecordLabel } from "./outside-record-status";

const base = { reviewerName: "Dr Ada Bello", reviewedBy: "u1", reviewedAt: "2026-10-20T10:00:00Z", note: null };

describe("outsideRecordLabel (null-gated attribution)", () => {
  it("an unchecked record is 'supplied by you, not yet checked'", () => {
    expect(outsideRecordLabel({ ...base, status: "unchecked", reviewedBy: null, reviewedAt: null })).toEqual({ kind: "unchecked" });
  });
  it("claims a check only with a status of verified AND a reviewer AND a review time", () => {
    expect(outsideRecordLabel({ ...base, status: "verified" }).kind).toBe("verified");
    expect(outsideRecordLabel({ ...base, status: "verified", reviewedBy: null }).kind).toBe("unchecked");
    expect(outsideRecordLabel({ ...base, status: "verified", reviewedAt: null }).kind).toBe("unchecked");
  });
  it("an unknown or missing status never reads as checked", () => {
    expect(outsideRecordLabel({ ...base, status: "approved" }).kind).toBe("unchecked");
    expect(outsideRecordLabel({ ...base, status: null }).kind).toBe("unchecked");
  });
  it("a record a clinician filed has nothing to say", () => {
    expect(outsideRecordLabel({ ...base, status: "not_applicable" }).kind).toBe("none");
  });
});

describe("OutsideRecordStatus", () => {
  it("renders the unchecked label with its help, and no doctor name", () => {
    const out = renderToStaticMarkup(<OutsideRecordStatus {...base} status="unchecked" reviewedBy={null} reviewedAt={null} />);
    expect(out).toContain("Supplied by you, not yet checked");
    expect(out).toContain("not copied into your medical record");
    expect(out).not.toContain("until a doctor checks it");
    expect(out).not.toContain("Dr Ada Bello");
  });
  it("names the doctor and the date when checked, or 'your care team' when the name is unknown, never a guess", () => {
    expect(renderToStaticMarkup(<OutsideRecordStatus {...base} status="verified" />)).toContain("Checked by Dr Ada Bello on 20 Oct 2026");
    const nameless = renderToStaticMarkup(<OutsideRecordStatus {...base} status="verified" reviewerName={null} />);
    expect(nameless).toContain("Checked by your care team on 20 Oct 2026");
  });
  it("shows the doctor's reason when a record could not be checked, and does not call it checked", () => {
    const out = renderToStaticMarkup(<OutsideRecordStatus {...base} status="not_verified" note="The photo is too blurred to read" />);
    expect(out).toContain("could not check this record");
    expect(out).toContain("too blurred");
    expect(out).not.toContain("Checked by");
  });
  it("renders nothing for a clinician-filed document", () => {
    expect(renderToStaticMarkup(<OutsideRecordStatus {...base} status="not_applicable" />)).toBe("");
  });
});
