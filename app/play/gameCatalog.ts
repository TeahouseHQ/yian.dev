export type BundleMetadata = {
  id: string;
  name: string;
  version: string;
  description?: string;
  engineType: "godot" | "unity";
  metadata?: Record<string, unknown>;
};

export const GameBundles: Record<string, BundleMetadata> = {
  "floppy-bird": {
    id: "floppy-bird",
    name: "Floppy Bird",
    version: "1.0.0",
    engineType: "unity",
  },
  "pop-le-lock": {
    id: "pop-le-lock",
    name: "Pop Le Lock",
    version: "1.0.0",
    engineType: "unity",
  },
  challenge5: {
    id: "challenge5",
    name: "Challenge 5",
    version: "1.0.0",
    engineType: "unity",
  },
  "hello-dot": {
    id: "hello-dot",
    name: "Hello Dot",
    version: "1.0.0",
    engineType: "godot",
    metadata: {
      config: {
        args: [],
        canvasResizePolicy: 1,
        executable: "helloDot",
        experimentalVK: false,
        fileSizes: { "helloDot.pck": 148944, "helloDot.wasm": 35708238 },
        focusCanvas: true,
        gdextensionLibs: [],
      },
    },
  },
};

export const getBundleMetadata = (
  handle: string
): BundleMetadata | undefined => {
  return GameBundles[handle];
};
