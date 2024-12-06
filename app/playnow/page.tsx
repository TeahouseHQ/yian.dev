"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import Grid from "#/components/playnow/Grid";

const GameProvider = dynamic(
  () => import("#/components/playnow/GameProvider"),
  { ssr: false }
);

export default function Index() {
  const [seed, setSeed] = useState<number>(
    Math.floor(Math.random() * Date.now())
  );

  return (
    <GameProvider seed={seed}>
      <div className="p-5 flex flex-col items-center">
        <h1 className="text-3xl font-bold text-gray-800 mb-5">Tile Flip</h1>
        <Grid />
      </div>
    </GameProvider>
  );
}
