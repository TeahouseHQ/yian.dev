"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import Game from "#/components/playnow/Game";

const GameProvider = dynamic(
  () => import("#/components/playnow/GameProvider"),
  { ssr: false }
);

export default function Index() {
  return (
    <GameProvider>
      <Game />
    </GameProvider>
  );
}
