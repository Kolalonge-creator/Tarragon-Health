/** @jest-environment jsdom */
/**
 * Saved posts, the feed order and the "For your own health" links (migration *_community_saved_posts_and_feed_sort.sql).
 * Screens: Save is on top-level posts only and shows its state; the order links keep the group and mark the current one; the group points
 * to the private care-team messages, the private record and this group's reading, and an unlisted group gets the general library only.
 * Actions: the order reaches the database only when it is not the default; a refused save turns into a calm message key, never DB text.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { feedSortFrom, type FeedPost, type GroupView as GroupViewData } from "@/lib/community/model";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));

const setSaved = jest.fn();
jest.mock("./community-actions", () => ({
  setSaved: (...a: unknown[]) => setSaved(...a),
  submitPost: jest.fn(),
  editPost: jest.fn(),
  deletePost: jest.fn(),
  reactToPost: jest.fn(),
  reportPost: jest.fn(),
  hideAuthor: jest.fn(),
  loadReplies: jest.fn(),
  loadFeed: jest.fn(),
  joinGroup: jest.fn(),
  leaveGroup: jest.fn(),
  setGroupMuted: jest.fn(),
  setDigest: jest.fn(),
}));

import { GroupView } from "./group-view";
import { PostCard } from "./post-card";

const NOW = new Date().toISOString();
const POST: FeedPost = {
  id: "p1",
  author_handle: "Quiet Heron",
  author_avatar: "leaf",
  is_mine: false,
  body: "Walking after dinner helped me.",
  created_at: NOW,
  edited_at: null,
  support_count: 0,
  reply_count: 0,
  i_supported: false,
  i_saved: false,
  pending_review: false,
  answers: [],
};
const view = (slug: string): Extract<GroupViewData, { found: true }> => ({
  found: true,
  group: { id: "g1", slug, name: "High blood pressure", description: "Share what helps.", topic_code: "htn", topic_label: null, status: "active", rules_text: "Be kind.", rules_version: 1, join_mode: "open" },
  membership: { status: "active", handle: "Warm Fig", avatar_code: "sun", rules_current: true, notifications_muted: false },
  pinned: [],
  team: [],
  prompts: [],
  qa: null,
  limits: { post_max_chars: 500, edit_window_minutes: 15 },
});
const cardProps = { groupId: "g1", locale: "en" as const, maxChars: 500, editWindowMinutes: 15, canPost: true, onChanged: jest.fn(), onSafety: jest.fn() };

beforeEach(() => {
  setSaved.mockReset();
  refresh.mockReset();
});

describe("Save on a post", () => {
  it("saves, shows the new state and says where to find it", async () => {
    setSaved.mockResolvedValue({ ok: true, saved: true });
    render(<PostCard post={POST} {...cardProps} />);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    await act(async () => fireEvent.click(button));
    expect(setSaved).toHaveBeenCalledWith({ postId: "p1", saved: true });
    expect(screen.getByRole("button", { name: "Saved" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Saved. Find it again under Saved posts.")).toBeTruthy();
  });

  it("keeps the old state and shows the refusal when the database says no", async () => {
    setSaved.mockResolvedValue({ ok: false, key: "community.saved.too_many" });
    render(<PostCard post={POST} {...cardProps} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByText(/You have saved 500 posts/)).toBeTruthy();
  });

  it("a reply, or a post without i_saved, has no Save control", () => {
    render(<PostCard post={POST} {...cardProps} isReply />);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    cleanup();
    const { i_saved: _omitted, ...withoutSaved } = POST;
    void _omitted;
    render(<PostCard post={withoutSaved} {...cardProps} />);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});

describe("Group page: order, care links and reading", () => {
  it("order links keep the group, mark the current order, and Most discussed says what it means; axe-clean", async () => {
    render(<GroupView view={view("high-blood-pressure")} initialPosts={[POST]} initialHasMore={false} feedFailed={false} sort="discussed" locale="en" />);
    const nav = screen.getByRole("navigation", { name: "Order of posts" });
    const latest = within(nav).getByRole("link", { name: "Latest" });
    const discussed = within(nav).getByRole("link", { name: "Most discussed" });
    expect(latest.getAttribute("href")).toBe("/patient/community/high-blood-pressure");
    expect(discussed.getAttribute("href")).toBe("/patient/community/high-blood-pressure?sort=discussed");
    expect(discussed.getAttribute("aria-current")).toBe("page");
    expect(latest.getAttribute("aria-current")).toBeNull();
    expect(screen.getByText("Posts from the last 30 days with the most replies.")).toBeTruthy();
    expect(within(nav).queryByRole("link", { name: "Saved posts" })).toBeNull(); // not one of the orders
    expect(screen.getByRole("link", { name: "Saved posts" }).getAttribute("href")).toBe("/patient/community/saved");
    cleanup();
    await expectNoA11yViolations(<GroupView view={view("high-blood-pressure")} initialPosts={[POST]} initialHasMore={false} feedFailed={false} sort="discussed" locale="en" />);
  });

  it("points to the private care-team messages and the private record, and to this group's reading", () => {
    render(<GroupView view={view("high-blood-pressure")} initialPosts={[]} initialHasMore={false} feedFailed={false} locale="en" />);
    expect(screen.getByRole("link", { name: "Message your care team" }).getAttribute("href")).toBe("/patient/messages");
    expect(screen.getByRole("link", { name: "Upload to your private record" }).getAttribute("href")).toBe("/patient/documents");
    const reading = within(screen.getByTestId("community-reading")).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(reading).toEqual(["/patient/learn?category=hypertension#learn-library", "/patient/learn?category=medicines#learn-library", "/patient/learn"]);
    // The copy promises a private route, never a doctor.
    expect(screen.getByText(/message your care team privately/).textContent).not.toMatch(/doctor|review|advice/i);
  });

  it("a group not in the reading list gets the general library link only", () => {
    render(<GroupView view={view("a-new-group")} initialPosts={[]} initialHasMore={false} feedFailed={false} locale="en" />);
    const reading = within(screen.getByTestId("community-reading")).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(reading).toEqual(["/patient/learn"]);
  });
});

describe("feedSortFrom", () => {
  it("accepts only the two orders and defaults to latest", () => {
    expect(feedSortFrom("discussed")).toBe("discussed");
    expect(feedSortFrom("latest")).toBe("latest");
    expect(feedSortFrom("loudest")).toBe("latest");
    expect(feedSortFrom(["discussed"])).toBe("latest");
    expect(feedSortFrom(undefined)).toBe("latest");
  });
});
