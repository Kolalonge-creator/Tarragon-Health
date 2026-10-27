import { dataProtectionLines, DATA_PROTECTION_CONTACTS } from "./data-protection-contacts";

describe("data protection lines on the privacy page", () => {
  it("states NDPC registration and never shows an unsupplied detail", () => {
    const lines = dataProtectionLines(DATA_PROTECTION_CONTACTS);
    expect(lines[0]).toMatch(/registered with the Nigeria Data Protection Commission/);
    expect(lines.join(" ")).not.toMatch(/null|undefined|\[|TODO/i);
  });

  it("adds the DPO and the registration reference once the founder supplies them", () => {
    const lines = dataProtectionLines({ dpoName: "A. Name", dpoEmail: "dpo@example.test", ndpcRegistrationRef: "REF-1" });
    expect(lines).toEqual(expect.arrayContaining([
      "NDPC registration reference: REF-1.",
      "Our Data Protection Officer is A. Name.",
      "Write to the Data Protection Officer at dpo@example.test.",
    ]));
  });

  it("contains no em or en dash", () => {
    const lines = dataProtectionLines({ dpoName: "A", dpoEmail: "b@c.d", ndpcRegistrationRef: "R" });
    expect(lines.join(" ")).not.toMatch(/[–—]/);
  });
});
