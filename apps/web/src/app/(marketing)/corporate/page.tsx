import { B2bPageTemplate } from "../_components/b2b-page-template";
import { B2B_PAGES } from "../_content/b2b";

export function generateMetadata() {
  return B2B_PAGES.corporate.metadata;
}

export default function CorporatePage() {
  return <B2bPageTemplate content={B2B_PAGES.corporate} />;
}
