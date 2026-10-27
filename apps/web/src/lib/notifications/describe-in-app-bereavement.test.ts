import { describe as describeNotification } from "./describe-in-app";

describe("W-21 sponsor_bereavement in-app text", () => {
  it("is gentle, names no one and promises no refund", () => {
    const n = { template: "sponsor_bereavement", payload: {} } as Parameters<typeof describeNotification>[0];
    const d = describeNotification(n);
    expect(d.text).toMatch(/very sorry/);
    expect(d.text).not.toMatch(/refund|₦|—|–/);
  });
});
