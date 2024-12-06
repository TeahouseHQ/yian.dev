"use client";

import Grid from "#/components/playnow/Grid";
import { GameProvider } from "#/lib/GameContext";

function App() {
  return (
    <GameProvider>
      <div className="p-5 flex flex-col items-center">
        <h1 className="text-3xl font-bold text-gray-800 mb-5">
          Tile Flipping Game
        </h1>
        <Grid />
      </div>
    </GameProvider>
  );
}

export default App;
