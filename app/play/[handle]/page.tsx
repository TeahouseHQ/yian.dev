import React from "react";

import GodotRenderer from "./components/godotRenderer";
import UnityRenderer from "./components/unityRenderer";
import { GameBundles, getBundleMetadata } from "../gameCatalog";

interface Params {
  handle: string;
}

type PageProps = {
  params: Params;
};

export const dynamicParams = false;

export default function Index({ params }: PageProps): JSX.Element {
  const { handle } = params;
  const { engineType } = getBundleMetadata(handle) || {};

  return engineType === "godot" ? (
    <GodotRenderer handle={handle} />
  ) : (
    <UnityRenderer handle={handle} />
  );
}

export async function generateStaticParams(): Promise<Params[]> {
  return Object.keys(GameBundles).map((handle) => ({ handle }));
}
