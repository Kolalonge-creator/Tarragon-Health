/**
 * UI-B (change 6): no notification title, push text, email subject or lock-screen text names a cycle, pregnancy or contraception topic.
 * This extends the INV-07 lint (inv07-lint.test.ts, which renders the same surfaces against the main forbidden list) with the extra
 * reproductive words and with two surfaces the main lint did not reach: every catalogue key that is notification wording, and the
 * text the phone itself puts on a lock screen (local notifications scheduled in apps/mobile). Counts are asserted so the lint cannot
 * pass by finding nothing, and each rule is shown to fail on a sabotaged string.
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { en } from "@tarragon/i18n";
import { lintText } from "./index.ts";
import { reproductiveTopicWords, REPRODUCTIVE_TOPIC_EXTRA_TERMS } from "./reproductive-topics.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";
import { describe as describeInApp } from "../../../apps/web/src/lib/notifications/describe-in-app.ts";

const ctx = { notificationId: "n", recipientId: "r" };
const dirty = (text: string): string[] => [...lintText(text).map((v) => v.match.toLowerCase()), ...reproductiveTopicWords(text)];
const inAppSource = readFileSync("../../apps/web/src/lib/notifications/describe-in-app.ts", "utf8");
const inAppTemplates = [...new Set([...inAppSource.matchAll(/n\.template === "([^"]+)"/g)].map((m) => m[1] as string))];
const canary = (k: string) => `ZQ${k.replace(/_/g, "")}QZ`;
const proxy = () => new Proxy({} as Record<string, unknown>, { get: (_t, k) => (typeof k === "string" ? canary(k) : undefined) });
const strip = (s: string) => s.replace(/ZQ[a-z0-9]+QZ/gi, " ");

describe("the extra reproductive words discriminate (sabotage controls)", () => {
  it("catch the topic words a lock screen would still give away", () => {
    for (const bad of ["Your second trimester check", "Your baby's growth", "Birth control reminder", "Time for your IUD check", "Contraception reminder"]) {
      expect({ bad, hit: dirty(bad).length > 0 }).toEqual({ bad, hit: true });
    }
  });
  it("leave neutral wording alone", () => {
    for (const ok of ["Your tracker has an update", "Time to check in", "Tarragon Health", "Open TarragonHealth to see more."]) {
      expect(dirty(ok)).toEqual([]);
    }
  });
  it("the list is not empty and holds no duplicates", () => {
    expect(REPRODUCTIVE_TOPIC_EXTRA_TERMS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(REPRODUCTIVE_TOPIC_EXTRA_TERMS).size).toBe(REPRODUCTIVE_TOPIC_EXTRA_TERMS.length);
  });
});

describe("sender templates (push, email, sms) carry no reproductive topic word", () => {
  const entries = Object.entries(TEMPLATE_MAP);
  it("covers every template", () => expect(entries.length).toBeGreaterThanOrEqual(75));
  for (const [key, fn] of entries) {
    it(`${key}`, () => {
      const r = fn(proxy(), ctx);
      const text = strip([r.smsText, r.email?.subject, r.email?.text, r.email?.html].filter(Boolean).join(" "));
      expect(reproductiveTopicWords(text)).toEqual([]);
    });
  }
});

describe("in-app inbox previews carry no reproductive topic word", () => {
  it("covers every case", () => expect(inAppTemplates.length).toBeGreaterThanOrEqual(100));
  for (const template of inAppTemplates) {
    it(`${template}`, () => {
      expect(reproductiveTopicWords(strip(describeInApp({ template, payload: proxy() }).text))).toEqual([]);
    });
  }
});

describe("every notification wording key in the catalogue", () => {
  // notify.*, *.notify.*, *.notif.*, push keys. Channel names are shown in system settings, so they count. The notif.settings.* screen
  // text explains the lock-screen setting inside the app; it is not itself sent to a lock screen, so it is not in scope.
  const keys = Object.keys(en).filter((k) => /(^|\.)(notify|notif|push|lockscreen)(\.|$)/.test(k) && !/test_/.test(k) && !k.startsWith("notif.settings."));
  it("finds the keys", () => expect(keys.length).toBeGreaterThanOrEqual(15));
  for (const key of keys) {
    it(key, () => {
      const text = en[key as keyof typeof en];
      expect({ key, hits: dirty(text) }).toEqual({ key, hits: [] });
    });
  }
});

describe("lock-screen text the phone schedules itself (apps/mobile local notifications)", () => {
  const root = "../../apps/mobile/src";
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(`${dir}/${d.name}`) : /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [`${dir}/${d.name}`] : []));
  const files = walk(root).filter((f) => readFileSync(f, "utf8").includes("scheduleNotificationAsync"));

  it("finds the files that schedule a notification", () => expect(files.length).toBeGreaterThanOrEqual(3));

  for (const file of files) {
    it(file.replace(root, "mobile"), () => {
      const src = readFileSync(file, "utf8");
      // Every catalogue key the file looks up, and every quoted literal on a title: / body: line.
      const keys = [...src.matchAll(/\b(?:t|text)\(\s*["']([a-z0-9_.]+)["']/g)].map((m) => m[1] as string);
      const literals = [
        ...src.matchAll(/\b(?:title|body|subtitle)\s*:\s*["'`]([^"'`\n]+)["'`]/g),
        ...src.matchAll(/\b[A-Z][A-Z_]*(?:TITLE|BODY)\s*=\s*["'`]([^"'`\n]+)["'`]/g),
      ].map((m) => m[1] as string);
      const words = [
        ...keys.filter((k) => k in en).map((k) => en[k as keyof typeof en] as string),
        ...literals,
      ];
      expect(words.length).toBeGreaterThan(0);
      for (const w of words) expect({ w, hits: dirty(w) }).toEqual({ w, hits: [] });
    });
  }

  it("the web service worker shows only the title and body it is sent, with a neutral fallback", () => {
    const sw = readFileSync("../../apps/web/public/sw.js", "utf8");
    expect(sw).toContain('data.title || "Tarragon Health"');
    expect(dirty("Tarragon Health")).toEqual([]);
    expect(dirty("You have an update.")).toEqual([]);
  });
});
