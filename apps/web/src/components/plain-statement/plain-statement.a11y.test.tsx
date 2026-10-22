/** @jest-environment jsdom */
import { screen } from "@testing-library/react";
import { plainStatement } from "@tarragon/i18n";
import { expectNoA11yViolations } from "@/test/a11y";
import { PlainStatementView } from "./plain-statement";

const props = { privacyHref: "/privacy", accessibilityHref: "/accessibility", pricingHref: "/pricing" };

describe("PlainStatementView", () => {
  it("has no axe violations as a page (h1) and shows the price it was given", async () => {
    await expectNoA11yViolations(
      <PlainStatementView statement={plainStatement({ price: "100", refundDays: 7 })} headingLevel="h1" {...props} />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByText("Membership costs ₦100 a year.")).toBeTruthy();
  });

  it("has no axe violations inside Settings (h2) and shows no number when the price is unknown", async () => {
    await expectNoA11yViolations(
      <PlainStatementView statement={plainStatement({ price: null, refundDays: null })} idPrefix="settings-plain" {...props} />,
    );
    expect(screen.getByText("See the price in the app before you pay.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/₦\s?\d/);
  });

  it("puts privacy before pricing before accessibility, with a link to the full privacy text", async () => {
    await expectNoA11yViolations(<PlainStatementView statement={plainStatement({ price: "1", refundDays: 1 })} {...props} />);
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings.indexOf("Your information, first")).toBeLessThan(headings.indexOf("What costs money"));
    expect(headings.indexOf("What costs money")).toBeLessThan(headings.indexOf("What the app does for large text, screen readers and audio"));
    expect(screen.getByRole("link", { name: "Read the full privacy notice" }).getAttribute("href")).toBe("/privacy");
  });
});
