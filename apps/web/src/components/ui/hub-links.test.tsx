/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { HubLinks } from "./hub-links";
import { getNavSections } from "@/lib/navigation";
import { MY_HEALTH_RELATED_LINKS } from "@/app/(dashboard)/patient/my-health/related-links";

describe("HubLinks", () => {
  it("renders each link inside a labelled nav", () => {
    render(<HubLinks label="Related" links={[{ href: "/a", label: "A" }, { href: "/b", label: "B" }]} />);
    expect(screen.getByRole("navigation", { name: "Related" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "B" }).getAttribute("href")).toBe("/b");
  });
});

describe("patient menu after the P5 folds", () => {
  const hrefs = getNavSections("patient", null).flatMap((s) => s.items.map((i) => i.href));
  it.each(["/patient/progress", "/patient/medicine-report", "/patient/receipts", "/patient/payment-requests", "/patient/health-report"])(
    "no longer lists %s as its own menu entry",
    (href) => expect(hrefs).not.toContain(href),
  );
  it.each(["/patient/financial-profile", "/patient/my-health"])("still lists the hub %s", (href) => expect(hrefs).toContain(href));
  // Slice C (PD-01): the health summary hub left the menu and is one tap from the My health record hub instead (the passport is a
  // card on that page). Full coverage proof: lib/patient-menu-coverage.test.ts.
  it("reaches the health summary hub from the My health record hub", () =>
    expect(MY_HEALTH_RELATED_LINKS.map((l) => l.href)).toContain("/patient/health-summary"));
});
