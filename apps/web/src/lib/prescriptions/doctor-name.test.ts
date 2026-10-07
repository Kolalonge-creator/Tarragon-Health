import { stripDoctorTitle } from "./doctor-name";

describe("stripDoctorTitle", () => {
  it.each([
    ["Dr Isaac Longe", "Isaac Longe"],
    ["Dr. Isaac Longe", "Isaac Longe"],
    ["DR  isaac longe", "isaac longe"],
    ["Doctor Ada Obi", "Ada Obi"],
    ["Kola Longe", "Kola Longe"],
    ["  Ada   Obi ", "Ada Obi"],
  ])("%j becomes %j", (input, expected) => {
    expect(stripDoctorTitle(input)).toBe(expected);
  });
  it("does not eat a surname that merely starts with the letters", () => {
    expect(stripDoctorTitle("Drummond Okafor")).toBe("Drummond Okafor");
    expect(stripDoctorTitle("Drake Eze")).toBe("Drake Eze");
  });
});
