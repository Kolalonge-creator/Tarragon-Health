import { beforeEach, describe, expect, it } from "@jest/globals";
import { PROPOSED_CONFIG } from "../../shared/src/proposed-config/registry";
import {
  allowedOutcomeCodes, checkOutcomeShape, classBreaches, CONTACT_ATTEMPT_LOOKBACK_HOURS, coolingOffUntil, escalatedClaimableWithoutOnCall, escalationChannels, escalationTier,
  offerWindowMinutes, outcomeCode, staleJobs, windowEndAfterMerge, type TaskLayerRules,
} from "../../../supabase/functions/_shared/queue/task-layer";
import type { CooldownRule } from "../../../supabase/functions/_shared/queue/claims";

const rules = PROPOSED_CONFIG.find((e) => e.key === "queue.task_layer")?.value as unknown as TaskLayerRules;
const completion = rules.completion;
const MIN = 60_000;
const NOW = Date.parse("2026-10-14T12:00:00Z");
const CREATED = NOW - 30 * MIN;
let n = 0;
beforeEach(() => { n = 0; });
// each default attempt is a minute apart, so a list of them is a list of different attempts
const attempt = (over: Record<string, unknown> = {}) => ({ at: new Date(NOW - (5 + n++) * MIN).toISOString(), method: "phone_call", reached: false, ...over });
const critical = (attempts: unknown, code = "contact_attempts_documented") => ({ code, attempts });

describe("offerWindowMinutes (D1)", () => {
  it("is the type window when that is shorter", () => expect(offerWindowMinutes(240, 1440, rules.lead_window_cap_fraction)).toBe(240));
  it("is half the due time when that is shorter", () => {
    expect(offerWindowMinutes(1440, 1440, rules.lead_window_cap_fraction)).toBe(720);
    expect(offerWindowMinutes(2880, 2880, rules.lead_window_cap_fraction)).toBe(1440);
    expect(offerWindowMinutes(1440, 30, rules.lead_window_cap_fraction)).toBe(15);
  });
  it("rounds down to whole minutes", () => expect(offerWindowMinutes(1440, 31, 0.5)).toBe(15));
  it("is no window when under a minute is left", () => {
    expect(offerWindowMinutes(1440, 1, 0.5)).toBe(0);
    expect(offerWindowMinutes(0, 1440, 0.5)).toBe(0);
  });
});

describe("windowEndAfterMerge (D9)", () => {
  it("tightens a running window to the same share of the shorter life", () => {
    expect(windowEndAfterMerge(0, 200 * MIN, 720 * MIN, 0.5)).toBe(100 * MIN);
  });
  it("never lengthens a window that is already shorter", () => {
    expect(windowEndAfterMerge(0, 2000 * MIN, 100 * MIN, 0.5)).toBe(100 * MIN);
  });
});

describe("escalation tiers and channels (D2)", () => {
  it("classes 1 and 2 are immediate, 3 to 9 are notices", () => {
    expect(escalationTier(1, 1, 2)).toBe("immediate");
    expect(escalationTier(2, 2, 2)).toBe("immediate");
    expect(escalationTier(3, 3, 2)).toBe("notice");
    expect(escalationTier(9, 9, 2)).toBe("notice");
  });
  it("the more urgent of the current and original class decides", () => {
    expect(escalationTier(5, 2, 2)).toBe("immediate");
    expect(escalationTier(2, 5, 2)).toBe("immediate");
  });
  it("immediate uses in-app, push and email; a notice is in-app only; never SMS or WhatsApp", () => {
    expect(escalationChannels("immediate", rules.escalation_alert)).toEqual(["in_app", "push", "email"]);
    expect(escalationChannels("notice", rules.escalation_alert)).toEqual(["in_app"]);
    for (const c of [...rules.escalation_alert.immediate_channels, ...rules.escalation_alert.notice_channels, ...rules.escalation_alert.digest_channels]) {
      expect(["sms", "whatsapp"]).not.toContain(c);
    }
  });
});

describe("escalatedClaimableWithoutOnCall (D1, INV-05)", () => {
  it("is true only for a non-red task with the rule on", () => {
    expect(escalatedClaimableWithoutOnCall(4, 4, true)).toBe(true);
    expect(escalatedClaimableWithoutOnCall(4, 4, false)).toBe(false);
    expect(escalatedClaimableWithoutOnCall(1, 1, true)).toBe(false);
    expect(escalatedClaimableWithoutOnCall(4, 1, true)).toBe(false);
    expect(escalatedClaimableWithoutOnCall(1, 4, true)).toBe(false);
  });
});

describe("outcome codes (D4)", () => {
  it("each type has its own list, others use the default", () => {
    expect(allowedOutcomeCodes("titration_signoff", completion)).toEqual(["signed", "amended", "rejected"]);
    expect(allowedOutcomeCodes("amber_bp_review", completion)).toEqual(completion.default_codes);
  });

  it("reads the code, or the legacy kind for the two older flows only", () => {
    expect(outcomeCode("amber_bp_review", { code: " referred_on " }, completion)).toBe("referred_on");
    expect(outcomeCode("amber_bp_review", { kind: "referred_on" }, completion)).toBeNull();
    expect(outcomeCode("async_question", { kind: "guidance" }, completion)).toBe("guidance");
    expect(outcomeCode("async_question", { kind: "  " }, completion)).toBeNull();
    expect(outcomeCode("async_question", {}, completion)).toBeNull();
    expect(outcomeCode("amber_bp_review", { code: 7 }, completion)).toBeNull();
    expect(outcomeCode("async_question", { code: "", kind: "needs_call" }, completion)).toBe("needs_call");
  });
});

describe("checkOutcomeShape (D4)", () => {
  const check = (type: string, outcome: Record<string, unknown>) => checkOutcomeShape(type, outcome, completion, CREATED, NOW);

  it("refuses a missing or unlisted code", () => {
    expect(check("amber_bp_review", { note: "I did a lot of things here" })).toBe("queue_outcome_code");
    expect(check("amber_bp_review", { code: "result_released" })).toBe("queue_outcome_code");
    expect(check("critical_result_review", { code: "completed_action_taken" })).toBe("queue_outcome_code");
  });

  it("a note is only a note: optional, a string, within the limit", () => {
    expect(check("amber_bp_review", { code: "referred_on" })).toBeNull();
    expect(check("amber_bp_review", { code: "referred_on", note: "ok" })).toBeNull();
    expect(check("amber_bp_review", { code: "referred_on", note: 5 })).toBe("queue_outcome_note");
    expect(check("amber_bp_review", { code: "referred_on", note: "x".repeat(completion.note_max_chars + 1) })).toBe("queue_outcome_note");
    expect(check("amber_bp_review", { code: "referred_on", note: "x".repeat(completion.note_max_chars) })).toBeNull();
  });

  it("a released-result claim needs no attempts here (the database checks the record)", () => {
    expect(check("critical_result_review", { code: "result_released" })).toBeNull();
  });

  it("a documented contact sequence needs enough dated attempts by a permitted method", () => {
    expect(check("critical_result_review", critical([attempt(), attempt(), attempt()]))).toBeNull();
    expect(check("critical_result_review", critical("nope"))).toBe("queue_outcome_attempts");
    expect(check("critical_result_review", critical([attempt(), attempt()]))).toBe("queue_outcome_attempts");
  });

  it.each([
    ["not an object", 7],
    ["null", null],
    ["no date", attempt({ at: undefined })],
    ["a date that is not a date", attempt({ at: "yesterday-ish" })],
    ["a keyword, not a time", attempt({ at: "now" })],
    ["a bare date with no time", attempt({ at: "2026-10-14" })],
    ["dated more than 24 hours before the task existed", attempt({ at: new Date(CREATED - 25 * 60 * MIN).toISOString() })],
    ["dated in the future", attempt({ at: new Date(NOW + 10 * MIN).toISOString() })],
    ["a method not on the list", attempt({ method: "carrier_pigeon" })],
    ["a method that is not text", attempt({ method: 3 })],
    ["reached not true or false", attempt({ reached: "no" })],
  ])("refuses an attempt that is %s", (_name, bad) => {
    expect(check("critical_result_review", critical([attempt(), attempt(), bad]))).toBe("queue_outcome_attempts");
  });

  it("three copies of one attempt are one attempt", () => {
    const same = attempt();
    expect(check("critical_result_review", critical([same, { ...same }, { ...same }]))).toBe("queue_outcome_attempts");
    const at = new Date(NOW - 6 * MIN).toISOString();
    expect(check("critical_result_review", critical([attempt({ at }), attempt({ at, method: "video_call" }), attempt({ at, method: "in_app_message" })]))).toBeNull();
  });

  it("accepts an attempt made up to 24 hours before the task existed (the constant mirrors the database)", () => {
    expect(CONTACT_ATTEMPT_LOOKBACK_HOURS).toBe(24);
    const early = (hours: number, method: string) => attempt({ method, at: new Date(CREATED - hours * 60 * MIN).toISOString() });
    expect(check("critical_result_review", critical([early(12, "phone_call"), early(23, "video_call"), early(24, "in_app_message")]))).toBeNull();
  });

  it("allows a date up to five minutes ahead (clock skew) and not beyond", () => {
    expect(check("critical_result_review", critical([attempt(), attempt(), attempt({ at: new Date(NOW + 4 * MIN).toISOString() })]))).toBeNull();
  });
});

describe("coolingOffUntil (D4 screen)", () => {
  const rule: CooldownRule = { count: 3, windowMinutes: 10, exemptReasons: ["technical_problem"], hardCount: 6, hardWindowMinutes: 60 };
  const hb = (agoMin: number, reason = "outside_competence") => ({ reason, at: NOW - agoMin * MIN });

  it("is null when neither limit is tripped", () => {
    expect(coolingOffUntil([hb(1), hb(2)], NOW, rule)).toBeNull();
    expect(coolingOffUntil([], NOW, rule)).toBeNull();
  });
  it("ends when the third most recent counted hand-back ages out of the short window", () => {
    expect(coolingOffUntil([hb(1), hb(3), hb(5)], NOW, rule)).toBe(NOW - 5 * MIN + 10 * MIN);
  });
  it("exempt reasons do not count toward the short limit", () => {
    expect(coolingOffUntil([hb(1), hb(3), hb(5, "technical_problem")], NOW, rule)).toBeNull();
  });
  it("hand-backs older than the window do not count", () => {
    expect(coolingOffUntil([hb(1), hb(3), hb(15)], NOW, rule)).toBeNull();
  });
  it("the hard limit counts every reason", () => {
    const six = [1, 2, 3, 4, 5, 6].map((m) => hb(m * 8, "technical_problem"));
    expect(coolingOffUntil(six, NOW, rule)).toBe(NOW - 48 * MIN + 60 * MIN);
  });
  it("when both are tripped the later end wins", () => {
    const many = [1, 2, 3, 4, 5, 6].map((m) => hb(m));
    expect(coolingOffUntil(many, NOW, rule)).toBe(NOW - 6 * MIN + 60 * MIN);
  });
  it("the short end wins when it is the later one", () => {
    const rule2: CooldownRule = { ...rule, hardWindowMinutes: 5, hardCount: 3 };
    expect(coolingOffUntil([hb(1), hb(2), hb(3)], NOW, rule2)).toBe(NOW - 3 * MIN + 10 * MIN);
  });
});

describe("classBreaches and staleJobs (D6)", () => {
  const warn = rules.watchdog.class_warning_minutes;

  it("flags only classes past their threshold, in class order, and ignores a class with none", () => {
    expect(classBreaches({ "4": 800, "2": 61, "5": 700, "1": 9999 }, warn)).toEqual([
      { priorityClass: 2, oldestOpenMinutes: 61, warnAfterMinutes: 60 },
      { priorityClass: 4, oldestOpenMinutes: 800, warnAfterMinutes: 720 },
    ]);
    expect(classBreaches({ "2": 60 }, warn)).toEqual([]);
    expect(classBreaches({}, warn)).toEqual([]);
  });

  it("a job that never ran or ran too long ago is stale; a fresh one is not", () => {
    const max = rules.watchdog.job_max_age_minutes;
    expect(staleJobs({ "sweep-clinical-tasks": NOW - 10 * MIN, "expire-task-claims": NOW - MIN }, NOW, max)).toEqual(["sweep-clinical-tasks"]);
    expect(staleJobs({}, NOW, max)).toEqual(["expire-task-claims", "sweep-clinical-tasks"]);
    expect(staleJobs({ "sweep-clinical-tasks": NOW, "expire-task-claims": NOW }, NOW, max)).toEqual([]);
  });
});
