/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { expectNoA11yViolations } from "@/test/a11y";
import type { NavItem } from "@/lib/navigation";
import { NavMoreItems } from "./nav-more-items";

const items: NavItem[] = [
  { label: "Wellbeing", href: "/patient/wellbeing", icon: "mood", more: true },
  { label: "Healthy ageing", href: "/patient/healthy-ageing", icon: "healthyAgeing", more: true },
];

const ui = (activeHref: string | null) => (
  <nav aria-label="Main">
    <ul>
      <NavMoreItems
        groupLabel="My health"
        items={items}
        activeHref={activeHref}
        renderItem={(item) => (
          <li key={item.href}>
            <a href={item.href}>{item.label}</a>
          </li>
        )}
      />
    </ul>
  </nav>
);

const toggle = () => screen.getByRole("button", { name: "More in My health" });

describe("NavMoreItems", () => {
  it("is closed by default, with a labelled toggle, and opens on click", async () => {
    const { container } = await expectNoA11yViolations(ui(null));
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: "Wellbeing" })).toBeNull();
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Wellbeing" }).getAttribute("href")).toBe("/patient/wellbeing");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("opens on its own when the current page is one of its links", async () => {
    await expectNoA11yViolations(ui("/patient/healthy-ageing"));
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Healthy ageing" })).toBeTruthy();
  });

  it("re-opens after a manual close when the patient moves to another of its pages", () => {
    const { rerender } = render(ui("/patient/wellbeing"));
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    rerender(ui("/patient/healthy-ageing"));
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("renders nothing when the group has no extra links", () => {
    const { container } = render(<ul><NavMoreItems groupLabel="My health" items={[]} activeHref={null} renderItem={() => null} /></ul>);
    expect(container.querySelector("button")).toBeNull();
  });
});
