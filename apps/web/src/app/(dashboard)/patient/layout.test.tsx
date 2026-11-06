/** @jest-environment jsdom */
/**
 * Regression: the "You are in X's account" banner used to render only on the (sections) pages, so Messages, Appointments, Family
 * and the other top-level patient routes gave no sign that someone else's record was open. The patient-level layout now shows it
 * on every /patient page, and it is sticky and coloured (it used an undefined `clinical-amber` token before).
 */
import { render, screen } from "@testing-library/react";

const getActingFor = jest.fn();
jest.mock("@/app/(dashboard)/patient/dashboard-context", () => ({ getActingFor: () => getActingFor() }));
jest.mock("@/app/(dashboard)/patient/supporting/actions", () => ({ closeTheirAccount: jest.fn() }));

import PatientLayout from "./layout";

describe("PatientLayout acting-for banner", () => {
  it("shows a sticky, coloured banner on every patient page while acting for someone", async () => {
    getActingFor.mockResolvedValue({ profileId: "p-2", fullName: "Mama Ngozi" });
    render(await PatientLayout({ children: <p>Messages page</p> }));
    const banner = screen.getByTestId("acting-for-banner");
    expect(banner.textContent).toContain("You are in Mama Ngozi's account, not your own.");
    expect(banner.className).toContain("sticky");
    expect(banner.className).toContain("bg-amber-50");
    expect(banner.className).not.toContain("clinical-amber");
    expect(screen.getByText("Messages page")).toBeTruthy();
  });

  it("shows nothing extra when the person is in their own account", async () => {
    getActingFor.mockResolvedValue(null);
    render(await PatientLayout({ children: <p>Messages page</p> }));
    expect(screen.queryByTestId("acting-for-banner")).toBeNull();
  });
});
