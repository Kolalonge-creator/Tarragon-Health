import { AUDIO_SCRIPTS, en, t } from "@tarragon/i18n";
import { HLP_CLIPS } from "@tarragon/audio";
import { SECTIONS } from "./sections";
import { SECTION_HELP, TOUR_BODY_KEYS, TOUR_TABS, helpTextFor, isTourTab, parseSeen, serializeSeen, tourToOffer } from "./screen-help";

describe("screen help", () => {
  it("every mapped screen points at a real section and a real clip with written words", () => {
    const ids = new Set(SECTIONS.map((s) => s.id));
    for (const [section, screen] of Object.entries(SECTION_HELP)) {
      expect(ids.has(section as never)).toBe(true);
      const text = AUDIO_SCRIPTS[HLP_CLIPS[screen!]]?.en;
      expect(typeof text).toBe("string");
      expect((text as string).length).toBeGreaterThan(20);
    }
  });

  it("returns the clip's own words for a mapped screen and null for an unmapped one", () => {
    expect(helpTextFor("overview")).toBe(AUDIO_SCRIPTS["HLP-001"].en);
    expect(helpTextFor("medications")).toBe(AUDIO_SCRIPTS["HLP-015"].en);
    expect(helpTextFor("emergency")).toBeNull();
    expect(helpTextFor("settings")).toBeNull();
  });

  it("maps no screen to a script that talks about a feature the app does not have (USSD, feature phone, a PIN)", () => {
    for (const section of Object.keys(SECTION_HELP)) {
      const text = helpTextFor(section as never) ?? "";
      expect(text).not.toMatch(/USSD|short code|dial/i);
    }
  });

  it("the help text follows the copy rules: no dash characters, never 'your doctor'", () => {
    for (const section of Object.keys(SECTION_HELP)) {
      const text = helpTextFor(section as never) ?? "";
      expect(text).not.toMatch(/[–—]/);
      expect(text).not.toMatch(/your doctor/i);
    }
  });
});

describe("tab tours", () => {
  it("cover the four bottom tabs the app has, each with written words", () => {
    const primary = SECTIONS.filter((s) => s.primary).map((s) => s.id);
    expect([...TOUR_TABS].sort()).toEqual([...primary].sort());
    for (const tab of TOUR_TABS) {
      const body = en[TOUR_BODY_KEYS[tab]];
      expect(body.length).toBeGreaterThan(40);
      expect(body).not.toMatch(/[–—]|your doctor/i);
    }
  });

  it("the messages tour keeps the emergency route in front of a person who is unwell", () => {
    expect(t(TOUR_BODY_KEYS.messages, "en")).toMatch(/do not wait for a reply/);
    expect(t(TOUR_BODY_KEYS.messages, "en")).toMatch(/nearest hospital/);
  });

  it("is offered on the first visit to a tour tab, not again once seen, and never on another screen", () => {
    expect(tourToOffer("overview", new Set())).toBe("overview");
    expect(tourToOffer("overview", new Set(["overview"]))).toBeNull();
    expect(tourToOffer("vitals", new Set(["overview"]))).toBe("vitals");
    expect(tourToOffer("settings", new Set())).toBeNull();
    expect(isTourTab("labs")).toBe(false);
  });

  it("remembers what was seen, and an unreadable store means none seen (one extra offer, never a hidden tour)", () => {
    expect([...parseSeen(serializeSeen(new Set(["vitals", "overview"])))].sort()).toEqual(["overview", "vitals"]);
    expect(parseSeen(null).size).toBe(0);
    expect(parseSeen("{not json").size).toBe(0);
    expect(parseSeen('["overview", 5, "labs"]').size).toBe(1);
  });
});
