/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { activeOutreachDangerousReadingWording } from "@tarragon/i18n";
import { DangerousReadingPanel } from "./screening-days-dashboard";

describe("DangerousReadingPanel (OUT-001)", () => {
  it("shows every step of the CMO-signed wording, names the attendee, and is announced as an alert", () => {
    render(<DangerousReadingPanel name="Ada Obi" onDone={() => {}} />);
    const words = activeOutreachDangerousReadingWording();
    expect(screen.getByRole("alert").textContent).toContain(`${words.title}: Ada Obi`);
    for (const step of words.steps) {
      expect(screen.getByText(step)).toBeTruthy();
    }
  });

  it("stays until the staff member taps Done", () => {
    const onDone = jest.fn();
    render(<DangerousReadingPanel name="Ada Obi" onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
