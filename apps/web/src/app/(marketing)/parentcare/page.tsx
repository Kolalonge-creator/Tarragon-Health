import { notFound } from "next/navigation";
import { ProductPageTemplate } from "../_components/product-page-template";
import { getProductPage } from "../_content/products";

export function generateMetadata() {
  const content = getProductPage("parentcare");
  return content?.metadata ?? {};
}

export default function ParentCarePage() {
  const content = getProductPage("parentcare");
  if (!content) notFound();
  return <ProductPageTemplate content={content} />;
}
