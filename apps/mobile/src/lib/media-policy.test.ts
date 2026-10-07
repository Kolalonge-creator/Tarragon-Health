import { mediaDecision, mediaDecisionAfterTap, type MediaContext } from "./media-policy";

const base: MediaContext = { kind: "image", lowData: false, connection: "cellular" };

describe("media policy", () => {
  it("loads images by themselves in normal mode and waits for a tap in low-data mode", () => {
    expect(mediaDecision(base)).toEqual({ action: "load" });
    expect(mediaDecision({ ...base, lowData: true })).toEqual({ action: "tap" });
  });

  it("never starts audio or video by itself, in either mode", () => {
    for (const kind of ["audio", "video"] as const) {
      for (const lowData of [false, true]) {
        expect(mediaDecision({ ...base, kind, lowData, connection: "wifi" })).toEqual({ action: "tap" });
      }
    }
  });

  it("downloads only on Wi-Fi unless mobile data was allowed, and treats unknown as not Wi-Fi", () => {
    const dl = { ...base, kind: "download" as const };
    expect(mediaDecision({ ...dl, connection: "wifi" })).toEqual({ action: "load" });
    expect(mediaDecision({ ...dl, connection: "cellular" })).toEqual({ action: "wait_for_wifi" });
    expect(mediaDecision({ ...dl, connection: "unknown" })).toEqual({ action: "wait_for_wifi" });
    expect(mediaDecision({ ...dl, connection: "cellular", allowCellularDownloads: true })).toEqual({ action: "load" });
    expect(mediaDecision({ ...dl, lowData: true, connection: "wifi" })).toEqual({ action: "load" });
  });

  it("never gates emergency content, whatever the mode or connection (INV-06)", () => {
    for (const kind of ["image", "audio", "video", "download"] as const) {
      for (const connection of ["wifi", "cellular", "unknown"] as const) {
        expect(mediaDecision({ kind, lowData: true, connection, emergency: true })).toEqual({ action: "load" });
      }
    }
  });

  it("a tap loads media but does not override the Wi-Fi rule for downloads", () => {
    expect(mediaDecisionAfterTap({ ...base, kind: "audio", lowData: true })).toEqual({ action: "load" });
    expect(mediaDecisionAfterTap({ ...base, kind: "image", lowData: true })).toEqual({ action: "load" });
    expect(mediaDecisionAfterTap({ ...base, kind: "download", connection: "cellular" })).toEqual({ action: "wait_for_wifi" });
  });
});
