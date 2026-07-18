import { B2bPageTemplate } from "../_components/b2b-page-template";
import { B2B_PAGES } from "../_content/b2b";

export function generateMetadata() {
  return B2B_PAGES.hmo.metadata;
}

export default function HmoPage() {
  return <B2bPageTemplate content={B2B_PAGES.hmo} />;
}
