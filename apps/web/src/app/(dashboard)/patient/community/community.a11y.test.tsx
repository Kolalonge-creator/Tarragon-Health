/** @jest-environment jsdom */
/**
 * The patient Community screens: axe-clean, the safety card appears first and clears the text, the join section cannot be submitted without
 * both ticks, the limit comes from the group, and a member is only ever a made-up name.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import type { FeedPost, GroupSummary, GroupView as GroupViewData } from "@/lib/community/model";

const push = jest.fn();
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const actions = {
  submitPost: jest.fn(),
  editPost: jest.fn(),
  deletePost: jest.fn(),
  reactToPost: jest.fn(),
  reportPost: jest.fn(),
  loadReplies: jest.fn(),
  loadFeed: jest.fn(),
  joinGroup: jest.fn(),
  leaveGroup: jest.fn(),
  setGroupMuted: jest.fn(),
  startEmergencyFromSafetyCard: jest.fn(),
};
jest.mock("./community-actions", () => ({
  submitPost: (...a: unknown[]) => actions.submitPost(...a),
  editPost: (...a: unknown[]) => actions.editPost(...a),
  deletePost: (...a: unknown[]) => actions.deletePost(...a),
  reactToPost: (...a: unknown[]) => actions.reactToPost(...a),
  reportPost: (...a: unknown[]) => actions.reportPost(...a),
  loadReplies: (...a: unknown[]) => actions.loadReplies(...a),
  loadFeed: (...a: unknown[]) => actions.loadFeed(...a),
  joinGroup: (...a: unknown[]) => actions.joinGroup(...a),
  leaveGroup: (...a: unknown[]) => actions.leaveGroup(...a),
  setGroupMuted: (...a: unknown[]) => actions.setGroupMuted(...a),
  startEmergencyFromSafetyCard: (...a: unknown[]) => actions.startEmergencyFromSafetyCard(...a),
}));

import { GroupList } from "./group-list";
import { GroupView } from "./group-view";
import { JoinSection } from "./join-section";
import { Composer } from "./composer";
import { PostCard } from "./post-card";
import { SafetyCard } from "./safety-card";
import { ReportForm } from "./report-form";

const MAX = 321; // arbitrary on purpose: the screen must follow whatever the group says
const NOW = new Date().toISOString();
const POST: FeedPost = {
  id: "p1",
  author_handle: "Quiet Heron",
  author_avatar: "leaf",
  is_mine: false,
  body: "Walking after dinner helped me.",
  created_at: NOW,
  edited_at: null,
  support_count: 2,
  reply_count: 1,
  i_supported: false,
  pending_review: false,
};
const MINE: FeedPost = { ...POST, id: "p2", author_handle: "Warm Fig", is_mine: true, body: "Thank you all.", reply_count: 0 };
const PENDING: FeedPost = { ...MINE, id: "p3", pending_review: true, body: "Waiting one" };

const GROUP = { id: "g1", slug: "hypertension", name: "Living with high blood pressure", description: "Share what helps day to day.", topic_code: "htn", topic_label: "Hypertension", status: "active" as const, rules_text: "Be kind.\nNo selling.", rules_version: 3, join_mode: "open" as const };
const view = (membership: Extract<GroupViewData, { found: true }>["membership"], status: "active" | "read_only" = "active"): Extract<GroupViewData, { found: true }> => ({
  found: true,
  group: { ...GROUP, status },
  membership,
  pinned: [{ id: "n1", title: "Salt and you", body: "A short reviewed note.", reviewed_at: "2026-10-01T09:00:00Z", reviewed_by_name: "Dr Ada Obi" }],
  team: [],
  prompts: [],
  limits: { post_max_chars: MAX, edit_window_minutes: 15 },
});
const MEMBER = { status: "active" as const, handle: "Warm Fig", avatar_code: "sun", rules_current: true, notifications_muted: false };

beforeEach(() => {
  Object.values(actions).forEach((m) => m.mockReset());
  push.mockReset();
  refresh.mockReset();
});

describe("GroupList", () => {
  const groups: GroupSummary[] = [
    { id: "g1", slug: "hypertension", name: "High blood pressure", description: "Share what helps.", topic_code: "htn", topic_label: "Hypertension", status: "active", member_count: 1, my_status: "active" },
    { id: "g2", slug: "diabetes", name: "Diabetes", description: "Day to day.", topic_code: "dm", topic_label: "Diabetes", status: "active", member_count: 12, my_status: "none" },
  ];
  it("shows count, membership and the empty state, and is axe-clean", async () => {
    render(<GroupList groups={groups} locale="en" />);
    expect(screen.getByText(/^1 member/).textContent).toMatch(/You are in this group/);
    expect(screen.getByText("12 members")).toBeTruthy();
    cleanup();
    await expectNoA11yViolations(<GroupList groups={groups} locale="en" />);
    cleanup();
    render(<GroupList groups={[]} locale="en" />);
    expect(screen.getByText("There are no groups open right now.")).toBeTruthy();
  });
});

describe("GroupView", () => {
  it("member view: banner, rules, reviewed note with the reviewer, own handle, limit from the group; axe-clean", async () => {
    render(<GroupView view={view(MEMBER)} initialPosts={[POST, MINE, PENDING]} initialHasMore={false} feedFailed={false} locale="en" />);
    expect(screen.getByText(/not medical advice/)).toBeTruthy();
    expect(screen.getByText("Group rules")).toBeTruthy();
    expect(screen.getByText(/Reviewed by Dr Ada Obi on/)).toBeTruthy();
    expect(screen.getByText("Your name here: Warm Fig")).toBeTruthy();
    expect(screen.getByText(`0 of ${MAX}`)).toBeTruthy();
    expect(screen.getByText("Waiting for a moderator to look at this. Only you can see it for now.")).toBeTruthy();
    cleanup();
    await expectNoA11yViolations(<GroupView view={view(MEMBER)} initialPosts={[POST, MINE, PENDING]} initialHasMore={false} feedFailed={false} locale="en" />);
  });

  it("non-member: a Join button, no composer and no feed; read-only: a notice and no composer", async () => {
    render(<GroupView view={view({ status: "none" })} initialPosts={[]} initialHasMore={false} feedFailed={false} locale="en" />);
    expect(screen.getByRole("button", { name: "Join this group" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Post" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Join this group" }));
    expect(screen.getByText("Before you join")).toBeTruthy();
    cleanup();
    render(<GroupView view={view(MEMBER, "read_only")} initialPosts={[POST]} initialHasMore={false} feedFailed={false} locale="en" />);
    expect(screen.getByText("This group is read only right now. You can read but not post.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Post" })).toBeNull();
  });

  it("older posts use the last post's time as the cursor", async () => {
    actions.loadFeed.mockResolvedValue({ ok: true, posts: [{ ...POST, id: "p9", author_handle: "Old Owl" }], has_more: false });
    render(<GroupView view={view(MEMBER)} initialPosts={[POST]} initialHasMore feedFailed={false} locale="en" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Show older posts" })));
    expect(actions.loadFeed).toHaveBeenCalledWith({ groupId: "g1", before: NOW });
    expect(screen.getByText("Old Owl")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show older posts" })).toBeNull();
  });

  it("an emergency post shows the safety card first, clears the text, and sends nothing by itself", async () => {
    actions.submitPost.mockResolvedValue({ ok: true, outcome: { kind: "safety", safety: "emergency", message: "community.safety.emergency.title" } });
    const { container } = render(<GroupView view={view(MEMBER)} initialPosts={[]} initialHasMore={false} feedFailed={false} locale="en" />);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "my chest is tight and I cannot breathe" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Post" })));
    expect(box.value).toBe("");
    expect(container.textContent).not.toContain("cannot breathe");
    const card = screen.getByRole("alert");
    expect(card.textContent).toContain("If this is an emergency");
    expect(container.firstElementChild?.firstElementChild).toBe(card);
    expect(actions.startEmergencyFromSafetyCard).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    await expectNoA11yViolations(<SafetyCard kind="emergency" locale="en" onDismiss={() => undefined} />);
  });
});

describe("SafetyCard", () => {
  it("emergency: the button is an explicit tap that goes to the existing emergency screen", async () => {
    actions.startEmergencyFromSafetyCard.mockResolvedValue({ ok: true });
    render(<SafetyCard kind="emergency" locale="en" onDismiss={() => undefined} />);
    expect(actions.startEmergencyFromSafetyCard).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Alert my emergency contact" })));
    expect(actions.startEmergencyFromSafetyCard).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/patient");
  });

  it("self harm: links to messaging the care team, can be dismissed, and never says flagged or reported", async () => {
    const onDismiss = jest.fn();
    const { container } = render(<SafetyCard kind="self_harm" locale="en" onDismiss={onDismiss} />);
    expect(screen.getByRole("link", { name: "Message your care team" }).getAttribute("href")).toBe("/patient/messages");
    expect(container.textContent?.toLowerCase()).not.toMatch(/flagged|reported/);
    fireEvent.click(screen.getByRole("button", { name: "I understand" }));
    expect(onDismiss).toHaveBeenCalled();
    cleanup();
    await expectNoA11yViolations(<SafetyCard kind="self_harm" locale="en" onDismiss={onDismiss} />);
  });
});

describe("JoinSection", () => {
  it("cannot be submitted until BOTH boxes are ticked, then sends the group's rules version", async () => {
    actions.joinGroup.mockResolvedValue({ ok: true, handle: "Quiet Heron", avatarCode: "leaf" });
    const onJoined = jest.fn();
    render(<JoinSection groupId="g1" rulesText="Be kind." rulesVersion={3} locale="en" onJoined={onJoined} />);
    const join = screen.getByRole("button", { name: "Join group" }) as HTMLButtonElement;
    expect(join.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("I have read the group rules and agree to follow them"));
    expect(join.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("I understand and agree"));
    expect(join.disabled).toBe(false);
    await act(async () => fireEvent.click(join));
    expect(actions.joinGroup).toHaveBeenCalledWith({ groupId: "g1", rulesVersion: 3, rulesAcknowledged: true, consent: true });
    expect(screen.getByRole("status").textContent).toBe("Your name here: Quiet Heron");
    expect(onJoined).toHaveBeenCalledWith("Quiet Heron", "leaf");
  });

  it("shows the refusal message and is axe-clean", async () => {
    actions.joinGroup.mockResolvedValue({ ok: false, key: "community.join.refused.rules_changed" });
    render(<JoinSection groupId="g1" rulesText="Be kind." rulesVersion={3} locale="en" onJoined={() => undefined} />);
    fireEvent.click(screen.getByLabelText("I have read the group rules and agree to follow them"));
    fireEvent.click(screen.getByLabelText("I understand and agree"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Join group" })));
    expect(screen.getByText("The group rules just changed. Please read them again and then join.")).toBeTruthy();
    cleanup();
    await expectNoA11yViolations(<JoinSection groupId="g1" rulesText="Be kind." rulesVersion={3} locale="en" onJoined={() => undefined} />);
  });
});

describe("Composer", () => {
  const props = { locale: "en" as const, maxChars: 10, label: "community.post.placeholder" as const, submitLabel: "community.post.submit" as const, onPublished: jest.fn(), onSafety: jest.fn() };

  it("counts against the group's limit and will not send an over-long post", async () => {
    const submit = jest.fn();
    render(<Composer {...props} submit={submit} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "12345678901" } });
    expect(screen.getByText(/11 of 10/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Post" }) as HTMLButtonElement).disabled).toBe(true);
    expect(submit).not.toHaveBeenCalled();
  });

  it("keeps the text when blocked and reuses the request id on a retry, a new one after an answer", async () => {
    const submit = jest.fn();
    submit.mockRejectedValueOnce(new Error("offline"));
    submit.mockResolvedValueOnce({ ok: true, outcome: { kind: "blocked", message: "community.compose.blocked.contact" } });
    submit.mockResolvedValueOnce({ ok: true, outcome: { kind: "published", message: "community.compose.published" } });
    render(<Composer {...props} maxChars={100} submit={submit} />);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "call 0801" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Post" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Post" })));
    expect(submit.mock.calls[0]?.[1]).toBe(submit.mock.calls[1]?.[1]);
    expect(box.value).toBe("call 0801");
    expect(screen.getByRole("status").textContent).toMatch(/phone numbers, emails, links/i);
    fireEvent.change(box, { target: { value: "hello" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Post" })));
    expect(submit.mock.calls[2]?.[1]).not.toBe(submit.mock.calls[1]?.[1]);
    expect(box.value).toBe("");
    expect(props.onPublished).toHaveBeenCalled();
  });

  it("is axe-clean", async () => {
    await expectNoA11yViolations(<Composer {...props} submit={jest.fn()} />);
  });
});

describe("PostCard", () => {
  const base = { groupId: "g1", locale: "en" as const, maxChars: MAX, editWindowMinutes: 15, canPost: true, onChanged: jest.fn(), onSafety: jest.fn() };

  it("shows only the made-up name, offers report on others' posts and edit/delete on mine, and is axe-clean", async () => {
    render(<PostCard post={POST} {...base} />);
    expect(screen.getByText("Quiet Heron")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Report" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByRole("button", { name: /1 reply: Show replies/ })).toBeTruthy();
    cleanup();
    render(<PostCard post={MINE} {...base} />);
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
    cleanup();
    await expectNoA11yViolations(<PostCard post={POST} {...base} />);
  });

  it("no edit once the window has passed, and delete asks first", async () => {
    const old = { ...MINE, created_at: new Date(Date.now() - 3600_000).toISOString() };
    render(<PostCard post={old} {...base} />);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    const confirm = jest.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    actions.deletePost.mockResolvedValue({ ok: true });
    const del = screen.getByRole("button", { name: "Delete" });
    await act(async () => fireEvent.click(del));
    expect(actions.deletePost).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(del));
    expect(actions.deletePost).toHaveBeenCalledWith({ postId: "p2" });
    confirm.mockRestore();
  });

  it("support toggles from the server's answer; replies load on demand", async () => {
    actions.reactToPost.mockResolvedValue({ ok: true, supportCount: 3, supported: true });
    actions.loadReplies.mockResolvedValue({ ok: true, replies: [{ ...POST, id: "r1", author_handle: "Kind Reed", body: "Same here.", reply_count: undefined }] });
    render(<PostCard post={POST} {...base} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Support/ })));
    expect(screen.getByRole("button", { name: /Supported \(3\)/ })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Show replies/ })));
    expect(screen.getByText("Kind Reed")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Hide replies/ })).toBeTruthy();
  });
});

describe("ReportForm", () => {
  it("needs a reason, then sends it and thanks the person; axe-clean", async () => {
    actions.reportPost.mockResolvedValue({ ok: true, key: "community.report.thanks" });
    render(<ReportForm postId="p1" locale="en" />);
    const send = screen.getByRole("button", { name: "Send report" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Unkind or threatening"));
    await act(async () => fireEvent.click(send));
    expect(actions.reportPost).toHaveBeenCalledWith({ postId: "p1", reason: "harassment", detail: "" });
    expect(screen.getByRole("status").textContent).toBe("Thank you. A moderator will look at this.");
    cleanup();
    await expectNoA11yViolations(<ReportForm postId="p1" locale="en" />);
  });
});
