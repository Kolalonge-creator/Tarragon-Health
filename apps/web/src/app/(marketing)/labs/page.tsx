import { notFound } from "next/navigation";
import { ProductPageTemplate } from "../_components/product-page-template";
import { getProductPage } from "../_content/products";

export function generateMetadata() {
  const content = getProductPage("labs");
  return content?.metadata ?? {};
}

export default function LabsPage() {
  const content = getProductPage("labs");
  if (!content) notFound();
  return <ProductPageTemplate content={content} />;
}
