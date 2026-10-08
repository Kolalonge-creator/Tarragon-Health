import { esc, httpStatusFor, parseOpenResult, renderSharePage, shareHeaders, type SharedRecord, type ShareOpenResult } from "./share-page";

const RECORD: SharedRecord = {
  full_name: "Ada Okafor",
  shared_at: "2026-10-01T10:00:00Z",
  expires_at: "2026-10-04T10:00:00Z",
  sections: ["vitals", "allergies"],
  views_left: 2,
  vitals: [{ vital_type: "blood_pressure", systolic: 120, diastolic: 80, pulse_bpm: 70, glucose_mmol: null, weight_kg: null, temperature_c: null, spo2_pct: null, source: "wearable", taken_at: "2026-10-01T09:00:00Z" }],
  allergies: [{ allergen: "Penicillin", reaction: "hives", severity: "severe" }],
};

describe("httpStatusFor", () => {
  const cases: [ShareOpenResult, number][] = [
    [{ status: "ok", record: RECORD }, 200],
    [{ status: "ready", views_left: 2 }, 200],
    [{ status: "gone", reason: "expired" }, 410],
    [{ status: "gone", reason: "revoked" }, 410],
    [{ status: "gone", reason: "view_cap" }, 410],
    [{ status: "pin_required" }, 401],
    [{ status: "pin_wrong", attempts_left: 2 }, 401],
    [{ status: "locked" }, 423],
    [{ status: "not_found" }, 404],
  ];
  it.each(cases)("%j answers %i", (result, status) => {
    expect(httpStatusFor(result)).toBe(status);
  });
});

describe("parseOpenResult", () => {
  it("reads what the database returns", () => {
    expect(parseOpenResult({ status: "gone", reason: "expired" })).toEqual({ status: "gone", reason: "expired" });
    expect(parseOpenResult({ status: "gone", reason: "view_cap" })).toEqual({ status: "gone", reason: "view_cap" });
    expect(parseOpenResult({ status: "pin_wrong", attempts_left: 3 })).toEqual({ status: "pin_wrong", attempts_left: 3 });
    expect(parseOpenResult({ status: "ok", record: RECORD })).toEqual({ status: "ok", record: RECORD });
  });
  it("reads a preview", () => {
    expect(parseOpenResult({ status: "ready", views_left: 2 })).toEqual({ status: "ready", views_left: 2 });
    expect(parseOpenResult({ status: "ready" })).toEqual({ status: "ready", views_left: null });
  });
  it("reads anything unrecognised as not found, the safe direction", () => {
    expect(parseOpenResult(null)).toEqual({ status: "not_found" });
    expect(parseOpenResult("x")).toEqual({ status: "not_found" });
    expect(parseOpenResult({ status: "ok" })).toEqual({ status: "not_found" });
    expect(parseOpenResult({ status: "something_new" })).toEqual({ status: "not_found" });
  });
  it("an unknown gone reason is treated as expired, never as live", () => {
    expect(parseOpenResult({ status: "gone", reason: "weird" })).toEqual({ status: "gone", reason: "expired" });
  });
});

describe("esc", () => {
  it("escapes the five characters that matter", () => {
    expect(esc(`<script>"a" & 'b'</script>`)).toBe("&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;");
    expect(esc(null)).toBe("");
  });
});

describe("renderSharePage", () => {
  it("shows the record, the owner's name and the number of views left", () => {
    const html = renderSharePage({ status: "ok", record: RECORD }, "t".repeat(64));
    expect(html).toContain("Ada Okafor");
    expect(html).toContain("blood pressure");
    expect(html).toContain("120/80 mmHg");
    expect(html).toContain("Penicillin");
    expect(html).toMatch(/2 views left|2 more views/);
  });

  it("labels a wearable reading as an estimate", () => {
    const html = renderSharePage({ status: "ok", record: RECORD }, "t".repeat(64));
    expect(html.toLowerCase()).toContain("estimate");
  });

  it("escapes everything a person controls (a name, a medicine, a facility)", () => {
    const evil: SharedRecord = {
      ...RECORD,
      full_name: `<img src=x onerror=alert(1)>`,
      medications: [{ drug_name: `<script>alert(1)</script>`, dose: `"><b>`, frequency: null, is_active: true }],
      procedures: [{ name: `Op</h2><script>`, performed_on: null, approximate_year: 2010, facility: `<i>x</i>`, verified_by_clinician: false }],
    };
    const html = renderSharePage({ status: "ok", record: evil }, "t".repeat(64));
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<i>x</i>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("marks a verified procedure and a verified dose, and says nothing for an unverified one", () => {
    const rec: SharedRecord = {
      ...RECORD,
      procedures: [
        { name: "Appendicectomy", performed_on: null, approximate_year: 2012, facility: null, verified_by_clinician: true },
        { name: "Tonsillectomy", performed_on: null, approximate_year: 2005, facility: null, verified_by_clinician: false },
      ],
    };
    const html = renderSharePage({ status: "ok", record: rec }, "t".repeat(64));
    expect(html.match(/class="ok"/g)).toHaveLength(1);
  });

  it("a preview shows no record, a button that posts, and how many views are left", () => {
    const token = "ab".repeat(32);
    const html = renderSharePage({ status: "ready", views_left: 1 }, token);
    expect(html).toContain(`<form method="post" action="/share/${token}">`);
    expect(html).toContain("<button");
    expect(html).not.toContain("Ada");
    expect(html).toMatch(/1 more views allowed/);
  });

  it("an expired link shows no record and says it has ended", () => {
    const html = renderSharePage({ status: "gone", reason: "expired" }, "t".repeat(64));
    expect(html).not.toContain("Ada Okafor");
    expect(html.toLowerCase()).toMatch(/expired/);
  });

  it("each way a link can end has its own plain wording", () => {
    const texts = (["expired", "revoked", "view_cap"] as const).map((reason) => renderSharePage({ status: "gone", reason }, "t".repeat(64)));
    expect(new Set(texts).size).toBe(3);
  });

  it("the PIN form posts to the link itself and puts the PIN in no URL", () => {
    const token = "a1".repeat(32);
    const html = renderSharePage({ status: "pin_required" }, token);
    expect(html).toContain(`<form method="post" action="/share/${token}">`);
    expect(html).toContain('type="password"');
    expect(html).not.toContain("?pin=");
  });

  it("a wrong PIN says how many tries are left", () => {
    expect(renderSharePage({ status: "pin_wrong", attempts_left: 2 }, "t".repeat(64))).toMatch(/2/);
  });

  it("a locked link offers no PIN form", () => {
    expect(renderSharePage({ status: "locked" }, "t".repeat(64))).not.toContain("<form");
  });

  it("never names a condition, reading or result in a state page", () => {
    for (const r of [{ status: "gone", reason: "expired" }, { status: "locked" }, { status: "not_found" }, { status: "pin_required" }] as ShareOpenResult[]) {
      expect(renderSharePage(r, "t".repeat(64))).not.toMatch(/diabet|hypertens|hiv|glucose|blood pressure/i);
    }
  });
});

describe("shareHeaders", () => {
  it("allows no script, no caching, no referrer and no indexing", () => {
    const h = shareHeaders();
    expect(h["Content-Security-Policy"]).toContain("default-src 'none'");
    expect(h["Content-Security-Policy"]).not.toMatch(/script-src/);
    expect(h["Cache-Control"]).toContain("no-store");
    expect(h["Referrer-Policy"]).toBe("no-referrer");
    expect(h["X-Robots-Tag"]).toContain("noindex");
  });
});
