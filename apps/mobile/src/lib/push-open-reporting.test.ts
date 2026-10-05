import { describe, expect, it } from "@jest/globals";

jest.mock("expo-notifications", () => ({}));
jest.mock("expo-constants", () => ({ expoConfig: {} }));
jest.mock("@/lib/supabase", () => ({ supabase: {} }));
jest.mock("@/lib/notification-settings", () => ({ reportNotificationOpened: jest.fn() }));

import { notificationIdFromData } from "./push-registration";

describe("notificationIdFromData", () => {
  it("reads a notification id from a push's data", () => {
    expect(notificationIdFromData({ notificationId: "0f8fad5b-d9cb-469f-a165-70867728950e", url: "/" })).toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
  });
  it("ignores anything that is not an id", () => {
    for (const bad of [null, undefined, {}, { notificationId: 5 }, { notificationId: "not-an-id" }, "x"]) expect(notificationIdFromData(bad)).toBeNull();
  });
});
