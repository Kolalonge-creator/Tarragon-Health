import { readFileSync } from "node:fs";
import { join } from "node:path";
import { en } from "@tarragon/i18n";
import {
  SHARE_MAX_VIEWS_CHOICES,
  SHARE_SECTIONS,
  createShare,
  expiryLabel,
  fetchShareLink,
  getSharingConfig,
  loadShares,
  parseShares,
  revokeShare,
  sectionLabel,
  shareFailureMessage,
  shareMessage,
  shareUrl,
  validateCreateShare,
  viewsLeft,
  type ShareFailure,
} from "./record-shares";

let mockUser: string | null = "user-1";
let mockError: { code?: string; message: string } | null = null;
let mockOptionsMissing = false;
let mockRows: unknown[] = [];
const mockRpcs: { fn: string; args: Record<string, unknown> }[] = [];
const mockSelects: string[] = [];

jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: mockUser ? { user: { id: mockUser } } : null } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      mockRpcs.push({ fn, args });
      if (mockError) return { data: null, error: mockError };
      if (fn === "create_record_share_with_options" && mockOptionsMissing) return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
      if (fn.startsWith("create_record_share")) return { data: { id: "s1", token: "tok_abc", pin: args.p_use_pin ? "123456" : null, expires_at: "2026-10-25T10:00:00Z" }, error: null };
      return { data: null, error: null };
    },
    from: () => ({
      select: (cols: string) => {
        mockSelects.push(cols);
        const q: Record<string, unknown> = {
          eq: () => q,
          order: () => q,
          limit: () => q,
          maybeSingle: async () => (mockError ? { data: null, error: mockError } : { data: { token: "tok_abc" }, error: null }),
          then: (res: (v: unknown) => unknown) => res(mockError ? { data: null, error: mockError } : { data: mockRows, error: null }),
        };
        return q;
      },
    }),
  },
}));

beforeEach(() => {
  mockUser = "user-1";
  mockError = null;
  mockOptionsMissing = false;
  mockRows = [];
  mockRpcs.length = 0;
  mockSelects.length = 0;
});

const base = { sections: ["vitals"], expiresInHours: getSharingConfig().default_expiry_hours, usePin: false, oneSession: false, recipientLabel: "", maxViews: null };

describe("share my record on the phone (S43m)", () => {
  it("offers no reproductive or mental health section, so a link can never include them", () => {
    expect([...SHARE_SECTIONS]).toEqual(["vitals", "medications", "conditions", "allergies", "lab_results", "vaccinations", "emergency_info"]);
    for (const s of SHARE_SECTIONS) expect(s).not.toMatch(/reproduct|mental|cycle|pregnan|fertil/);
  });

  it("keeps the view-cap choices the same as the web page's", () => {
    const web = readFileSync(join(__dirname, "../../../web/src/lib/my-health/share-options.ts"), "utf8");
    const m = /SHARE_MAX_VIEWS_CHOICES = \[([^\]]+)\]/.exec(web);
    expect(m).not.toBeNull();
    expect(m?.[1].split(",").map((n) => Number(n.trim()))).toEqual([...SHARE_MAX_VIEWS_CHOICES]);
  });

  it("has words for every section, expiry and failure", () => {
    for (const s of SHARE_SECTIONS) expect(Object.hasOwn(en, `share.sections.${s}`)).toBe(true);
    for (const h of getSharingConfig().expiry_options_hours) expect(expiryLabel(h)).not.toMatch(/undefined|\{/);
    const failures: ShareFailure[] = ["offline", "failed", "no_section", "bad_expiry", "bad_views", "label_too_long", "options_unavailable"];
    for (const f of failures) expect(shareFailureMessage(f)).not.toMatch(/undefined|\{/);
    expect(sectionLabel("something_else")).toBe("something else");
  });

  it("refuses an empty selection, an unknown section, an expiry off the list, a bad cap and a long label", () => {
    expect(validateCreateShare({ ...base, sections: [] })).toBe("no_section");
    expect(validateCreateShare({ ...base, sections: ["vitals", "cycle_data"] })).toBe("no_section");
    expect(validateCreateShare({ ...base, expiresInHours: 99999 })).toBe("bad_expiry");
    expect(validateCreateShare({ ...base, maxViews: 7 })).toBe("bad_views");
    expect(validateCreateShare({ ...base, recipientLabel: "x".repeat(81) })).toBe("label_too_long");
    expect(validateCreateShare(base)).toBeNull();
  });

  it("makes a plain link through the base function and returns the link and the PIN once", async () => {
    const r = await createShare({ ...base, usePin: true });
    expect(r).toEqual({ ok: true, share: { id: "s1", token: "tok_abc", pin: "123456", expiresAt: "2026-10-25T10:00:00Z" } });
    expect(mockRpcs.map((c) => c.fn)).toEqual(["create_record_share"]);
    expect(mockRpcs[0].args).toEqual({ p_sections: ["vitals"], p_expires_in_hours: base.expiresInHours, p_use_pin: true, p_one_session: false });
  });

  it("uses the options function only when a label or a cap is asked for, and says so when the database does not have it yet", async () => {
    await createShare({ ...base, recipientLabel: " Dr Okafor ", maxViews: 3 });
    expect(mockRpcs[0].fn).toBe("create_record_share_with_options");
    expect(mockRpcs[0].args).toMatchObject({ p_recipient_label: "Dr Okafor", p_max_views: 3 });
    mockOptionsMissing = true;
    expect(await createShare({ ...base, maxViews: 3 })).toEqual({ ok: false, reason: "options_unavailable" });
  });

  it("says needs a connection when offline, and never invents a link", async () => {
    mockError = { message: "Network request failed" };
    expect(await createShare(base)).toEqual({ ok: false, reason: "offline" });
    expect(await revokeShare("s1")).toEqual({ ok: false, reason: "offline" });
    expect(await fetchShareLink("s1")).toEqual({ ok: false, reason: "offline" });
  });

  it("lists only links that can still be opened, and never asks for the link itself", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    mockRows = [
      { id: "a", sections: ["vitals"], expires_at: future, is_active: true, view_count: 1, pin_protected: true, one_session: false, locked_at: null, recipient_label: "Clinic", max_views: 3 },
      { id: "b", sections: ["vitals"], expires_at: past, is_active: true, view_count: 0, pin_protected: false, one_session: false, locked_at: null, recipient_label: null, max_views: null },
      { id: "c", sections: ["vitals"], expires_at: future, is_active: false, view_count: 0, pin_protected: false, one_session: false, locked_at: null, recipient_label: null, max_views: null },
    ];
    const r = await loadShares("user-1");
    expect(r.ok && r.data.map((s) => s.id)).toEqual(["a"]);
    expect(mockSelects[0]).not.toMatch(/\btoken\b/);
    expect(JSON.stringify(r)).not.toMatch(/tok_|token/);
  });

  it("fetches a link only on request and returns it without saving it", async () => {
    expect(await fetchShareLink("a")).toEqual({ ok: true, token: "tok_abc" });
    expect(mockSelects).toEqual(["token"]);
  });

  it("counts views left and builds a message that names no record content", () => {
    expect(viewsLeft(null, 4)).toBeNull();
    expect(viewsLeft(3, 5)).toBe(0);
    expect(shareUrl("tok")).toMatch(/\/share\/tok$/);
    expect(shareMessage("tok")).toBe("Open my TarragonHealth record: " + shareUrl("tok"));
    expect(shareMessage("tok")).not.toMatch(/blood|result|medicine|diagnos|hiv|pregnan/i);
  });

  it("ignores malformed rows", () => {
    expect(parseShares([{ id: 1 }, null, "x"])).toEqual([]);
    expect(parseShares("nope")).toEqual([]);
  });
});
