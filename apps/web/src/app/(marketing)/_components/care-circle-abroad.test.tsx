/** @jest-environment jsdom */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { CareCircleAbroad } from "./care-circle-abroad";
import { scanText } from "../../../../../../packages/shared/src/copy-lint/scan";

const SOURCES = ["_components/care-circle-abroad.tsx", "_content/care-circle.ts"].map((rel) => ({
  rel: `apps/web/src/app/(marketing)/${rel}`,
  text: readFileSync(join(__dirname, "..", rel), "utf8"),
}));

/** Rendered text plus the source strings: what a visitor can read. */
function visibleText(): string {
  const { container } = render(<CareCircleAbroad />);
  return container.textContent ?? "";
}

describe("Care Circle for family abroad", () => {
  it("names each live item a family member may see", () => {
    render(<CareCircleAbroad />);
    const shared = screen.getByTestId("care-circle-shared");
    expect(within(shared).getAllByRole("listitem").map((li) => li.querySelector("p")?.textContent)).toEqual([
      "Blood pressure, as weekly averages",
      "Medicines, as doses taken",
      "Appointments",
      "A monthly summary",
      "A request to check on them",
    ]);
    expect(shared.textContent).toMatch(/Single readings are never shown/);
    expect(shared.textContent).toMatch(/names of the medicines are not shown/);
  });

  it("says the person chooses, can pause or remove anyone, and sees who looked", () => {
    render(<CareCircleAbroad />);
    const control = screen.getByTestId("care-circle-control").textContent ?? "";
    expect(control).toMatch(/choose who joins/i);
    expect(control).toMatch(/paused/);
    expect(control).toMatch(/removed/);
    expect(control).toMatch(/see who looked/);
  });

  it("labels the product visual as an illustration, once", () => {
    render(<CareCircleAbroad />);
    const figures = screen.getAllByTestId("care-circle-illustration");
    expect(figures).toHaveLength(1);
    expect(within(figures[0]).getByText("Illustration")).toBeTruthy();
    expect(within(figures[0]).getByText(/An illustration of what a Care Circle member sees/)).toBeTruthy();
  });

  it("is a named region and links the gift to /gift without quoting a price", () => {
    render(<CareCircleAbroad />);
    expect(screen.getByRole("region", { name: /Follow a parent's care from wherever you live/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /giving a Membership/ }).getAttribute("href")).toBe("/gift");
    expect(visibleText()).not.toMatch(/₦|NGN|naira/i);
  });

  it("mentions the doctor's note only as coming soon", () => {
    const text = visibleText();
    expect(text).toMatch(/Coming soon: a short note from their care team/);
    const noteMentions = text.match(/short note/g) ?? [];
    expect(noteMentions).toHaveLength(1);
  });

  it("makes none of the claims that are not live or not allowed", () => {
    const text = visibleText();
    for (const banned of [/on target/i, /\bcontrolled\b/i, /under (their )?target/i, /whatsapp/i, /doctor-led/i, /\b1\s*:\s*\d+/, /within \d+ (minutes|hours)/i, /\bBP\b/]) {
      expect(text).not.toMatch(banned);
    }
    expect(text).not.toMatch(/[–—]/);
  });

  it("passes the repo copy-lint rules with no exceptions", () => {
    for (const f of SOURCES) expect(scanText(f.rel, f.text)).toEqual([]);
  });

  it("imports nothing from the platform or auth modules", () => {
    for (const f of SOURCES) {
      const imports = [...f.text.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      expect(imports.filter((i) => /supabase|@tarragon\/auth|lib\/queries|\(dashboard\)/.test(i))).toEqual([]);
    }
  });

  it("is on the home page and the parent care page", () => {
    for (const page of ["page.tsx", "parentcare/page.tsx"]) {
      expect(readFileSync(join(__dirname, "..", page), "utf8")).toContain("<CareCircleAbroad");
    }
  });
});
