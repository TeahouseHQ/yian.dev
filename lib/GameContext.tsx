import { createContext, useContext } from "react";
import { GameContextType, Tile, TileValue } from "types/game";

import { mulberry32 } from "#/lib/random";

export const GameContext = createContext<GameContextType>({
  grid: [],
  revealTile: () => {},
  seed: 0,
  isGameOver: false,
});

// Create a 5x5 grid with random values (1, 2, 3, or bomb)
export const createInitialGrid = (seed: number): Tile[][] => {
  const rng = mulberry32(seed);

  const grid: Tile[][] = [];
  for (let i = 0; i < 5; i++) {
    const row: Tile[] = [];
    for (let j = 0; j < 5; j++) {
      const values: TileValue[] = [1, 2, 3, 0];
      const randomValue = values[Math.floor(rng() * values.length)];
      row.push({
        value: randomValue,
        isRevealed: false,
      });
    }
    grid.push(row);
  }
  return grid;
};

export const useGame = (): GameContextType => {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error("useGame must be used within a GameProvider");
  }
  return context;
};
