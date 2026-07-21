/** Metro resolves static image assets to an opaque module id. */
declare module "*.png" {
  const assetId: number;
  export default assetId;
}
