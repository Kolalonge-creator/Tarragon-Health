import type { MetadataRoute } from "next";

/** The console is a staff tool. It is never indexed. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
