import { dataProtectionLines, DATA_PROTECTION_CONTACTS, DATA_REQUEST_EMAIL } from "./data-protection-contacts";

describe("data protection lines on the privacy page", () => {
  it("with nothing supplied: no registration claim, no DPO, but always a working contact", () => {
    const lines = dataProtectionLines({ dpoName: null, dpoEmail: null, ndpcRegistrationRef: null });
    const all = lines.join(" ");
    expect(all).not.toMatch(/registered with/i);
    expect(all).not.toMatch(/Data Protection Officer is/);
    expect(all).toContain(DATA_REQUEST_EMAIL);
    expect(all).not.toMatch(/null|undefined|\[|TODO/i);
  });

  it("the committed defaults claim nothing the founder has not supplied", () => {
    expect(DATA_PROTECTION_CONTACTS).toEqual({ dpoName: null, dpoEmail: null, ndpcRegistrationRef: null });
  });

  it("claims registration only when the reference is supplied", () => {
    const lines = dataProtectionLines({ dpoName: "A. Name", dpoEmail: "dpo@example.test", ndpcRegistrationRef: "REF-1" });
    expect(lines.join(" ")).toMatch(/registered with the Nigeria Data Protection Commission \(NDPC\)\. Registration reference: REF-1\./);
    expect(lines).toContain("Our Data Protection Officer is A. Name.");
    expect(lines.join(" ")).toContain("dpo@example.test");
  });

  it("contains no em or en dash", () => {
    const lines = dataProtectionLines({ dpoName: "A", dpoEmail: "b@c.d", ndpcRegistrationRef: "R" });
    expect(lines.join(" ")).not.toMatch(/[–—]/);
  });
});
