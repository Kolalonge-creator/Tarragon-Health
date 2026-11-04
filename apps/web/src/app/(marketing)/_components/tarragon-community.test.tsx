/** @jest-environment jsdom */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { TarragonCommunity } from "./tarragon-community";
import { scanText } from "../../../../../../packages/shared/src/copy-lint/scan";

const SOURCES = ["_components/tarragon-community.tsx", "_content/community.ts"].map((rel) => ({
  rel: `apps/web/src/app/(marketing)/${rel}`,
  text: readFileSync(join(__dirname, "..", rel), "utf8"),
}));

describe("Tarragon Community section", () => {
  it("uses the agreed name and subtitle (COM-29)", () => {
    render(<TarragonCommunity />);
    expect(screen.getByText("Tarragon Community")).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 2, name: "Support groups for people living with blood pressure, diabetes and more" })
    ).toBeTruthy();
  });

  it("lists the four live groups", () => {
    render(<TarragonCommunity />);
    const groups = screen.getByTestId("community-groups");
    expect(within(groups).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "High blood pressure",
      "Diabetes",
      "Healthy weight and habits",
      "General health",
    ]);
  });

  it("promises nothing that is not built: no direct messages, no doctor answers, no 24/7 cover", () => {
    const { container } = render(<TarragonCommunity />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/direct message|private message|chat with|doctor answers|24\/7|around the clock|anonymous/i);
    expect(text).toMatch(/not medical advice/);
  });

  it("passes the copy lint", () => {
    for (const f of SOURCES) expect(scanText(f.rel, f.text)).toEqual([]);
  });

  it("imports nothing from the platform or auth modules", () => {
    for (const f of SOURCES) {
      const imports = [...f.text.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      expect(imports.filter((i) => /supabase|@tarragon\/auth|lib\/queries|\(dashboard\)/.test(i))).toEqual([]);
    }
  });
});
