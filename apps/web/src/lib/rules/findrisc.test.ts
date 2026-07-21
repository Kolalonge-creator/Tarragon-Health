import { scoreFindrisc, type FindriscInput } from "./findrisc";

const base: FindriscInput = {
  ageYears: 30,
  bmi: 22,
  waistCm: 80,
  sex: "male",
  physicallyActive: true,
  eatsVegetablesFruitDaily: true,
  onBpMedication: false,
  historyOfHighGlucose: false,
  familyHistory: "none",
};

describe("scoreFindrisc", () => {
  it("scores a low-risk young healthy adult as low", () => {
    const r = scoreFindrisc(base);
    expect(r.score).toBe(0);
    expect(r.band).toBe("low");
    expect(r.recommendBloodTest).toBe(false);
  });

  it("adds points per factor correctly", () => {
    const r = scoreFindrisc({
      ...base,
      ageYears: 60, // 3
      bmi: 32, // 3
      waistCm: 105, // 4 (male)
      physicallyActive: false, // 2
      eatsVegetablesFruitDaily: false, // 1
      onBpMedication: true, // 2
      historyOfHighGlucose: true, // 5
      familyHistory: "first_degree", // 5
    });
    expect(r.score).toBe(25);
    expect(r.band).toBe("very_high");
    expect(r.recommendBloodTest).toBe(true);
  });

  it("uses female waist thresholds", () => {
    const male = scoreFindrisc({ ...base, sex: "male", waistCm: 90 });
    const female = scoreFindrisc({ ...base, sex: "female", waistCm: 90 });
    expect(male.score).toBe(0); // <94 male → 0
    expect(female.score).toBe(4); // >88 female → 4
  });

  it("recommends a blood test at moderate risk (score >= 12)", () => {
    const r = scoreFindrisc({
      ...base,
      ageYears: 55, // 3
      bmi: 31, // 3
      waistCm: 103, // 4
      historyOfHighGlucose: false,
      familyHistory: "second_degree", // 3
    });
    expect(r.score).toBe(13);
    expect(r.band).toBe("moderate");
    expect(r.recommendBloodTest).toBe(true);
  });
});
