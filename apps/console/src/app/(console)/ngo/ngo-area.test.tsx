/**
 * The NGO partner area (S38f follow-up): the funded-cohort tools stay behind the ngo_funded_cohort module (now checked on the overview page,
 * not the layout), and the programme figures page does not depend on that module. Only an ngo_admin or the super admin gets into the area.
 */
const getCurrentProfile = jest.fn();
const isPlatformModuleEnabled = jest.fn();
const listFundingProgrammesForCaller = jest.fn();
const redirect = jest.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});

jest.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
jest.mock("next/link", () => ({ __esModule: true, default: () => null }));
jest.mock("@tarragon/auth/current-profile", () => ({ getCurrentProfile: () => getCurrentProfile() }));
jest.mock("@tarragon/auth/supabase/server", () => ({ createClient: jest.fn(async () => ({ rpc: jest.fn(async () => ({ data: null, error: { message: "x" } })) })) }));
jest.mock("@tarragon/staff-core/platform-modules", () => ({ isPlatformModuleEnabled: (k: string) => isPlatformModuleEnabled(k) }));
jest.mock("@tarragon/staff-core/ngo/funding-programmes", () => ({
  listFundingProgrammesForCaller: (...a: unknown[]) => listFundingProgrammesForCaller(...a),
  listFundingProgrammeInvitations: jest.fn(async () => []),
  getFundingProgrammeStats: jest.fn(async () => null),
}));
jest.mock("@tarragon/ui/components/dashboard-placeholder", () => ({ DashboardPlaceholder: function DashboardPlaceholder() { return null; } }));
jest.mock("@tarragon/ui/components/card", () => ({ Card: () => null, CardContent: () => null, CardDescription: () => null, CardHeader: () => null, CardTitle: () => null }));
jest.mock("./ngo-console", () => ({ NgoConsole: function NgoConsole() { return null; } }));

/* eslint-disable @typescript-eslint/no-require-imports */
const layout = () => require("./layout").default as (p: { children: React.ReactNode }) => Promise<unknown>;
const overview = () => require("./page").default as () => Promise<{ type: { name: string } }>;
const figures = () => require("./programme-figures/page").default as () => Promise<{ type: unknown; props: { children?: unknown } }>;

beforeEach(() => {
  jest.clearAllMocks();
  listFundingProgrammesForCaller.mockResolvedValue([]);
});

describe("NGO layout role gate", () => {
  it.each(["patient", "clinician", "corporate_admin", "hmo_admin"])("sends %s away", async (role) => {
    getCurrentProfile.mockResolvedValue({ role });
    await expect(layout()({ children: null })).rejects.toThrow("REDIRECT:/");
  });
  it("sends a signed-out caller to sign in", async () => {
    getCurrentProfile.mockResolvedValue(null);
    await expect(layout()({ children: null })).rejects.toThrow("REDIRECT:/login");
  });
  it.each(["ngo_admin", "admin"])("lets %s in", async (role) => {
    getCurrentProfile.mockResolvedValue({ role });
    await expect(layout()({ children: null })).resolves.toBeTruthy();
  });
});

describe("overview page module gate", () => {
  it("shows the placeholder and reads no programmes while the module is off", async () => {
    getCurrentProfile.mockResolvedValue({ role: "ngo_admin", full_name: "Ada" });
    isPlatformModuleEnabled.mockResolvedValue(false);
    const el = await overview()();
    expect(el.type.name).toBe("DashboardPlaceholder");
    expect(isPlatformModuleEnabled).toHaveBeenCalledWith("ngo_funded_cohort");
    expect(listFundingProgrammesForCaller).not.toHaveBeenCalled();
  });
  it("reads the programmes once the module is on", async () => {
    getCurrentProfile.mockResolvedValue({ role: "ngo_admin", full_name: "Ada" });
    isPlatformModuleEnabled.mockResolvedValue(true);
    await overview()();
    expect(listFundingProgrammesForCaller).toHaveBeenCalledTimes(1);
  });
});

describe("programme figures page", () => {
  it("does not depend on the funded-cohort module", async () => {
    getCurrentProfile.mockResolvedValue({ role: "ngo_admin" });
    isPlatformModuleEnabled.mockResolvedValue(false);
    await figures()();
    expect(isPlatformModuleEnabled).not.toHaveBeenCalled();
  });
  it("tells a super admin it is for partner staff instead of showing a fault", async () => {
    getCurrentProfile.mockResolvedValue({ role: "admin" });
    const el = await figures()();
    expect(JSON.stringify(el.props.children)).toContain("partner staff");
  });
});
