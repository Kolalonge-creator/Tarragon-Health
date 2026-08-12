import { loadResourceArticle } from "@/lib/marketing/resources-data";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../../_components/og-card";

export const alt = "TarragonHealth resource article";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = await loadResourceArticle(slug);
  return renderOgImage({
    title: article?.title ?? "TarragonHealth",
    subtitle: article?.description ?? "",
  });
}
