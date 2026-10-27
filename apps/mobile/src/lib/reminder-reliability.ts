import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { parseSelfTest, permissionState, type PermissionState, type SelfTestRecord } from "@tarragon/medicines";

/**
 * The phone side of reminder reliability (item 4): what is kept on the phone, and the permission read. Everything works offline: the
 * self-test is a local notification, its result is stored on the phone only, and nothing here is sent anywhere. Never throws.
 * Not run on a real Android or iPhone yet.
 */
const SELF_TEST_KEY = "reliability:self-test";
const FIRST_RUN_KEY = "reliability:first-run-seen";

export async function readSelfTest(): Promise<SelfTestRecord | null> {
  try {
    return parseSelfTest(await AsyncStorage.getItem(SELF_TEST_KEY));
  } catch {
    return null;
  }
}

export async function writeSelfTest(rec: SelfTestRecord): Promise<void> {
  try {
    await AsyncStorage.setItem(SELF_TEST_KEY, JSON.stringify(rec));
  } catch {
    // The test still ran; only the saved answer is lost.
  }
}

/** True the first time only: the card opens by itself once, then stays folded until the person opens it. */
export async function consumeFirstRun(): Promise<boolean> {
  try {
    if ((await AsyncStorage.getItem(FIRST_RUN_KEY)) !== null) return false;
    await AsyncStorage.setItem(FIRST_RUN_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

/** The notification permission, including iPhone's provisional state. Never asks. "undetermined" when it cannot be read. */
export async function readPermissionState(): Promise<PermissionState> {
  try {
    const p = await Notifications.getPermissionsAsync();
    const iosStatus = Platform.OS === "ios" ? (p.ios?.status ?? null) : null;
    return permissionState({ granted: p.granted, canAskAgain: p.canAskAgain, iosStatus });
  } catch {
    return "undetermined";
  }
}
