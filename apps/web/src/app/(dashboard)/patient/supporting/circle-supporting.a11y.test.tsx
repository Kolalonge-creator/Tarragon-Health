/** @jest-environment jsdom */
/** The Care Circle half of the supporter home (S29): an open check-in request first, then the people who shared something. */
import { cleanup, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { CircleSupporting } from "./circle-supporting";

let people: { isSuccess: boolean; data: unknown[] };
let alerts: { data: unknown[] };
jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
jest.mock("@/lib/queries/care-circle", () => ({ useSupportedPeople: () => people, useOpenAlerts: () => alerts }));

const PERSON = { patient_id: "p1", member_id: "m1", name: "Mama Eze", relationship: "Mother", permissions: ["red_alerts"], expires_at: "2027-06-01T00:00:00Z" };
beforeEach(() => {
  people = { isSuccess: true, data: [PERSON] };
  alerts = { data: [] };
});

describe("CircleSupporting", () => {
  it("lists the people and links to each page", async () => {
    render(<CircleSupporting locale="en" />);
    expect(screen.getByText("Mama Eze")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe("/patient/supporting/circle/p1");
    cleanup();
    await expectNoA11yViolations(<CircleSupporting locale="en" />);
  });

  it("shows an open check-in request as an alert with a name and nothing clinical", () => {
    alerts = { data: [{ patient_id: "p1", name: "Mama Eze", since: "2026-10-06T10:00:00Z" }] };
    render(<CircleSupporting locale="en" />);
    const a = screen.getByRole("alert");
    expect(a.textContent).toMatch(/Please check on Mama Eze/);
    expect(a.textContent).toMatch(/Please call Mama Eze now/);
    expect(a.textContent).not.toMatch(/blood|pressure|reading|result|emergency|critical/i);
  });

  it("renders nothing at all for someone who is in no circle", () => {
    people = { isSuccess: true, data: [] };
    const { container } = render(<CircleSupporting locale="en" />);
    expect(container.textContent).toBe("");
  });
});
