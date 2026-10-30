import { showRecordsRequestsLink } from "./show-link";

describe("showRecordsRequestsLink", () => {
  it("hides the link when the feature is off and there are no requests", () => {
    expect(showRecordsRequestsLink(false, 0)).toBe(false);
  });
  it("hides it when the guard answer could not be read", () => {
    expect(showRecordsRequestsLink(null, 0)).toBe(false);
    expect(showRecordsRequestsLink(undefined, 0)).toBe(false);
  });
  it("shows it when the feature is on", () => {
    expect(showRecordsRequestsLink(true, 0)).toBe(true);
  });
  it("keeps it for someone who already has a request, even if the feature is off", () => {
    expect(showRecordsRequestsLink(false, 2)).toBe(true);
  });
});
