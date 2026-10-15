/** @jest-environment jsdom */
/** The share button never fails silently: with no share sheet and no clipboard the address is shown to copy by hand (S55 review). */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ShareLessonButtons } from "./share-lesson-buttons";

const URL_ = "https://tarragonhealth.ng/learn/htn-basics";

describe("ShareLessonButtons", () => {
  const nav = navigator as unknown as Record<string, unknown>;
  afterEach(() => {
    delete nav.share;
    delete nav.clipboard;
  });

  it("copies the link when the clipboard works, and shows no manual field", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ShareLessonButtons title="Basics" url={URL_} />);
    fireEvent.click(screen.getAllByRole("button")[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL_));
    expect(screen.queryByDisplayValue(URL_)).toBeNull();
  });

  it("shows the address to copy by hand when the clipboard is refused (not a silent no-op)", async () => {
    const writeText = jest.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ShareLessonButtons title="Basics" url={URL_} />);
    fireEvent.click(screen.getAllByRole("button")[0]);
    await waitFor(() => expect(screen.getByDisplayValue(URL_)).toBeTruthy());
  });

  it("carries only the public address: no account or patient information in the link or the email", () => {
    render(<ShareLessonButtons title="Basics" url={URL_} />);
    const mail = screen.getByRole("link") as HTMLAnchorElement;
    expect(decodeURIComponent(mail.href)).toContain(URL_);
    expect(mail.href).not.toMatch(/patient|token|user/i);
  });
});
