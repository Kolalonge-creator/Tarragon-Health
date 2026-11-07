/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { NotificationBell } from "./notification-bell";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
const mockRead = jest.fn();
jest.mock("@/lib/queries/notifications", () => ({
  useInAppNotifications: () => mockRead(),
  useMarkNotificationRead: () => ({ mutate: jest.fn() }),
  useMarkAllNotificationsRead: () => ({ mutate: jest.fn() }),
  useRespondToNotification: () => ({ mutate: jest.fn(), isPending: false }),
}));

describe("NotificationBell read failure", () => {
  it("says it couldn't load, never 'No notifications yet', when the read fails", () => {
    mockRead.mockReturnValue({ data: undefined, isError: true });
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByRole("alert").textContent).toMatch(/couldn.t load/i);
    expect(screen.queryByText("No notifications yet.")).toBeNull();
  });

  it("still shows the empty line when the read worked and there is nothing", () => {
    mockRead.mockReturnValue({ data: [], isError: false });
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByText("No notifications yet.")).toBeTruthy();
  });
});
