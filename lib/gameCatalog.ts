import { Url } from "next/dist/shared/lib/router/router";

export type BundleMetadata = {
  id: string;
  name: string;
  version: string;
  description?: string;
  screenshots: string[];
  engineType: "godot" | "unity";
  metadata?: Record<string, unknown>;
};

export const GameBundles: Record<string, BundleMetadata> = {
  "floppy-bird": {
    id: "floppy-bird",
    name: "Floppy Bird",
    version: "1.0.0",
    engineType: "unity",
    screenshots: ["/assets/images/floppybird.png"],
  },
  "pop-le-lock": {
    id: "pop-le-lock",
    name: "Pop Le Lock",
    version: "1.0.0",
    engineType: "unity",
    screenshots: ["/assets/images/poplelock.png"],
  },
  challenge5: {
    id: "challenge5",
    name: "Challenge 5",
    version: "1.0.0",
    engineType: "unity",
    screenshots: ["/assets/images/challenge5.png"],
  },
  "hello-dot": {
    id: "hello-dot",
    name: "Hello Dot",
    version: "1.0.0",
    engineType: "godot",
    screenshots: ["/assets/images/hellodot.png"],
    metadata: {
      config: {
        args: [],
        canvasResizePolicy: 0,
        executable: "helloDot",
        experimentalVK: false,
        fileSizes: { "helloDot.pck": 150416, "helloDot.wasm": 35708238 },
        focusCanvas: true,
        gdextensionLibs: [],
      },
    },
  },
};

export const getBundleMetadata = (handle: string): BundleMetadata | undefined => {
  return GameBundles[handle];
};

export const getGamePath = (handle: string): Url => {
  const metadata = getBundleMetadata(handle);
  if (!metadata) {
    return "";
  }
  const engineType = metadata.engineType === "godot" ? "g" : "u";
  return `/play/${engineType}/${handle}`;
};
