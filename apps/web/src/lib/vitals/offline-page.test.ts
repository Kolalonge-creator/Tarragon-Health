import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { activeWording } from "@tarragon/i18n";
import { EMERGENCY_MARKER_KEY } from "./emergency-marker";

/**
 * S85b (INV-06): the offline page a service worker serves with no network carries the signed emergency wording as static text, shown only when
 * this tab holds a note that a reading asking for emergency guidance was not confirmed saved. These tests keep:
 *  - EVERY string a person can see on the page either the neutral text the page had before S85b or the signed wording for EMG-001 / EMG-001L,
 *    so no text can be invented on it;
 *  - the wording identical to the wording in force;
 *  - the emergency blocks hidden by default and shown by a script that reads one sessionStorage key and makes no request;
 *  - the service worker's cache name tied to the page's exact bytes, so an edit to the page cannot ship while installed workers keep the old copy.
 */
const PUBLIC = path.join(__dirname, "..", "..", "..", "public");
const html = fs.readFileSync(path.join(PUBLIC, "offline.html"), "utf8");
const sw = fs.readFileSync(path.join(PUBLIC, "sw.js"), "utf8");

const decode = (t: string): string =>
  t.replace(/&rsquo;/g, "’").replace(/&mdash;/g, "—").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** Every text node of the page (style, script and comments removed), whether or not it is hidden by default. */
function allText(source: string): string[] {
  const stripped = source
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const body = stripped.slice(stripped.search(/<title/i));
  return body
    .split(/<[^>]+>/)
    .map(decode)
    .filter((t) => t.length > 0);
}

const NEUTRAL_TEXT_BEFORE_S85B = [
  "You're offline — TarragonHealth",
  "You’re offline",
  "TarragonHealth needs a connection to show your latest readings and messages. Your care team is still here — reconnect and try again.",
  "Try again",
];
const SIGNED = (["EMG-001", "EMG-001L"] as const).flatMap((c) => [activeWording(c).title, activeWording(c).body]);

function strangers(source: string): string[] {
  const allowed = new Set([...NEUTRAL_TEXT_BEFORE_S85B, ...SIGNED]);
  return allText(source).filter((t) => !allowed.has(t));
}

function field(source: string, code: string, name: "title" | "body"): string {
  const block = source.match(new RegExp(`data-emg-code="${code}"[\\s\\S]*?</section>`));
  if (!block) throw new Error(`offline.html has no block for ${code}`);
  const m = block[0].match(new RegExp(`data-emg="${name}">([^<]*)<`));
  if (!m) throw new Error(`offline.html block ${code} has no data-emg="${name}" element`);
  return decode(m[1]!);
}

describe("offline.html emergency guidance", () => {
  it("says exactly the signed wording in force for each code, nothing of its own", () => {
    for (const code of ["EMG-001", "EMG-001L"] as const) {
      expect(field(html, code, "title")).toBe(activeWording(code).title);
      expect(field(html, code, "body")).toBe(activeWording(code).body);
    }
  });

  it("every visible string is the neutral text the page already had or the signed wording: no invented text", () => {
    expect(strangers(html)).toEqual([]);
    // the page really has the strings the check allows (a parser that finds nothing would pass the line above)
    expect(allText(html).length).toBeGreaterThanOrEqual(8);
  });

  it("sabotage: an added heading, a drifted word or an added sentence is caught by the same check", () => {
    expect(strangers(html.replace("<h1>", "<h2>If you have a very high blood pressure reading</h2><h1>")).length).toBeGreaterThan(0);
    expect(strangers(html.replace("nearest hospital", "nearest clinic")).length).toBeGreaterThan(0);
    expect(strangers(html.replace("</main>", "<p>Call us.</p></main>")).length).toBeGreaterThan(0);
  });

  it("shows the emergency block to no one by default, and only when the tab's own note names its code", () => {
    const blocks = html.match(/<section class="emergency"[^>]*>/g) ?? [];
    expect(blocks).toHaveLength(2);
    for (const b of blocks) expect(b).toMatch(/\bhidden\b/);
    expect(html).toContain("section.emergency[hidden]");
    expect(html).toContain(`sessionStorage.getItem("${EMERGENCY_MARKER_KEY}")`);
  });

  it("its script reads one storage key and makes no request of any kind", () => {
    const scripts = html.match(/<script[\s\S]*?<\/script>/gi) ?? [];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).not.toMatch(/\bsrc=/i);
    expect(scripts[0]).not.toMatch(/fetch|XMLHttpRequest|sendBeacon|WebSocket|import\(|document\.write|eval\(|innerHTML|localStorage|cookie/i);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/<form/i);
  });

  it("is served by the service worker when a navigation fails", () => {
    expect(sw).toMatch(/OFFLINE_URL = "\/offline\.html"/);
    expect(sw).toMatch(/fetch\(event\.request\)\.catch/);
  });

  it("still caches no page or clinical data other than the offline page and an icon", () => {
    expect(sw).toMatch(/OFFLINE_ASSETS = \[OFFLINE_URL, "\/icon-192\.png"\]/);
  });
});

describe("service worker cache name is tied to the page's exact bytes", () => {
  const hashOf = (source: string): string => crypto.createHash("sha256").update(source).digest("hex").slice(0, 12);
  const named = (swSource: string): string | null => swSource.match(/OFFLINE_CACHE = "th-offline-v\d+-([0-9a-f]{12})"/)?.[1] ?? null;

  it("sw.js names the cache with the first 12 hex digits of the sha256 of offline.html", () => {
    expect(named(sw)).toBe(hashOf(html));
  });

  it("sabotage: change one word of offline.html and the recorded name no longer matches (the edit cannot ship quietly)", () => {
    expect(named(sw)).not.toBe(hashOf(html.replace("Try again", "Try once more")));
    expect(named(sw)).not.toBe(hashOf(html.replace("nearest hospital", "nearest clinic")));
  });
});
