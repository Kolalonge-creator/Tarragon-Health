/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";

jest.mock("./actions", () => ({
  doctorUnmaskAction: jest.fn(async () => ({ ok: true, message: "Recorded.", result: { full_name: "Ada Obi" } })),
}));

import { DoctorUnmask } from "./unmask-client";

const candidates = [{ signal_id: "s1", group_id: "g1", group_name: "Calm", author_handle: "calm-heron", kind: "reviewer_concern", status: "open", created_at: "2026-10-08T10:00:00Z", body: "Words of the post" }];

describe("doctor unmask", () => {
  it("has no axe violations with a list, an empty list, or a load failure", async () => {
    await expectNoA11yViolations(<DoctorUnmask candidates={candidates} />);
    await expectNoA11yViolations(<DoctorUnmask candidates={[]} />);
    await expectNoA11yViolations(<DoctorUnmask candidates={null} />);
  });
  it("shows the name once, without a profile id, and clears it", async () => {
    jest.spyOn(window, "confirm").mockReturnValue(true);
    render(<DoctorUnmask candidates={candidates} />);
    expect(screen.getByText(/reported that this person may be in danger/)).toBeTruthy();
    fireEvent.change(screen.getAllByLabelText("Written reason")[0], { target: { value: "Safety review of a flagged post" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Look up this person" })[0]);
    await waitFor(() => expect(screen.getByText("Ada Obi")).toBeTruthy());
    expect(screen.queryByText("Profile id")).toBeNull();
    expect(screen.getByText(/recorded with your written reason/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear this result" }));
    expect(screen.queryByText("Ada Obi")).toBeNull();
  });
});
