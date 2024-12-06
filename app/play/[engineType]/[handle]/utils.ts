import { getBundleMetadata } from "../../../../lib/gameCatalog";

const BUNDLE_BASE_URL = "https://play.yian.dev";

declare global {
  interface Window {
    createUnityInstance: (
      canvas: Element | null,
      options: {
        dataUrl: string;
        frameworkUrl: string;
        codeUrl: string;
        streamingAssetsUrl: string;
        companyName: string;
        productName: string;
        productVersion: string;
      }
    ) => void;
  }
}

export const createUnityInstance = (targetElm: Element | null, bundleId: string) => {
  if (!targetElm || !bundleId) {
    console.error("Invalid target element or bundle metadata");
    return;
  }

  const bundleMetadata = getBundleMetadata(bundleId);
  if (!bundleMetadata) {
    console.error("Invalid bundle metadata");
    return;
  }

  const { id, name, version } = bundleMetadata;

  window.createUnityInstance(targetElm, {
    dataUrl: `${BUNDLE_BASE_URL}/${id}/WebGL.data`,
    frameworkUrl: `${BUNDLE_BASE_URL}/${id}/WebGL.framework.js`,
    codeUrl: `${BUNDLE_BASE_URL}/${id}/WebGL.wasm`,
    streamingAssetsUrl: "StreamingAssets", // ?
    companyName: "play.yian.dev",
    productName: name,
    productVersion: version,
  });
};
