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
jest.mock("@/lib/queries/pending-ai-governance-signoff", () => ({
  readPendingAiGovernanceSignoff: (...args: unknown[]) => readPendingAiGovernanceSignoff(...args),
}));

import { CLINICAL_RULES_ITEM_KEY, PROTOCOL_DRAFTS_ITEM_KEY, readCmoSigningHub } from "./cmo-signing-hub";

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
});

describe("readCmoSigningHub", () => {
  it("asks the queue for the Chief Medical Officer's own links", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    await readCmoSigningHub(supabase);
    expect(readSignoffQueue).toHaveBeenCalledWith(supabase, "/clinician");
  });

  it("is an all-clear only when everything was read and nothing is outstanding", async () => {
    readSignoffQueue.mockResolvedValue({ items: [], failedSources: [], settledConfigs: [] });
    expect(await readCmoSigningHub(supabase)).toEqual({ items: [], failed: false, failedSources: [], settledConfigs: [] });
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
});
