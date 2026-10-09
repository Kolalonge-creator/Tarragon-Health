/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";

jest.mock("./ops-actions", () => {
  const ok = jest.fn(async () => ({ ok: true, message: "Saved." }));
  return { setGroupImagesAction: ok, setShiftsAction: ok, createQaAction: ok, cancelQaAction: ok };
});

import { GroupImagesForm } from "./image-forms";
import { CancelQaForm, CreateQaForm } from "./session-forms";
import { ShiftsForm } from "./rota-forms";
import { CoverageGrid } from "./rota-grid";

const doctors = [{ id: "d1", full_name: "Dr Ada Obi", tier: "senior_medical_officer" as const }];
const groups = [{ id: "g1", name: "Calm" }];

describe("pictures, rota and question session forms", () => {
  it("have no axe violations", async () => {
    await expectNoA11yViolations(<GroupImagesForm id="g1" name="Calm" current={false} topicNeedsCmoRules={false} />);
    await expectNoA11yViolations(<GroupImagesForm id="g1" name="Calm" current={true} topicNeedsCmoRules={false} />);
    await expectNoA11yViolations(<GroupImagesForm id="g1" name="Calm" current={undefined} topicNeedsCmoRules />);
    await expectNoA11yViolations(<ShiftsForm staffId="s1" who="Ada" initial={[]} />);
    await expectNoA11yViolations(<ShiftsForm staffId="s1" who="Ada" initial={[{ weekday: 0, start_hour: 8, end_hour: 16 }]} />);
    await expectNoA11yViolations(<CreateQaForm doctors={doctors} groups={groups} />);
    await expectNoA11yViolations(<CreateQaForm doctors={null} groups={[]} />);
    await expectNoA11yViolations(<CancelQaForm seriesId="s1" title="Ask a doctor" />);
    await expectNoA11yViolations(<CoverageGrid title="Moderators" scope="moderator" gaps={[{ scope: "moderator", weekday: 2, hour: 3 }]} />);
  });

  it("offers the right pictures choice for what is known", () => {
    const { rerender } = render(<GroupImagesForm id="g1" name="Calm" current={false} topicNeedsCmoRules={false} />);
    expect(screen.getByRole("button", { name: "Allow pictures" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Switch pictures off" })).toBeNull();
    expect(screen.getByText(/wait for a moderator before anyone sees them/)).toBeTruthy();
    rerender(<GroupImagesForm id="g1" name="Calm" current={undefined} topicNeedsCmoRules />);
    expect(screen.getByRole("button", { name: "Allow pictures" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch pictures off" })).toBeTruthy();
    expect(screen.getByText(/weight-loss group/)).toBeTruthy();
  });

  it("splits an overnight shift in two at midnight and fills every day", () => {
    const { container } = render(<ShiftsForm staffId="s1" who="Ada" initial={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add overnight shift" }));
    const hidden = () => (container.querySelector('input[name="shifts"]') as HTMLInputElement).value;
    expect(JSON.parse(hidden())).toEqual([
      { weekday: 0, start_hour: 22, end_hour: 24 },
      { weekday: 1, start_hour: 0, end_hour: 6 },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Everyday 24 hours" }));
    const all = JSON.parse(hidden()) as Array<{ weekday: number; start_hour: number; end_hour: number }>;
    expect(all).toHaveLength(7);
    expect(all.every((r) => r.start_hour === 0 && r.end_hour === 24)).toBe(true);
    expect(all.map((r) => r.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("wraps a Sunday night shift round to Monday morning", () => {
    const { container } = render(<ShiftsForm staffId="s1" who="Ada" initial={[]} />);
    fireEvent.change(screen.getByLabelText("Starts on"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Add overnight shift" }));
    const rows = JSON.parse((container.querySelector('input[name="shifts"]') as HTMLInputElement).value) as Array<{ weekday: number }>;
    expect(rows.map((r) => r.weekday)).toEqual([6, 0]);
  });

  it("marks gaps in words, not only colour", () => {
    const { container } = render(<CoverageGrid title="Moderators" scope="moderator" gaps={[{ scope: "moderator", weekday: 2, hour: 3 }, { scope: "safety_reviewer", weekday: 0, hour: 0 }]} />);
    expect(screen.getByText("Moderators: 1 hour is not covered")).toBeTruthy();
    expect(screen.getByText("Wednesday 03:00: nobody on duty")).toBeTruthy();
    expect(screen.getByText("Monday 00:00: covered")).toBeTruthy();
    expect(container.querySelectorAll("td")).toHaveLength(168);
  });

  it("asks before saving shifts", async () => {
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
    render(<ShiftsForm staffId="s1" who="Ada" initial={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Save shifts" }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    confirm.mockRestore();
  });
});
