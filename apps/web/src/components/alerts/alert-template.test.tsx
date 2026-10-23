/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { AlertTemplate } from "./alert-template";

const props = {
  noticed: "You ticked a sign that needs a check.",
  meaning: "Some signs in pregnancy need care straight away.",
  step: "Go to your health facility now.",
};

describe("AlertTemplate", () => {
  it("shows what we noticed, what it may mean, one step and a message-your-care-team link", () => {
    render(<AlertTemplate {...props} />);
    expect(screen.getByRole("heading", { name: props.noticed })).toBeTruthy();
    expect(screen.getByText("What it may mean")).toBeTruthy();
    expect(screen.getByText(props.meaning)).toBeTruthy();
    expect(screen.getByText("One step to take")).toBeTruthy();
    expect(screen.getByText(props.step)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Message your care team" });
    expect(link.getAttribute("href")).toBe("/patient/messages");
  });

  it("uses red only for a clinical alert", () => {
    const { container, rerender } = render(<AlertTemplate {...props} />);
    expect(container.innerHTML).not.toMatch(/red-/);
    rerender(<AlertTemplate {...props} clinical />);
    expect(container.innerHTML).toMatch(/red-200/);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("urgent: the step is the most prominent element, shown once, with no message link beside it", () => {
    const { container } = render(<AlertTemplate {...props} clinical urgent />);
    expect(screen.getAllByText(props.step)).toHaveLength(1);
    expect(screen.getByText(props.step).className).toMatch(/text-lg/);
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).not.toMatch(/Message your care team/);
  });

  it("can leave the button out", () => {
    render(<AlertTemplate {...props} messageHref={null} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("has no axe violations, clinical or not", async () => {
    await expectNoA11yViolations(<AlertTemplate {...props} />);
    await expectNoA11yViolations(<AlertTemplate {...props} clinical />);
  });
});
