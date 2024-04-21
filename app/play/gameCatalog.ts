export type BundleMetadata = {
  id: string;
  name: string;
  version: string;
  description?: string;
};

export const GameBundles: Record<string, BundleMetadata> = {
  "floppy-bird": {
    id: "floppy-bird",
    name: "Floppy Bird",
    version: "1.0.0",
  },
  "pop-le-lock": {
    id: "pop-le-lock",
    name: "Pop Le Lock",
    version: "1.0.0",
  },
  challenge5: {
    id: "challenge5",
    name: "Challenge 5",
    version: "1.0.0",
  },
};

export const getBundleMetadata = (
  handle: string
): BundleMetadata | undefined => {
  return GameBundles[handle];
};
