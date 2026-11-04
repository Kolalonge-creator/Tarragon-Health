/** @jest-environment jsdom */
/** The "My health / People I support" switch for an account that is both: two links, the current one marked, shown only when it means something. */
import { render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { CareModeSwitch, CareModeSwitchIfSupporting } from "./care-mode-switch";

let circle: { data: unknown[] | undefined };
let sponsored: { data: unknown[] | undefined };
jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
jest.mock("@/lib/queries/care-circle", () => ({ useSupportedPeople: () => circle }));
jest.mock("@/lib/queries/sponsorship", () => ({ useSupportedPeople: () => sponsored }));

beforeEach(() => {
  circle = { data: [] };
  sponsored = { data: [] };
});

describe("CareModeSwitch", () => {
  it("offers both places and marks the current one", async () => {
    render(<CareModeSwitch active="supporting" locale="en" />);
    expect(screen.getByRole("navigation", { name: "Choose what to look at" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "My health" }).getAttribute("href")).toBe("/patient");
    const here = screen.getByRole("link", { name: "People I support" });
    expect(here.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "My health" }).getAttribute("aria-current")).toBeNull();
    await expectNoA11yViolations(<CareModeSwitch active="mine" locale="en" />);
  });

  it("is absent on the person's own home until they support somebody", () => {
    const { container, rerender } = render(<CareModeSwitchIfSupporting locale="en" />);
    expect(container.textContent).toBe("");
    circle = { data: [{ patient_id: "p1" }] };
    rerender(<CareModeSwitchIfSupporting locale="en" />);
    expect(screen.getByRole("link", { name: "My health" }).getAttribute("aria-current")).toBe("page");
    circle = { data: [] };
    sponsored = { data: [{ profileId: "p2" }] };
    rerender(<CareModeSwitchIfSupporting locale="en" />);
    expect(screen.getByRole("link", { name: "People I support" })).toBeTruthy();
  });
});
