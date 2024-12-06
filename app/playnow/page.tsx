"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import Game from "#/components/playnow/Game";

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
      <Game />
    </GameProvider>
  );
}
