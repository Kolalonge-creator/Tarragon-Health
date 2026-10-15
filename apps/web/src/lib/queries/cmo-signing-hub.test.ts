import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import type { SettledConfig, SignoffQueueItem } from "./signoff-queue";
import type { PendingAiGovernanceSignoff } from "./pending-ai-governance-signoff";

const readSignoffQueue = jest.fn<(...args: unknown[]) => Promise<{ items: SignoffQueueItem[]; failedSources: string[]; settledConfigs: SettledConfig[] }>>();
const readPendingAiGovernanceSignoff = jest.fn<(...args: unknown[]) => Promise<PendingAiGovernanceSignoff>>();

jest.mock("@/lib/queries/signoff-queue", () => ({
  readSignoffQueue: (...args: unknown[]) => readSignoffQueue(...args),
  SEVERITY_RANK: { live_unsigned: 0, draft_pending: 1, setup_needed: 2 },
}));
const readS06S10Signoffs = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const emptyS06S10 = { rows: [], openProposed: [], founderReview: [], items: [] as SignoffQueueItem[], failed: false, failedSources: [] as string[] };
jest.mock("@/lib/queries/s06-s10-signoffs", () => ({
  readS06S10Signoffs: (...args: unknown[]) => readS06S10Signoffs(...args),
  EMPTY_S06S10: { rows: [], openProposed: [], founderReview: [], items: [], failed: false, failedSources: [] },
}));
const readPendingCommunitySignoff = jest.fn<(...args: unknown[]) => Promise<{ rulesUnsigned: boolean; groupsWaiting: number; statementsWaiting: number; attentionCount: number; failed: boolean }>>();
jest.mock("@/lib/queries/pending-community-signoff", () => ({
  readPendingCommunitySignoff: (...args: unknown[]) => readPendingCommunitySignoff(...args),
}));
const readCredentialAttention = jest.fn<(...args: unknown[]) => Promise<{ overdueRechecks: number; unverified: number; failed: boolean }>>();
jest.mock("@/lib/queries/credential-attention", () => {
  const actual = jest.requireActual<typeof import("./credential-attention")>("./credential-attention");
  return { ...actual, readCredentialAttention: (...args: unknown[]) => readCredentialAttention(...args) };
});
const readPendingRedOutreachSignoff = jest.fn<(...args: unknown[]) => Promise<{ waiting: boolean; failed: boolean }>>();
jest.mock("@/lib/queries/pending-red-outreach-signoff", () => ({
  readPendingRedOutreachSignoff: (...args: unknown[]) => readPendingRedOutreachSignoff(...args),
}));
type GlucosePending = { pending: boolean; version: number | null; approvedVersion: number | null; note: string | null; failed: boolean };
const readPendingGlucoseTriageSignoff = jest.fn<(...args: unknown[]) => Promise<GlucosePending>>();
jest.mock("@/lib/queries/pending-glucose-triage-signoff", () => ({
  GLUCOSE_TRIAGE_ITEM_KEY: "glucose_triage_rule_set",
  readPendingGlucoseTriageSignoff: (...args: unknown[]) => readPendingGlucoseTriageSignoff(...args),
}));
const noGlucose: GlucosePending = { pending: false, version: null, approvedVersion: null, note: null, failed: false };
const readPendingGlucoseTaskTypeSignoff = jest.fn<(...args: unknown[]) => Promise<{ waiting: boolean; failed: boolean }>>();
jest.mock("@/lib/queries/pending-glucose-task-type-signoff", () => ({
  readPendingGlucoseTaskTypeSignoff: (...args: unknown[]) => readPendingGlucoseTaskTypeSignoff(...args),
}));
type QualityPending = { qualityVersion: number | null; credentialingVersion: number | null; failed: boolean };
const readPendingQualityConfigSignoff = jest.fn<(...args: unknown[]) => Promise<QualityPending>>();
jest.mock("@/lib/queries/pending-quality-config-signoff", () => ({
  readPendingQualityConfigSignoff: (...args: unknown[]) => readPendingQualityConfigSignoff(...args),
}));
const noQualityConfig: QualityPending = { qualityVersion: null, credentialingVersion: null, failed: false };
type CapacityPending = { capacityVersion: number | null; leadVersion: number | null; failed: boolean };
const readPendingCapacityConfigSignoff = jest.fn<(...args: unknown[]) => Promise<CapacityPending>>();
jest.mock("@/lib/queries/pending-capacity-config-signoff", () => ({
  readPendingCapacityConfigSignoff: (...args: unknown[]) => readPendingCapacityConfigSignoff(...args),
}));
const noCapacityConfig: CapacityPending = { capacityVersion: null, leadVersion: null, failed: false };
const readPendingSoleCmoException = jest.fn<(...args: unknown[]) => Promise<{ waiting: boolean; failed: boolean }>>();
jest.mock("@/lib/queries/pending-sole-cmo-exception", () => ({
  readPendingSoleCmoException: (...args: unknown[]) => readPendingSoleCmoException(...args),
}));
const noCommunity = { rulesUnsigned: false, groupsWaiting: 0, statementsWaiting: 0, attentionCount: 0, failed: false };
jest.mock("@/lib/queries/pending-ai-governance-signoff", () => ({
  readPendingAiGovernanceSignoff: (...args: unknown[]) => readPendingAiGovernanceSignoff(...args),
}));

import { CAPACITY_CONFIG_ITEM_KEY, CLINICAL_RULES_ITEM_KEY, COMMUNITY_ITEM_KEY, PROTOCOL_DRAFTS_ITEM_KEY, QUALITY_CONFIG_ITEM_KEY, RED_OUTREACH_ITEM_KEY, readCmoSigningHub, SOLE_CMO_EXCEPTION_ITEM_KEY } from "./cmo-signing-hub";

const supabase = {} as SupabaseClient<Database>;

const noAi: PendingAiGovernanceSignoff = {
  pendingVersionApprovalCount: 0,
  pendingClinicalAccuracyLabelCount: 0,
  attentionCount: 0,
  failed: false,
};

function item(key: string, severity: SignoffQueueItem["severity"], count?: number): SignoffQueueItem {
  return { key, title: key, detail: key, href: `/clinician/${key}`, severity, count };
}

beforeEach(() => {
  readSignoffQueue.mockReset();
  readPendingAiGovernanceSignoff.mockReset();
  readPendingAiGovernanceSignoff.mockResolvedValue(noAi);
  readPendingCommunitySignoff.mockReset();
  readPendingCommunitySignoff.mockResolvedValue(noCommunity);
  readCredentialAttention.mockReset();
  readCredentialAttention.mockResolvedValue({ overdueRechecks: 0, unverified: 0, failed: false });
  readS06S10Signoffs.mockReset();
  readS06S10Signoffs.mockResolvedValue(emptyS06S10);
  readPendingRedOutreachSignoff.mockReset();
  readPendingRedOutreachSignoff.mockResolvedValue({ waiting: false, failed: false });
  readPendingSoleCmoException.mockReset();
  readPendingSoleCmoException.mockResolvedValue({ waiting: false, failed: false });
  readPendingGlucoseTaskTypeSignoff.mockReset();
  readPendingGlucoseTaskTypeSignoff.mockResolvedValue({ waiting: false, failed: false });
  readPendingGlucoseTriageSignoff.mockReset();
  readPendingGlucoseTriageSignoff.mockResolvedValue(noGlucose);
  readPendingQualityConfigSignoff.mockReset();
  readPendingQualityConfigSignoff.mockResolvedValue(noQualityConfig);
  readPendingCapacityConfigSignoff.mockReset();
  readPendingCapacityConfigSignoff.mockResolvedValue(noCapacityConfig);
});

describe("readCmoSigningHub: capacity, rest and fire drills", () => {
  const empty = { items: [] as SignoffQueueItem[], failedSources: [] as string[], settledConfigs: [] as SettledConfig[] };
  it("adds one line, under /clinician, that counts both drafts and signs nothing", async () => {
    readSignoffQueue.mockResolvedValue(empty);
    readPendingCapacityConfigSignoff.mockResolvedValue({ capacityVersion: 2, leadVersion: 2, failed: false });
    const hub = await readCmoSigningHub(supabase);
    const line = hub.items.find((i) => i.key === CAPACITY_CONFIG_ITEM_KEY);
    expect(line?.count).toBe(2);
    expect(line?.href.startsWith("/clinician/")).toBe(true);
    expect(line?.detail).toMatch(/stay off until you sign/);
  });
  it("adds no line when nothing waits, and names a failed read", async () => {
    readSignoffQueue.mockResolvedValue(empty);
    expect((await readCmoSigningHub(supabase)).items.find((i) => i.key === CAPACITY_CONFIG_ITEM_KEY)).toBeUndefined();
    readPendingCapacityConfigSignoff.mockResolvedValue({ capacityVersion: null, leadVersion: null, failed: true });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.failed).toBe(true);
    expect(hub.failedSources).toContain("the capacity and lead configurations");
  });
});

describe("readCmoSigningHub: S20 v2 quality and credentialing configurations", () => {
  const empty = { items: [] as SignoffQueueItem[], failedSources: [] as string[], settledConfigs: [] as SettledConfig[] };
  it("adds one line, under /clinician, that counts both drafts and signs nothing", async () => {
    readSignoffQueue.mockResolvedValue(empty);
    readPendingQualityConfigSignoff.mockResolvedValue({ qualityVersion: 3, credentialingVersion: 4, failed: false });
    const hub = await readCmoSigningHub(supabase);
    const line = hub.items.find((i) => i.key === QUALITY_CONFIG_ITEM_KEY);
    expect(line?.count).toBe(2);
    expect(line?.href.startsWith("/clinician/")).toBe(true);
    expect(line?.detail).toMatch(/stay off until you sign/);
  });
  it("adds no line when nothing waits, and names a failed read", async () => {
    readSignoffQueue.mockResolvedValue(empty);
    expect((await readCmoSigningHub(supabase)).items.find((i) => i.key === QUALITY_CONFIG_ITEM_KEY)).toBeUndefined();
    readPendingQualityConfigSignoff.mockResolvedValue({ qualityVersion: null, credentialingVersion: null, failed: true });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.failed).toBe(true);
    expect(hub.failedSources).toContain("the quality and credentialing configurations");
  });
});

describe("readCmoSigningHub: glucose triage rules (plan item R2)", () => {
  it("lists a draft glucose rule set as a hub line under /clinician", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readPendingGlucoseTriageSignoff.mockResolvedValue({ pending: true, version: 1, approvedVersion: null, note: null, failed: false });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.items).toHaveLength(1);
    expect(hub.items[0]).toMatchObject({ key: "glucose_triage_rule_set", href: "/clinician/glucose-triage-rules", severity: "draft_pending" });
    expect(hub.items[0]?.detail).toMatch(/shadow only/);
  });
  it("says which version stays in force once one is approved", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readPendingGlucoseTriageSignoff.mockResolvedValue({ pending: true, version: 2, approvedVersion: 1, note: null, failed: false });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.items[0]?.detail).toMatch(/Version 1 stays in force/);
  });
  it("shows nothing when there is nothing to sign, and names a failed read instead of going quiet", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    expect((await readCmoSigningHub(supabase)).items).toEqual([]);
    readPendingGlucoseTriageSignoff.mockResolvedValue({ pending: false, version: null, approvedVersion: null, note: null, failed: true });
    expect(await readCmoSigningHub(supabase)).toMatchObject({ failed: true, failedSources: ["the glucose triage rules"] });
  });
});

describe("readCmoSigningHub: S06 to S10 items", () => {
  it("merges the S06 to S10 lines into the list and counts them", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readS06S10Signoffs.mockResolvedValue({ ...emptyS06S10, items: [item("triage_rule_set_draft", "draft_pending"), item("proposed_values_s06_s10", "draft_pending", 2)] });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.items.map((i) => i.key)).toEqual(["triage_rule_set_draft", "proposed_values_s06_s10"]);
  });
  it("names an unreadable S06 to S10 source instead of going quiet", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readS06S10Signoffs.mockResolvedValue({ ...emptyS06S10, failed: true, failedSources: ["the go-live conditions"] });
    const hub = await readCmoSigningHub(supabase);
    expect(hub).toMatchObject({ failed: true, failedSources: ["the go-live conditions"] });
  });
  it("never lets a banner row link to a hub line that does not exist", async () => {
    const row = (id: string, panelKey: string) => ({ id, status: "pending", panelKey, fallbackHref: "/x" });
    readSignoffQueue.mockResolvedValue({ items: [item("versioned_draft:prn_limit_rules", "draft_pending")], failedSources: [], settledConfigs: [] });
    readS06S10Signoffs.mockResolvedValue({ ...emptyS06S10, rows: [row("C7", "versioned_draft:prn_limit_rules"), row("C1", "versioned_draft:home_bp_programme_signoffs")] });
    const hub = await readCmoSigningHub(supabase);
    const rows = hub.s06s10.rows as unknown as Array<{ id: string; panelKey: string | null }>;
    expect(rows.find((r) => r.id === "C7")?.panelKey).toBe("versioned_draft:prn_limit_rules");
    expect(rows.find((r) => r.id === "C1")?.panelKey).toBeNull();
  });
  it("treats a thrown S06 to S10 read as a failure, not an all-clear", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readS06S10Signoffs.mockRejectedValue(new Error("boom"));
    const hub = await readCmoSigningHub(supabase);
    expect(hub.failed).toBe(true);
  });
});

describe("readCmoSigningHub: Community", () => {
  it("adds one Community line, linking into /clinician, when anything needs the CMO", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readPendingCommunitySignoff.mockResolvedValue({ rulesUnsigned: true, groupsWaiting: 1, statementsWaiting: 3, attentionCount: 5, failed: false });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.items).toHaveLength(1);
    expect(hub.items[0]).toMatchObject({ key: COMMUNITY_ITEM_KEY, count: 5, href: "/clinician/community/signoff" });
  });
  it("names Community as a failed source rather than going quiet", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readPendingCommunitySignoff.mockResolvedValue({ ...noCommunity, failed: true });
    const hub = await readCmoSigningHub(supabase);
    expect(hub).toMatchObject({ failed: true, failedSources: ["Community"] });
  });
});

describe("readCmoSigningHub", () => {
  it("asks the queue for the Chief Medical Officer's own links", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    await readCmoSigningHub(supabase);
    expect(readSignoffQueue).toHaveBeenCalledWith(supabase, "/clinician");
  });

  it("is an all-clear only when everything was read and nothing is outstanding", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    expect(await readCmoSigningHub(supabase)).toEqual({ items: [], failed: false, failedSources: [], settledConfigs: [], s06s10: emptyS06S10, attention: [] });
  });

  it("merges rules needing setup and rules ready to sign into one line with the summed count", async () => {
    readSignoffQueue.mockResolvedValue({ items: [
      item("clinical_rules_needs_setup", "setup_needed", 2),
      item("clinical_rules_ready", "draft_pending", 3),
    ], failedSources: [], settledConfigs: [] });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.items).toHaveLength(1);
    expect(hub.items[0]).toMatchObject({ key: CLINICAL_RULES_ITEM_KEY, count: 5 });
  });

  it("adds one AI governance line naming both kinds of pending work", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readPendingAiGovernanceSignoff.mockResolvedValue({
      pendingVersionApprovalCount: 1,
      pendingClinicalAccuracyLabelCount: 4,
      attentionCount: 5,
      failed: false,
    });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.items).toHaveLength(1);
    expect(hub.items[0]).toMatchObject({ key: "ai_governance", href: "/clinician/ai-governance", count: 5 });
    expect(hub.items[0]?.detail).toContain("1 AI system version to approve");
    expect(hub.items[0]?.detail).toContain("4 clinical-accuracy scenarios");
  });

  it("lists what is live with no signature before what is merely waiting", async () => {
    readSignoffQueue.mockResolvedValue({ items: [item("clinical_rules_ready", "draft_pending", 1), item("lpe_content_blocks", "live_unsigned", 2)], failedSources: [], settledConfigs: [] });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.items.map((i) => i.severity)).toEqual(["live_unsigned", "draft_pending"]);
  });

  it("reports failure, never an all-clear, when the queue cannot be read, and still shows AI work", async () => {
    readSignoffQueue.mockRejectedValue(new Error("db down"));
    readPendingAiGovernanceSignoff.mockResolvedValue({
      pendingVersionApprovalCount: 1,
      pendingClinicalAccuracyLabelCount: 0,
      attentionCount: 1,
      failed: false,
    });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.failed).toBe(true);
    expect(hub.items.map((i) => i.key)).toEqual(["ai_governance"]);
  });

  it("reports failure when only the AI read failed", async () => {
    readSignoffQueue.mockResolvedValue({ items: [item("lpe_content_blocks", "live_unsigned", 1)], failedSources: [], settledConfigs: [] });
    readPendingAiGovernanceSignoff.mockResolvedValue({ ...noAi, failed: true });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.failed).toBe(true);
    expect(hub.items).toHaveLength(1);
  });

  it("merges every protocol draft into one line so the one manager is not rendered per draft", async () => {
    readSignoffQueue.mockResolvedValue({
      items: [
        { ...item("protocol_draft:a", "draft_pending"), title: "Hypertension" },
        { ...item("protocol_draft:b", "draft_pending"), title: "Diabetes" },
      ],
      failedSources: [],
      settledConfigs: [],
    });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.items).toHaveLength(1);
    expect(hub.items[0]).toMatchObject({ key: PROTOCOL_DRAFTS_ITEM_KEY, count: 2, href: "/clinician/protocols" });
    expect(hub.items[0]?.detail).toContain("Hypertension, Diabetes");
  });

  it("keeps the lines that loaded and names the source that did not", async () => {
    readSignoffQueue.mockResolvedValue({ items: [item("lpe_content_blocks", "live_unsigned", 2)], failedSources: ["alert_rules"], settledConfigs: [] });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.failed).toBe(true);
    expect(hub.failedSources).toEqual(["alert_rules"]);
    expect(hub.items.map((i) => i.key)).toEqual(["lpe_content_blocks"]);
  });

  it("names AI governance when only that read failed", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readPendingAiGovernanceSignoff.mockResolvedValue({ ...noAi, failed: true });
    expect((await readCmoSigningHub(supabase)).failedSources).toEqual(["AI governance"]);
  });

  it("passes the signed configurations through, so the page does not read those tables again", async () => {
    const settled = [{ table: "alert_rules", title: "Alert rules", href: "/clinician/alert-rules", version: 6 }];
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: settled });
    expect((await readCmoSigningHub(supabase)).settledConfigs).toEqual(settled);
  });

  it("P5: an overdue MDCN spot re-check and clinicians with no verification show as one attention line that links under /clinician", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readCredentialAttention.mockResolvedValue({ overdueRechecks: 1, unverified: 2, failed: false });
    const hub = await readCmoSigningHub(supabase);
    // attention, not a signature: it must never be counted by the "areas need your signature" banner
    expect(hub.items).toHaveLength(0);
    expect(hub.attention).toHaveLength(1);
    expect(hub.attention[0]).toMatchObject({ key: "credential_attention", count: 3, href: "/clinician/credentialing" });
    expect(hub.attention[0]?.detail).toContain("1 MDCN spot re-check is overdue");
    expect(hub.attention[0]?.detail).toContain("2 clinicians have no MDCN or DataFlow verification on record");
    expect(hub.attention[0]?.detail).toContain("Nothing is paused");
  });

  it("P5: nothing outstanding adds no line, and a failed read is named rather than shown as all clear", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    const clear = await readCmoSigningHub(supabase);
    expect(clear.items).toEqual([]);
    expect(clear.attention).toEqual([]);
    readCredentialAttention.mockResolvedValue({ overdueRechecks: 0, unverified: 0, failed: true });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.failed).toBe(true);
    expect(hub.failedSources).toEqual(["Clinician registration checks"]);
  });
});

describe("readCmoSigningHub: red alert outreach (S13 R4)", () => {
  it("lists the call-the-patient task type while it awaits the CMO, under /clinician", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readPendingRedOutreachSignoff.mockResolvedValue({ waiting: true, failed: false });
    const hub = await readCmoSigningHub(supabase);
    const line = hub.items.find((i) => i.key === RED_OUTREACH_ITEM_KEY);
    expect(line).toMatchObject({ severity: "draft_pending", count: 1 });
    expect(line?.href.startsWith("/clinician/")).toBe(true);
  });
  it("lists nothing once it is confirmed", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.items.find((i) => i.key === RED_OUTREACH_ITEM_KEY)).toBeUndefined();
  });
  it("names an unreadable source instead of looking like an all-clear", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readPendingRedOutreachSignoff.mockResolvedValue({ waiting: false, failed: true });
    const hub = await readCmoSigningHub(supabase);
    expect(hub).toMatchObject({ failed: true, failedSources: ["Red alert outreach"] });
  });
});

describe("readCmoSigningHub: both new task types and the glucose rules together (S11 to S15 integration)", () => {
  it("lists the glucose rules, the urgent glucose review task type and the call-the-patient task type as three separate lines, all under /clinician", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readPendingGlucoseTriageSignoff.mockResolvedValue({ pending: true, version: 1, approvedVersion: null, note: null, failed: false });
    readPendingGlucoseTaskTypeSignoff.mockResolvedValue({ waiting: true, failed: false });
    readPendingRedOutreachSignoff.mockResolvedValue({ waiting: true, failed: false });
    const hub = await readCmoSigningHub(supabase);
    const keys = hub.items.map((i) => i.key).sort();
    expect(keys).toEqual(["glucose_task_type", "glucose_triage_rule_set", "red_outreach"]);
    expect(hub.items.every((i) => i.href.startsWith("/clinician/"))).toBe(true);
    expect(hub.failed).toBe(false);
  });
  it("names an unreadable glucose task type source instead of going quiet", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readPendingGlucoseTaskTypeSignoff.mockResolvedValue({ waiting: false, failed: true });
    expect(await readCmoSigningHub(supabase)).toMatchObject({ failed: true, failedSources: ["the urgent glucose review task type"] });
  });
});

describe("readCmoSigningHub: sole-CMO on-call exception", () => {
  it("lists the exception line under /clinician only while it is waiting", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readPendingSoleCmoException.mockResolvedValue({ waiting: true, failed: false });
    const line = (await readCmoSigningHub(supabase)).items.find((i) => i.key === SOLE_CMO_EXCEPTION_ITEM_KEY);
    expect(line).toMatchObject({ severity: "draft_pending", count: 1 });
    expect(line?.href.startsWith("/clinician/")).toBe(true);
    expect(line?.title).toMatch(/on-call rota/);
  });
  it("shows nothing once an exception is in force or a second CMO exists", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    expect((await readCmoSigningHub(supabase)).items.find((i) => i.key === SOLE_CMO_EXCEPTION_ITEM_KEY)).toBeUndefined();
  });
  it("names an unreadable source instead of looking like an all-clear", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readPendingSoleCmoException.mockResolvedValue({ waiting: false, failed: true });
    expect(await readCmoSigningHub(supabase)).toMatchObject({ failed: true, failedSources: ["the sole-CMO on-call exception"] });
  });
});
