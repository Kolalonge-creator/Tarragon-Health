/**
 * Registers the in-memory stand-ins for every native module this package's
 * pure logic touches, and resets them between tests. Kept here rather than a
 * per-file jest.mock so a module that starts importing one of these can't
 * silently reach a native bridge that doesn't exist under Jest — see
 * src/test/mocks/ for what each one does and why.
 */
import * as asyncStorageMock from "./src/test/mocks/async-storage";
import * as bleMock from "./src/test/mocks/react-native-ble-plx";
import * as cryptoMock from "./src/test/mocks/expo-crypto";
import * as secureStoreMock from "./src/test/mocks/expo-secure-store";
import * as sqliteMock from "./src/test/mocks/expo-sqlite";

jest.mock("expo-secure-store", () => jest.requireActual("./src/test/mocks/expo-secure-store"));
jest.mock("expo-crypto", () => jest.requireActual("./src/test/mocks/expo-crypto"));
jest.mock("expo-sqlite", () => jest.requireActual("./src/test/mocks/expo-sqlite"));
jest.mock("react-native-ble-plx", () =>
  jest.requireActual("./src/test/mocks/react-native-ble-plx")
);
jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual("./src/test/mocks/async-storage")
);

/**
 * sync-diagnostics.ts mirrors every recorded failure to console.warn under
 * __DEV__, which Jest sets. Tests assert on the ring buffer itself
 * (getRecentSyncDiagnostics), so the mirrored output is pure noise that
 * would bury a real failure in the run log.
 */
beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  secureStoreMock.__reset();
  cryptoMock.__reset();
  sqliteMock.__reset();
  asyncStorageMock.__reset();
  bleMock.__reset();
});
