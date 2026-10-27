/**
 * S59c (OQ-S59c-05): danger wording in the describe box tells the care team the FACT only. These tests pin: the fact is sent with only a
 * session key and a coarse code; typed words cannot be passed through (strict schema); the answer says "not recorded" when the database
 * cannot record it (so the screen promises nothing); failures are reported without any text; and a source scan shows no typed text reaches
 * a log, Sentry or the request on either screen, nor the route.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const captureException = jest.fn();
jest.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureException(...a) }));

import { recordDescribeDanger } from "./describe-danger";
import type { SupabaseClient } from "@supabase/supabase-js";

const SESSION = "5b0d0c1e-3c1a-4a43-8d57-3f3d0e9f8a11";
const TYPED = "my chest is crushing and I want to die";

function client(result: { data: unknown; error: { message: string; code?: string } | null } | "throw") {
  const rpc = jest.fn(async () => {
    if (result === "throw") throw new Error(`network down while sending ${TYPED}`);
    return result;
  });
  return { rpc, supabase: { rpc } as unknown as SupabaseClient };
}

beforeEach(() => captureException.mockClear());

describe("recordDescribeDanger", () => {
  it("sends only the session key and the coarse code, and reports recorded", async () => {
    const { rpc, supabase } = client({ data: { recorded: true, repeat: false, doctor_alerted: true }, error: null });
    const out = await recordDescribeDanger(supabase, "u1", { session: SESSION, category: "self_harm" });
    expect(out).toEqual({ recorded: true, doctorAlerted: true });
    expect(rpc).toHaveBeenCalledWith("record_describe_danger", { p_session: SESSION, p_category: "self_harm" });
  });

  it("PLANS: a plan without doctor time is recorded but NOT paged, so the screen must not say the care team was told", async () => {
    const free = client({ data: { recorded: true, repeat: false, doctor_alerted: false }, error: null });
    expect(await recordDescribeDanger(free.supabase, "u1", { session: SESSION, category: "danger" })).toEqual({ recorded: true, doctorAlerted: false });
    const paid = client({ data: { recorded: true, repeat: false, doctor_alerted: true }, error: null });
    expect(await recordDescribeDanger(paid.supabase, "u1", { session: SESSION, category: "danger" })).toEqual({ recorded: true, doctorAlerted: true });
    const missing = client({ data: { recorded: true }, error: null });
    expect((await recordDescribeDanger(missing.supabase, "u1", { session: SESSION, category: "danger" })).doctorAlerted).toBe(false);
  });

  it("a repeat inside the rate-limit window repeats what the first event did and is not a failure", async () => {
    const { supabase } = client({ data: { recorded: true, repeat: true, doctor_alerted: true }, error: null });
    expect(await recordDescribeDanger(supabase, "u1", { session: SESSION, category: "danger" })).toEqual({ recorded: true, doctorAlerted: true });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("refuses any extra field, so typed words cannot be passed on", async () => {
    const { rpc, supabase } = client({ data: { recorded: true }, error: null });
    const out = await recordDescribeDanger(supabase, "u1", { session: SESSION, category: "danger", text: TYPED });
    expect(out).toEqual({ recorded: false, doctorAlerted: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a free-text category and a signed-out caller", async () => {
    const { rpc, supabase } = client({ data: { recorded: true }, error: null });
    expect(await recordDescribeDanger(supabase, "u1", { session: SESSION, category: TYPED })).toEqual({ recorded: false, doctorAlerted: false });
    expect(await recordDescribeDanger(supabase, null, { session: SESSION, category: "danger" })).toEqual({ recorded: false, doctorAlerted: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("FAILURE: when the database cannot record the event the answer is recorded=false (the screen promises nothing) and it is reported", async () => {
    const { supabase } = client({ data: { recorded: false, reason: "error" }, error: null });
    expect(await recordDescribeDanger(supabase, "u1", { session: SESSION, category: "danger" })).toEqual({ recorded: false, doctorAlerted: false });
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("FAILURE: an RPC error is reported by code only and never throws", async () => {
    const { supabase } = client({ data: null, error: { message: `could not insert ${TYPED}`, code: "XX000" } });
    expect(await recordDescribeDanger(supabase, "u1", { session: SESSION, category: "danger" })).toEqual({ recorded: false, doctorAlerted: false });
    const sent = captureException.mock.calls.map((c) => String((c[0] as Error).message)).join("|");
    expect(sent).toContain("XX000");
    expect(sent).not.toContain(TYPED);
  });

  it("FAILURE: a thrown network error never throws out and nothing typed is reported", async () => {
    const { supabase } = client("throw");
    expect(await recordDescribeDanger(supabase, "u1", { session: SESSION, category: "danger" })).toEqual({ recorded: false, doctorAlerted: false });
    expect(captureException.mock.calls.map((c) => String((c[0] as Error).message)).join("|")).not.toContain(TYPED);
  });

  it("a closed checker answers recorded=false without a report", async () => {
    const { supabase } = client({ data: { recorded: false, reason: "closed" }, error: null });
    expect(await recordDescribeDanger(supabase, "u1", { session: SESSION, category: "danger" })).toEqual({ recorded: false, doctorAlerted: false });
    expect(captureException).not.toHaveBeenCalled();
  });
});

describe("no typed text reaches a log, Sentry or the request (source scan)", () => {
  const root = join(__dirname, "../../..");
  const read = (rel: string) => readFileSync(join(root, rel), "utf8");
  const files = {
    lib: read("src/lib/symptom-checkback/describe-danger.ts"),
    route: read("src/app/api/mobile/symptom-describe-danger/route.ts"),
    webEntry: read("src/components/symptom/describe-entry.tsx"),
    webScreen: read("src/app/(dashboard)/patient/symptom-triage-check.tsx"),
    phoneEntry: readFileSync(join(root, "../mobile/src/screens/sections/symptom-assessment-extras.tsx"), "utf8"),
    phoneScreen: readFileSync(join(root, "../mobile/src/screens/sections/symptom-checker-card.tsx"), "utf8"),
  };

  it("the danger callback carries a boolean only, on both screens", () => {
    expect(files.webEntry).toContain("onDanger: (selfHarm: boolean) => void");
    expect(files.phoneEntry).toContain("onDanger: (selfHarm: boolean) => void");
  });

  it("the calls made on danger carry only the session key and the code", () => {
    expect(files.webScreen).toContain('recordDescribeDangerAction({ session: describeSession, category: selfHarm ? "self_harm" : "danger" })');
    expect(files.phoneScreen).toContain('postDescribeDanger({ session: describeSession, category: selfHarm ? "self_harm" : "danger" })');
  });

  it("the describe entries never log, report or send the text", () => {
    for (const src of [files.webEntry, files.phoneEntry]) {
      expect(src).not.toMatch(/console\./);
      expect(src).not.toMatch(/Sentry/);
      expect(src).not.toMatch(/fetch\(/);
      expect(src).not.toMatch(/localStorage|sessionStorage|AsyncStorage/);
    }
  });

  it("the lib and the route never log and never read a text field", () => {
    for (const src of [files.lib, files.route]) {
      expect(src).not.toMatch(/console\./);
      expect(src).not.toMatch(/\.text\b|\btext:/);
    }
  });

  it("the screens make the care-team promise only when a clinician was really paged", () => {
    expect(files.webScreen).toContain('describeDanger && describeRecorded === "paged"');
    expect(files.phoneScreen).toContain('describeDanger && describeRecorded === "paged"');
    expect(files.webScreen).toContain('r.doctorAlerted === true ? "paged" : "recorded_only"');
    expect(files.phoneScreen).toContain('r.doctorAlerted ? "paged" : "recorded_only"');
  });

  it("ACTING FOR: the web action refuses before any database call when the person is acting for someone else", () => {
    const action = read("src/app/(dashboard)/patient/symptom-checkback/[id]/actions.ts");
    const at = action.indexOf("export async function recordDescribeDangerAction");
    const body = action.slice(at);
    expect(body.indexOf("getActingFor()")).toBeGreaterThan(-1);
    expect(body.indexOf("getActingFor()")).toBeLessThan(body.indexOf("recordDescribeDanger("));
    expect(body).toContain('reason: "acting_for"');
  });

  it("the phone card shows no describe box at all while acting for someone else", () => {
    expect(files.phoneScreen.indexOf("if (actingForSomeoneElse)")).toBeLessThan(files.phoneScreen.indexOf("<DescribeBox"));
  });
});
