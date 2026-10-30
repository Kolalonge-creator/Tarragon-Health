/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { HubLinks } from "./hub-links";
import { getNavSections } from "@/lib/navigation";

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
  it.each(["/patient/financial-profile", "/patient/health-passport", "/patient/health-summary"])("still lists the hub %s", (href) =>
    expect(hrefs).toContain(href),
  );
});
