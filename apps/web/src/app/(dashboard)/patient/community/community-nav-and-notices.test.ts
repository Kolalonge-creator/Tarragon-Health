/** The Community menu entry exists only while the community is open, and the four community inbox notices render fixed, identity-free copy. */
import { getNavSections } from "@/lib/navigation";
import { describe as describeNotice } from "@/lib/notifications/describe-in-app";

const hrefs = (open: boolean | undefined) =>
  getNavSections("patient", true, open === undefined ? undefined : { communityOpen: open })
    .flatMap((s) => s.items)
    .map((i) => i.href);

describe("patient navigation", () => {
  it("has no Community entry unless the database says it is open", () => {
    expect(hrefs(undefined)).not.toContain("/patient/community");
    expect(hrefs(false)).not.toContain("/patient/community");
    expect(hrefs(true)).toContain("/patient/community");
  });

  it("never offers Community to a supporter-only account", () => {
    const items = getNavSections("patient", false, { communityOpen: true }).flatMap((s) => s.items);
    expect(items.map((i) => i.href)).not.toContain("/patient/community");
  });
});

describe("community inbox notices", () => {
  it.each([
    ["community_reply", "New reply in Community. Someone replied to your post. Open Community to read it.", "/patient/community"],
    ["community_post_removed", "A post was removed. A moderator removed one of your posts. Please read the group rules.", "/patient/community"],
    ["community_sanction_notice", "A change to your Community access. A moderator has made a change to your access. Open Community for more.", "/patient/community"],
    ["community_unmask_notice", "A community name was looked up. An admin looked up who is behind a community name. The reason is in the audit log.", "/clinician"],
  ])("%s", (template, text, href) => {
    expect(describeNotice({ template, payload: { group: "secret", handle: "Quiet Heron" } })).toEqual({ text, href });
  });
});
