import { sponsorMinimumGroupSize } from "./sponsor-min-group";

describe("sponsorMinimumGroupSize", () => {
  it("reads the active min_cell (20 from 2026-10-07, 11 before)", () => {
    expect(sponsorMinimumGroupSize("2026-10-08")).toBe(20);
    expect(sponsorMinimumGroupSize("2026-10-06")).toBe(11);
  });
});
