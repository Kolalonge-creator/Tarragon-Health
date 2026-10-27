import fs from "node:fs";
import path from "node:path";
import { activeWording } from "@tarragon/i18n";

/**
 * S85b (INV-06): the offline page a service worker serves with no network carries the emergency guidance as static text. These tests keep
 * the page's words identical to the wording in force (never retyped and left to drift), keep the page free of any request, and keep the
 * service worker caching it under a version that forces installed workers to refetch.
 */
const PUBLIC = path.join(__dirname, "..", "..", "..", "public");
const html = fs.readFileSync(path.join(PUBLIC, "offline.html"), "utf8");
const sw = fs.readFileSync(path.join(PUBLIC, "sw.js"), "utf8");

function field(name: "title" | "body"): string {
  const m = html.match(new RegExp(`data-emg="${name}">([^<]*)<`));
  if (!m) throw new Error(`offline.html has no data-emg="${name}" element`);
  return m[1]!.replace(/&rsquo;/g, "’").replace(/&amp;/g, "&").trim();
}

describe("offline.html emergency guidance", () => {
  it("says exactly the EMG-001 wording in force", () => {
    expect(field("title")).toBe(activeWording("EMG-001").title);
    expect(field("body")).toBe(activeWording("EMG-001").body);
  });

  it("sabotage: a drifted word is noticed by the same comparison", () => {
    const drifted = html.replace("nearest hospital", "nearest clinic");
    expect(drifted).not.toBe(html);
    const m = drifted.match(/data-emg="body">([^<]*)</);
    expect(m![1]!.trim()).not.toBe(activeWording("EMG-001").body);
  });

  it("is static: no script, no external request, no form post", () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/<form/i);
  });

  it("is served by the service worker when a navigation fails, from a cache version bumped for this change", () => {
    expect(sw).toMatch(/OFFLINE_URL = "\/offline\.html"/);
    expect(sw).toMatch(/OFFLINE_CACHE = "th-offline-v([2-9]|\d{2,})"/);
    expect(sw).toMatch(/fetch\(event\.request\)\.catch/);
  });

  it("still caches no page or clinical data other than the offline page and an icon", () => {
    expect(sw).toMatch(/OFFLINE_ASSETS = \[OFFLINE_URL, "\/icon-192\.png"\]/);
  });
});
