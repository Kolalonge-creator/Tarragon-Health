/**
 * syncAppleHealth/syncHealthConnect are called from three places, and only
 * one of them — the Devices tab's own manual "Sync" button — is an
 * interactive, foreground-guaranteed moment where presenting a native
 * permission sheet is safe. The other two (background-sync.ts's periodic
 * OS-scheduled task, and its live HealthKit-change subscription) must never
 * trigger one: doing so raced against the app's own launch presentation and
 * wedged the root view controller mid-boot (the iOS Simulator blank-shell
 * bug, root-caused 2026-09-13). These tests pin the default-off contract so
 * a future edit can't silently reintroduce an unconditional permission
 * request into a call site that isn't the manual button.
 */
import { getHealthSyncCursor, postHealthSamples } from "./api";
import { isHealthKitAvailable, readHealthSamples, requestHealthKitPermissions } from "./healthkit";
import {
  isHealthConnectAvailable,
  readHealthConnectSamples,
  requestHealthConnectPermissions,
} from "./health-connect";
import { flushHealthSamplesQueue } from "./offline-queue";
import { syncAppleHealth, syncHealthConnect } from "./health-sync";

jest.mock("./api", () => ({
  getHealthSyncCursor: jest.fn(),
  postHealthSamples: jest.fn(),
}));
jest.mock("./healthkit", () => ({
  isHealthKitAvailable: jest.fn(),
  readHealthSamples: jest.fn(),
  requestHealthKitPermissions: jest.fn(),
  INITIAL_WINDOW_DAYS: 30,
}));
jest.mock("./health-connect", () => ({
  isHealthConnectAvailable: jest.fn(),
  readHealthConnectSamples: jest.fn(),
  requestHealthConnectPermissions: jest.fn(),
  INITIAL_WINDOW_DAYS: 30,
}));
jest.mock("./sync-diagnostics", () => ({
  countSyncErrorsSince: jest.fn(() => 0),
  recordSyncError: jest.fn(),
}));
jest.mock("./offline-queue", () => ({
  flushHealthSamplesQueue: jest.fn(),
  enqueueHealthSamplesPage: jest.fn(),
}));

const mockGetCursor = getHealthSyncCursor as jest.MockedFunction<typeof getHealthSyncCursor>;
const mockPost = postHealthSamples as jest.MockedFunction<typeof postHealthSamples>;
const mockFlushQueue = flushHealthSamplesQueue as jest.MockedFunction<typeof flushHealthSamplesQueue>;
const mockIsHKAvailable = isHealthKitAvailable as jest.MockedFunction<typeof isHealthKitAvailable>;
const mockReadHK = readHealthSamples as jest.MockedFunction<typeof readHealthSamples>;
const mockRequestHK = requestHealthKitPermissions as jest.MockedFunction<typeof requestHealthKitPermissions>;
const mockIsHCAvailable = isHealthConnectAvailable as jest.MockedFunction<typeof isHealthConnectAvailable>;
const mockReadHC = readHealthConnectSamples as jest.MockedFunction<typeof readHealthConnectSamples>;
const mockRequestHC = requestHealthConnectPermissions as jest.MockedFunction<
  typeof requestHealthConnectPermissions
>;

beforeEach(() => {
  jest.clearAllMocks();
  mockFlushQueue.mockResolvedValue({ flushedSamples: 0 } as never);
  mockGetCursor.mockResolvedValue({ cursor: null } as never);
  mockPost.mockResolvedValue({ ok: true, data: { vitals_inserted: 0, wearable_inserted: 0 } } as never);
});

describe("syncAppleHealth", () => {
  it("never requests permission when called with no options (background task / live subscription)", async () => {
    mockIsHKAvailable.mockResolvedValue(true);
    mockReadHK.mockResolvedValue({ samples: [], truncatedTypes: [] });

    await syncAppleHealth();

    expect(mockRequestHK).not.toHaveBeenCalled();
  });

  it("requests permission only when explicitly opted in (the manual Sync button)", async () => {
    mockIsHKAvailable.mockResolvedValue(true);
    mockReadHK.mockResolvedValue({ samples: [], truncatedTypes: [] });

    await syncAppleHealth({ requestPermissions: true });

    expect(mockRequestHK).toHaveBeenCalledTimes(1);
  });

  it("skips the permission request entirely when HealthKit itself is unavailable", async () => {
    mockIsHKAvailable.mockResolvedValue(false);

    const result = await syncAppleHealth({ requestPermissions: true });

    expect(result).toEqual({ status: "unavailable" });
    expect(mockRequestHK).not.toHaveBeenCalled();
  });
});

describe("syncHealthConnect", () => {
  it("never requests permission when called with no options (background task)", async () => {
    mockIsHCAvailable.mockResolvedValue(true);
    mockReadHC.mockResolvedValue({ samples: [], truncatedTypes: [] });

    await syncHealthConnect();

    expect(mockRequestHC).not.toHaveBeenCalled();
  });

  it("requests permission only when explicitly opted in (the manual Sync button)", async () => {
    mockIsHCAvailable.mockResolvedValue(true);
    mockReadHC.mockResolvedValue({ samples: [], truncatedTypes: [] });

    await syncHealthConnect({ requestPermissions: true });

    expect(mockRequestHC).toHaveBeenCalledTimes(1);
  });
});
