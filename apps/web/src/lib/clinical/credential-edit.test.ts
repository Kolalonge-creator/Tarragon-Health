import { parseCredentialEdit } from "./credential-edit";

const none = { credential_type: null, credential_number: null };

describe("parseCredentialEdit", () => {
  it("accepts a real number and trims it", () => {
    expect(parseCredentialEdit({ credentialType: " MDCN ", credentialNumber: " R2311 " }, none)).toEqual({
      status: "ok",
      credentialType: "MDCN",
      credentialNumber: "R2311",
    });
  });
  it("sends nothing when nothing changed, so verification is not cleared", () => {
    expect(
      parseCredentialEdit(
        { credentialType: "MDCN", credentialNumber: "R8919" },
        { credential_type: "MDCN", credential_number: "R8919" },
      ),
    ).toEqual({ status: "unchanged" });
    expect(parseCredentialEdit({ credentialType: "", credentialNumber: "" }, none)).toEqual({ status: "unchanged" });
  });
  it("requires both fields", () => {
    expect(parseCredentialEdit({ credentialType: "MDCN", credentialNumber: "" }, none).status).toBe("error");
    expect(parseCredentialEdit({ credentialType: "", credentialNumber: "R1" }, none).status).toBe("error");
  });
  it.each(["MDCN-PENDING-ISAAC-LONGE", "TBC", "n/a", "test"])("refuses the placeholder %j", (value) => {
    expect(parseCredentialEdit({ credentialType: "MDCN", credentialNumber: value }, none).status).toBe("error");
  });
  it("refuses an absurdly long value", () => {
    expect(parseCredentialEdit({ credentialType: "MDCN", credentialNumber: "R".repeat(41) }, none).status).toBe("error");
  });
});
