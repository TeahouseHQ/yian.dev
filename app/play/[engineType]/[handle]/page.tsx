import React from "react";

import GodotRenderer from "./components/GodotRenderer";
import UnityRenderer from "./components/UnityRenderer";
import { GameBundles } from "../../../../lib/gameCatalog";

interface Params {
  engineType: "g" | "u";
  handle: string;
}

export const dynamicParams = false;

export default async function Index(props: {
  params: Promise<Params>;
}): Promise<React.JSX.Element> {
  const { handle, engineType } = await props.params;

  return engineType === "g" ? <GodotRenderer handle={handle} /> : <UnityRenderer handle={handle} />;
}

export async function generateStaticParams(): Promise<Params[]> {
  return Object.values(GameBundles).map((bundle) => ({
    engineType: bundle.engineType === "godot" ? "g" : "u",
    handle: bundle.id,
  }));
}
