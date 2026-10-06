import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import type { SignoffQueueItem } from "./signoff-queue";
import type { PendingAiGovernanceSignoff } from "./pending-ai-governance-signoff";

const getSignoffQueue = jest.fn<(...args: unknown[]) => Promise<SignoffQueueItem[]>>();
const readPendingAiGovernanceSignoff = jest.fn<(...args: unknown[]) => Promise<PendingAiGovernanceSignoff>>();

jest.mock("@/lib/queries/signoff-queue", () => ({
  getSignoffQueue: (...args: unknown[]) => getSignoffQueue(...args),
  SEVERITY_RANK: { live_unsigned: 0, draft_pending: 1, setup_needed: 2 },
}));
jest.mock("@/lib/queries/pending-ai-governance-signoff", () => ({
  readPendingAiGovernanceSignoff: (...args: unknown[]) => readPendingAiGovernanceSignoff(...args),
}));

import { CLINICAL_RULES_ITEM_KEY, readCmoSigningHub } from "./cmo-signing-hub";

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
  getSignoffQueue.mockReset();
  readPendingAiGovernanceSignoff.mockReset();
  readPendingAiGovernanceSignoff.mockResolvedValue(noAi);
});

describe("readCmoSigningHub", () => {
  it("asks the queue for the Chief Medical Officer's own links", async () => {
    getSignoffQueue.mockResolvedValue([]);
    await readCmoSigningHub(supabase);
    expect(getSignoffQueue).toHaveBeenCalledWith(supabase, "/clinician");
  });

  it("is an all-clear only when everything was read and nothing is outstanding", async () => {
    getSignoffQueue.mockResolvedValue([]);
    expect(await readCmoSigningHub(supabase)).toEqual({ items: [], failed: false });
  });

  it("merges rules needing setup and rules ready to sign into one line with the summed count", async () => {
    getSignoffQueue.mockResolvedValue([
      item("clinical_rules_needs_setup", "setup_needed", 2),
      item("clinical_rules_ready", "draft_pending", 3),
    ]);
    const hub = await readCmoSigningHub(supabase);
    expect(hub.items).toHaveLength(1);
    expect(hub.items[0]).toMatchObject({ key: CLINICAL_RULES_ITEM_KEY, count: 5 });
  });

  it("adds one AI governance line naming both kinds of pending work", async () => {
    getSignoffQueue.mockResolvedValue([]);
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
    getSignoffQueue.mockResolvedValue([item("clinical_rules_ready", "draft_pending", 1), item("lpe_content_blocks", "live_unsigned", 2)]);
    const hub = await readCmoSigningHub(supabase);
    expect(hub.items.map((i) => i.severity)).toEqual(["live_unsigned", "draft_pending"]);
  });

  it("reports failure, never an all-clear, when the queue cannot be read, and still shows AI work", async () => {
    getSignoffQueue.mockRejectedValue(new Error("db down"));
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
    getSignoffQueue.mockResolvedValue([item("lpe_content_blocks", "live_unsigned", 1)]);
    readPendingAiGovernanceSignoff.mockResolvedValue({ ...noAi, failed: true });
    const hub = await readCmoSigningHub(supabase);
    expect(hub.failed).toBe(true);
    expect(hub.items).toHaveLength(1);
  });
});
