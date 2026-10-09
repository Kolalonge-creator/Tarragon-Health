/** @jest-environment jsdom */
/**
 * Community Phase 2 member features: search, the Full badge, prompts and team, the weekly note, hiding a person, the appeals page and
 * the eating-disorder hold message. Every new component is also checked with axe.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { composeOutcome, type FeedPost, type GroupSummary, type GroupView as GroupViewData, type MyActions } from "@/lib/community/model";

const push = jest.fn();
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const actions = {
  searchGroups: jest.fn(),
  setDigest: jest.fn(),
  hideAuthor: jest.fn(),
  unhideAuthor: jest.fn(),
  submitAppeal: jest.fn(),
  submitPost: jest.fn(),
  loadReplies: jest.fn(),
  loadFeed: jest.fn(),
  setGroupMuted: jest.fn(),
};
jest.mock("./community-actions", () => ({
  searchGroups: (...a: unknown[]) => actions.searchGroups(...a),
  setDigest: (...a: unknown[]) => actions.setDigest(...a),
  hideAuthor: (...a: unknown[]) => actions.hideAuthor(...a),
  unhideAuthor: (...a: unknown[]) => actions.unhideAuthor(...a),
  submitAppeal: (...a: unknown[]) => actions.submitAppeal(...a),
  submitPost: (...a: unknown[]) => actions.submitPost(...a),
  loadReplies: (...a: unknown[]) => actions.loadReplies(...a),
  loadFeed: (...a: unknown[]) => actions.loadFeed(...a),
  setGroupMuted: (...a: unknown[]) => actions.setGroupMuted(...a),
  editPost: jest.fn(),
  deletePost: jest.fn(),
  reactToPost: jest.fn(),
  reportPost: jest.fn(),
  joinGroup: jest.fn(),
  leaveGroup: jest.fn(),
  startEmergencyFromSafetyCard: jest.fn(),
}));

import { GroupList } from "./group-list";
import { GroupSearch } from "./group-search";
import { GroupView } from "./group-view";
import { HiddenAuthors } from "./hidden-authors";
import { PostCard } from "./post-card";
import { Composer } from "./composer";
import { AppealForm } from "./appeals/appeal-form";
import { AppealsList } from "./appeals/appeals-list";

type Found = Extract<GroupViewData, { found: true }>;
const NOW = new Date().toISOString();
const POST: FeedPost = { id: "p1", author_handle: "Quiet Heron", author_avatar: "leaf", is_mine: false, body: "Hello.", created_at: NOW, edited_at: null, support_count: 0, reply_count: 0, i_supported: false, pending_review: false };
const MINE: FeedPost = { ...POST, id: "p2", author_handle: "Warm Fig", is_mine: true };
const MEMBER = { status: "active" as const, handle: "Warm Fig", avatar_code: "sun", rules_current: true, notifications_muted: false, digest_opt_in: false };
const view = (over: Partial<Found> = {}, group: Partial<Found["group"]> = {}): Found => ({
  found: true,
  group: { id: "g1", slug: "htn", name: "High blood pressure", description: "Share what helps.", topic_code: "htn", topic_label: "Hypertension", status: "active", rules_text: "Be kind.", rules_version: 1, join_mode: "open", ...group },
  membership: MEMBER,
  pinned: [],
  team: [],
  prompts: [],
  limits: { post_max_chars: 500, edit_window_minutes: 15 },
  ...over,
});
const gv = (v: Found, hidden: { id: string; handle: string }[] = []) => <GroupView view={v} initialPosts={[POST, MINE]} initialHasMore={false} feedFailed={false} hidden={hidden} locale="en" />;

beforeEach(() => {
  Object.values(actions).forEach((m) => m.mockReset());
  push.mockReset();
  refresh.mockReset();
});

const SUMMARIES: GroupSummary[] = [
  { id: "g1", slug: "htn", name: "High blood pressure", description: "Share what helps.", topic_code: "htn", topic_label: "Hypertension", status: "active", member_count: 3, my_status: "none", full: true },
  { id: "g2", slug: "dm", name: "Diabetes", description: "Day to day.", topic_code: "dm", topic_label: "Diabetes", status: "active", member_count: 4, my_status: "active", full: true },
  { id: "g3", slug: "ckd", name: "Kidneys", description: "Care.", topic_code: "ckd", topic_label: "Kidney", status: "active", member_count: 1, my_status: "none" },
];

describe("group list: search and the Full badge", () => {
  it("shows Full for a full group the member is not in, not for one they are in", async () => {
    render(<GroupList groups={SUMMARIES} locale="en" />);
    expect(screen.getAllByText("Full for now")).toHaveLength(1);
    cleanup();
    await expectNoA11yViolations(<GroupList groups={SUMMARIES} locale="en" />);
  });

  it("search sends the text, shows the matches, and says so when nothing matches", async () => {
    actions.searchGroups.mockResolvedValueOnce({ open: true, adult: true, groups: [SUMMARIES[2]] });
    render(<GroupSearch groups={SUMMARIES} locale="en" />);
    fireEvent.change(screen.getByLabelText("Search groups"), { target: { value: "kidney" } });
    await act(async () => fireEvent.submit(screen.getByRole("search")));
    expect(actions.searchGroups).toHaveBeenCalledWith({ q: "kidney" });
    expect(screen.getByText("Kidneys")).toBeTruthy();
    expect(screen.queryByText("Diabetes")).toBeNull();
    actions.searchGroups.mockResolvedValueOnce({ open: true, adult: true, groups: [] });
    fireEvent.change(screen.getByLabelText("Search groups"), { target: { value: "zzz" } });
    await act(async () => fireEvent.submit(screen.getByRole("search")));
    expect(screen.getByText("No groups match that.")).toBeTruthy();
    cleanup();
    await expectNoA11yViolations(<GroupSearch groups={SUMMARIES} locale="en" />);
  });

  it("a failed search shows a calm message and keeps the list", async () => {
    actions.searchGroups.mockResolvedValueOnce({ ok: false, key: "community.feed.error" });
    render(<GroupSearch groups={SUMMARIES} locale="en" />);
    await act(async () => fireEvent.submit(screen.getByRole("search")));
    expect(screen.getByRole("heading", { name: "Diabetes" })).toBeTruthy();
  });
});

describe("group view: Phase 2", () => {
  it("shows prompts, the team with role labels, and the default line when the team list is empty; axe-clean", async () => {
    render(gv(view({ prompts: [{ id: "pr1", body: "How was your week?" }], team: [{ display_name: "Nurse Ada", scope: "moderator" }] })));
    expect(screen.getByText("From the Tarragon team")).toBeTruthy();
    expect(screen.getByText("How was your week?")).toBeTruthy();
    expect(screen.getByText("Who looks after this group")).toBeTruthy();
    expect(screen.getByText(/Nurse Ada/).textContent).toContain("Moderator");
    expect(screen.getByRole("link", { name: "Decisions about your posts" }).getAttribute("href")).toBe("/patient/community/appeals");
    cleanup();
    render(gv(view()));
    expect(screen.getByText("The Tarragon team looks after this group.")).toBeTruthy();
    expect(screen.queryByText("From the Tarragon team")).toBeNull();
    cleanup();
    await expectNoA11yViolations(gv(view({ prompts: [{ id: "pr1", body: "How was your week?" }], team: [{ display_name: "Nurse Ada", scope: "safety_reviewer" }] }), [{ id: "h1", handle: "Old Owl" }]));
  });

  it("a full group replaces Join with the badge for a non-member, but not for a member", () => {
    render(gv(view({ membership: { status: "none" } }, { full: true })));
    expect(screen.queryByRole("button", { name: "Join this group" })).toBeNull();
    expect(screen.getByText("Full for now")).toBeTruthy();
    cleanup();
    render(gv(view({}, { full: true })));
    expect(screen.queryByText("Full for now")).toBeNull();
  });

  it("the weekly note toggle reflects the saved choice and calls the action", async () => {
    actions.setDigest.mockResolvedValue({ ok: true, on: true });
    render(gv(view()));
    const box = screen.getByLabelText("Send me a weekly note when there is something new") as HTMLInputElement;
    expect(box.checked).toBe(false);
    await act(async () => fireEvent.click(box));
    expect(actions.setDigest).toHaveBeenCalledWith({ groupId: "g1", on: true });
    expect(box.checked).toBe(true);
    cleanup();
    render(gv(view({ membership: { ...MEMBER, digest_opt_in: true } })));
    expect((screen.getByLabelText(/weekly note/) as HTMLInputElement).checked).toBe(true);
  });

  it("lists hidden people with the note and a Show again button", async () => {
    actions.unhideAuthor.mockResolvedValue({ ok: true });
    render(gv(view(), [{ id: "h1", handle: "Old Owl" }]));
    expect(screen.getByText("People you have hidden")).toBeTruthy();
    expect(screen.getByText("They are never told. You can show them again at any time.")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Show again: Old Owl/ })));
    expect(actions.unhideAuthor).toHaveBeenCalledWith({ id: "h1" });
    expect(refresh).toHaveBeenCalled();
  });

  it("HiddenAuthors with nobody hidden says so, and is axe-clean", async () => {
    render(<HiddenAuthors hidden={[]} locale="en" onChanged={() => undefined} />);
    expect(screen.getByText("You have not hidden anyone in this group.")).toBeTruthy();
    cleanup();
    await expectNoA11yViolations(<HiddenAuthors hidden={[{ id: "h1", handle: "Old Owl" }]} locale="en" onChanged={() => undefined} />);
  });
});

describe("post card: hide this person", () => {
  const base = { groupId: "g1", locale: "en" as const, maxChars: 500, editWindowMinutes: 15, canPost: true, onChanged: jest.fn(), onSafety: jest.fn() };

  it("is offered on other people's posts only, as a plain button", () => {
    render(<PostCard post={POST} {...base} />);
    expect(screen.getByRole("button", { name: "Hide this person's posts" }).tagName).toBe("BUTTON");
    cleanup();
    render(<PostCard post={MINE} {...base} />);
    expect(screen.queryByRole("button", { name: "Hide this person's posts" })).toBeNull();
  });

  it("on success shows the done line and refreshes; on failure shows the failure line", async () => {
    const onChanged = jest.fn();
    actions.hideAuthor.mockResolvedValueOnce({ ok: true });
    render(<PostCard post={POST} {...base} onChanged={onChanged} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Hide this person's posts" })));
    expect(actions.hideAuthor).toHaveBeenCalledWith({ postId: "p1" });
    expect(screen.getByRole("status").textContent).toContain("You will not see this person's posts");
    expect(onChanged).toHaveBeenCalled();
    cleanup();
    const onChanged2 = jest.fn();
    actions.hideAuthor.mockResolvedValueOnce({ ok: false, key: "community.post.hide_failed" });
    render(<PostCard post={POST} {...base} onChanged={onChanged2} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Hide this person's posts" })));
    expect(screen.getByRole("status").textContent).toBe("That could not be done. Please try again.");
    expect(onChanged2).not.toHaveBeenCalled();
    cleanup();
    await expectNoA11yViolations(<PostCard post={POST} {...base} />);
  });
});

describe("appeals", () => {
  const data: MyActions = {
    open: true,
    removed_posts: [
      { post_id: "r1", group_name: "Diabetes", removed_at: "2026-10-01T09:00:00Z", reason_code: "harassment", appeal_status: null, can_appeal: true },
      { post_id: "r2", group_name: "Kidneys", removed_at: "2026-10-02T09:00:00Z", reason_code: null, appeal_status: "open", can_appeal: false },
    ],
    sanctions: [
      { sanction_id: "s1", kind: "mute", group_name: "Diabetes", starts_at: "2026-10-03T09:00:00Z", ends_at: null, reason_code: "x", overturned: true, appeal_status: "overturned", can_appeal: false },
    ],
  };

  it("lists removals and access changes, shows statuses, offers the form only where allowed, and never shows moderators or post text", async () => {
    const { container } = render(<AppealsList actions={data} locale="en" />);
    expect(screen.getByText("A post in Diabetes was removed.")).toBeTruthy();
    expect(screen.getByText("Waiting for a second look")).toBeTruthy();
    expect(screen.getByText(/You were muted for a while\./)).toBeTruthy();
    expect(screen.getByText("This was reversed after a second look.")).toBeTruthy();
    expect(screen.getAllByLabelText("What do you think we got wrong?")).toHaveLength(1);
    expect(container.textContent?.toLowerCase()).not.toMatch(/moderator [a-z]+ |harassment/);
    cleanup();
    await expectNoA11yViolations(<AppealsList actions={data} locale="en" />);
  });

  it("empty state", () => {
    render(<AppealsList actions={{ open: true, removed_posts: [], sanctions: [] }} locale="en" />);
    expect(screen.getByText("There is nothing to show. Recent decisions appear here for a short time.")).toBeTruthy();
  });

  it("the form sends kind, id and reason, then confirms; a refusal shows its message", async () => {
    actions.submitAppeal.mockResolvedValueOnce({ ok: false, key: "community.appeals.refused.reason_length" });
    actions.submitAppeal.mockResolvedValueOnce({ ok: true });
    render(<AppealForm kind="removal" targetId="r1" locale="en" />);
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("What do you think we got wrong?"), { target: { value: "short" } });
    await act(async () => fireEvent.click(send));
    expect(actions.submitAppeal).toHaveBeenCalledWith({ kind: "removal", targetId: "r1", reason: "short" });
    expect(screen.getByRole("status").textContent).toBe("Please write a little more, at least 10 characters.");
    fireEvent.change(screen.getByLabelText("What do you think we got wrong?"), { target: { value: "This was a joke between friends." } });
    await act(async () => fireEvent.click(send));
    expect(screen.getByRole("status").textContent).toBe("Thank you. A different moderator will look at this.");
    expect(refresh).toHaveBeenCalled();
    cleanup();
    await expectNoA11yViolations(<AppealForm kind="sanction" targetId="s1" locale="en" />);
  });
});

describe("eating-disorder hold", () => {
  it("composeOutcome maps it to the dedicated message", () => {
    expect(composeOutcome({ status: "held", reason: "eating_disorder" })).toEqual({ kind: "held", message: "community.compose.held.eating_disorder" });
  });

  it("the composer shows that message, clears the box and tells the parent", async () => {
    const onPublished = jest.fn();
    const submit = jest.fn().mockResolvedValue({ ok: true, outcome: composeOutcome({ status: "held", reason: "eating_disorder" }) });
    render(<Composer locale="en" maxChars={100} label="community.post.placeholder" submitLabel="community.post.submit" submit={submit} onPublished={onPublished} onSafety={jest.fn()} />);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "I have been struggling" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Post" })));
    expect(screen.getByRole("status").textContent).toMatch(/A person on our team will read your post before it is shown\. If food or your body feels hard/);
    expect(box.value).toBe("");
    expect(onPublished).toHaveBeenCalled();
  });
});
