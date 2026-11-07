/**
 * Slice H finding: the Care Circle person page is in the supporter's own area, so it asks the dashboard gate for area "supporter".
 * Without it a support-only account (receives_care false) was redirected to /patient/supporting from every supporter page, including
 * this one, and never saw the help request. What the supporter may see is still decided by circle_help_alert_view in the database.
 */
const getPatientDashboardContext = jest.fn(async () => ({ uiLanguage: "en" }));
jest.mock("@/app/(dashboard)/patient/dashboard-context", () => ({ getPatientDashboardContext }));
jest.mock("./supporter-view", () => ({ SupporterView: () => null }));
jest.mock("./help-alert-view", () => ({ HelpAlertView: () => null }));
jest.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));

import SupporterViewPage from "./page";

describe("Care Circle person page", () => {
  it("asks the dashboard gate for the supporter area", async () => {
    await SupporterViewPage({ params: Promise.resolve({ patientId: "1f4d86f4-cae0-4c33-9a5a-4f3c1b128fa9" }) });
    expect(getPatientDashboardContext).toHaveBeenCalledWith({ area: "supporter" });
  });

  it("refuses a malformed id before reading anything", async () => {
    getPatientDashboardContext.mockClear();
    await expect(SupporterViewPage({ params: Promise.resolve({ patientId: "not-a-uuid" }) })).rejects.toThrow("NOT_FOUND");
    expect(getPatientDashboardContext).not.toHaveBeenCalled();
  });
});
