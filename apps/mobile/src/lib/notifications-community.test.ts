import { describeNotification, type InAppNotification } from "./notifications";

const notice = (template: string): InAppNotification => ({
  id: "n",
  status: "unread",
  template,
  payload: { group: "secret group", handle: "Quiet Heron", excerpt: "my diagnosis" },
  createdAt: "2026-10-09T10:00:00Z",
});

describe("Community notices in the in-app list", () => {
  it.each([
    ["community_reply", "New reply in Community. Someone replied to your post. Open Community to read it."],
    ["community_post_removed", "A post was removed. A moderator removed one of your posts. Please read the group rules."],
    ["community_sanction_notice", "A change to your Community access. A moderator has made a change to your access. Open Community for more."],
    ["community_appeal_result", "Your request has an answer. A moderator has looked at your request for a second look. Open Community to see it."],
    ["community_digest", "Something new in Community. There are new conversations in your groups. Open Community to read them."],
    ["community_qa_answer", "A doctor answered your question. Open Community to read the answer."],
  ])("%s shows fixed, identity-free text and opens Community", (template, text) => {
    const d = describeNotification(notice(template));
    expect(d.text).toBe(text);
    expect(d.section).toBe("community");
    expect(d.text).not.toContain("secret group");
    expect(d.text).not.toContain("Quiet Heron");
    expect(d.text).not.toContain("my diagnosis");
  });
});
