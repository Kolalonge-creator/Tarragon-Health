/**
 * INV-07 lint over every notification surface in the repository (spec 4.9, Section 10, safety case 20).
 * It renders the REAL template functions, so a new template that names a condition, a reading, a medicine or a
 * result, or that reads a clinical payload key, fails here before it can ship. Counts are asserted so the lint cannot
 * pass by finding nothing.
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { en, pcm } from "@tarragon/i18n";
import { describeViolations, FORBIDDEN_PARAM_KEYS, FORBIDDEN_TERMS, lintRenderFn, lintText } from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";
import { describe as describeInApp } from "../../../apps/web/src/lib/notifications/describe-in-app.ts";

const ctx = { notificationId: "n", recipientId: "r" };
const inAppSource = readFileSync("../../apps/web/src/lib/notifications/describe-in-app.ts", "utf8");
const inAppTemplates = [...new Set([...inAppSource.matchAll(/n\.template === "([^"]+)"/g)].map((m) => m[1] as string))];
const canary = (k: string) => `ZQ${k.replace(/_/g, "")}QZ`;
const proxy = () => new Proxy({} as Record<string, unknown>, { get: (_t, k) => (typeof k === "string" ? canary(k) : undefined) });

describe("sender templates (send-pending-notifications)", () => {
  const entries = Object.entries(TEMPLATE_MAP);
  it("covers every template", () => {
    expect(entries.length).toBeGreaterThanOrEqual(75);
  });
  for (const [key, fn] of entries) {
    it(`${key} names no condition, reading, medicine or result`, () => {
      expect(describeViolations(lintRenderFn((p) => fn(p, ctx)))).toEqual([]);
    });
  }
});

describe("in-app inbox copy (notification bell)", () => {
  it("covers every case", () => {
    expect(inAppTemplates.length).toBeGreaterThanOrEqual(100);
  });
  for (const template of inAppTemplates) {
    it(`${template} names no condition, reading, medicine or result`, () => {
      const text = describeInApp({ template, payload: proxy() }).text;
      const leaked = FORBIDDEN_PARAM_KEYS.filter((k) => text.includes(canary(k)));
      expect(leaked).toEqual([]);
      expect(describeViolations(lintText(text.replace(/ZQ[a-z0-9]+QZ/gi, " ")))).toEqual([]);
    });
  }
});

describe("safety case 20: notification text for a task carries no condition or reading", () => {
  // Real clinical values, not canaries: if any template echoes one, it shows up in the output.
  const clinical: Record<string, unknown> = {
    systolic: 150, diastolic: 95, reading: "150/95", value: "8.1", condition: "hypertension", condition_label: "hypertension",
    drug_name: "amlodipine", medication: "metformin", test_name: "HbA1c", vaccine_name: "hepatitis B", result: "positive", details: "BP 150/95",
    vital_type: "blood_pressure", diagnosis: "diabetes",
  };
  const secrets = ["150", "95", "8.1", "hypertension", "amlodipine", "metformin", "HbA1c", "hepatitis", "positive", "diabetes", "blood"];
  it("no template echoes any clinical value it is given", () => {
    for (const [key, fn] of Object.entries(TEMPLATE_MAP)) {
      const r = fn(clinical, ctx);
      const out = [r.smsText, r.email?.subject, r.email?.text, r.email?.html].filter(Boolean).join(" ").toLowerCase();
      for (const s of secrets) expect({ key, leaked: out.includes(s.toLowerCase()) ? s : null }).toEqual({ key, leaked: null });
    }
    for (const template of inAppTemplates) {
      const text = describeInApp({ template, payload: clinical }).text.toLowerCase();
      for (const s of secrets) expect({ template, leaked: text.includes(s.toLowerCase()) ? s : null }).toEqual({ template, leaked: null });
    }
  });
  it("the lint would catch an amber task text that did name the reading (control)", () => {
    expect(lintText("Your reading of 150/95 needs a repeat").length).toBeGreaterThan(0);
    expect(lintText("A quick check-in is waiting for you")).toEqual([]);
  });
  it("clinician paging says only that a priority case waits", () => {
    const page = TEMPLATE_MAP["abnormal_result_clinician_alert"]!(clinical, ctx).smsText;
    expect(page).toBe("New priority case. Open your Tarragon Health worklist. Tarragon Health");
  });
});

describe("notification wording in the language catalogues (reminders, medicine reminders, notices)", () => {
  const keys = Object.keys(en).filter((k) => /^(reminders\.notif\.|medicines\.notify\.)/.test(k) && !/(channel|test_)/.test(k));
  it("finds the keys", () => {
    expect(keys.length).toBeGreaterThanOrEqual(5);
  });
  for (const locale of ["en", "pcm"] as const) {
    for (const key of keys) {
      it(`${locale}: ${key}`, () => {
        const text = (locale === "en" ? en : pcm)[key as keyof typeof en];
        expect(describeViolations(lintText(text))).toEqual([]);
      });
    }
  }
});

describe("the database term list matches the code list", () => {
  const dir = "../../supabase/migrations";
  const file = readdirSync(dir).find((f) => f.endsWith("_s13_notifications_framework.sql"));
  it("has the S13 migration", () => {
    expect(file).toBeDefined();
  });
  it("seeds exactly the code's terms and placeholder names", () => {
    const sql = readFileSync(`${dir}/${file}`, "utf8");
    const seed = sql.slice(sql.indexOf("insert into public.notification_forbidden_terms"), sql.indexOf("create function private.notification_text_violations"));
    const pairs = [...seed.matchAll(/\('([^']+)', '(term|param)'\)/g)].map((m) => `${m[2]}:${m[1]}`).sort();
    const code = [...FORBIDDEN_TERMS.map((t) => `term:${t}`), ...FORBIDDEN_PARAM_KEYS.map((k) => `param:${k}`)].sort();
    expect(pairs).toEqual(code);
  });
});
