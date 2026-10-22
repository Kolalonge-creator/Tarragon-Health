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
const readPendingVitalsTriageSignoff = jest.fn<(...args: unknown[]) => Promise<GlucosePending>>();
jest.mock("@/lib/queries/pending-vitals-triage-signoff", () => ({
  VITALS_TRIAGE_ITEM_KEY: "vitals_triage_rule_set",
  readPendingVitalsTriageSignoff: (...args: unknown[]) => readPendingVitalsTriageSignoff(...args),
}));
const readPendingVitalsTaskTypeSignoff = jest.fn<(...args: unknown[]) => Promise<{ waiting: boolean; failed: boolean }>>();
jest.mock("@/lib/queries/pending-vitals-task-type-signoff", () => ({
  readPendingVitalsTaskTypeSignoff: (...args: unknown[]) => readPendingVitalsTaskTypeSignoff(...args),
}));
type QualityPending = { qualityVersion: number | null; credentialingVersion: number | null; failed: boolean };
const readPendingQualityConfigSignoff = jest.fn<(...args: unknown[]) => Promise<QualityPending>>();
jest.mock("@/lib/queries/pending-quality-config-signoff", () => ({
  readPendingQualityConfigSignoff: (...args: unknown[]) => readPendingQualityConfigSignoff(...args),
}));
const noQualityConfig: QualityPending = { qualityVersion: null, credentialingVersion: null, failed: false };
type CapacityPending = { opsDeskVersion?: number | null; capacityVersion: number | null; capacityRules: unknown; leadVersion: number | null; leadCapDraft: number | null; leadCapInForce: number | null; failed: boolean };
const readPendingCapacityConfigSignoff = jest.fn<(...args: unknown[]) => Promise<CapacityPending>>();
jest.mock("@/lib/queries/pending-capacity-config-signoff", () => ({
  readPendingCapacityConfigSignoff: (...args: unknown[]) => readPendingCapacityConfigSignoff(...args),
}));
const noCapacityConfig: CapacityPending = { capacityVersion: null, capacityRules: null, leadVersion: null, leadCapDraft: null, leadCapInForce: null, failed: false };
type QueuePagingPending = { taskLayer: { kind: "accept_in_force" | "sign_new"; version: number } | null; taskLayerRules: unknown; pagingVersion: number | null; pagingRules: unknown; pagingInForceRules: unknown; failed: boolean };
const readPendingQueuePagingConfigSignoff = jest.fn<(...args: unknown[]) => Promise<QueuePagingPending>>();
jest.mock("@/lib/queries/pending-queue-paging-config-signoff", () => ({
  readPendingQueuePagingConfigSignoff: (...args: unknown[]) => readPendingQueuePagingConfigSignoff(...args),
}));
const noQueuePaging: QueuePagingPending = { taskLayer: null, taskLayerRules: null, pagingVersion: null, pagingRules: null, pagingInForceRules: null, failed: false };
const readPendingBpDeviceReview = jest.fn<(...args: unknown[]) => Promise<{ waiting: number; failed: boolean }>>();
jest.mock("@/lib/queries/pending-bp-device-review", () => ({
  readPendingBpDeviceReview: (...args: unknown[]) => readPendingBpDeviceReview(...args),
}));
type PostCheckinPending = { version: number | null; rules: unknown; failed: boolean };
const readPendingPostCheckinSignoff = jest.fn<(...args: unknown[]) => Promise<PostCheckinPending>>();
jest.mock("@/lib/queries/pending-post-checkin-signoff", () => ({
  readPendingPostCheckinSignoff: (...args: unknown[]) => readPendingPostCheckinSignoff(...args),
}));
const noPostCheckin: PostCheckinPending = { version: null, rules: null, failed: false };
type MentalWellbeingPending = { worklistVersion: number | null; worklistRules: unknown; attestations: unknown[]; failed: boolean };
const readPendingMentalWellbeingSignoff = jest.fn<(...args: unknown[]) => Promise<MentalWellbeingPending>>();
jest.mock("@/lib/queries/pending-mental-wellbeing-signoff", () => ({
  readPendingMentalWellbeingSignoff: (...args: unknown[]) => readPendingMentalWellbeingSignoff(...args),
}));
const noMentalWellbeing: MentalWellbeingPending = { worklistVersion: null, worklistRules: null, attestations: [], failed: false };
const readPendingSoleCmoException = jest.fn<(...args: unknown[]) => Promise<{ waiting: boolean; failed: boolean }>>();
const readLegacyNoticeRetirementState = jest.fn<(...args: unknown[]) => Promise<{ liveVersion: { version: number } | null; waiting: unknown[]; measurement: unknown[]; failed: boolean }>>();
jest.mock("@/lib/queries/pending-legacy-notice-retirement-signoff", () => ({
  readLegacyNoticeRetirementState: (...args: unknown[]) => readLegacyNoticeRetirementState(...args),
}));
const readUnifiedRedPagingState = jest.fn<(...args: unknown[]) => Promise<{ waitingVersion: number | null; liveVersion: number | null; failed: boolean }>>();
jest.mock("@/lib/queries/pending-unified-red-paging-signoff", () => ({
  readUnifiedRedPagingState: (...args: unknown[]) => readUnifiedRedPagingState(...args),
}));
jest.mock("@/lib/queries/pending-sole-cmo-exception", () => ({
  readPendingSoleCmoException: (...args: unknown[]) => readPendingSoleCmoException(...args),
}));
const readThresholdHubState = jest.fn<(...args: unknown[]) => Promise<{ policyWaiting: boolean; policyVersion: number | null; policyId: string | null; policyActive: boolean; active: number; reviewsOverdue: number; reviewTaskFailures: number; failed: boolean }>>();
jest.mock("@/lib/queries/threshold-overrides", () => ({ readThresholdHubState: (...args: unknown[]) => readThresholdHubState(...args) }));
const readPendingFastSugarWordingSignoff = jest.fn<(...args: unknown[]) => Promise<{ waiting: boolean; signed: boolean; failed: boolean }>>();
jest.mock("@/lib/queries/pending-fast-sugar-wording-signoff", () => ({
  FAST_SUGAR_ITEM_KEY: "glucose_fast_sugar_wording",
  readPendingFastSugarWordingSignoff: (...args: unknown[]) => readPendingFastSugarWordingSignoff(...args),
}));
const noCommunity = { rulesUnsigned: false, groupsWaiting: 0, statementsWaiting: 0, attentionCount: 0, failed: false };
jest.mock("@/lib/queries/pending-ai-governance-signoff", () => ({
  readPendingAiGovernanceSignoff: (...args: unknown[]) => readPendingAiGovernanceSignoff(...args),
}));

import { MENTAL_WELLBEING_ITEM_KEY, POST_CHECKIN_ITEM_KEY, OPS_DESK_CONFIG_ITEM_KEY, THRESHOLD_POLICY_ITEM_KEY, PAGING_DELIVERY_CONFIG_ITEM_KEY, TASK_LAYER_CONFIG_ITEM_KEY, CAPACITY_CONFIG_ITEM_KEY, CLINICAL_RULES_ITEM_KEY, COMMUNITY_ITEM_KEY, PROTOCOL_DRAFTS_ITEM_KEY, QUALITY_CONFIG_ITEM_KEY, RED_OUTREACH_ITEM_KEY, readCmoSigningHub, SOLE_CMO_EXCEPTION_ITEM_KEY } from "./cmo-signing-hub";

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
  readPendingBpDeviceReview.mockReset();
  readPendingBpDeviceReview.mockResolvedValue({ waiting: 0, failed: false });
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
  readLegacyNoticeRetirementState.mockReset();
  readLegacyNoticeRetirementState.mockResolvedValue({ liveVersion: null, waiting: [], measurement: [], failed: false });
  readUnifiedRedPagingState.mockReset();
  readUnifiedRedPagingState.mockResolvedValue({ waitingVersion: null, liveVersion: null, failed: false });
  readPendingGlucoseTaskTypeSignoff.mockReset();
  readPendingGlucoseTaskTypeSignoff.mockResolvedValue({ waiting: false, failed: false });
  readPendingGlucoseTriageSignoff.mockReset();
  readPendingGlucoseTriageSignoff.mockResolvedValue(noGlucose);
  readPendingVitalsTriageSignoff.mockReset();
  readPendingVitalsTriageSignoff.mockResolvedValue(noGlucose);
  readPendingVitalsTaskTypeSignoff.mockReset();
  readPendingVitalsTaskTypeSignoff.mockResolvedValue({ waiting: false, failed: false });
  readPendingQualityConfigSignoff.mockReset();
  readPendingQualityConfigSignoff.mockResolvedValue(noQualityConfig);
  readPendingCapacityConfigSignoff.mockReset();
  readPendingCapacityConfigSignoff.mockResolvedValue(noCapacityConfig);
  readThresholdHubState.mockReset();
  readThresholdHubState.mockResolvedValue({ policyWaiting: false, policyVersion: null, policyId: null, policyActive: true, active: 0, reviewsOverdue: 0, reviewTaskFailures: 0, failed: false });
  readPendingFastSugarWordingSignoff.mockReset();
  readPendingFastSugarWordingSignoff.mockResolvedValue({ waiting: false, signed: false, failed: false });
  readPendingQueuePagingConfigSignoff.mockReset();
  readPendingQueuePagingConfigSignoff.mockResolvedValue(noQueuePaging);
  readPendingPostCheckinSignoff.mockReset();
  readPendingPostCheckinSignoff.mockResolvedValue(noPostCheckin);
  readPendingMentalWellbeingSignoff.mockReset();
  readPendingMentalWellbeingSignoff.mockResolvedValue(noMentalWellbeing);
});

describe("readCmoSigningHub: fast-sugar wording (OQ-326)", () => {
  const empty = { items: [] as SignoffQueueItem[], failedSources: [] as string[], settledConfigs: [] as SettledConfig[] };
  it("is its own line, separate from the glucose rules, under /clinician, and says it stays unsigned until signed", async () => {
    readSignoffQueue.mockResolvedValue(empty);
    readPendingGlucoseTriageSignoff.mockResolvedValue({ pending: true, version: 1, approvedVersion: null, note: null, failed: false });
    readPendingFastSugarWordingSignoff.mockResolvedValue({ waiting: true, signed: false, failed: false });
    const hub = await readCmoSigningHub(supabase);
    const keys = hub.items.map((i) => i.key).sort();
    expect(keys).toEqual(["glucose_fast_sugar_wording", "glucose_triage_rule_set"]);
    const line = hub.items.find((i) => i.key === "glucose_fast_sugar_wording");
    expect(line?.href.startsWith("/clinician/")).toBe(true);
    expect(line?.detail).toMatch(/own signature/);
    expect(line?.detail).toMatch(/stays unsigned/);
    expect(hub.failed).toBe(false);
  });
  it("once signed the signing line goes, and an attention line says it is not yet in the app build", async () => {
    readSignoffQueue.mockResolvedValue(empty);
    readPendingFastSugarWordingSignoff.mockResolvedValue({ waiting: false, signed: true, failed: false });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.items.find((i) => i.key === "glucose_fast_sugar_wording")).toBeUndefined();
    expect(hub.attention.map((i) => i.key)).toContain("glucose_fast_sugar_wording_not_shipped");
    expect(hub.attention.find((i) => i.key === "glucose_fast_sugar_wording_not_shipped")?.href.startsWith("/clinician/")).toBe(true);
  });
  it("is absent once signed, and a failed read is named instead of going quiet", async () => {
    readSignoffQueue.mockResolvedValue(empty);
    expect((await readCmoSigningHub(supabase)).items.find((i) => i.key === "glucose_fast_sugar_wording")).toBeUndefined();
    readPendingFastSugarWordingSignoff.mockResolvedValue({ waiting: false, signed: false, failed: true });
    expect(await readCmoSigningHub(supabase)).toMatchObject({ failed: true, failedSources: ["the fast-sugar wording signature"] });
  });
});

describe("readCmoSigningHub: task layer and paging delivery configurations (OQ-451)", () => {
  const empty = { items: [] as SignoffQueueItem[], failedSources: [] as string[], settledConfigs: [] as SettledConfig[] };
  it("lists a line for each, under /clinician, so the banner counts both", async () => {
    readSignoffQueue.mockResolvedValue(empty);
    readPendingQueuePagingConfigSignoff.mockResolvedValue({ ...noQueuePaging, taskLayer: { kind: "accept_in_force", version: 1 }, pagingVersion: 2 });
    const hub = await readCmoSigningHub(supabase);
    const task = hub.items.find((i) => i.key === TASK_LAYER_CONFIG_ITEM_KEY);
    const paging = hub.items.find((i) => i.key === PAGING_DELIVERY_CONFIG_ITEM_KEY);
    expect(task?.count).toBe(1);
    expect(task?.detail).toMatch(/never been signed/);
    expect(paging?.count).toBe(1);
    expect(paging?.detail).toMatch(/cannot be activated until every on-call clinician/);
    expect(task?.href.startsWith("/clinician/") && paging?.href.startsWith("/clinician/")).toBe(true);
  });
  it("words a newer draft differently from the version in force", async () => {
    readSignoffQueue.mockResolvedValue(empty);
    readPendingQueuePagingConfigSignoff.mockResolvedValue({ ...noQueuePaging, taskLayer: { kind: "sign_new", version: 2 } });
    const line = (await readCmoSigningHub(supabase)).items.find((i) => i.key === TASK_LAYER_CONFIG_ITEM_KEY);
    expect(line?.title).toMatch(/sign a new version/);
  });
  it("adds no line when nothing waits, and names a failed read rather than reading as all clear", async () => {
    readSignoffQueue.mockResolvedValue(empty);
    const clear = await readCmoSigningHub(supabase);
    expect(clear.items.some((i) => i.key === TASK_LAYER_CONFIG_ITEM_KEY || i.key === PAGING_DELIVERY_CONFIG_ITEM_KEY)).toBe(false);
    readPendingQueuePagingConfigSignoff.mockResolvedValue({ ...noQueuePaging, failed: true });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.failed).toBe(true);
    expect(hub.failedSources).toContain("the task layer and paging delivery configurations");
  });
});

describe("readCmoSigningHub: personal alert thresholds (N-overrides)", () => {
  const empty = { items: [] as SignoffQueueItem[], failedSources: [] as string[], settledConfigs: [] as SettledConfig[] };
  it("lists a signature line under /clinician while the policy waits, and nothing once it is signed", async () => {
    readSignoffQueue.mockResolvedValue(empty);
    readThresholdHubState.mockResolvedValue({ policyWaiting: true, policyVersion: 1, policyId: "p", policyActive: false, active: 0, reviewsOverdue: 0, reviewTaskFailures: 0, failed: false });
    const line = (await readCmoSigningHub(supabase)).items.find((i) => i.key === THRESHOLD_POLICY_ITEM_KEY);
    expect(line).toMatchObject({ severity: "draft_pending", count: 1 });
    expect(line?.href.startsWith("/clinician/")).toBe(true);
    expect(line?.detail).toMatch(/never lower a red/);
    readThresholdHubState.mockResolvedValue({ policyWaiting: false, policyVersion: null, policyId: null, policyActive: true, active: 2, reviewsOverdue: 0, reviewTaskFailures: 0, failed: false });
    expect((await readCmoSigningHub(supabase)).items.find((i) => i.key === THRESHOLD_POLICY_ITEM_KEY)).toBeUndefined();
  });
  it("an overdue monthly review is an attention line, never counted as a signature", async () => {
    readSignoffQueue.mockResolvedValue(empty);
    readThresholdHubState.mockResolvedValue({ policyWaiting: false, policyVersion: null, policyId: null, policyActive: true, active: 3, reviewsOverdue: 2, reviewTaskFailures: 0, failed: false });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.attention.find((i) => i.key === "threshold_override_reviews")).toMatchObject({ count: 2, href: "/clinician/threshold-overrides" });
    expect(hub.items.find((i) => i.key === "threshold_override_reviews")).toBeUndefined();
    readThresholdHubState.mockResolvedValue({ policyWaiting: false, policyVersion: null, policyId: null, policyActive: true, active: 1, reviewsOverdue: 1, reviewTaskFailures: 0, failed: false });
    expect((await readCmoSigningHub(supabase)).attention[0]?.detail).toMatch(/1 personal alert threshold is past/);
  });
  it("names an unreadable source instead of looking like an all-clear", async () => {
    readSignoffQueue.mockResolvedValue(empty);
    readThresholdHubState.mockResolvedValue({ policyWaiting: false, policyVersion: null, policyId: null, policyActive: false, active: 0, reviewsOverdue: 0, reviewTaskFailures: 0, failed: true });
    expect(await readCmoSigningHub(supabase)).toMatchObject({ failed: true, failedSources: ["personal alert thresholds"] });
  });
});

describe("readCmoSigningHub: ops desk checklist gate", () => {
  const empty = { items: [] as SignoffQueueItem[], failedSources: [] as string[], settledConfigs: [] as SettledConfig[] };
  it("adds a line under /clinician only when a draft waits, and signs nothing", async () => {
    readSignoffQueue.mockResolvedValue(empty);
    expect((await readCmoSigningHub(supabase)).items.find((i) => i.key === OPS_DESK_CONFIG_ITEM_KEY)).toBeUndefined();
    readPendingCapacityConfigSignoff.mockResolvedValue({ ...noCapacityConfig, opsDeskVersion: 2 });
    const line = (await readCmoSigningHub(supabase)).items.find((i) => i.key === OPS_DESK_CONFIG_ITEM_KEY);
    expect(line?.count).toBe(1);
    expect(line?.href.startsWith("/clinician/")).toBe(true);
    expect(line?.detail).toMatch(/stays off until you sign/);
  });
});

describe("readCmoSigningHub: check-ins after a consultation", () => {
  const empty = { items: [] as SignoffQueueItem[], failedSources: [] as string[], settledConfigs: [] as SettledConfig[] };
  it("adds one line, under /clinician, for an unsigned draft", async () => {
    readSignoffQueue.mockResolvedValue(empty);
    readPendingPostCheckinSignoff.mockResolvedValue({ version: 1, rules: null, failed: false });
    const line = (await readCmoSigningHub(supabase)).items.find((i) => i.key === POST_CHECKIN_ITEM_KEY);
    expect(line?.count).toBe(1);
    expect(line?.href.startsWith("/clinician/")).toBe(true);
    expect(line?.detail).toMatch(/No check-in is sent until you sign/);
  });
  it("adds no line when nothing waits, and names a failed read", async () => {
    readSignoffQueue.mockResolvedValue(empty);
    expect((await readCmoSigningHub(supabase)).items.find((i) => i.key === POST_CHECKIN_ITEM_KEY)).toBeUndefined();
    readPendingPostCheckinSignoff.mockResolvedValue({ version: null, rules: null, failed: true });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.failed).toBe(true);
    expect(hub.failedSources).toContain("the check-in configuration");
  });
});

describe("readCmoSigningHub: mental wellbeing (S56b)", () => {
  const empty = { items: [] as SignoffQueueItem[], failedSources: [] as string[], settledConfigs: [] as SettledConfig[] };
  it("adds one line, under /clinician, counting the rules draft and every unmet attestation, and signs nothing", async () => {
    readSignoffQueue.mockResolvedValue(empty);
    readPendingMentalWellbeingSignoff.mockResolvedValue({ worklistVersion: 1, worklistRules: null, attestations: [{}, {}, {}], failed: false });
    const line = (await readCmoSigningHub(supabase)).items.find((i) => i.key === MENTAL_WELLBEING_ITEM_KEY);
    expect(line?.count).toBe(4);
    expect(line?.href.startsWith("/clinician/")).toBe(true);
    expect(line?.detail).toMatch(/Nothing is shown to a patient or a clinician until you/);
  });
  it("adds no line when nothing waits, and a failed read is named, never an all-clear", async () => {
    readSignoffQueue.mockResolvedValue(empty);
    expect((await readCmoSigningHub(supabase)).items.find((i) => i.key === MENTAL_WELLBEING_ITEM_KEY)).toBeUndefined();
    readPendingMentalWellbeingSignoff.mockResolvedValue({ worklistVersion: null, worklistRules: null, attestations: [], failed: true });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.failed).toBe(true);
    expect(hub.failedSources).toContain("the mental wellbeing sign-offs");
  });
});

describe("readCmoSigningHub: capacity, rest and fire drills", () => {
  const empty = { items: [] as SignoffQueueItem[], failedSources: [] as string[], settledConfigs: [] as SettledConfig[] };
  it("adds one line, under /clinician, that counts both drafts and signs nothing", async () => {
    readSignoffQueue.mockResolvedValue(empty);
    readPendingCapacityConfigSignoff.mockResolvedValue({ capacityVersion: 2, capacityRules: null, leadVersion: 2, leadCapDraft: 40, leadCapInForce: 60, failed: false });
    const hub = await readCmoSigningHub(supabase);
    const line = hub.items.find((i) => i.key === CAPACITY_CONFIG_ITEM_KEY);
    expect(line?.count).toBe(2);
    expect(line?.href.startsWith("/clinician/")).toBe(true);
    expect(line?.detail).toMatch(/stay off until you sign/);
  });
  it("adds no line when nothing waits, and names a failed read", async () => {
    readSignoffQueue.mockResolvedValue(empty);
    expect((await readCmoSigningHub(supabase)).items.find((i) => i.key === CAPACITY_CONFIG_ITEM_KEY)).toBeUndefined();
    readPendingCapacityConfigSignoff.mockResolvedValue({ capacityVersion: null, capacityRules: null, leadVersion: null, leadCapDraft: null, leadCapInForce: null, failed: true });
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

describe("readCmoSigningHub: pulse, oxygen and temperature triage rules", () => {
  it("lists the draft vitals rule set and its task type as two lines under /clinician, the task type first", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readPendingVitalsTriageSignoff.mockResolvedValue({ pending: true, version: 1, approvedVersion: null, note: null, failed: false });
    readPendingVitalsTaskTypeSignoff.mockResolvedValue({ waiting: true, failed: false });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.items.map((i) => i.key)).toEqual(["vitals_task_type", "vitals_triage_rule_set"]);
    expect(hub.items[1]).toMatchObject({ href: "/clinician/vitals-triage-rules", severity: "draft_pending" });
    expect(hub.items[1]?.detail).toMatch(/shadow only/);
    expect(hub.items[0]?.href.startsWith("/clinician")).toBe(true);
  });
  it("says which version stays in force once one is approved", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readPendingVitalsTriageSignoff.mockResolvedValue({ pending: true, version: 2, approvedVersion: 1, note: null, failed: false });
    expect((await readCmoSigningHub(supabase)).items[0]?.detail).toMatch(/Version 1 stays in force/);
  });
  it("names an unreadable source instead of going quiet", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readPendingVitalsTriageSignoff.mockResolvedValue({ pending: false, version: null, approvedVersion: null, note: null, failed: true });
    readPendingVitalsTaskTypeSignoff.mockResolvedValue({ waiting: false, failed: true });
    expect(await readCmoSigningHub(supabase)).toMatchObject({ failed: true, failedSources: ["the pulse, oxygen and temperature triage rules", "the amber vitals review task type"] });
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

describe("unified red-event paging line (S19d)", () => {
  it("lists the switch-on line while a version is waiting and says it is off", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readUnifiedRedPagingState.mockResolvedValue({ waitingVersion: 1, liveVersion: null, failed: false });
    const hub = await readCmoSigningHub(supabase);
    const line = hub.items.find((i) => i.key === "unified_red_paging");
    expect(line?.title).toMatch(/off/i);
    expect(line?.detail).toMatch(/test pack/i);
  });
  it("keeps a switch-off line while it is on", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readUnifiedRedPagingState.mockResolvedValue({ waitingVersion: null, liveVersion: 1, failed: false });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.items.find((i) => i.key === "unified_red_paging")?.title).toMatch(/ON/);
  });
  it("shows no line when there is nothing, and reports a failed read instead of an all-clear", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    expect((await readCmoSigningHub(supabase)).items.find((i) => i.key === "unified_red_paging")).toBeUndefined();
    readUnifiedRedPagingState.mockResolvedValue({ waitingVersion: null, liveVersion: null, failed: true });
    expect(await readCmoSigningHub(supabase)).toMatchObject({ failed: true, failedSources: ["unified red-event paging"] });
  });
});

describe("legacy notice retirement line (S19f)", () => {
  it("lists a line while versions wait, says it is off and points at the parallel run first", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readLegacyNoticeRetirementState.mockResolvedValue({ liveVersion: null, waiting: [{ version: 1 }], measurement: [], failed: false });
    const line = (await readCmoSigningHub(supabase)).items.find((i) => i.key === "legacy_notice_retirement");
    expect(line?.title).toMatch(/off/i);
    expect(line?.detail).toMatch(/parallel run/i);
  });
  it("keeps a switch-off line while a version is live", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readLegacyNoticeRetirementState.mockResolvedValue({ liveVersion: { version: 2 }, waiting: [], measurement: [], failed: false });
    expect((await readCmoSigningHub(supabase)).items.find((i) => i.key === "legacy_notice_retirement")?.title).toMatch(/ON/);
  });
  it("shows no line when there is nothing, and reports a failed read instead of an all-clear", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    expect((await readCmoSigningHub(supabase)).items.find((i) => i.key === "legacy_notice_retirement")).toBeUndefined();
    readLegacyNoticeRetirementState.mockResolvedValue({ liveVersion: null, waiting: [], measurement: [], failed: true });
    expect(await readCmoSigningHub(supabase)).toMatchObject({ failed: true, failedSources: ["the older clinician-message retirement"] });
  });
});

describe("readCmoSigningHub: recommended blood pressure monitors (S07y)", () => {
  it("adds one line, linking into /clinician, only when a monitor waits for review", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    readPendingBpDeviceReview.mockResolvedValue({ waiting: 2, failed: false });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.items).toHaveLength(1);
    expect(hub.items[0]).toMatchObject({ key: "bp_device_review", count: 2, href: "/clinician/recommended-devices" });
  });
  it("says nothing when none waits, and names the source when it cannot be read", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    expect((await readCmoSigningHub(supabase)).items).toHaveLength(0);
    readPendingBpDeviceReview.mockResolvedValue({ waiting: 0, failed: true });
    expect(await readCmoSigningHub(supabase)).toMatchObject({ failed: true, failedSources: ["the recommended blood pressure monitors"] });
  });
});
