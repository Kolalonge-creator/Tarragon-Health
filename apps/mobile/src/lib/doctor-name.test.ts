import { formatDoctorName } from "./doctor-name";

describe("formatDoctorName", () => {
  it("prefixes a plain name with Dr.", () => {
    expect(formatDoctorName("Adaeze Okoye")).toBe("Dr. Adaeze Okoye");
  });

  it("does not double-prefix a name that already starts with Dr.", () => {
    expect(formatDoctorName("Dr. Adaeze Okoye")).toBe("Dr. Adaeze Okoye");
  });

  it("does not double-prefix a name that already starts with Prof.", () => {
    expect(formatDoctorName("Prof. Adaeze Okoye")).toBe("Prof. Adaeze Okoye");
  });

  it("does not double-prefix a name that already starts with Professor", () => {
    expect(formatDoctorName("Professor Adaeze Okoye")).toBe("Professor Adaeze Okoye");
  });

  it("matches a title case-insensitively", () => {
    expect(formatDoctorName("dr Adaeze Okoye")).toBe("dr Adaeze Okoye");
  });
});
