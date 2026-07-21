import { notFound } from "next/navigation";
import { ProductPageTemplate } from "../_components/product-page-template";
import { getProductPage } from "../_content/products";

export function generateMetadata() {
  const content = getProductPage("obesity");
  return content?.metadata ?? {};
}

export default function ObesityPage() {
  const content = getProductPage("obesity");
  if (!content) notFound();
  return <ProductPageTemplate content={content} />;
}
