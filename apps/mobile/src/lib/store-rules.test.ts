import {
  bytesToHex,
  compareSummaries,
  eventCode,
  fnv1a,
  isWrongKeyError,
  keyPragma,
  leaseVerdict,
  rowsChecksum,
  storeFileName,
} from "./store-rules";

describe("store rules", () => {
  it("names the encrypted file by generation and never below 1", () => {
    expect(storeFileName(1)).toBe("tarragon-secure-1.db");
    expect(storeFileName(3)).toBe("tarragon-secure-3.db");
    expect(storeFileName(0)).toBe("tarragon-secure-1.db");
  });

  it("builds the raw-key pragma only from 64 lower-case hex characters", () => {
    const hex = "ab".repeat(32);
    expect(keyPragma(hex)).toBe(`PRAGMA key = "x'${hex}'";`);
    expect(() => keyPragma("short")).toThrow();
    expect(() => keyPragma("AB".repeat(32))).toThrow();
    expect(() => keyPragma(`${"ab".repeat(31)}'; drop table outbox; --`)).toThrow();
  });

  it("hex-encodes bytes with leading zeros", () => {
    expect(bytesToHex(new Uint8Array([0, 15, 255]))).toBe("000fff");
  });

  it("tells a wrong key from a disk or lock problem", () => {
    expect(isWrongKeyError(new Error("file is not a database"))).toBe(true);
    expect(isWrongKeyError(new Error("Error code 26: file is encrypted or is not a database"))).toBe(true);
    expect(isWrongKeyError(new Error("database is locked"))).toBe(false);
    expect(isWrongKeyError(new Error("disk I/O error"))).toBe(false);
  });

  it("checksums rows in order, sees a changed value, a missing row and a swapped order, and chains pages", () => {
    const a = [["1", "x", 1]];
    const b = [["2", "y", null]];
    const whole = rowsChecksum([...a, ...b]);
    expect(rowsChecksum(b, rowsChecksum(a))).toBe(whole);
    expect(rowsChecksum([...b, ...a])).not.toBe(whole);
    expect(rowsChecksum([...a])).not.toBe(whole);
    expect(rowsChecksum([["1", "x", 2], ...b])).not.toBe(whole);
    expect(rowsChecksum([["1", "x", "1"], ...b])).not.toBe(whole); // number 1 and text "1" differ
    expect(rowsChecksum([[new Uint8Array([1, 2])]])).not.toBe(rowsChecksum([[new Uint8Array([1, 3])]]));
    expect(fnv1a("abc")).toHaveLength(8);
  });

  it("reports every difference between the source and the copy", () => {
    const src = [
      { table: "outbox", count: 3, checksum: "aa" },
      { table: "drafts", count: 1, checksum: "bb" },
    ];
    expect(compareSummaries(src, src)).toEqual([]);
    expect(compareSummaries(src, [{ table: "outbox", count: 2, checksum: "aa" }, src[1]])).toEqual(["outbox: 3 rows in source, 2 in copy"]);
    expect(compareSummaries(src, [src[0], { table: "drafts", count: 1, checksum: "zz" }])).toEqual(["drafts: checksum differs"]);
    expect(compareSummaries(src, [src[0]])).toEqual(["drafts: missing in copy"]);
  });

  it("makes a short upper-case code from an id", () => {
    expect(eventCode("0a1b2c3d-1111-4222-8333-444455556666")).toBe("0A1B2C3D");
  });

  describe("key lease", () => {
    const now = new Date("2026-10-13T12:00:00Z");
    it("is ok before expiry and expired at and after it", () => {
      expect(leaseVerdict("2026-10-14T00:00:00Z", "2026-10-13T11:00:00Z", now)).toBe("ok");
      expect(leaseVerdict("2026-10-13T12:00:00Z", "2026-10-13T11:00:00Z", now)).toBe("expired");
      expect(leaseVerdict("2026-10-01T00:00:00Z", "2026-09-01T00:00:00Z", now)).toBe("expired");
    });
    it("is ok with no lease on record (a phone that has never checked in)", () => {
      expect(leaseVerdict(null, null, now)).toBe("ok");
    });
    it("reads a clock that moved backwards since the last check-in as ok, never as expired", () => {
      expect(leaseVerdict("2026-10-01T00:00:00Z", "2026-10-20T00:00:00Z", now)).toBe("ok");
    });
  });
});
