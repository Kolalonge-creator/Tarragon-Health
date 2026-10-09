/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { expectNoA11yViolations } from "@/test/a11y";
import { DrillForm } from "./drill-form";
import { DrillRuns, DrillSteps } from "./drill-runs";
import { ModerationQueue } from "./moderation-queue";
import { QaAnswerForm } from "./qa-answer-form";
import { RecentPosts } from "./recent-posts";
import { SafetyQueue } from "./safety-queue";
import type { ModItem, ModRecentItem, SafetyItem } from "@/lib/community/model";

const IMG = "55555555-5555-4555-8555-555555555555";
const withPicture: ModItem = {
  post_id: "11111111-1111-4111-8111-111111111111",
  group_id: "22222222-2222-4222-8222-222222222222",
  group_name: "Living with diabetes",
  author_handle: "QuietHeron42",
  is_reply: false,
  body: "My meal today.",
  state: "held",
  reasons: ["image_pending"],
  created_at: "2026-10-09T10:00:00Z",
  report_count: 0,
  report_reasons: [],
  author_is_new: false,
  image_id: IMG,
};
const ok = { ok: true, message: "Done." };

describe("a picture in the moderation queue", () => {
  const setup = () => {
    const onDecide = jest.fn().mockResolvedValue(ok);
    const ui = <ModerationQueue items={[withPicture]} onDecide={onDecide} onSanction={jest.fn()} />;
    return { onDecide, ui };
  };
  it("shows the picture, the checklist and the warning, with no axe violations", async () => {
    const { container } = await expectNoA11yViolations(setup().ui);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(`/api/community/images/${IMG}`);
    expect(img?.className).toContain("max-h-96");
    expect(screen.getByText(/No faces of other people/)).toBeTruthy();
    expect(screen.getByText("Approving makes this picture visible to the whole group.")).toBeTruthy();
  });
  it("asks before approving a picture, and only then approves", async () => {
    const { ui, onDecide } = setup();
    render(ui);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onDecide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, approve the picture" }));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith({ postId: withPicture.post_id, decision: "approve" }));
  });
  it("approves a post without a picture straight away", async () => {
    const onDecide = jest.fn().mockResolvedValue(ok);
    render(<ModerationQueue items={[{ ...withPicture, image_id: null }]} onDecide={onDecide} onSanction={jest.fn()} />);
    expect(document.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(onDecide).toHaveBeenCalled());
  });
});

describe("a picture in the safety queue", () => {
  it("shows the picture and has no axe violations", async () => {
    const item: SafetyItem = {
      signal_id: "33333333-3333-4333-8333-333333333333", kind: "self_harm_language", status: "open", created_at: "2026-10-09T10:00:00Z",
      group_name: "Calm", post_id: "44444444-4444-4444-8444-444444444444", post_state: "withheld", author_handle: "QuietHeron42", body: "text", image_id: IMG,
    };
    const { container } = await expectNoA11yViolations(<SafetyQueue items={[item]} onDecide={jest.fn()} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(`/api/community/images/${IMG}`);
  });
});

describe("RecentPosts", () => {
  const post = (n: number, extra: Partial<ModRecentItem> = {}): ModRecentItem => ({
    post_id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    group_id: "22222222-2222-4222-8222-222222222222",
    group_name: "Calm",
    author_handle: `Heron${n}`,
    is_reply: false,
    body: `Post ${n}`,
    state: "visible",
    created_at: `2026-10-09T10:${String(59 - n).padStart(2, "0")}:00Z`,
    image_id: null,
    ...extra,
  });
  const cb = { onLoadOlder: jest.fn(), onRemove: jest.fn() };
  it("has no axe violations with a picture and a reply", async () => {
    const { container } = await expectNoA11yViolations(<RecentPosts initial={[post(1, { image_id: IMG }), post(2, { is_reply: true })]} {...cb} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(`/api/community/images/${IMG}`);
  });
  it("has no axe violations when empty", async () => {
    await expectNoA11yViolations(<RecentPosts initial={[]} {...cb} />);
  });
  it("has no axe violations with the reason picker open", async () => {
    const { container } = await expectNoA11yViolations(<RecentPosts initial={[post(1)]} {...cb} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(container.querySelector("select")).not.toBeNull();
    expect((await axe(container)).violations).toHaveLength(0);
  });
  it("needs a reason, then removes once and marks the post removed", async () => {
    const onRemove = jest.fn().mockResolvedValue({ ok: true, message: "Removed." });
    render(<RecentPosts initial={[post(1)]} onLoadOlder={jest.fn()} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove it" }));
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Please choose a reason.");
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "unkind" } });
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove it" }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith({ postId: post(1).post_id, reasonCode: "unkind" }));
    await waitFor(() => expect(screen.getByText("Removed.", { selector: "p.font-medium" })).toBeTruthy());
  });
  it("shows Load older only for a full page, and appends the next page once", async () => {
    const first = Array.from({ length: 30 }, (_, i) => post(i));
    const older = [post(31), post(29)];
    const onLoadOlder = jest.fn().mockResolvedValue({ ok: true, items: older });
    render(<RecentPosts initial={first} onLoadOlder={onLoadOlder} onRemove={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Load older" }));
    await waitFor(() => expect(onLoadOlder).toHaveBeenCalledWith({ before: first[29].created_at }));
    await waitFor(() => expect(screen.getByText("Post 31")).toBeTruthy());
    expect(screen.getAllByText("Post 29")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Load older" })).toBeNull();
  });
  it("does not offer Load older for a short page, and says so when loading fails", async () => {
    const { rerender } = render(<RecentPosts initial={[post(1)]} onLoadOlder={jest.fn()} onRemove={jest.fn()} />);
    expect(screen.queryByRole("button", { name: "Load older" })).toBeNull();
    const first = Array.from({ length: 30 }, (_, i) => post(i));
    rerender(<RecentPosts key="x" initial={first} onLoadOlder={jest.fn().mockResolvedValue({ ok: false, message: "That could not be done. Please try again." })} onRemove={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Load older" }));
    await waitFor(() => expect(screen.getByText(/Not done: That could not be done/)).toBeTruthy());
  });
});

describe("the safety drill", () => {
  it("has no axe violations", async () => {
    await expectNoA11yViolations(<DrillForm onRecord={jest.fn()} />);
    await expectNoA11yViolations(<DrillSteps />);
    await expectNoA11yViolations(
      <DrillRuns runs={[{ id: "r1", run_at: "2026-10-09T10:00:00Z", passed: false, notes: "Step 6 skipped", run_by_name: "Dr Chief", steps: [{ step: "One", ok: true }, { step: "Two", ok: false }] }]} />,
    );
    await expectNoA11yViolations(<DrillRuns runs={[]} />);
  });
  it("will not record a pass unless the first five steps are ticked", async () => {
    const onRecord = jest.fn().mockResolvedValue(ok);
    render(<DrillForm onRecord={onRecord} />);
    fireEvent.click(screen.getByLabelText("Passed"));
    fireEvent.click(screen.getByRole("button", { name: "Record this drill" }));
    expect(onRecord).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/first five steps/);
  });
  it("records the ticks as steps", async () => {
    const onRecord = jest.fn().mockResolvedValue(ok);
    render(<DrillForm onRecord={onRecord} />);
    for (const box of screen.getAllByRole("checkbox").slice(0, 5)) fireEvent.click(box);
    fireEvent.click(screen.getByLabelText("Passed"));
    fireEvent.click(screen.getByRole("button", { name: "Record this drill" }));
    await waitFor(() => expect(onRecord).toHaveBeenCalled());
    const arg = onRecord.mock.calls[0][0] as { passed: boolean; steps: Array<{ ok: boolean }> };
    expect(arg.passed).toBe(true);
    expect(arg.steps.map((s) => s.ok)).toEqual([true, true, true, true, true, false]);
  });
  it("asks whether it passed", () => {
    const onRecord = jest.fn();
    render(<DrillForm onRecord={onRecord} />);
    fireEvent.click(screen.getByRole("button", { name: "Record this drill" }));
    expect(onRecord).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Please say whether the drill passed.");
  });
});

describe("QaAnswerForm", () => {
  it("has no axe violations", async () => {
    await expectNoA11yViolations(<QaAnswerForm postId="p" onAnswer={jest.fn()} />);
  });
  it("rejects a too-short answer and sends a good one", async () => {
    const onAnswer = jest.fn().mockResolvedValue(ok);
    render(<QaAnswerForm postId="p1" onAnswer={onAnswer} />);
    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "no" } });
    fireEvent.click(screen.getByRole("button", { name: "Post answer" }));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/between 5 and 1500/);
    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "Drink water and see your clinic." } });
    fireEvent.click(screen.getByRole("button", { name: "Post answer" }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith({ postId: "p1", body: "Drink water and see your clinic." }));
  });
});
