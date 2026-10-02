/**
 * An automatic health sync (the background task, the live change subscription
 * at app launch) must never raise the iOS Health sheet or the Health Connect
 * screen on its own. Only an explicit Connect or Sync press may ask. Before this
 * rule, every signed-in iPhone was asked for Health access at each launch,
 * including patients who never connected Apple Health.
 */
import { syncAppleHealth, syncHealthConnect } from "./health-sync";
import { requestHealthKitPermissions } from "./healthkit";
import { requestHealthConnectPermissions } from "./health-connect";

jest.mock("./api", () => ({
  getHealthSyncCursor: jest.fn().mockResolvedValue(null),
  postHealthSamples: jest.fn(),
}));
jest.mock("./healthkit", () => ({
  INITIAL_WINDOW_DAYS: 30,
  isHealthKitAvailable: jest.fn().mockResolvedValue(true),
  readHealthSamples: jest.fn().mockResolvedValue({ samples: [], truncatedTypes: [] }),
  requestHealthKitPermissions: jest.fn().mockResolvedValue(true),
}));
jest.mock("./health-connect", () => ({
  INITIAL_WINDOW_DAYS: 30,
  isHealthConnectAvailable: jest.fn().mockResolvedValue(true),
  readHealthConnectSamples: jest.fn().mockResolvedValue({ samples: [], truncatedTypes: [] }),
  requestHealthConnectPermissions: jest.fn().mockResolvedValue(true),
}));
jest.mock("./offline-queue", () => ({
  enqueueHealthSamplesPage: jest.fn(),
  flushHealthSamplesQueue: jest.fn().mockResolvedValue({ flushedSamples: 0 }),
}));
jest.mock("./sync-diagnostics", () => ({
  countSyncErrorsSince: jest.fn().mockReturnValue(0),
  recordSyncError: jest.fn(),
}));

const askApple = requestHealthKitPermissions as jest.Mock;
const askAndroid = requestHealthConnectPermissions as jest.Mock;

describe("health sync permission prompts", () => {
  it("an explicit Apple Health sync asks for permission", async () => {
    await syncAppleHealth();
    expect(askApple).toHaveBeenCalledTimes(1);
  });

  it("an automatic Apple Health sync never asks", async () => {
    await syncAppleHealth({ promptForPermission: false });
    expect(askApple).not.toHaveBeenCalled();
  });

  it("an explicit Health Connect sync asks for permission", async () => {
    await syncHealthConnect();
    expect(askAndroid).toHaveBeenCalledTimes(1);
  });

  it("an automatic Health Connect sync never asks", async () => {
    await syncHealthConnect({ promptForPermission: false });
    expect(askAndroid).not.toHaveBeenCalled();
  });
});
