/** @jest-environment jsdom */
import { fireEvent, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { expectNoA11yViolations } from "@/test/a11y";
import type { NavItem } from "@/lib/navigation";
import { NavMoreItems } from "./nav-more-items";

const items: NavItem[] = [
  { label: "Wellbeing", href: "/patient/wellbeing", icon: "mood", more: true },
  { label: "Healthy ageing", href: "/patient/healthy-ageing", icon: "healthyAgeing", more: true },
];

const ui = (activeInside: boolean) => (
  <nav aria-label="Main">
    <ul>
      <NavMoreItems
        groupLabel="My health"
        items={items}
        activeInside={activeInside}
        renderItem={(item) => (
          <li key={item.href}>
            <a href={item.href}>{item.label}</a>
          </li>
        )}
      />
    </ul>
  </nav>
);

describe("NavMoreItems", () => {
  it("is closed by default, with a labelled toggle, and opens on click", async () => {
    const { container } = await expectNoA11yViolations(ui(false));
    const toggle = screen.getByRole("button", { name: "More in My health" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: "Wellbeing" })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Wellbeing" }).getAttribute("href")).toBe("/patient/wellbeing");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("opens on its own when the current page is one of its links", async () => {
    await expectNoA11yViolations(ui(true));
    expect(screen.getByRole("button", { name: "More in My health" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Healthy ageing" })).toBeTruthy();
  });
});
