import { describe, expect, it } from "@jest/globals";
import { checkVitalReading } from "./reading-check";

describe("checkVitalReading — blood_pressure", () => {
  it("passes a normal reading", () => {
    expect(checkVitalReading({ vitalType: "blood_pressure", systolic: 120, diastolic: 80 }).status).toBe("ok");
  });

  it("flags an unusually high systolic", () => {
    const result = checkVitalReading({ vitalType: "blood_pressure", systolic: 195, diastolic: 90 });
    expect(result.status).toBe("recheck");
    if (result.status === "recheck") {
      expect(result.message).toContain("higher");
      expect(result.tips.length).toBeGreaterThan(0);
    }
  });

  it("flags an unusually low systolic", () => {
    expect(checkVitalReading({ vitalType: "blood_pressure", systolic: 82, diastolic: 60 }).status).toBe("recheck");
  });

  it("flags a swapped systolic/diastolic pair", () => {
    const result = checkVitalReading({ vitalType: "blood_pressure", systolic: 80, diastolic: 120 });
    expect(result.status).toBe("recheck");
    if (result.status === "recheck") {
      expect(result.message).toContain("swapped");
    }
  });

  it("flags systolic equal to diastolic", () => {
    expect(checkVitalReading({ vitalType: "blood_pressure", systolic: 90, diastolic: 90 }).status).toBe("recheck");
  });
});

describe("checkVitalReading — glucose", () => {
  it("passes a normal mmol/L reading", () => {
    expect(checkVitalReading({ vitalType: "glucose", value: 5.6, unit: "mmol_l" }).status).toBe("ok");
  });

  it("flags a very high mmol/L reading", () => {
    const result = checkVitalReading({ vitalType: "glucose", value: 25, unit: "mmol_l" });
    expect(result.status).toBe("recheck");
    if (result.status === "recheck") expect(result.message).toContain("mmol/L");
  });

  it("passes a normal mg/dL reading", () => {
    expect(checkVitalReading({ vitalType: "glucose", value: 100, unit: "mg_dl" }).status).toBe("ok");
  });

  it("flags a very low mg/dL reading", () => {
    expect(checkVitalReading({ vitalType: "glucose", value: 50, unit: "mg_dl" }).status).toBe("recheck");
  });
});

describe("checkVitalReading — weight / pulse / temperature / spo2", () => {
  it("passes a normal weight", () => {
    expect(checkVitalReading({ vitalType: "weight", weightKg: 72 }).status).toBe("ok");
  });

  it("flags an unusually high weight (possible lb/kg mix-up)", () => {
    expect(checkVitalReading({ vitalType: "weight", weightKg: 210 }).status).toBe("recheck");
  });

  it("passes a normal pulse", () => {
    expect(checkVitalReading({ vitalType: "pulse", pulseBpm: 72 }).status).toBe("ok");
  });

  it("flags a very fast pulse", () => {
    expect(checkVitalReading({ vitalType: "pulse", pulseBpm: 150 }).status).toBe("recheck");
  });

  it("passes a normal temperature", () => {
    expect(checkVitalReading({ vitalType: "temperature", temperatureC: 37 }).status).toBe("ok");
  });

  it("flags a very high temperature", () => {
    expect(checkVitalReading({ vitalType: "temperature", temperatureC: 40.5 }).status).toBe("recheck");
  });

  it("passes a normal SpO2", () => {
    expect(checkVitalReading({ vitalType: "spo2", spo2Pct: 98 }).status).toBe("ok");
  });

  it("flags a low SpO2", () => {
    expect(checkVitalReading({ vitalType: "spo2", spo2Pct: 88 }).status).toBe("recheck");
  });
});
