import { useState } from "react";

import Grid from "#/components/playnow/Grid";
import { useGame } from "#/lib/GameContext";

export default function Game() {
  const { isGameOver, resetGame } = useGame();

  return (
    <div className="p-5 flex flex-col items-center">
      <h1 className="text-3xl font-bold text-gray-800 mb-5">Tile Flip</h1>
      <Grid />
      {isGameOver && (
        <>
          <div>Game Over</div>
          <button onClick={resetGame}>Reset Game</button>
        </>
      )}
    </div>
  );
}
