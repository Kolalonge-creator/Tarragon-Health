/** @jest-environment jsdom */
/**
 * Community pictures and doctor question sessions: the picture control (only when the group allows pictures), the multipart upload,
 * picture rendering, the question card, the ask action and the read-only answers. Every new piece is also checked with axe.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import type { FeedPost, GroupView as GroupViewData } from "@/lib/community/model";

const push = jest.fn();
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const actions = {
  submitPost: jest.fn(),
  askQuestion: jest.fn(),
  loadReplies: jest.fn(),
  loadFeed: jest.fn(),
};
jest.mock("./community-actions", () => ({
  submitPost: (...a: unknown[]) => actions.submitPost(...a),
  askQuestion: (...a: unknown[]) => actions.askQuestion(...a),
  loadReplies: (...a: unknown[]) => actions.loadReplies(...a),
  loadFeed: (...a: unknown[]) => actions.loadFeed(...a),
  editPost: jest.fn(),
  deletePost: jest.fn(),
  reactToPost: jest.fn(),
  reportPost: jest.fn(),
  joinGroup: jest.fn(),
  leaveGroup: jest.fn(),
  setGroupMuted: jest.fn(),
  setDigest: jest.fn(),
  hideAuthor: jest.fn(),
  unhideAuthor: jest.fn(),
  startEmergencyFromSafetyCard: jest.fn(),
}));

import { Composer } from "./composer";
import { GroupView } from "./group-view";
import { PostCard } from "./post-card";

type Found = Extract<GroupViewData, { found: true }>;
const NOW = new Date().toISOString();
const POST: FeedPost = { id: "p1", author_handle: "Quiet Heron", author_avatar: "leaf", is_mine: false, body: "Hello.", created_at: NOW, edited_at: null, support_count: 0, reply_count: 0, i_supported: false, pending_review: false, answers: [] };
const MEMBER = { status: "active" as const, handle: "Warm Fig", avatar_code: "sun", rules_current: true, notifications_muted: false, digest_opt_in: false };
const QA = {
  session_id: "11111111-1111-4111-8111-111111111111",
  title: "Ask about salt",
  intro: "Send your questions.",
  opens_at: "2026-10-10T09:00:00Z",
  closes_at: "2026-10-10T11:00:00Z",
  status: "open" as const,
  doctors: ["Dr Ada Obi", "Dr Tunde Bello"],
  my_questions: 1,
  question_limit: 3,
};
const view = (over: Partial<Found> = {}, group: Partial<Found["group"]> = {}): Found => ({
  found: true,
  group: { id: "g1", slug: "htn", name: "High blood pressure", description: "Share what helps.", topic_code: "htn", topic_label: "Hypertension", status: "active", rules_text: "Be kind.", rules_version: 1, join_mode: "open", ...group },
  membership: MEMBER,
  pinned: [],
  team: [],
  prompts: [],
  qa: null,
  limits: { post_max_chars: 500, edit_window_minutes: 15 },
  ...over,
});
const gv = (v: Found, posts: FeedPost[] = []) => <GroupView view={v} initialPosts={posts} initialHasMore={false} feedFailed={false} locale="en" />;

const fetchMock = jest.fn();
beforeEach(() => {
  Object.values(actions).forEach((m) => m.mockReset());
  fetchMock.mockReset();
  push.mockReset();
  refresh.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  URL.createObjectURL = jest.fn(() => "blob:preview");
  URL.revokeObjectURL = jest.fn();
});

const png = (size = 1000, type = "image/png") => new File([new Uint8Array(size)], "p.png", { type });
const pick = (file: File) => fireEvent.change(screen.getByLabelText("Add a picture"), { target: { files: [file] } });

const composer = (withPicture: boolean) => (
  <Composer
    locale="en"
    maxChars={500}
    label="community.post.placeholder"
    submitLabel="community.post.submit"
    submit={(body, id) => actions.submitPost(body, id)}
    onPublished={refresh}
    onSafety={jest.fn()}
    picture={withPicture ? { groupId: "11111111-1111-4111-8111-111111111111", parentId: null, maxBytes: 4 * 1024 * 1024 } : undefined}
  />
);

describe("picture control", () => {
  it("is not shown when the group does not allow pictures", () => {
    render(gv(view({}, { images_allowed: false }), []));
    expect(screen.queryByLabelText("Add a picture")).toBeNull();
    cleanup();
    render(gv(view(), []));
    expect(screen.queryByLabelText("Add a picture")).toBeNull();
  });

  it("is shown when allowed, with help text, a preview and a way to remove the picture; axe-clean", async () => {
    render(gv(view({}, { images_allowed: true }), []));
    expect(screen.getByLabelText("Add a picture")).toBeTruthy();
    expect(screen.getByText(/One picture, JPEG or PNG, up to 4 MB/)).toBeTruthy();
    cleanup();
    render(composer(true));
    pick(png());
    expect(screen.getByAltText("A picture shared by a member")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove the picture" }));
    expect(screen.queryByAltText("A picture shared by a member")).toBeNull();
    cleanup();
    await expectNoA11yViolations(composer(true));
  });

  it("refuses a too-big or wrong-type file before sending anything", () => {
    render(composer(true));
    pick(png(4 * 1024 * 1024 + 1));
    expect(screen.getByRole("status").textContent).toBe("That picture could not be used. Please choose a JPEG or PNG under 4 MB.");
    pick(png(10, "image/gif"));
    expect(screen.getByRole("status").textContent).toMatch(/could not be used/);
    expect(screen.queryByRole("button", { name: "Remove the picture" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uploads multipart to the images route, shows the held message and clears; text only still uses the server action", async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ status: "held", reason: "image", post_id: "x" }) });
    render(composer(true));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "My log" } });
    pick(png());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Post" })));
    expect(actions.submitPost).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/community/images");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("group_id")).toBe("11111111-1111-4111-8111-111111111111");
    expect(form.get("body")).toBe("My log");
    expect(form.get("client_request_id")).toBeTruthy();
    expect(form.get("image")).toBeInstanceOf(File);
    expect(form.has("parent_id")).toBe(false);
    expect(screen.getByRole("status").textContent).toMatch(/look at your picture before anyone else sees it/);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Remove the picture" })).toBeNull();

    actions.submitPost.mockResolvedValue({ ok: true, outcome: { kind: "published", message: "community.compose.published" } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "No picture" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Post" })));
    expect(actions.submitPost).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the uploading text while sending, keeps the text on a refusal and reuses the request id on a retry", async () => {
    let release: (v: unknown) => void = () => undefined;
    fetchMock.mockReturnValueOnce(new Promise((r) => (release = r)));
    render(composer(true));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "My log" } });
    pick(png());
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    const sending = await screen.findByRole("button", { name: "Sending your picture..." });
    expect((sending as HTMLButtonElement).disabled).toBe(true);
    await act(async () => release({ json: async () => ({ status: "refused", reason: "images_off" }) }));
    expect(screen.getByRole("status").textContent).toBe("Pictures are not turned on in this group.");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("My log");

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Post" })));
    fetchMock.mockResolvedValueOnce({ json: async () => ({ status: "held", reason: "image" }) });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Post" })));
    const ids = fetchMock.mock.calls.map((c) => (c[1].body as FormData).get("client_request_id"));
    expect(ids[1]).not.toBe(ids[0]); // a definite answer starts a new attempt
    expect(ids[2]).toBe(ids[1]); // an unreachable server keeps the same attempt
  });

  it("a reply in a picture-allowing group can carry a picture and sends parent_id", async () => {
    actions.loadReplies.mockResolvedValue({ ok: true, replies: [] });
    fetchMock.mockResolvedValue({ json: async () => ({ status: "held", reason: "image" }) });
    const parent = "22222222-2222-4222-8222-222222222222";
    render(<PostCard post={{ ...POST, id: parent }} groupId="11111111-1111-4111-8111-111111111111" locale="en" maxChars={500} editWindowMinutes={15} canPost imagesAllowed onChanged={jest.fn()} onSafety={jest.fn()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Show replies|replies/i })));
    fireEvent.change(screen.getByPlaceholderText("Write a reply..."), { target: { value: "Reply" } });
    pick(png());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reply" })));
    expect((fetchMock.mock.calls[0][1].body as FormData).get("parent_id")).toBe(parent);
  });
});

describe("picture rendering", () => {
  const WITH_IMAGE: FeedPost = { ...POST, image: { id: "img1", width: 800, height: 600 } };

  it("renders the picture from the images route, lazy, with alt text and no link around it; axe-clean", async () => {
    const { container } = render(<PostCard post={WITH_IMAGE} groupId="g1" locale="en" maxChars={500} editWindowMinutes={15} canPost onChanged={jest.fn()} onSafety={jest.fn()} />);
    const img = screen.getByAltText("A picture shared by a member");
    expect(img.getAttribute("src")).toBe("/api/community/images/img1");
    expect(img.getAttribute("width")).toBe("800");
    expect(img.getAttribute("height")).toBe("600");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.closest("a")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(screen.queryByText("Your picture is waiting for a person on our team to check it.")).toBeNull();
    cleanup();
    await expectNoA11yViolations(<PostCard post={WITH_IMAGE} groupId="g1" locale="en" maxChars={500} editWindowMinutes={15} canPost onChanged={jest.fn()} onSafety={jest.fn()} />);
  });

  it("tells the author their own pending picture is waiting, and nobody else", () => {
    render(<PostCard post={{ ...WITH_IMAGE, is_mine: true, pending_review: true }} groupId="g1" locale="en" maxChars={500} editWindowMinutes={15} canPost onChanged={jest.fn()} onSafety={jest.fn()} />);
    expect(screen.getByText("Your picture is waiting for a person on our team to check it.")).toBeTruthy();
    cleanup();
    render(<PostCard post={{ ...WITH_IMAGE, is_mine: false, pending_review: false }} groupId="g1" locale="en" maxChars={500} editWindowMinutes={15} canPost onChanged={jest.fn()} onSafety={jest.fn()} />);
    expect(screen.queryByText(/waiting for a person/)).toBeNull();
  });
});

describe("question session", () => {
  it("shows the card with title, status, doctors and the not-advice sentence, and an ask form while open; axe-clean", async () => {
    render(gv(view({ qa: QA })));
    expect(screen.getByRole("heading", { name: "Ask the doctors" })).toBeTruthy();
    expect(screen.getByText("Ask about salt")).toBeTruthy();
    expect(screen.getByText(/^Open until /)).toBeTruthy();
    expect(screen.getByText("Answering: Dr Ada Obi, Dr Tunde Bello")).toBeTruthy();
    expect(screen.getByText(/not a diagnosis or advice for you personally/)).toBeTruthy();
    expect(screen.getByText("You can ask 2 more.")).toBeTruthy();
    expect(screen.getByPlaceholderText("Type your question for the doctors")).toBeTruthy();
    cleanup();
    await expectNoA11yViolations(gv(view({ qa: QA })));
  });

  it("has no ask form when upcoming, closed, out of questions, or the member cannot post", () => {
    for (const qa of [{ ...QA, status: "upcoming" as const }, { ...QA, status: "closed" as const }, { ...QA, my_questions: 3 }]) {
      render(gv(view({ qa })));
      expect(screen.queryByRole("button", { name: "Send question" })).toBeNull();
      cleanup();
    }
    render(gv(view({ qa: QA, membership: { status: "none" } })));
    expect(screen.getByText("Ask about salt")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send question" })).toBeNull();
  });

  it("says when it starts and that it has ended", () => {
    render(gv(view({ qa: { ...QA, status: "upcoming" } })));
    expect(screen.getByText(/^Starts /)).toBeTruthy();
    cleanup();
    render(gv(view({ qa: { ...QA, status: "closed" } })));
    expect(screen.getByText("This session has ended. The answers stay here.")).toBeTruthy();
  });

  it("asks through the server action with the session, refreshes, and clears the box", async () => {
    actions.askQuestion.mockResolvedValue({ ok: true, outcome: { kind: "published", message: "community.compose.published" } });
    render(gv(view({ qa: QA })));
    fireEvent.change(screen.getByPlaceholderText("Type your question for the doctors"), { target: { value: "Is salt bad?" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send question" })));
    expect(actions.askQuestion).toHaveBeenCalledWith(expect.objectContaining({ groupId: "g1", sessionId: QA.session_id, body: "Is salt bad?", clientRequestId: expect.any(String) }));
    expect(refresh).toHaveBeenCalled();
    expect((screen.getByPlaceholderText("Type your question for the doctors") as HTMLTextAreaElement).value).toBe("");
  });

  it("shows the closed and limit refusals and keeps the question", async () => {
    actions.askQuestion.mockResolvedValue({ ok: true, outcome: { kind: "refused", message: "community.compose.refused.qa_limit" } });
    render(gv(view({ qa: QA })));
    fireEvent.change(screen.getByPlaceholderText("Type your question for the doctors"), { target: { value: "One more" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send question" })));
    await waitFor(() => expect(screen.getAllByRole("status").map((s) => s.textContent).join("|")).toMatch(/most questions this session allows/));
    expect((screen.getByPlaceholderText("Type your question for the doctors") as HTMLTextAreaElement).value).toBe("One more");
  });

  it("badges a question, shows answers read-only with the doctor's name from the data, and only says 'not answered' while open", async () => {
    const question: FeedPost = { ...POST, id: "q1", qa_session_id: QA.session_id, body: "Is salt bad?", answers: [{ id: "a1", doctor_name: "Dr Ada Obi", body: "Less is better.", created_at: NOW }] };
    const { container } = render(<PostCard post={question} groupId="g1" locale="en" maxChars={500} editWindowMinutes={15} canPost qaStatus="open" onChanged={jest.fn()} onSafety={jest.fn()} />);
    expect(screen.getByText("Question for the doctors")).toBeTruthy();
    expect(screen.getByText("Answer from Dr Ada Obi")).toBeTruthy();
    expect(screen.getByText("Less is better.")).toBeTruthy();
    expect(screen.queryByText("Not answered yet.")).toBeNull();
    expect(container.querySelectorAll("textarea")).toHaveLength(0); // answers are not editable by members
    cleanup();
    const unanswered = { ...question, answers: [] };
    render(<PostCard post={unanswered} groupId="g1" locale="en" maxChars={500} editWindowMinutes={15} canPost qaStatus="open" onChanged={jest.fn()} onSafety={jest.fn()} />);
    expect(screen.getByText("Not answered yet.")).toBeTruthy();
    expect(screen.queryByText(/Answer from/)).toBeNull();
    cleanup();
    render(<PostCard post={unanswered} groupId="g1" locale="en" maxChars={500} editWindowMinutes={15} canPost qaStatus="closed" onChanged={jest.fn()} onSafety={jest.fn()} />);
    expect(screen.queryByText("Not answered yet.")).toBeNull();
    cleanup();
    await expectNoA11yViolations(<PostCard post={question} groupId="g1" locale="en" maxChars={500} editWindowMinutes={15} canPost qaStatus="open" onChanged={jest.fn()} onSafety={jest.fn()} />);
  });

  it("never shows an answer section for an ordinary post", () => {
    render(<PostCard post={POST} groupId="g1" locale="en" maxChars={500} editWindowMinutes={15} canPost qaStatus="open" onChanged={jest.fn()} onSafety={jest.fn()} />);
    expect(screen.queryByText(/Answer from/)).toBeNull();
    expect(screen.queryByText("Not answered yet.")).toBeNull();
  });
});
