import { notFound } from "next/navigation";
import { ProductPageTemplate } from "../_components/product-page-template";
import { getProductPage } from "../_content/products";

export function generateMetadata() {
  const content = getProductPage("prevention");
  return content?.metadata ?? {};
}

export default function PreventionPage() {
  const content = getProductPage("prevention");
  if (!content) notFound();
  return <ProductPageTemplate content={content} />;
}
