import React from "react";

import GodotRenderer from "./components/godotRenderer";
import UnityRenderer from "./components/unityRenderer";
import { GameBundles } from "../../../../lib/gameCatalog";

interface Params {
  engineType: "g" | "u";
  handle: string;
}

type PageProps = {
  params: Params;
};

export const dynamicParams = false;

export default function Index({ params }: PageProps): JSX.Element {
  const { handle, engineType } = params;

  return engineType === "g" ? (
    <GodotRenderer handle={handle} />
  ) : (
    <UnityRenderer handle={handle} />
  );
}

export async function generateStaticParams(): Promise<Params[]> {
  return Object.values(GameBundles).map((bundle) => ({
    engineType: bundle.engineType === "godot" ? "g" : "u",
    handle: bundle.id,
  }));
}
