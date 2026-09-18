/**
 * ClinicianVaccinationsPage used to mint each pending certificate's signed
 * URL with its own Storage API round trip (Promise.all(records.map(async
 * (record) => ... createSignedUrl))) — a real N+1 in the care-team
 * verification worklist: an org with 20 certificates awaiting review fired
 * 20 separate signed-URL requests on every load of this page. This proves
 * the fix: one batched createSignedUrls call regardless of queue size, with
 * each record still getting the right URL even when the storage API
 * returns them out of request order.
 */

const createSignedUrls = jest.fn();

jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    storage: {
      from: () => ({
        createSignedUrls,
      }),
    },
  }),
}));

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(),
  getCurrentUser: jest.fn().mockResolvedValue({ id: "clinician-1" }),
}));

jest.mock("./verification-list", () => ({
  VaccinationVerificationList: () => null,
}));

import { createClient } from "@/lib/supabase/server";
import ClinicianVaccinationsPage from "./page";

// The page returns a JSX element tree without rendering it (calling an async
// Server Component function directly builds elements, it doesn't invoke
// child components) — so pull the VaccinationVerificationList element's
// `items` prop straight out of that tree instead of relying on a mock to be
// called.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findItemsProp(element: any): any[] | undefined {
  if (!element || typeof element !== "object") return undefined;
  if (element.props?.items) return element.props.items;
  const children = element.props?.children;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    const found = findItemsProp(child);
    if (found) return found;
  }
  return undefined;
}

function record(id: string, path: string | null) {
  return {
    id,
    dose_number: 1,
    date_administered: "2026-01-01",
    provider: "Test Clinic",
    physical_certificate_path: path,
    created_at: "2026-09-01T00:00:00Z",
    profiles: { full_name: "Test Patient", patient_number: "TP-1" },
    vaccination_catalog: { name: "MMR" },
  };
}

describe("ClinicianVaccinationsPage — signed URL batching", () => {
  beforeEach(() => {
    createSignedUrls.mockReset();
  });

  it("mints every pending certificate's signed URL in a single Storage call, not one per record", async () => {
    const records = [record("rec-1", "certs/a.pdf"), record("rec-2", "certs/b.pdf"), record("rec-3", null)];
    (createClient as jest.Mock).mockResolvedValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: records, error: null }),
          }),
        }),
      }),
    });
    // Returned out of request order, to prove lookup is by path, not index.
    createSignedUrls.mockResolvedValue({
      data: [
        { path: "certs/b.pdf", signedUrl: "https://signed/b" },
        { path: "certs/a.pdf", signedUrl: "https://signed/a" },
      ],
      error: null,
    });

    const element = await ClinicianVaccinationsPage();
    const items = findItemsProp(element) ?? [];

    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(["certs/a.pdf", "certs/b.pdf"], 600);
    expect(items.find((i) => i.id === "rec-1")?.signedUrl).toBe("https://signed/a");
    expect(items.find((i) => i.id === "rec-2")?.signedUrl).toBe("https://signed/b");
    // A record with no uploaded file never enters the batch and stays null.
    expect(items.find((i) => i.id === "rec-3")?.signedUrl).toBeNull();
  });

  it("never calls the Storage API when the verification queue is empty", async () => {
    (createClient as jest.Mock).mockResolvedValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    });

    await ClinicianVaccinationsPage();

    expect(createSignedUrls).not.toHaveBeenCalled();
  });
});
