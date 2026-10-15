import {
  breadcrumbJsonLd,
  breadcrumbTrail,
  humaniseSegment,
  medicalWebPageJsonLd,
} from "./structured-data";

describe("breadcrumbTrail", () => {
  it("returns nothing for the homepage", () => {
    // A one-item BreadcrumbList is noise; Google ignores it.
    expect(breadcrumbTrail("/")).toEqual([]);
    expect(breadcrumbTrail("")).toEqual([]);
  });

  it("labels a known top-level route from the route table", () => {
    expect(breadcrumbTrail("/pricing")).toEqual([
      { name: "Home", path: "/" },
      { name: "Pricing", path: "/pricing" },
    ]);
  });

  it("builds one crumb per segment for a nested route", () => {
    expect(breadcrumbTrail("/pricing/how-it-works")).toEqual([
      { name: "Home", path: "/" },
      { name: "Pricing", path: "/pricing" },
      { name: "How pricing works", path: "/pricing/how-it-works" },
    ]);
  });

  it("humanises an unknown leaf segment (resource article slugs)", () => {
    expect(breadcrumbTrail("/resources/understanding-blood-pressure")).toEqual([
      { name: "Home", path: "/" },
      { name: "Health resources", path: "/resources" },
      {
        name: "Understanding blood pressure",
        path: "/resources/understanding-blood-pressure",
      },
    ]);
  });

  it("ignores a trailing slash, a query string and a hash", () => {
    const expected = breadcrumbTrail("/pricing");
    expect(breadcrumbTrail("/pricing/")).toEqual(expected);
    expect(breadcrumbTrail("/pricing?channel=hmo")).toEqual(expected);
    expect(breadcrumbTrail("/pricing#faq")).toEqual(expected);
  });
});

describe("humaniseSegment", () => {
  it("turns a slug into a sentence-case phrase", () => {
    expect(humaniseSegment("how-it-works")).toBe("How it works");
    expect(humaniseSegment("annual_health_check")).toBe("Annual health check");
  });
});

describe("breadcrumbJsonLd", () => {
  it("is null on the homepage", () => {
    expect(breadcrumbJsonLd("/")).toBeNull();
  });

  it("emits absolute item URLs and 1-based positions", () => {
    const jsonLd = breadcrumbJsonLd("/pricing/how-it-works") as {
      "@type": string;
      itemListElement: { position: number; name: string; item: string }[];
    };
    expect(jsonLd["@type"]).toBe("BreadcrumbList");
    expect(jsonLd.itemListElement.map((i) => i.position)).toEqual([1, 2, 3]);
    for (const item of jsonLd.itemListElement) {
      expect(item.item).toMatch(/^https?:\/\//);
    }
  });
});

describe("medicalWebPageJsonLd", () => {
  const base = {
    name: "Hypertension Monitoring",
    description: "Log blood pressure and get doctor review when readings drift.",
    path: "/hypertension",
    providerName: "TarragonHealth",
    providerUrl: "https://tarragonhealth.ng",
  };

  it("emits a MedicalWebPage with an absolute url and no outcome claims", () => {
    const result = medicalWebPageJsonLd(base);
    expect(result).toMatchObject({
      "@type": "MedicalWebPage",
      name: "Hypertension Monitoring",
      url: expect.stringMatching(/^https?:\/\/.+\/hypertension$/),
    });
    expect(Object.keys(result ?? {})).not.toContain("medicalAudience");
  });

  it("returns null rather than an empty block when title or description is missing", () => {
    expect(medicalWebPageJsonLd({ ...base, name: undefined })).toBeNull();
    expect(medicalWebPageJsonLd({ ...base, description: "   " })).toBeNull();
  });
});
