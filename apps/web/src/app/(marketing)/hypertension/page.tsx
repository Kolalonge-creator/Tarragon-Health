import { notFound } from "next/navigation";
import { ProductPageTemplate } from "../_components/product-page-template";
import { getProductPage } from "../_content/products";

export function generateMetadata() {
  const content = getProductPage("hypertension");
  return content?.metadata ?? {};
}

export default function HypertensionPage() {
  const content = getProductPage("hypertension");
  if (!content) notFound();
  return <ProductPageTemplate content={content} />;
}
