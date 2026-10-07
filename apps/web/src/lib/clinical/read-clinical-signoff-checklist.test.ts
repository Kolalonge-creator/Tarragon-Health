import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

const readGovernedConfigSignoff = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();

jest.mock("@/lib/queries/governed-config-signoff", () => ({
  GOVERNED_CONFIG_TABLES: [{ table: "alert_rules" }, { table: "escalation_slas" }],
  readGovernedConfigSignoff: (...args: unknown[]) => readGovernedConfigSignoff(...args),
}));

import { readClinicalSignoffChecklist } from "./read-clinical-signoff-checklist";

type Chain = {
  select: () => Chain;
  in: () => Chain;
  eq: () => Chain;
  neq: () => Chain;
  not: () => Chain;
  order: () => Chain;
  then: Promise<{ data: unknown[]; error: null }>["then"];
};

function client(): SupabaseClient<Database> {
  return {
    from: () => {
      const chain: Chain = {
        select: () => chain,
        in: () => chain,
        eq: () => chain,
        neq: () => chain,
        not: () => chain,
        order: () => chain,
        then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
      };
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
}

beforeEach(() => {
  readGovernedConfigSignoff.mockReset();
  readGovernedConfigSignoff.mockResolvedValue([]);
});

describe("readClinicalSignoffChecklist config reads", () => {
  it("reads the governed configs by default, as the admin page needs", async () => {
    await readClinicalSignoffChecklist(client(), "/admin/settings");
    expect(readGovernedConfigSignoff).toHaveBeenCalledTimes(1);
  });

  it("skips them when the caller has already read those tables", async () => {
    const data = await readClinicalSignoffChecklist(client(), "/clinician", { withConfigs: false });
    expect(readGovernedConfigSignoff).not.toHaveBeenCalled();
    expect(data.loadFailed).toBe(false);
    expect(data.totalConfigCount).toBe(2);
  });
});
