import type { ReactElement, ReactNode } from "react";

// @react-pdf/renderer is ESM only and this CJS jest transform cannot load it, so primitives become host tags and the test walks the element tree.
jest.mock("@react-pdf/renderer", () => ({
  Document: "Document",
  Page: "Page",
  Text: "Text",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles },
  Font: { register: () => undefined },
}));
jest.mock("@/lib/pdf/register-fonts", () => ({ registerPdfFonts: () => undefined, PDF_FONT_FAMILY: "Noto Sans" }));

import { addDays, buildLetter, isOverdue, lagosToday, loadLetterConfig, loadLetterConfigForVersion, longDate, SCOPE_CODES } from "./letter";
import { RecordsRequestLetterDocument } from "./letter-document";

function allText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(allText).join("\n");
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (typeof el.type === "function") return allText((el.type as (p: unknown) => ReactNode)(el.props));
  return allText(el.props?.children);
}

const { letter, letterVersionKey, wordingSigned, responseDays } = loadLetterConfig();
const input = {
  facilityName: "Lagos General Hospital",
  scopes: ["whole_record", "lab_results"] as const,
  letterDate: "2026-10-20",
  followUpDays: 30,
  draft: true,
  patient: { fullName: "Ada Obi", dateOfBirth: "1980-05-01", phone: "+2348012345678" },
};

describe("records request letter configuration", () => {
  it("is unsigned placeholder wording: an agent never marks it confirmed", () => {
    expect(wordingSigned).toBe(false);
    expect(letter.wording_status).toBe("unsigned_placeholder_pending_counsel");
    expect(letterVersionKey).toBe("records_request.letter@1");
  });

  it("takes the reply period from versioned configuration", () => {
    expect(responseDays).toBe(30);
  });
});

describe("buildLetter", () => {
  const built = buildLetter(letter, { ...input, scopes: [...input.scopes] });

  it("fills the person's details and the facility into the configured wording", () => {
    expect(built.greeting).toBe("To the Medical Records Officer, Lagos General Hospital");
    expect(built.identityLines).toEqual(["Name: Ada Obi", "Date of birth: 1 May 1980", "Phone: +2348012345678"]);
    expect(built.dateLine).toBe("20 October 2026");
    expect(built.timing).toContain("after 30 days");
    expect(built.signatureLine).toBe("Ada Obi");
  });

  it("lists what was asked for in the fixed order, only what was chosen", () => {
    expect(built.scopeLines).toEqual([letter.scopes.lab_results, letter.scopes.whole_record]);
  });

  it("leaves blank lines for what only the person or the facility knows, and omits an absent phone or birth date", () => {
    expect(built.fillInLines.length).toBe(2);
    const bare = buildLetter(letter, { ...input, scopes: ["lab_results"], patient: { fullName: "Ada Obi", dateOfBirth: null, phone: null } });
    expect(bare.identityLines).toEqual(["Name: Ada Obi"]);
    // what the profile lacks becomes a blank to write in, never an empty printed value
    expect(bare.fillInLines).toEqual(expect.arrayContaining(["Date of birth:", "Phone:"]));
    expect(built.fillInLines).not.toContain("Phone:");
  });

  it("invokes the right of access only in words and asserts no law: no section number, no statutory deadline, no penalty, no legal-advice claim", () => {
    const text = [built.intro, built.format, built.timing, built.footer].join(" ");
    expect(text).toContain("Nigeria Data Protection Act 2023");
    expect(text).not.toMatch(/\bsection\b|\bs\.\s?\d|\bpenalt|\bfine\b|\bmust\b|legal advice|within \d+ days|by law/i);
  });

  it("is plain, calm English: no em dash, none of the banned words", () => {
    const text = Object.values(built).flat().join(" ");
    expect(text).not.toMatch(/—|\bcures?\b|instant doctor|free healthcare|your doctor/i);
  });
});

describe("wording versions and the draft notice", () => {
  it("loads the exact version a request was made with, and nothing for a version that does not exist", () => {
    expect(loadLetterConfigForVersion("records_request.letter@1")?.letterVersionKey).toBe("records_request.letter@1");
    expect(loadLetterConfigForVersion("records_request.letter@999")).toBeNull();
    expect(loadLetterConfigForVersion("something-else")).toBeNull();
  });

  it("marks an unsigned letter as a draft and leaves a signed one unmarked", () => {
    expect(buildLetter(letter, { ...input, scopes: [...input.scopes] }).draftNotice).toBe("Draft wording, not yet checked by a lawyer.");
    expect(buildLetter(letter, { ...input, scopes: [...input.scopes], draft: false }).draftNotice).toBeNull();
  });

  it("prints the draft notice on the page", () => {
    const text = allText(RecordsRequestLetterDocument({ letter: buildLetter(letter, { ...input, scopes: [...input.scopes] }) }));
    expect(text).toContain("Draft wording, not yet checked by a lawyer.");
  });
});

describe("dates", () => {
  it("formats a calendar day without shifting it across time zones", () => {
    expect(longDate("2026-10-20")).toBe("20 October 2026");
    expect(longDate("2026-01-01")).toBe("1 January 2026");
  });

  it("adds days across a month and a year end", () => {
    expect(addDays("2026-10-20", 30)).toBe("2026-11-19");
    expect(addDays("2026-12-20", 30)).toBe("2027-01-19");
  });

  it("uses the Lagos day, not the UTC day, for today", () => {
    expect(lagosToday(new Date("2026-10-19T23:30:00Z"))).toBe("2026-10-20");
    expect(lagosToday(new Date("2026-10-19T22:30:00Z"))).toBe("2026-10-19");
  });
});

describe("isOverdue", () => {
  const now = new Date("2026-11-20T09:00:00Z");
  it("is overdue only when handed over and past its date", () => {
    expect(isOverdue({ state: "sent", due_at: "2026-11-19T00:00:00Z" }, now)).toBe(true);
    expect(isOverdue({ state: "sent", due_at: "2026-11-21T00:00:00Z" }, now)).toBe(false);
    expect(isOverdue({ state: "prepared", due_at: null }, now)).toBe(false);
    expect(isOverdue({ state: "received", due_at: "2026-11-19T00:00:00Z" }, now)).toBe(false);
    expect(isOverdue({ state: "withdrawn", due_at: "2026-11-19T00:00:00Z" }, now)).toBe(false);
  });
});

describe("RecordsRequestLetterDocument", () => {
  const built = buildLetter(letter, { ...input, scopes: [...input.scopes] });
  const tree = RecordsRequestLetterDocument({ letter: built });
  const text = allText(tree);

  it("renders every part of the letter", () => {
    for (const part of [built.title, built.greeting, built.intro, ...built.scopeLines, ...built.identityLines, ...built.fillInLines, built.timing, built.signOff, built.signatureLine, built.footer]) {
      expect(text).toContain(part);
    }
  });

  it("is a single A4 page in black and white, with no colour value other than black", () => {
    const json = JSON.stringify(tree, (_k, v) => (typeof v === "function" ? undefined : v));
    expect(json).toContain('"size":"A4"');
    const colours = json.match(/#[0-9a-fA-F]{3,8}/g) ?? [];
    expect(new Set(colours.map((c) => c.toLowerCase()))).toEqual(new Set(["#000000"]));
    expect(json).not.toContain("Image");
  });

  it("offers every scope code a printable line", () => {
    for (const c of SCOPE_CODES) expect(letter.scopes[c].length).toBeGreaterThan(5);
  });
});
