/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { expectNoA11yViolations } from "@/test/a11y";
import { ModerationQueue } from "./moderation-queue";
import { SafetyQueue } from "./safety-queue";
import type { ModItem, SafetyItem } from "@/lib/community/model";

const item: ModItem = {
  post_id: "11111111-1111-4111-8111-111111111111",
  group_id: "22222222-2222-4222-8222-222222222222",
  group_name: "Living with diabetes",
  author_handle: "QuietHeron42",
  is_reply: true,
  body: "Buy my herbal tea, it works.",
  state: "held",
  reasons: ["commerce", "new_member"],
  created_at: "2026-10-09T10:00:00Z",
  report_count: 2,
  report_reasons: ["selling_or_promotion"],
  author_is_new: true,
};
const ok = { ok: true, message: "Approved." };

function setup(items: ModItem[] = [item]) {
  const onDecide = jest.fn().mockResolvedValue(ok);
  const onSanction = jest.fn().mockResolvedValue({ ok: true, message: "Done." });
  return { onDecide, onSanction, ui: <ModerationQueue items={items} onDecide={onDecide} onSanction={onSanction} /> };
}

describe("ModerationQueue", () => {
  it("has no axe violations (card and empty)", async () => {
    await expectNoA11yViolations(setup().ui);
  });
  it("has no axe violations when empty", async () => {
    await expectNoA11yViolations(setup([]).ui);
  });
  it("has no axe violations with the remove form and the sanction form open", async () => {
    const { container } = await expectNoA11yViolations(setup().ui);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Sanction the member" }));
    fireEvent.change(screen.getByLabelText("What to do"), { target: { value: "mute" } });
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows the handle, the reasons and the report note, and no identity field", () => {
    const { ui } = setup();
    const { container } = render(ui);
    expect(screen.getByText("QuietHeron42")).toBeTruthy();
    expect(screen.getByText("May be selling or promoting")).toBeTruthy();
    expect(screen.getByText("New member: first posts are checked")).toBeTruthy();
    expect(screen.getByText("Reported 2 times")).toBeTruthy();
    expect(container.textContent).not.toMatch(/@|\+234|profile/i);
  });

  it("approves a post", async () => {
    const { ui, onDecide } = setup();
    render(ui);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith({ postId: item.post_id, decision: "approve" }));
    expect(await screen.findByText(/Approved\./)).toBeTruthy();
  });

  it("will not remove without a reason, then removes with one", async () => {
    const { ui, onDecide } = setup();
    render(ui);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
    expect(screen.getByRole("alert").textContent).toBe("Please choose a reason.");
    expect(onDecide).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "selling" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith({ postId: item.post_id, decision: "remove", reasonCode: "selling" }));
  });

  it("needs hours for a mute, shows a confirm step, and offers no platform-wide option", async () => {
    const { ui, onSanction } = setup();
    render(ui);
    fireEvent.click(screen.getByRole("button", { name: "Sanction the member" }));
    expect(screen.getByText(/You do not see who this member is; the sanction applies to them in this group/)).toBeTruthy();
    expect(screen.queryByText(/platform/i)).toBeNull();
    fireEvent.change(screen.getByLabelText("What to do"), { target: { value: "mute" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "harassment" } });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByRole("alert").textContent).toMatch(/hours/);
    fireEvent.change(screen.getByLabelText(/For how many hours/), { target: { value: "24" } });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByText(/You are about to mute for 24 hours/)).toBeTruthy();
    expect(onSanction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, apply this sanction" }));
    await waitFor(() => expect(onSanction).toHaveBeenCalledWith({ postId: item.post_id, kind: "mute", reasonCode: "harassment", hours: 24 }));
  });

  it("shows a calm empty state", () => {
    render(setup([]).ui);
    expect(screen.getByText(/Nothing is waiting for you/)).toBeTruthy();
  });

  it("shows a failure in plain words when the action rejects", async () => {
    const onDecide = jest.fn().mockRejectedValue(new Error("db exploded: relation x"));
    render(<ModerationQueue items={[item]} onDecide={onDecide} onSanction={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const msg = await screen.findByText(/Not done/);
    expect(msg.textContent).toBe("Not done: That could not be done. Please try again.");
  });
});

const safety: SafetyItem = {
  signal_id: "33333333-3333-4333-8333-333333333333",
  kind: "self_harm_language",
  status: "open",
  created_at: "2026-10-09T10:00:00Z",
  group_name: "Living with diabetes",
  post_id: "44444444-4444-4444-8444-444444444444",
  post_state: "held",
  author_handle: "SoftMango7",
  body: "I feel so low today.",
};

describe("SafetyQueue", () => {
  it("has no axe violations", async () => {
    await expectNoA11yViolations(<SafetyQueue items={[safety]} onDecide={jest.fn()} />);
    await expectNoA11yViolations(<SafetyQueue items={[]} onDecide={jest.fn()} />);
  });

  it("shows the guidance, never invents a phone number, and shows no identity", () => {
    const { container } = render(<SafetyQueue items={[safety]} onDecide={jest.fn()} />);
    expect(container.textContent).toContain("Nothing has been sent to the member's care team or emergency contact.");
    expect(container.textContent).toContain("follow the crisis process your Chief Medical Officer has given you");
    expect(container.textContent).not.toMatch(/\d{5,}/);
    expect(screen.getByText("Self-harm language")).toBeTruthy();
    expect(screen.getByText("SoftMango7")).toBeTruthy();
  });

  it("keeps withheld, closes, and asks before releasing", async () => {
    const onDecide = jest.fn().mockResolvedValue({ ok: true, message: "Kept withheld." });
    render(<SafetyQueue items={[safety]} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole("button", { name: "Keep withheld" }));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith({ signalId: safety.signal_id, decision: "keep_withheld" }));
    await screen.findByText(/Kept withheld\./);
    fireEvent.click(screen.getByRole("button", { name: "Release" }));
    expect(onDecide).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Yes, release it" }));
    await waitFor(() => expect(onDecide).toHaveBeenLastCalledWith({ signalId: safety.signal_id, decision: "release" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(onDecide).toHaveBeenLastCalledWith({ signalId: safety.signal_id, decision: "close" }));
  });
});
