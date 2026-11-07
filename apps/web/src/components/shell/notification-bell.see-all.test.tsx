/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { NotificationBell } from "./notification-bell";

const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
jest.mock("@/lib/queries/notifications", () => ({
  useInAppNotifications: () => ({ data: [] }),
  useMarkNotificationRead: () => ({ mutate: jest.fn() }),
  useMarkAllNotificationsRead: () => ({ mutate: jest.fn() }),
  useRespondToNotification: () => ({ mutate: jest.fn(), isPending: false }),
}));

describe("NotificationBell See all link (P19)", () => {
  it("links to the notification centre when given a href", () => {
    render(<NotificationBell allHref="/patient/notifications" />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    fireEvent.click(screen.getByText("See all notifications"));
    expect(push).toHaveBeenCalledWith("/patient/notifications");
  });

  it("shows no link on a staff console", () => {
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.queryByText("See all notifications")).toBeNull();
  });
});
