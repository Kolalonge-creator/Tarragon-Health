import { communityGate, showCommunityEntry } from "./entry";

const open = { open: true, adult: true };

describe("showCommunityEntry", () => {
  it("shows for an adult with their own account while Community is open", () => {
    expect(showCommunityEntry({ acting: false, receivesCare: true, list: open })).toBe(true);
  });
  it("is hidden for someone acting for another person", () => {
    expect(showCommunityEntry({ acting: true, receivesCare: true, list: open })).toBe(false);
  });
  it("is hidden for a supporter-only account, and while that is unknown", () => {
    expect(showCommunityEntry({ acting: false, receivesCare: false, list: open })).toBe(false);
    expect(showCommunityEntry({ acting: false, receivesCare: null, list: open })).toBe(false);
  });
  it("is hidden while the go-live guard is off, for under 18s, and while the list is unknown", () => {
    expect(showCommunityEntry({ acting: false, receivesCare: true, list: { open: false, adult: true } })).toBe(false);
    expect(showCommunityEntry({ acting: false, receivesCare: true, list: { open: true, adult: false } })).toBe(false);
    expect(showCommunityEntry({ acting: false, receivesCare: true, list: undefined })).toBe(false);
  });
});

describe("communityGate", () => {
  it("says one calm thing when closed, unreadable or not an adult, and lets a closed guard win", () => {
    expect(communityGate(undefined)).toBe("not_open");
    expect(communityGate({ open: false, adult: true })).toBe("not_open");
    expect(communityGate({ open: false, adult: false })).toBe("not_open");
    expect(communityGate({ open: true, adult: false })).toBe("adults_only");
    expect(communityGate(open)).toBe("ready");
  });
});
