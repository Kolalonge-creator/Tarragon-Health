/** @jest-environment jsdom */
/**
 * Design audit P1 item 11: the emergency control is one floating button, not a card on every page.
 * The signed checklist wording must still be reachable in one tap, and the sheet must sit below the
 * EmergencyAlert dialog (z-50) so the guidance that follows a report is never hidden behind it.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

jest.mock("./actions", () => ({ reportDangerSymptoms: jest.fn(), reportPaediatricDangerSymptoms: jest.fn() }));

import { DangerSymptomCheck } from "./danger-symptom-check";

function renderIt() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <DangerSymptomCheck patientId="p1" ageYears={40} />
    </QueryClientProvider>,
  );
}

describe("DangerSymptomCheck floating control", () => {
  it("shows only the button until opened, then the signed question and a submit that needs a selection", () => {
    renderIt();
    expect(screen.getByRole("button", { name: "Get emergency guidance" })).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Get emergency guidance" }));
    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(screen.getByText("Feeling something serious right now?")).not.toBeNull();
    const submit = screen.getAllByRole("button", { name: "Get emergency guidance" }).find((b) => b.getAttribute("type") === "submit");
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("closes with the Close button and sits below the emergency alert layer", () => {
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Get emergency guidance" }));
    expect(screen.getByRole("dialog").className).toContain("z-[45]");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
