import { notFound } from "next/navigation";
import { ProductPageTemplate } from "../_components/product-page-template";
import { getProductPage } from "../_content/products";

export function generateMetadata() {
  const content = getProductPage("medication");
  return content?.metadata ?? {};
}

export default function MedicationPage() {
  const content = getProductPage("medication");
  if (!content) notFound();
  return <ProductPageTemplate content={content} />;
}
