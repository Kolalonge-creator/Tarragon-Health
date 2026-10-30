/**
 * The truncation clamp in healthkit.ts assumes every capped query returns the
 * OLDEST rows first: when a page comes back full, the cursor is clamped to
 * the newest sample in that page, so the rest of the window is fetched on the
 * next sync. The native default is newest-first, so a reader that leaves
 * `ascending` out returns the newest 200 rows, the clamp then treats the
 * overall newest reading as the held-back point, and the older rows are never
 * fetched. For blood pressure that is silent loss of readings that should
 * reach the care team's escalation rules.
 *
 * The native module is faked: HealthKit does not run in Jest or Expo Go, and
 * none of this has been run on a real device (CLAUDE.md, Device & Wearable
 * Integration).
 */
const mockQueryCorrelationSamples = jest.fn();
const mockQueryQuantitySamples = jest.fn();

jest.mock(
  "@kingstinct/react-native-healthkit",
  () => ({
    isHealthDataAvailable: jest.fn().mockResolvedValue(true),
    queryCorrelationSamples: (...args: unknown[]) => mockQueryCorrelationSamples(...args),
    queryQuantitySamples: (...args: unknown[]) => mockQueryQuantitySamples(...args),
    queryStatisticsCollectionForQuantity: jest.fn().mockResolvedValue([]),
  }),
  { virtual: true }
);

import { readHealthSamples } from "./healthkit";

describe("HealthKit reads that are capped by a limit", () => {
  beforeEach(() => {
    mockQueryCorrelationSamples.mockResolvedValue([]);
    mockQueryQuantitySamples.mockResolvedValue([]);
  });

  it("asks for blood pressure oldest first, so a truncated page cannot skip older readings", async () => {
    await readHealthSamples(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-30T00:00:00Z"));

    expect(mockQueryCorrelationSamples).toHaveBeenCalledTimes(1);
    const [identifier, options] = mockQueryCorrelationSamples.mock.calls[0];
    expect(identifier).toBe("HKCorrelationTypeIdentifierBloodPressure");
    expect(options).toMatchObject({ limit: 200, ascending: true });
  });

  it("asks for every quantity type oldest first as well", async () => {
    await readHealthSamples(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-30T00:00:00Z"));

    expect(mockQueryQuantitySamples.mock.calls.length).toBeGreaterThan(0);
    for (const [identifier, options] of mockQueryQuantitySamples.mock.calls) {
      expect({ identifier, ascending: options.ascending }).toEqual({ identifier, ascending: true });
    }
  });
});
