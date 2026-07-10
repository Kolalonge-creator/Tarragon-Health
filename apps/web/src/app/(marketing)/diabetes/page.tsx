import { notFound } from "next/navigation";
import { ProductPageTemplate } from "../_components/product-page-template";
import { getProductPage } from "../_content/products";

export function generateMetadata() {
  const content = getProductPage("diabetes");
  return content?.metadata ?? {};
}

export default function DiabetesPage() {
  const content = getProductPage("diabetes");
  if (!content) notFound();
  return <ProductPageTemplate content={content} />;
}
