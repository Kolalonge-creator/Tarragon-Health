import {
  breadcrumbJsonLd,
  breadcrumbTrail,
  humaniseSegment,
  paidServicesJsonLd,
  parseNairaAmount,
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

describe("parseNairaAmount", () => {
  it("parses the formatted strings the pricing page renders", () => {
    expect(parseNairaAmount("₦50,000")).toBe(50000);
    expect(parseNairaAmount("₦2,500")).toBe(2500);
    expect(parseNairaAmount(" ₦999 ")).toBe(999);
    expect(parseNairaAmount("₦1,234.50")).toBe(1234.5);
  });

  it("refuses anything that is not a plain naira amount", () => {
    // A confident, wrong `price` in structured data is worse than no Offer.
    expect(parseNairaAmount("From ₦2,500")).toBeNull();
    expect(parseNairaAmount("$25")).toBeNull();
    expect(parseNairaAmount("Free")).toBeNull();
    expect(parseNairaAmount("")).toBeNull();
  });
});

describe("paidServicesJsonLd", () => {
  const build = (price: string) =>
    paidServicesJsonLd({
      services: [{ id: "a", name: "Ask a Doctor", description: "One written question.", price }],
      pageUrl: "https://tarragonhealth.ng/pricing",
      providerName: "TarragonHealth",
      providerUrl: "https://tarragonhealth.ng",
    }) as {
      hasOfferCatalog: { itemListElement: { price: string; priceCurrency: string }[] };
    };

  it("prices every offer in NGN", () => {
    const offers = build("₦2,500").hasOfferCatalog.itemListElement;
    expect(offers).toHaveLength(1);
    expect(offers[0]!.price).toBe("2500");
    expect(offers[0]!.priceCurrency).toBe("NGN");
  });

  it("drops an entry whose price is not a parseable amount", () => {
    expect(build("Ask us").hasOfferCatalog.itemListElement).toHaveLength(0);
  });
});
