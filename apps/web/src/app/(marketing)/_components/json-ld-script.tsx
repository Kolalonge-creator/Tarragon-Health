import type { JsonLd } from "@/lib/marketing/structured-data";

/**
 * Serialise JSON-LD for a script tag. `<` is escaped so a string containing
 * `</script>` can never close the block early.
 */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function JsonLdScript({ data }: { data: JsonLd }) {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />
  );
}
