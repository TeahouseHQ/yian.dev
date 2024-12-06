import { useState } from "react";

import Grid from "#/components/playnow/Grid";
import { useGame } from "#/lib/GameContext";

export default function Game() {
  const { isGameOver, resetGame, score } = useGame();

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="text-2xl font-bold">Score: {score}</div>
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
