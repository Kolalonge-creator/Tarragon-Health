/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { LockScreenImageCard, lockScreenImageHref } from "./lock-screen-image-card";

describe("LockScreenImageCard", () => {
  it("shows the shared-phone warning and withholds the save link until the person ticks that anyone holding the phone can read it", () => {
    render(<LockScreenImageCard />);
    expect(screen.getByText(/anyone holding your phone can read this picture/i)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByLabelText(/anyone holding my phone can read this picture/i));
    const link = screen.getByRole("link", { name: /save the picture/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/api/patient/emergency-card/lock-screen-image?confirm=1&minimum=1&qr=1");
  });

  it("starts on the minimum with the QR on, and each can be switched off", () => {
    render(<LockScreenImageCard />);
    fireEvent.click(screen.getByLabelText(/anyone holding my phone/i));
    fireEvent.click(screen.getByLabelText(/show only the minimum/i));
    fireEvent.click(screen.getByLabelText(/add the qr code/i));
    expect((screen.getByRole("link", { name: /save the picture/i }) as HTMLAnchorElement).getAttribute("href")).toBe(
      "/api/patient/emergency-card/lock-screen-image?confirm=1&minimum=0&qr=0",
    );
  });

  it("unticking the confirm takes the link away again", () => {
    render(<LockScreenImageCard />);
    const box = screen.getByLabelText(/anyone holding my phone/i);
    fireEvent.click(box);
    fireEvent.click(box);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("the link always carries confirm=1 and nothing about the person", () => {
    expect(lockScreenImageHref({ minimum: true, qr: true })).toBe("/api/patient/emergency-card/lock-screen-image?confirm=1&minimum=1&qr=1");
  });
});
