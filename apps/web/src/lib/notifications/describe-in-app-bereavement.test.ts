import { describe as describeNotification } from "./describe-in-app";

type Input = Parameters<typeof describeNotification>[0];

describe("W-21 sponsor_bereavement in-app text", () => {
  it("is gentle, names no one and promises no refund", () => {
    const d = describeNotification({ template: "sponsor_bereavement", payload: {} } as Input);
    expect(d.text).toMatch(/very sorry/);
    expect(d.text).not.toMatch(/refund|₦|—|–/);
  });
});

describe("W-21 sponsor_bereavement_correction in-app text", () => {
  it("uses the first name only when it is in the payload", () => {
    const named = describeNotification({ template: "sponsor_bereavement_correction", payload: { first_name: "Ada" } } as Input);
    expect(named.text).toBe("A note we sent earlier about Ada was sent in error. They are well. We are sorry.");
  });
  it("falls back to someone you support when there is no name or it is blank", () => {
    for (const payload of [{}, { first_name: "" }, { first_name: "   " }, { first_name: 7 }]) {
      const d = describeNotification({ template: "sponsor_bereavement_correction", payload } as Input);
      expect(d.text).toBe("A note we sent earlier about someone you support was sent in error. They are well. We are sorry.");
    }
  });
  it("has no dash and names no condition", () => {
    const d = describeNotification({ template: "sponsor_bereavement_correction", payload: { first_name: "Ada" } } as Input);
    expect(d.text).not.toMatch(/[—–]/);
  });
});
